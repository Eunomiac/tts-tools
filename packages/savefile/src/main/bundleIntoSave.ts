import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { basename, join } from "path";

import { bundle as bundleXml } from "@tts-tools/xmlbundle";
import { bundleString } from "luabundle";

import { SaveFile, TTSObject } from "./model/tts";

export type ScriptPayload = {
  script?: string;
  ui?: string;
};

export type BundleFromObjectsOptions = {
  objectsDir: string;
  /** Directories searched for `require` / `<Include>` (same idea as Save & Play include paths). */
  includePaths: string | string[];
};

export type ApplyScriptsOptions = {
  /** When true, leave save-level Global LuaScript/XmlUI unchanged. */
  preserveGlobal?: boolean;
};

export type ApplyScriptsStats = {
  updated: number;
  skippedGlobal: number;
  missingInSave: string[];
};

export type BundleIntoSaveFileTarget = {
  path: string;
  preserveGlobal?: boolean;
  /** Write a `.bak` next to the save before overwriting. Default true. */
  backup?: boolean;
};

export type BundleIntoSaveFilesResult = {
  scriptsBundled: number;
  files: Array<{
    path: string;
    stats: ApplyScriptsStats;
  }>;
};

const asIncludeList = (includePaths: string | string[]): string[] =>
  typeof includePaths === "string" ? [includePaths] : [...includePaths];

const luaBundlePaths = (includePaths: string[]): string[] => {
  const patterns = ["?.lua", "?.ttslua"];
  const paths = includePaths.flatMap((dir) => patterns.map((pattern) => join(dir, pattern)));
  paths.push(...patterns);
  return paths;
};

export const bundleLuaSource = (script: string, includePaths: string | string[]): string => {
  const bundled = bundleString(script, { paths: luaBundlePaths(asIncludeList(includePaths)) });
  return bundled.startsWith("-- Bundled") ? bundled + "\n" : bundled;
};

export const bundleXmlSource = (xml: string, includePaths: string | string[]): string =>
  bundleXml(xml, asIncludeList(includePaths));

/**
 * Map object-script basenames under `.tts/objects` to GUID.
 * Files look like `Global.lua` / `Global.xml` or `Name.<guid>.lua`.
 */
export const guidFromObjectFileName = (fileName: string): string | undefined => {
  const base = basename(fileName);
  const lower = base.toLowerCase();
  if (lower === "global.lua" || lower === "global.xml") {
    return "-1";
  }
  // TTS GUIDs are usually hex; allow alphanumerics so stub filenames still match.
  const match = base.match(/\.([0-9a-zA-Z-]{2,})\.(lua|xml)$/i);
  return match?.[1];
};

/**
 * Bundle every stub under `objectsDir` that has a recognizable GUID in its name.
 */
export const bundleScriptsFromObjectsDir = (options: BundleFromObjectsOptions): Map<string, ScriptPayload> => {
  const includePaths = asIncludeList(options.includePaths);
  const byGuid = new Map<string, { luaPath?: string; xmlPath?: string }>();

  if (!existsSync(options.objectsDir)) {
    throw new Error(`Objects directory not found: ${options.objectsDir}`);
  }

  for (const name of readdirSync(options.objectsDir)) {
    const guid = guidFromObjectFileName(name);
    if (!guid) {
      continue;
    }
    const entry = byGuid.get(guid) ?? {};
    if (name.toLowerCase().endsWith(".lua")) {
      entry.luaPath = join(options.objectsDir, name);
    } else if (name.toLowerCase().endsWith(".xml")) {
      entry.xmlPath = join(options.objectsDir, name);
    }
    byGuid.set(guid, entry);
  }

  const scripts = new Map<string, ScriptPayload>();
  for (const [guid, files] of byGuid) {
    const payload: ScriptPayload = {};
    if (files.luaPath) {
      payload.script = bundleLuaSource(readFileSync(files.luaPath, "utf8"), includePaths);
    }
    if (files.xmlPath) {
      payload.ui = bundleXmlSource(readFileSync(files.xmlPath, "utf8"), includePaths);
    }
    if (payload.script !== undefined || payload.ui !== undefined) {
      scripts.set(guid, payload);
    }
  }
  return scripts;
};

const visitObject = (
  object: TTSObject,
  scripts: Map<string, ScriptPayload>,
  stats: ApplyScriptsStats,
  preserveGlobal: boolean
): void => {
  const guid = object.GUID;
  const payload = scripts.get(guid);
  if (payload) {
    if (preserveGlobal && guid === "-1") {
      stats.skippedGlobal += 1;
    } else {
      if (payload.script !== undefined) {
        object.LuaScript = payload.script;
      }
      if (payload.ui !== undefined) {
        object.XmlUI = payload.ui;
      }
      stats.updated += 1;
    }
    scripts.delete(guid);
  }

  if (object.ContainedObjects) {
    for (const child of object.ContainedObjects) {
      visitObject(child, scripts, stats, preserveGlobal);
    }
  }
  if (object.ChildObjects) {
    for (const child of object.ChildObjects) {
      visitObject(child, scripts, stats, preserveGlobal);
    }
  }
  if (object.States) {
    for (const child of Object.values(object.States)) {
      visitObject(child, scripts, stats, preserveGlobal);
    }
  }
};

/**
 * Apply bundled scripts to a save JSON object.
 * Global lives on the save root (`LuaScript` / `XmlUI`), not as an ObjectStates entry.
 */
export const applyScriptsToSave = (
  save: SaveFile,
  scripts: Map<string, ScriptPayload>,
  options: ApplyScriptsOptions = {}
): { save: SaveFile; stats: ApplyScriptsStats } => {
  const remaining = new Map(scripts);
  const stats: ApplyScriptsStats = { updated: 0, skippedGlobal: 0, missingInSave: [] };
  const preserveGlobal = options.preserveGlobal === true;

  const globalPayload = remaining.get("-1");
  if (globalPayload) {
    if (preserveGlobal) {
      stats.skippedGlobal += 1;
    } else {
      if (globalPayload.script !== undefined) {
        save.LuaScript = globalPayload.script;
      }
      if (globalPayload.ui !== undefined) {
        save.XmlUI = globalPayload.ui;
      }
      stats.updated += 1;
    }
    remaining.delete("-1");
  }

  for (const object of save.ObjectStates ?? []) {
    visitObject(object, remaining, stats, preserveGlobal);
  }

  stats.missingInSave = [...remaining.keys()];
  return { save, stats };
};

const writeSaveJson = (path: string, save: SaveFile): void => {
  writeFileSync(path, `${JSON.stringify(save, null, 2)}\n`, "utf8");
};

const backupSaveCopy = (path: string): string => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = `${path}.${stamp}.bak`;
  writeFileSync(bak, readFileSync(path));
  return bak;
};

/**
 * Bundle stubs once, then patch each target save file on disk.
 */
export const bundleIntoSaveFiles = (options: {
  targets: BundleIntoSaveFileTarget[];
  objectsDir: string;
  includePaths: string | string[];
}): BundleIntoSaveFilesResult => {
  if (options.targets.length === 0) {
    throw new Error("No save targets given");
  }

  const scripts = bundleScriptsFromObjectsDir({
    objectsDir: options.objectsDir,
    includePaths: options.includePaths,
  });

  const files: BundleIntoSaveFilesResult["files"] = [];
  for (const target of options.targets) {
    if (!existsSync(target.path)) {
      throw new Error(`Save file not found: ${target.path}`);
    }
    if (target.backup !== false) {
      backupSaveCopy(target.path);
    }
    const save = JSON.parse(readFileSync(target.path, "utf8")) as SaveFile;
    const { stats } = applyScriptsToSave(save, scripts, { preserveGlobal: target.preserveGlobal });
    writeSaveJson(target.path, save);
    files.push({ path: target.path, stats });
  }

  return { scriptsBundled: scripts.size, files };
};

/** Read a save, apply scripts already bundled, write back (used by tests). */
export const applyScriptsToSaveFile = (
  savePath: string,
  scripts: Map<string, ScriptPayload>,
  options: ApplyScriptsOptions & { backup?: boolean } = {}
): ApplyScriptsStats => {
  if (!existsSync(savePath)) {
    throw new Error(`Save file not found: ${savePath}`);
  }
  if (options.backup !== false) {
    backupSaveCopy(savePath);
  }
  const save = JSON.parse(readFileSync(savePath, "utf8")) as SaveFile;
  const { stats } = applyScriptsToSave(save, scripts, options);
  writeSaveJson(savePath, save);
  return stats;
};
