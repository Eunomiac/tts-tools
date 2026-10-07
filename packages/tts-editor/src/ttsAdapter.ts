import { connectGateway, type GatewaySession } from "@tts-tools/gateway-client";
import { TTSObject as SaveFileObject, bundleObject, unbundleObject } from "@tts-tools/savefile";
import { Range, Uri, window, workspace } from "vscode";

import { command } from "./command";
import configuration from "./configuration";
import { ensureGatewayHelper } from "./gateway/ensureHelper";
import { stopGatewayHelper } from "./gateway/stopHelper";
import { selectObject } from "./interaction/selectObject";
import {
  bundleLua,
  bundleXml,
  findNearestBundle,
  getRootName,
  isBundled,
  unbundleLua,
  unbundleXml,
} from "./io/bundle";
import { getOutputFileUri, getOutputPath, OutputType, readOutputFile, writeOutputFile } from "./io/files";
import { ImportMutex } from "./io/importMutex";
import {
  clearOutputFolders,
  looksLikeLuaRequireStub,
  looksLikeXmlIncludeStub,
  ObjectReadMode,
  reconcileObjectsFromState,
  removeOrphanedObjectFiles,
} from "./io/objectSync";
import {
  EditorMessage,
  MessageFormat,
  RequestEditorMessage,
  RequestObjectMessage,
  WriteContentMessage,
} from "./message";
import { LoadedObject } from "./model/objectData";
import { Plugin } from "./plugin";
import { luaLongString } from "./tts/luaString";
import {
  CustomMessage,
  ErrorMessage,
  LoadingANewGame,
  ObjectCreated,
  OutgoingJsonObject,
  PrintDebugMessage,
  PushingNewObject,
} from "./tts/externalEditorApi";

const polyFills = ["object", "write"];
const ROUTE_TAG = "TTSTOOLS";
const CLIENT_ID = "ttstools-extension";

export class TTSAdapter {
  private session: GatewaySession | undefined;
  private plugin: Plugin;
  private lastError: Maybe<ErrorMessage> = undefined;
  private importMutex = new ImportMutex();
  /** True when this session went through the gateway helper, so releasing should stop that helper. */
  private connectedViaHelper = false;
  private hasWarnedAboutHelperFallback = false;
  /** Set before Save & Play so the following loadingANewGame uses the fast echo path. */
  private expectSaveAndPlayEcho = false;
  private forceFullResyncOnEcho = false;
  private pendingSentScripts: OutgoingJsonObject[] | undefined;

  public constructor(plugin: Plugin) {
    this.plugin = plugin;
    void this.connectOnActivate();
  }

  /** Connect to TTS using the configured connection mode (the status bar's "Claim"). */
  public claimEditorPort = async (): Promise<void> => {
    try {
      const detail = await this.plugin.progress("Connecting to Tabletop Simulator", async () =>
        this.describeSession(await this.connectSession())
      );
      this.plugin.info(detail);
      window.showInformationMessage(detail);
    } catch (e) {
      const message = `${e}`;
      this.plugin.setPortStatus("error", message);
      this.plugin.error(message);
      window.showErrorMessage(message);
    }
  };

  /** Disconnect so another local tool can listen on the TTS editor port. */
  public releaseEditorPort = async (): Promise<void> => {
    try {
      await this.disconnectSession();
      const detail = "Released the TTS editor port. Another local tool can use it now.";
      this.plugin.setPortStatus("released", detail);
      this.plugin.info(detail);
      window.showInformationMessage(detail);
    } catch (e) {
      const message = `Could not release editor port: ${e}`;
      this.plugin.setPortStatus("error", message);
      this.plugin.error(message);
      window.showErrorMessage(message);
    }
  };

  /** Reconnect after a connection setting changed. */
  public reconnect = async (): Promise<void> => {
    await this.disconnectSession();
    await this.claimEditorPort();
  };

  public isHoldingEditorPort = (): boolean => this.session !== undefined;

  /** Called from extension deactivate. */
  public dispose = async (): Promise<void> => {
    try {
      await this.disconnectSession();
    } catch (e) {
      this.plugin.error(`dispose: ${e}`);
    }
    this.plugin.setPortStatus("released", "Extension deactivated.");
  };

  private connectOnActivate = async () => {
    try {
      this.plugin.info(this.describeSession(await this.connectSession()));
    } catch (e) {
      const message = `Could not connect to TTS (${e}). Use “Claim TTS Editor Port” to retry.`;
      this.plugin.setPortStatus("error", message);
      this.plugin.error(message);
    }
  };

  private connectSession = async (): Promise<GatewaySession> => {
    if (this.session) {
      return this.session;
    }
    const session =
      configuration.connectionMode() === "gateway"
        ? await this.connectThroughGatewayHelper()
        : await this.connectDirectly();
    this.bindSession(session);
    this.session = session;
    this.plugin.setPortStatus(session.mode === "gateway" ? "gateway" : "holding", this.describeSession(session));
    return session;
  };

  /** Joins a gateway that another tool already runs; otherwise listens on the editor port itself. */
  private connectDirectly = async (): Promise<GatewaySession> =>
    connectGateway({ routeTag: ROUTE_TAG, clientId: CLIENT_ID, failover: true });

  private connectThroughGatewayHelper = async (): Promise<GatewaySession> => {
    try {
      await ensureGatewayHelper(this.plugin.fileHandler.extensionPath, undefined, this.plugin.info);
    } catch (error) {
      this.warnAboutHelperFallback(error);
      return this.connectDirectly();
    }
    this.connectedViaHelper = true;
    // The extension owns the helper's lifecycle, so it must not grab the editor port behind the helper's back.
    return connectGateway({ routeTag: ROUTE_TAG, clientId: CLIENT_ID, failover: false });
  };

  private warnAboutHelperFallback = (error: unknown) => {
    this.plugin.error(`The TTS gateway helper could not start: ${error}`);
    if (this.hasWarnedAboutHelperFallback) {
      return;
    }
    this.hasWarnedAboutHelperFallback = true;
    void window
      .showWarningMessage(
        "TTS Tools could not start its gateway helper, so it connected to TTS directly. " +
          "Everything in the editor works, but other local tools (such as the MCP server for AI agents) " +
          "cannot share the connection. Details are in the TTS Editor output.",
        "Show Output"
      )
      .then((choice) => {
        if (choice === "Show Output") {
          this.plugin.showOutput();
        }
      });
  };

  private describeSession = (session: GatewaySession): string =>
    session.mode === "gateway"
      ? "Connected to TTS through the gateway helper (other local tools can share the connection)."
      : "Connected to TTS directly on the editor port.";

  private disconnectSession = async (): Promise<void> => {
    if (this.session) {
      try {
        await this.session.close();
      } catch {
        // Already closed.
      }
      this.session = undefined;
    }
    if (this.connectedViaHelper) {
      this.connectedViaHelper = false;
      await stopGatewayHelper(undefined, this.plugin.info);
    }
  };

  private requireSession = (): GatewaySession => {
    if (!this.session) {
      throw new Error("Not connected to TTS gateway. Use Claim TTS Editor Port first.");
    }
    return this.session;
  };

  private bindSession = (session: GatewaySession) => {
    session.on("loadingANewGame", (payload) => {
      void this.onLoadGame(payload as unknown as LoadingANewGame);
    });
    session.on("pushingNewObject", (payload) => {
      void this.onPushObject(payload as unknown as PushingNewObject);
    });
    session.on("objectCreated", (payload) => {
      void this.onObjectCreated(payload as unknown as ObjectCreated);
    });
    session.on("print", (message) => {
      void this.onPrintDebugMessage({ messageID: 2, message } as PrintDebugMessage);
    });
    session.on("error", (payload) => {
      void this.onErrorMessage(payload as unknown as ErrorMessage);
    });
    session.on("customMessage", (payload) => {
      void this.onCustomMessage(payload as unknown as CustomMessage);
    });
    session.on("status", (status) => {
      if (status.mode === "disconnected") {
        this.session = undefined;
        this.plugin.setPortStatus("error", status.detail ?? "Gateway disconnected");
      } else if (status.mode === "gateway") {
        this.plugin.setPortStatus("gateway", status.detail ?? "Connected via gateway");
      } else if (status.mode === "direct") {
        this.plugin.setPortStatus("holding", status.detail ?? "Listening on the editor port directly");
      }
    });
  };

  /**
   * Retrieves scripts from currently open game.
   */
  public getObjects = async () => {
    await this.requireSession().getLuaScripts();
  };

  /**
   * Sends the bundled scripts to TTS.
   *
   * By default the Save & Play echo uses a fast sync (no wipe, no N× getJSON).
   * Pass `fullResync: true` or enable `ttsEditor.resyncAfterSaveAndPlay` for a full getJSON rebuild.
   */
  public saveAndPlay = async (
    bundled: OutputType = "script",
    options: { fullResync?: boolean } = {}
  ) => {
    try {
      await saveAllFiles();

      const { scripts, errors } = await this.plugin.progress("Bundling scripts", async () =>
        this.createScripts(bundled)
      );

      if (errors.size === 0) {
        this.expectSaveAndPlayEcho = true;
        this.forceFullResyncOnEcho = options.fullResync === true || configuration.resyncAfterSaveAndPlay();
        this.pendingSentScripts = scripts;
        this.plugin.progress("Sending scripts to TTS", async () => this.requireSession().saveAndPlay(scripts));
      } else {
        [...errors].forEach((message) => window.showErrorMessage(message));
      }
    } catch (e) {
      this.plugin.error(`${e}`);
    }
  };

  /** Save & Play then force a full getJSON resync on the reload echo. */
  public saveAndPlayFullResync = async (bundled: OutputType = "script") => {
    return this.saveAndPlay(bundled, { fullResync: true });
  };

  /**
   * Executes the given Lua script in TTS.
   *
   * @param script the Lua script to execute
   */
  public executeCode = async <T = void>(script: string, parameters: Record<string, string> = {}) => {
    let completeScript = "";
    let hasPolyFill = false;

    const getPolyFill = async (name: string) => this.plugin.fileHandler.readExtensionFile(`polyFill/${name}.lua`);

    for (const polyFill of polyFills) {
      if (script.includes(`__${polyFill}__`)) {
        hasPolyFill = true;
        let content = await getPolyFill(polyFill);
        for (const [name, value] of Object.entries(parameters)) {
          content = content.replace(`$\{${name}}`, value);
        }
        completeScript += content + "\n\n";
      }
    }

    if (hasPolyFill) {
      completeScript = (await getPolyFill("messageBridge")) + "\n\n" + completeScript;
    }

    completeScript += script;

    return this.requireSession().executeLua(completeScript) as Promise<T>;
  };

  public executeMacro = async (name: string, object?: LoadedObject) => {
    const command = await this.plugin.fileHandler.readExtensionFile(`macro/${name}.lua`);
    const parameters: Record<string, string> = {};

    if (object) {
      parameters.guid = object.guid;
    }

    this.executeCode(command, parameters);
  };

  /**
   * Sends a custom structured object.
   *
   * @param object - Table to be sent to game
   */
  public async customMessage(object: EditorMessage) {
    return this.requireSession().customMessage(object);
  }

  /**
   * Refresh one object's `.tts` files from the **live** table (not the save file on disk).
   * Uses `getObjectFromGUID` + `getJSON` in the running game; does not prune other loaded objects.
   */
  public async getObject(object: LoadedObject) {
    if (object.isGlobal) {
      window.showWarningMessage("Get Object is for table objects. Use Get Objects to refresh Global.");
      return;
    }
    try {
      await this.plugin.progress(`Reading ${object.name}`, async () => {
        await this.readObject(object.guid, false);
      });
      this.plugin.setStatus(`Updated ${object.name} (${object.guid}) from live TTS.`);
      command.refreshView();
    } catch (e) {
      window.showErrorMessage(`Error while getting object ${object.guid}:\n${e}`);
    }
  }

  /**
   * Respawn an object with its local script, UI and state. Everything else (position, contents,
   * nested objects) comes from the live table by default, or from `data.json` when
   * `ttsEditor.updateObject.source` is `dataFile`.
   */
  public async updateObject(object: LoadedObject) {
    const readObjectFile = async (extension: string) => {
      try {
        return await this.plugin.fileHandler.readOutputFile(object, extension, "script");
      } catch (_) {
        return undefined;
      }
    };

    try {
      const data = await this.loadObjectDataForUpdate(object, readObjectFile);
      if (!data) {
        return;
      }
      data.LuaScript = await readObjectFile("lua");
      data.XmlUI = await readObjectFile("xml");

      const state = await readObjectFile("state.txt");
      if (state) {
        data.LuaScriptState = state;
      }

      const bundled = bundleObject(data, {
        includePath: configuration.xmlIncludePaths(),
      });

      const script = `
local obj = getObjectFromGUID("${object.guid}")
obj.destruct()

spawnObjectJSON({
  json = ${luaLongString(JSON.stringify(bundled))}
})
`;

      await this.executeCode(script);

      await this.readObject(bundled.GUID);
    } catch (e) {
      window.showErrorMessage(`Error while updating object ${object.guid}:\n${e}`);
      return;
    }

    command.refreshView();
  }

  private loadObjectDataForUpdate = async (
    object: LoadedObject,
    readObjectFile: (extension: string) => Promise<string | undefined>
  ): Promise<SaveFileObject | undefined> => {
    if (configuration.updateObjectSource() === "liveTable") {
      const liveData = await this.getObjectData(object.guid);
      if (!liveData) {
        window.showErrorMessage(`Object ${object.guid} is no longer on the table.`);
        return undefined;
      }
      // Unbundled, so nested objects' scripts get re-bundled from the current include files.
      return unbundleObject(liveData);
    }

    const dataFile = await readObjectFile("data.json");
    if (!dataFile) {
      window.showErrorMessage(`Can not find data file for object ${object.guid}`);
      return undefined;
    }
    return JSON.parse(dataFile) as SaveFileObject;
  };

  public goToLastError = () => {
    if (this.lastError) {
      this.goToError(this.lastError);
    } else {
      window.showWarningMessage("There was no previous error");
    }
  };

  public unbundleLibrary = async () => {
    await this.clearLibraryPath();
    for (const obj of this.plugin.getLoadedObjects()) {
      this.unbundleLuaLibrary(obj);
      this.unbundleXmlLibrary(obj);
    }
  };

  private unbundleLuaLibrary = async (obj: LoadedObject) => {
    const fileName = `${obj.fileName}.lua`;
    const source = await readOutputFile(fileName, "bundle");
    if (source && isBundled(source)) {
      const moduleInfo = unbundleLua(source);
      for (const [name, module] of Object.entries(moduleInfo.modules)) {
        if (name !== moduleInfo.metadata.rootModuleName) {
          const modulePath = module.name.replace(/\./g, "/");
          writeOutputFile(`${modulePath}.lua`, module.content, "library");
        }
      }
    }
  };

  private unbundleXmlLibrary = async (obj: LoadedObject) => {
    const fileName = `${obj.fileName}.xml`;
    const source = await readOutputFile(fileName, "bundle");
    if (source) {
      const moduleInfo = unbundleXml(source);
      for (const [_, module] of Object.entries(moduleInfo.bundles)) {
        const modulePath = module.name.replace(/\./g, "/");
        writeOutputFile(`${modulePath}.xml`, module.content, "library");
      }
    }
  };

  private onLoadGame = async (message: LoadingANewGame) => {
    this.plugin.debug("recieved onLoadGame");
    this.lastError = undefined;

    const isEcho = this.expectSaveAndPlayEcho;
    const forceFull = this.forceFullResyncOnEcho;
    const sentScripts = this.pendingSentScripts;
    this.expectSaveAndPlayEcho = false;
    this.forceFullResyncOnEcho = false;
    this.pendingSentScripts = undefined;

    let mode: ObjectReadMode;
    if (configuration.syncMode() === "classic" || (isEcho && forceFull)) {
      mode = "full";
    } else if (isEcho) {
      mode = "echo";
    } else {
      mode = "incremental";
    }

    // loadingANewGame lists every scripted object, so anything else on disk or in the tree is gone —
    // except for our own fast echo, which only refreshes what was just sent.
    const isCompleteInventory = mode !== "echo";
    const cleanUp = configuration.cleanUpOnLoad();

    const title = mode === "echo" ? "Updating scripts" : mode === "full" ? "Reading objects (full)" : "Syncing objects";
    await this.importMutex.runExclusive(async () => {
      await this.plugin.progress(title, async () => {
        if (isCompleteInventory && cleanUp === "everything") {
          await clearOutputFolders();
          this.plugin.resetLoadedObjects();
        }

        await reconcileObjectsFromState(this.objectSyncDeps(), {
          mode,
          scriptStates: message.scriptStates,
          sentScripts,
          openFiles: false,
          pruneMissing: isCompleteInventory,
          preserveGlobalStubs: configuration.preserveGlobalStubs(),
          deleteStaleFiles: cleanUp !== "nothing",
        });

        if (isCompleteInventory && cleanUp === "removedObjects") {
          await removeOrphanedObjectFiles(this.plugin, this.plugin.info);
        }
      });
    });
  };

  private onPushObject = async (message: PushingNewObject) => {
    this.plugin.debug(`recieved onPushObject ${message.messageID}`);
    await this.importMutex.runExclusive(async () => {
      await this.plugin.progress("Reading object", async () =>
        reconcileObjectsFromState(this.objectSyncDeps(), {
          mode: configuration.syncMode() === "classic" ? "full" : "incremental",
          scriptStates: message.scriptStates,
          openFiles: true,
          preserveGlobalStubs: configuration.preserveGlobalStubs(),
          deleteStaleFiles: configuration.cleanUpOnLoad() !== "nothing",
        })
      );
    });
  };

  private objectSyncDeps = () => ({
    plugin: this.plugin,
    getObjectData: this.getObjectData,
    debug: this.plugin.debug,
  });

  private onObjectCreated = async (message: ObjectCreated) => {
    this.plugin.debug(`recieved onObjectCreated ${message.guid}`);
  };

  private onPrintDebugMessage = async (message: PrintDebugMessage) => {
    this.plugin.info(message.message);
  };

  private onErrorMessage = async (message: ErrorMessage) => {
    this.lastError = message;
    this.plugin.info(`${message.guid} ${message.errorMessagePrefix}`);

    const action = await window.showErrorMessage(`${message.errorMessagePrefix}`, "Go To Error");
    if (action === "Go To Error") {
      this.goToError(message);
    }
  };

  private goToError = async (message: ErrorMessage) => {
    const object = this.plugin.getLoadedObject(message.guid);
    if (!object) {
      window.showWarningMessage(
        `No scripts are currently loaded for object ${message.guid}. Try using command 'Get Objects' first.`
      );
      return;
    }

    const fileName = `${object.fileName}.lua`;
    const source = await readOutputFile(fileName, "bundle");
    if (!source) {
      window.showWarningMessage(`Can not find the script file for object ${object.guid}`);
      return;
    }

    const range = this.getRange(message.errorMessagePrefix);
    let fileToShow = getOutputFileUri(fileName);

    if (isBundled(source)) {
      const bundleInfo = await findNearestBundle(source, range.line);
      if (bundleInfo) {
        const { name: bundleName, offset } = bundleInfo;
        if (getRootName(source) === bundleName) {
          // the output file is the one we need, but we need to adjust the line number
          range.line -= offset;
        } else {
          const bundleFile = await this.findBundleFile(bundleName);
          if (bundleFile) {
            range.line -= offset;
            fileToShow = bundleFile;
          } else {
            window.showWarningMessage(
              `Tried to find file for ${bundleName} but couldn't locate it. Will open the bundled version instead.`
            );
            fileToShow = getOutputFileUri(fileName, "bundle");
          }
        }
      } else {
        window.showWarningMessage(
          `Tried to identify the bundle name for ${fileName} but couldn't determine it. Will open the bundled version instead.`
        );
        fileToShow = getOutputFileUri(fileName, "bundle");
      }
    }

    window.showTextDocument(fileToShow, {
      selection: new Range(range.line - 1, range.start, range.line - 1, range.end),
    });
  };

  private getRange = (errorMessage: string): { line: number; start: number; end: number } => {
    const rangeExpression = /.*:\((\d+),(\d+)-(\d+)\):/;
    const range = errorMessage.match(rangeExpression);
    if (range) {
      const [_, line, start, end] = range;
      return { line: Number(line), start: Number(start), end: Number(end) };
    }

    return { line: 0, start: 0, end: 0 };
  };

  /**
   * Searches for a Lua scipt for the given bundle name in the current workspace (respecting the inlcude path settings).
   *
   * @param name The full name of the bundle
   * @returns The `Uri` to the bundle file or `undefined` if it can not be found.
   */
  private findBundleFile = async (name: string): Promise<Maybe<Uri>> => {
    name = name.replace(/\./g, "/");
    this.plugin.debug(`Base file name: ${name}`);
    for (const path of configuration.luaIncludePaths()) {
      const fileName = path.replace("?", name);
      const fileUri = Uri.file(fileName);
      this.plugin.debug(`Looking for file ${fileUri}`);
      if (await this.plugin.fileHandler.fileExists(fileUri)) {
        return fileUri;
      }
    }

    return undefined;
  };

  private onCustomMessage = async (customMessage: CustomMessage) => {
    if (!configuration.messagesEnabled()) {
      return;
    }

    const message = (customMessage.customMessage ?? customMessage) as RequestEditorMessage;

    this.plugin.debug(`recieved onCustomMessage ${JSON.stringify(message, null, 2)}`);

    switch (message.type) {
      case "object":
        this.handleObjectMessage(message);
        break;
      case "write":
        this.handleWriteMessage(message);
        break;
    }
  };

  private handleObjectMessage = async (message: RequestObjectMessage) => {
    const object = await selectObject(this.plugin, {
      title: message.title,
      placeholder: message.placeholder,
      includeGlobal: message.withGlobal,
    });
    if (object) {
      this.customMessage({
        type: "object",
        guid: object.guid,
      });
    }
  };

  private handleWriteMessage = async (message: WriteContentMessage) => {
    const content = this.formatContent(message.content, message.format);
    if (message.name) {
      let fileName = message.name;
      if (message.object) {
        const object = this.plugin.getLoadedObject(message.object);
        if (!object) {
          window.showErrorMessage(`Requested to write file for object ${message.object}, but it wasn't loaded.`);
          return;
        }
        fileName = `${object.fileName}.${fileName}`;
      }

      const file = await this.plugin.fileHandler.writeOutputFile(fileName, content, "output");
      window.showTextDocument(file);
    } else {
      workspace.openTextDocument({ content: content });
    }
  };

  private formatContent = (message: string, format: MessageFormat = "auto"): string => {
    if (format === "none") {
      return message;
    }

    try {
      const parsed = JSON.parse(message);
      return JSON.stringify(parsed, null, 2);
    } catch (_) {
      return message;
    }
  };

  private clearLibraryPath = async () => {
    await workspace.fs.delete(getOutputPath("library"), { recursive: true });
  };

  private getObjectData = async (guid: string): Promise<SaveFileObject | undefined> => {
    const command = `
local obj = getObjectFromGUID("${guid}")
if obj and not obj.isDestroyed() then
  return obj.getJSON()
end

return nil
`;

    const data = await this.executeCode<string>(command);

    if (!data) {
      return undefined;
    }

    return JSON.parse(data) as SaveFileObject;
  };

  private readObject = async (guid: string, openFiles: boolean = false) => {
    await this.importMutex.runExclusive(async () => {
      await reconcileObjectsFromState(this.objectSyncDeps(), {
        // Refresh this GUID only — never prune the rest of the TTS Objects list.
        mode: "full",
        scriptStates: [{ guid, name: guid, script: "" }],
        openFiles,
        pruneMissing: false,
        deleteStaleFiles: configuration.cleanUpOnLoad() !== "nothing",
      });
    });
  };

  private createScripts = async (bundled: OutputType) => {
    const scripts = new Map<string, OutgoingJsonObject>();

    const includePathsLua = configuration.luaIncludePaths();
    const includePathXml = configuration.xmlIncludePaths();
    this.plugin.debug(`Using Lua include paths ${includePathsLua}`);
    this.plugin.debug(`Using XML include path ${includePathXml}`);

    const errors = new Set<string>();
    const preserveGlobalStubs = configuration.preserveGlobalStubs();

    for (const object of this.plugin.getLoadedObjects()) {
      try {
        this.plugin.debug(`Reading object files ${object.fileName}`);
        const fromBundledLua = await readOutputFile(`${object.fileName}.lua`, "bundle");
        const fromBundledXml = await readOutputFile(`${object.fileName}.xml`, "bundle");
        const fromObjectsLua = await readOutputFile(`${object.fileName}.lua`, "script");
        const fromObjectsXml = await readOutputFile(`${object.fileName}.xml`, "script");

        let lua = "";
        let xml = "";

        // Preserved Global stubs are always rebundled from their include files, even for
        // "Save and Play (Bundled)", because the bundled copy would not contain edits to those files.
        const isGlobalStub = (content: string | undefined, looksLikeStub: (content: string) => boolean) =>
          preserveGlobalStubs && object.isGlobal && content !== undefined && looksLikeStub(content);
        const rebundleGlobalLua = isGlobalStub(fromObjectsLua, looksLikeLuaRequireStub);
        const rebundleGlobalXml = isGlobalStub(fromObjectsXml, looksLikeXmlIncludeStub);

        if (rebundleGlobalLua || (bundled === "script" && fromObjectsLua)) {
          lua = await bundleLua(fromObjectsLua ?? "", includePathsLua);
        } else {
          lua = (bundled === "bundle" ? fromBundledLua : fromObjectsLua) ?? fromBundledLua ?? "";
        }

        if (rebundleGlobalXml || (bundled === "script" && fromObjectsXml)) {
          xml = await bundleXml(fromObjectsXml ?? "", includePathXml);
        } else {
          xml = (bundled === "bundle" ? fromBundledXml : fromObjectsXml) ?? fromBundledXml ?? "";
        }

        scripts.set(object.guid, {
          guid: object.guid,
          script: lua,
          ui: xml,
        });
      } catch (error) {
        console.error(error instanceof Error ? error.stack : error);
        const message = error instanceof Error ? error.message : String(error);
        if (message) {
          errors.add(message);
        }
      }
    }

    return {
      scripts: Array.from(scripts.values()),
      errors: errors,
    };
  };
}

const saveAllFiles = async () => {
  try {
    await workspace.saveAll(false);
  } catch (reason) {
    throw new Error(`Unable to save opened files.\nDetail: ${reason}`);
  }
};
