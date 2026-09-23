import ExternalEditorApi, {
  CustomMessage,
  ErrorMessage,
  LoadingANewGame,
  ObjectCreated,
  OutgoingJsonObject,
  PrintDebugMessage,
  PushingNewObject,
} from "@matanlurey/tts-editor";
import { TTSObject as SaveFileObject, bundleObject } from "@tts-tools/savefile";
import { Range, Uri, window, workspace } from "vscode";

import { command } from "./command";
import configuration from "./configuration";
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
import { reconcileObjectsFromState, SyncMode } from "./io/objectSync";
import { closeEditorApi, isEditorApiListening, listenEditorApi, prepareAndListen } from "./io/portSession";
import { installReturnIdDemux } from "./io/returnIdDemux";
import {
  EditorMessage,
  MessageFormat,
  RequestEditorMessage,
  RequestObjectMessage,
  WriteContentMessage,
} from "./message";
import { LoadedObject } from "./model/objectData";
import { Plugin } from "./plugin";

const polyFills = ["object", "write"];

export class TTSAdapter {
  private api: ExternalEditorApi;
  private plugin: Plugin;
  private lastError: Maybe<ErrorMessage> = undefined;
  private importMutex = new ImportMutex();
  /** Set before Save & Play so the following loadingANewGame uses the fast echo path. */
  private expectSaveAndPlayEcho = false;
  private forceFullResyncOnEcho = false;
  private pendingSentScripts: OutgoingJsonObject[] | undefined;

  public constructor(plugin: Plugin) {
    this.api = new ExternalEditorApi();
    this.plugin = plugin;

    this.bindApi(this.api);
    void this.startListeningOnActivate();
  }

  /**
   * Start (or resume) listening on editor port 39998. Force-claims reclaimable holders on Windows.
   */
  public claimEditorPort = async (): Promise<void> => {
    try {
      const { detail } = await this.plugin.progress("Claiming TTS editor port", async () => {
        if (isEditorApiListening(this.api)) {
          return { port: 39998, detail: "Already holding the editor port." };
        }
        // Fresh API after close so upstream connection handlers attach on listen again
        await closeEditorApi(this.api);
        this.api = new ExternalEditorApi();
        this.bindApi(this.api);
        return prepareAndListen(this.api);
      });
      this.plugin.setPortStatus("holding", detail);
      this.plugin.info(detail);
      window.showInformationMessage(detail);
    } catch (e) {
      const message = `${e}`;
      this.plugin.setPortStatus("error", message);
      this.plugin.error(message);
      window.showErrorMessage(message);
    }
  };

  /**
   * Stop listening on 39998 so another app (e.g. Storyteller Dashboard) can bind it.
   */
  public releaseEditorPort = async (): Promise<void> => {
    try {
      await closeEditorApi(this.api);
      const detail = "Released port 39998. Dashboard or another tool can Claim it now.";
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

  public isHoldingEditorPort = (): boolean => isEditorApiListening(this.api);

  /** Close the editor listener; called from extension deactivate. */
  public dispose = async (): Promise<void> => {
    try {
      await closeEditorApi(this.api);
    } catch (e) {
      this.plugin.error(`dispose: ${e}`);
    }
    this.plugin.setPortStatus("released", "Extension deactivated.");
  };

  /**
   * Retrieves scripts from currently open game.
   */
  public getObjects = async () => {
    this.api.getLuaScripts();
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
        this.plugin.progress("Sending scripts to TTS", async () => this.api.saveAndPlay(scripts));
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

    return this.api.executeLuaCodeAndReturn(completeScript) as T;
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
    return this.api.customMessage(object);
  }

  public async updateObject(object: LoadedObject) {
    const readObjectFile = async (extension: string) => {
      try {
        return await this.plugin.fileHandler.readOutputFile(object, extension, "script");
      } catch (_) {
        return undefined;
      }
    };

    const dataFile = await readObjectFile("data.json");
    if (!dataFile) {
      window.showErrorMessage(`Can not find data file for object ${object.guid}`);
      return;
    }

    try {
      const data = JSON.parse(dataFile) as SaveFileObject;
      data.LuaScript = await readObjectFile("lua");
      data.XmlUI = await readObjectFile("xml");

      const state = await readObjectFile("state.txt");
      if (state) {
        data.LuaScriptState = state;
      }

      const bundled = bundleObject(data, {
        includePath: configuration.xmlIncludePaths(),
      });

      let newData = JSON.stringify(bundled);
      newData = newData.replace(/\]\]/g, ']] .. "]]" .. [[');

      const script = `
local obj = getObjectFromGUID("${object.guid}")
obj.destruct()

spawnObjectJSON({
  json = [[${newData}]]
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

  private bindApi = (api: ExternalEditorApi) => {
    installReturnIdDemux(api);
    api.on("loadingANewGame", this.onLoadGame.bind(this));
    api.on("pushingNewObject", this.onPushObject.bind(this));
    api.on("objectCreated", this.onObjectCreated.bind(this));
    api.on("printDebugMessage", this.onPrintDebugMessage.bind(this));
    api.on("errorMessage", this.onErrorMessage.bind(this));
    api.on("customMessage", this.onCustomMessage.bind(this));
  };

  private startListeningOnActivate = async () => {
    try {
      await listenEditorApi(this.api);
      this.plugin.setPortStatus("holding", "Listening on editor port 39998.");
      this.plugin.info("Listening on TTS editor port 39998.");
    } catch (e) {
      const message =
        `Could not listen on 39998 (${e}). Another tool may hold the port — ` +
        `use “Claim TTS Editor Port” after they Release, or Claim to force-take reclaimable holders.`;
      this.plugin.setPortStatus("error", message);
      this.plugin.error(message);
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

    let mode: SyncMode;
    if (isEcho && forceFull) {
      mode = "full";
    } else if (isEcho) {
      mode = "echo";
    } else {
      mode = "incremental";
    }

    const title = mode === "echo" ? "Updating scripts" : mode === "full" ? "Reading objects (full)" : "Syncing objects";
    await this.importMutex.runExclusive(async () => {
      await this.plugin.progress(title, async () =>
        reconcileObjectsFromState(
          {
            plugin: this.plugin,
            getObjectData: this.getObjectData,
            debug: this.plugin.debug,
          },
          {
            mode,
            scriptStates: message.scriptStates,
            sentScripts,
            openFiles: false,
          }
        )
      );
    });
  };

  private onPushObject = async (message: PushingNewObject) => {
    this.plugin.debug(`recieved onPushObject ${message.messageID}`);
    await this.importMutex.runExclusive(async () => {
      await this.plugin.progress("Reading object", async () =>
        reconcileObjectsFromState(
          {
            plugin: this.plugin,
            getObjectData: this.getObjectData,
            debug: this.plugin.debug,
          },
          {
            mode: "incremental",
            scriptStates: message.scriptStates,
            openFiles: true,
          }
        )
      );
    });
  };

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

    const message = customMessage.customMessage as RequestEditorMessage;

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
      await reconcileObjectsFromState(
        {
          plugin: this.plugin,
          getObjectData: this.getObjectData,
          debug: this.plugin.debug,
        },
        {
          mode: "full",
          scriptStates: [{ guid, name: guid, script: "" }],
          openFiles,
        }
      );
    });
  };

  private createScripts = async (bundled: OutputType) => {
    const scripts = new Map<string, OutgoingJsonObject>();

    const includePathsLua = configuration.luaIncludePaths();
    const includePathXml = configuration.xmlIncludePaths();
    this.plugin.debug(`Using Lua include paths ${includePathsLua}`);
    this.plugin.debug(`Using XML include path ${includePathXml}`);

    const errors = new Set<string>();

    for (const object of this.plugin.getLoadedObjects()) {
      try {
        this.plugin.debug(`Reading object files ${object.fileName}`);
        const luaFile = await readOutputFile(`${object.fileName}.lua`, bundled);
        const xmlFile = await readOutputFile(`${object.fileName}.xml`, bundled);

        let lua: string = luaFile ?? "";
        let xml: string = xmlFile ?? "";
        if (luaFile && bundled === "script") {
          lua = await bundleLua(luaFile, includePathsLua);
        }
        if (xmlFile && bundled === "script") {
          xml = await bundleXml(xmlFile, includePathXml);
        }

        scripts.set(object.guid, {
          guid: object.guid,
          script: lua,
          ui: xml,
        });
      } catch (error: any) {
        console.error(error.stack);
        if (error.message) {
          errors.add(error.message);
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
