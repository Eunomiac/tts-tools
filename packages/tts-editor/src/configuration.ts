import { Uri, workspace } from "vscode";

import { getOutputPath } from "./io/files";

/** How the extension reaches TTS: through the shared gateway helper, or by listening on the editor port itself. */
export type ConnectionMode = "gateway" | "direct";

/** `fast` reuses files already on disk; `classic` re-reads every object from TTS like the original extension. */
export type SyncMode = "fast" | "classic";

/** Which files under `.tts` get deleted when a game loads. */
export type CleanUpOnLoad = "removedObjects" | "everything" | "nothing";

/** Where Update Object takes the object's non-script data from before respawning it. */
export type UpdateObjectSource = "liveTable" | "dataFile";

const section = "ttsEditor";

const settingNames = {
  includePath: "includePath",
  messagesEnabled: "enableMessages",
  resyncAfterSaveAndPlay: "resyncAfterSaveAndPlay",
  behaveLikeOriginal: "compatibility.behaveLikeOriginal",
  connectionMode: "connection.mode",
  syncMode: "sync.mode",
  cleanUpOnLoad: "sync.cleanUpOnLoad",
  preserveGlobalStubs: "sync.preserveGlobalStubs",
  updateObjectSource: "updateObject.source",
  mcpEnabled: "mcp.enabled",
};

/** Settings that change how (or whether) the extension connects to TTS. */
export const connectionSettings = [settingNames.behaveLikeOriginal, settingNames.connectionMode].map(
  (name) => `${section}.${name}`
);

export const mcpSettings = [settingNames.behaveLikeOriginal, settingNames.mcpEnabled].map(
  (name) => `${section}.${name}`
);

const getSetting = <T>(name: string): T | undefined => workspace.getConfiguration(section).get<T>(name);

const behaveLikeOriginal = (): boolean => getSetting<boolean>(settingNames.behaveLikeOriginal) === true;

const includePatterns = ["?.lua", "?.ttslua"];

const includePaths = (): Uri[] => {
  const workspaceFolders = workspace.workspaceFolders ?? [];
  const relative = getSetting<string>(settingNames.includePath) ?? ".";
  const libraryPath = getOutputPath("library");

  return [...workspaceFolders.map((folder) => Uri.joinPath(folder.uri, `/${relative}`)), libraryPath];
};

const luaIncludePaths = (): string[] => {
  const result: Uri[] = [];
  for (const path of includePaths()) {
    for (const pattern of includePatterns) {
      result.push(Uri.joinPath(path, pattern));
    }
  }
  return result.map((uri) => uri.fsPath);
};

const xmlIncludePaths = (): string[] => includePaths().map((uri) => uri.fsPath);

const messagesEnabled = (): boolean => getSetting<boolean>(settingNames.messagesEnabled) !== false;

const resyncAfterSaveAndPlay = (): boolean => getSetting<boolean>(settingNames.resyncAfterSaveAndPlay) === true;

const connectionMode = (): ConnectionMode =>
  behaveLikeOriginal() ? "direct" : getSetting<ConnectionMode>(settingNames.connectionMode) ?? "gateway";

const syncMode = (): SyncMode =>
  behaveLikeOriginal() ? "classic" : getSetting<SyncMode>(settingNames.syncMode) ?? "fast";

const cleanUpOnLoad = (): CleanUpOnLoad =>
  behaveLikeOriginal() ? "everything" : getSetting<CleanUpOnLoad>(settingNames.cleanUpOnLoad) ?? "removedObjects";

const preserveGlobalStubs = (): boolean =>
  !behaveLikeOriginal() && getSetting<boolean>(settingNames.preserveGlobalStubs) === true;

const updateObjectSource = (): UpdateObjectSource =>
  behaveLikeOriginal() ? "dataFile" : getSetting<UpdateObjectSource>(settingNames.updateObjectSource) ?? "liveTable";

const mcpEnabled = (): boolean => !behaveLikeOriginal() && getSetting<boolean>(settingNames.mcpEnabled) !== false;

export default {
  luaIncludePaths,
  xmlIncludePaths,
  messagesEnabled,
  resyncAfterSaveAndPlay,
  connectionMode,
  syncMode,
  cleanUpOnLoad,
  preserveGlobalStubs,
  updateObjectSource,
  mcpEnabled,
};
