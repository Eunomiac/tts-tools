import { IncomingJsonObject, OutgoingJsonObject } from "@matanlurey/tts-editor";
import { TTSObject as SaveFileObject, unbundleObject } from "@tts-tools/savefile";
import { FileType, Uri, window, workspace } from "vscode";

import { unbundleRootModule, unbundleXml } from "./bundle";
import { getOutputFileUri, getOutputPath, hasOutputFile, readOutputFile, writeOutputFile } from "./files";
import { Plugin } from "../plugin";

export type SyncMode = "echo" | "incremental" | "full";

export interface ObjectSyncDeps {
  plugin: Plugin;
  getObjectData: (guid: string) => Promise<SaveFileObject | undefined>;
  debug?: (message: string) => void;
}

export interface ObjectSyncRequest {
  mode: SyncMode;
  scriptStates: IncomingJsonObject[];
  /** Scripts we just sent on Save & Play (echo path may prefer these for bundled refresh). */
  sentScripts?: OutgoingJsonObject[];
  openFiles?: boolean;
}

const sanitizeBaseName = (name: string | undefined): string => {
  const safe = name && name.length > 0 ? name : "Object";
  return safe.replace(/([":<>/\\|?*\r\n])/g, "");
};

const getUnbundledLua = (script: string): string => {
  try {
    return unbundleRootModule(script);
  } catch (e) {
    console.error(e);
    return script;
  }
};

const writeIfChanged = async (fileName: string, content: string, type: "script" | "bundle"): Promise<boolean> => {
  const existing = await readOutputFile(fileName, type);
  if (existing === content) {
    return false;
  }
  await writeOutputFile(fileName, content, type);
  return true;
};

const listFilesForGuid = async (guid: string): Promise<Uri[]> => {
  const found: Uri[] = [];
  const needle = `.${guid}.`;
  for (const type of ["script", "bundle"] as const) {
    const dir = getOutputPath(type);
    let entries: [string, FileType][];
    try {
      entries = await workspace.fs.readDirectory(dir);
    } catch {
      continue;
    }
    for (const [name, fileType] of entries) {
      if (fileType === FileType.File && name.includes(needle)) {
        found.push(Uri.joinPath(dir, name));
      }
    }
  }
  return found;
};

const deleteFilesForGuid = async (guid: string): Promise<void> => {
  const files = await listFilesForGuid(guid);
  await Promise.all(files.map((file) => workspace.fs.delete(file)));
};

const resolveFileName = (
  guid: string,
  displayName: string | undefined,
  plugin: Plugin
): { fileName: string; objectName: string } => {
  const existing = plugin.getLoadedObject(guid);
  if (existing && !existing.isGlobal) {
    return { fileName: existing.fileName, objectName: existing.name };
  }
  const objectName = displayName && displayName.length > 0 ? displayName : guid;
  return { fileName: `${sanitizeBaseName(objectName)}.${guid}`, objectName };
};

const writeScriptUiFromStates = async (
  fileName: string,
  script: string | undefined,
  ui: string | undefined,
  openFiles: boolean
): Promise<{ lua?: string; xml?: string; bundledLua?: string; bundledXml?: string }> => {
  const result: { lua?: string; xml?: string; bundledLua?: string; bundledXml?: string } = {};

  if (script !== undefined) {
    const unbundled = getUnbundledLua(script);
    result.lua = unbundled;
    result.bundledLua = script;
    await writeIfChanged(`${fileName}.lua`, unbundled, "script");
    await writeIfChanged(`${fileName}.lua`, script, "bundle");
    if (openFiles) {
      window.showTextDocument(getOutputFileUri(`${fileName}.lua`));
    }
  }

  if (ui !== undefined) {
    const unbundled = unbundleXml(ui).root;
    result.xml = unbundled;
    result.bundledXml = ui;
    await writeIfChanged(`${fileName}.xml`, unbundled, "script");
    await writeIfChanged(`${fileName}.xml`, ui, "bundle");
  }

  return result;
};

/** True when objects/Global.xml is a thin Include stub (workspace keeps Sources separate from expanded bundles). */
export const looksLikeXmlIncludeStub = (content: string): boolean => {
  return /<Include\s+src=/i.test(content) && content.length < 4096;
};

/** True when objects/Global.lua is a thin require stub. */
export const looksLikeLuaRequireStub = (content: string): boolean => {
  const trimmed = content.trim();
  return /^require\s*\(/m.test(trimmed) && trimmed.length < 512;
};

/**
 * Reconcile `.tts` object files from a TTS scriptStates payload without a blind wipe.
 */
export const reconcileObjectsFromState = async (deps: ObjectSyncDeps, request: ObjectSyncRequest): Promise<void> => {
  const { plugin, getObjectData, debug } = deps;
  const { mode, scriptStates, sentScripts, openFiles = false } = request;
  const log = debug ?? (() => undefined);

  plugin.setStatus(`Syncing ${scriptStates.length} scripts (${mode})`);
  log(`objectSync mode=${mode} count=${scriptStates.length}`);

  const sentByGuid = new Map<string, OutgoingJsonObject>();
  for (const sent of sentScripts ?? []) {
    sentByGuid.set(sent.guid, sent);
  }

  const writeGlobalFiles = async (script: string | undefined, ui: string | undefined) => {
    const fileName = "Global";
    // Echo must refresh .tts/bundled for Go to Error, but must not replace Include/require stubs under objects/
    if (script !== undefined) {
      await writeIfChanged(`${fileName}.lua`, script, "bundle");
      if (mode !== "echo") {
        const existing = await readOutputFile(`${fileName}.lua`, "script");
        if (!existing || !looksLikeLuaRequireStub(existing)) {
          await writeIfChanged(`${fileName}.lua`, getUnbundledLua(script), "script");
        }
      }
    }
    if (ui !== undefined) {
      await writeIfChanged(`${fileName}.xml`, ui, "bundle");
      if (mode !== "echo") {
        const existing = await readOutputFile(`${fileName}.xml`, "script");
        if (!existing || !looksLikeXmlIncludeStub(existing)) {
          await writeIfChanged(`${fileName}.xml`, unbundleXml(ui).root, "script");
        }
      }
    }
    plugin.setLoadedObject({
      name: "Global",
      fileName,
      isGlobal: true,
      data: {
        LuaScript: script ?? "",
        XmlUI: ui,
      },
    });
  };

  // Echo: always flush what we sent to .tts/bundled (TTS may omit some GUIDs from scriptStates)
  if (mode === "echo" && sentScripts && sentScripts.length > 0) {
    for (const sent of sentScripts) {
      if (sent.guid === "-1") {
        await writeGlobalFiles(sent.script, sent.ui);
        continue;
      }
      const incoming = scriptStates.find((s) => s.guid === sent.guid);
      const { fileName } = resolveFileName(sent.guid, incoming?.name, plugin);
      await writeScriptUiFromStates(fileName, sent.script, sent.ui, false);
      const existing = plugin.getLoadedObject(sent.guid);
      plugin.setLoadedObject({
        isGlobal: false,
        name: existing?.name ?? incoming?.name ?? sent.guid,
        guid: sent.guid,
        fileName,
        data: {
          ...(existing?.data ?? {}),
          Name: (existing?.data as ObjectData | undefined)?.Name ?? incoming?.name ?? sent.guid,
          LuaScript: sent.script ?? (existing?.data as ObjectData | undefined)?.LuaScript ?? "",
          XmlUI: sent.ui ?? (existing?.data as ObjectData | undefined)?.XmlUI,
        } as ObjectData,
      });
    }
    log(`objectSync echo flushed ${sentScripts.length} sent scripts to disk`);
    return;
  }

  const seenGuids = new Set<string>();

  for (const incoming of scriptStates) {
    const guid = incoming.guid;
    seenGuids.add(guid);

    if (guid === "-1") {
      const script = sentByGuid.get("-1")?.script ?? incoming.script;
      const ui = sentByGuid.get("-1")?.ui ?? incoming.ui;
      await writeGlobalFiles(script, ui);
      continue;
    }

    const sent = sentByGuid.get(guid);
    const script = mode === "echo" ? (sent?.script ?? incoming.script) : incoming.script;
    const ui = mode === "echo" ? (sent?.ui ?? incoming.ui) : incoming.ui;
    const { fileName, objectName } = resolveFileName(guid, incoming.name, plugin);

    if (mode === "full") {
      const bundledData = await getObjectData(guid);
      if (!bundledData) {
        log(`objectSync full: object ${guid} missing in TTS`);
        continue;
      }
      const unbundledData = unbundleObject(bundledData);
      const jsonName = bundledData.Nickname?.length > 0 ? bundledData.Nickname : bundledData.Name ?? "Object";
      const fullFileName = `${sanitizeBaseName(jsonName)}.${guid}`;

      // Drop stale Name.guid.* files if nickname changed
      if (fullFileName !== fileName) {
        await deleteFilesForGuid(guid);
      }

      await writeOutputFile(`${fullFileName}.data.json`, JSON.stringify(unbundledData, null, 2));
      if (unbundledData.LuaScript !== undefined) {
        const scriptFile = await writeOutputFile(`${fullFileName}.lua`, unbundledData.LuaScript);
        if (openFiles) {
          window.showTextDocument(scriptFile);
        }
        if (bundledData.LuaScript !== undefined) {
          await writeOutputFile(`${fullFileName}.lua`, bundledData.LuaScript, "bundle");
        }
      }
      if (unbundledData.XmlUI !== undefined) {
        await writeOutputFile(`${fullFileName}.xml`, unbundledData.XmlUI);
        if (bundledData.XmlUI !== undefined) {
          await writeOutputFile(`${fullFileName}.xml`, bundledData.XmlUI, "bundle");
        }
      }

      plugin.setLoadedObject({
        isGlobal: false,
        name: jsonName,
        guid,
        fileName: fullFileName,
        data: unbundledData as unknown as ObjectData,
      });
      continue;
    }

    // echo + incremental: prefer scriptStates (and sent scripts on echo) for Lua/XML
    await writeScriptUiFromStates(fileName, script, ui, openFiles);

    if (mode === "incremental") {
      const dataFile = `${fileName}.data.json`;
      if (await hasOutputFile(dataFile)) {
        const raw = await readOutputFile(dataFile);
        if (raw) {
          try {
            const data = JSON.parse(raw) as ObjectData;
            if (script !== undefined) {
              data.LuaScript = script;
            }
            if (ui !== undefined) {
              data.XmlUI = ui;
            }
            const diskName =
              (typeof data.Nickname === "string" && data.Nickname.length > 0 && data.Nickname) ||
              (typeof data.Name === "string" && data.Name) ||
              objectName;
            plugin.setLoadedObject({
              isGlobal: false,
              name: diskName,
              guid,
              fileName,
              data,
            });
            continue;
          } catch (e) {
            log(`objectSync: bad data.json for ${guid}: ${e}`);
          }
        }
      }

      const bundledData = await getObjectData(guid);
      if (bundledData) {
        const unbundledData = unbundleObject(bundledData);
        await writeOutputFile(dataFile, JSON.stringify(unbundledData, null, 2));
        const jsonName =
          bundledData.Nickname?.length > 0 ? bundledData.Nickname : bundledData.Name ?? objectName;
        plugin.setLoadedObject({
          isGlobal: false,
          name: jsonName,
          guid,
          fileName,
          data: unbundledData as unknown as ObjectData,
        });
        continue;
      }
    }

    // echo (or incremental fallback): keep a minimal but Name-safe ObjectData for the tree
    const existing = plugin.getLoadedObject(guid);
    const existingData = (existing?.data ?? {}) as Partial<ObjectData>;
    plugin.setLoadedObject({
      isGlobal: false,
      name: objectName,
      guid,
      fileName,
      data: {
        ...existingData,
        Name: existingData.Name ?? objectName,
        LuaScript: script ?? existingData.LuaScript ?? "",
        XmlUI: ui ?? existingData.XmlUI,
      } as ObjectData,
    });
  }

  if (mode === "echo") {
    return;
  }

  // Prune objects that vanished from the game
  for (const loaded of plugin.getLoadedObjects()) {
    if (loaded.isGlobal) {
      continue;
    }
    if (!seenGuids.has(loaded.guid)) {
      log(`objectSync prune ${loaded.guid}`);
      await deleteFilesForGuid(loaded.guid);
      plugin.removeLoadedObject(loaded.guid);
    }
  }
};
