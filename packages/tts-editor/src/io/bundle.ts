import { bundle, unbundle } from "@tts-tools/xmlbundle";
import { existsSync, lstatSync } from "fs";
import * as luabundle from "luabundle";
import { sep as pathSeparator } from "path";

import { readMetadata } from "luabundle/metadata";
import { UnbundledData } from "luabundle";

/**
 * @returns `true` if the given Lua string was bundled by luabundle, `false` otherwise.
 */
export const isBundled = (content: string): boolean => readMetadata(content) !== null;

/**
 * Default header luabundle accepts when a bundle was emitted with `metadata: false`.
 * The runtime still starts with `local __bundle_require`; only the comment is missing.
 */
const SYNTHETIC_BUNDLE_METADATA = '-- Bundled by luabundle {"version":"1.7.0"}\n';

/**
 * True when `content` is itself a luabundle, not merely text that mentions one.
 * Markers have to be the start of the source. A session-start root embeds other
 * objects' bundles inside string literals; those must not count.
 */
export const isLuabundleSource = (content: string): boolean => {
  if (typeof content !== "string" || content.length === 0) {
    return false;
  }
  const trimmed = content.trimStart();
  return trimmed.startsWith("-- Bundled by luabundle") || trimmed.startsWith("local __bundle_require");
};

/**
 * Heuristic for a luabundle payload even when the metadata comment is missing.
 * Used to refuse writing already-bundled scripts into `objects/` (which breaks Save & Play).
 */
export const looksLikeLuabundlePayload = (content: string): boolean => isLuabundleSource(content);

/** True when objects/Global.lua is only `require(...)` lines. */
export const looksLikeLuaRequireStub = (content: string): boolean => {
  const trimmed = content.trim();
  if (trimmed.length === 0 || trimmed.length >= 512) {
    return false;
  }
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.length > 0 && lines.every((line) => /^require\s*\(/.test(line));
};

/**
 * luabundle only unbundles scripts that start with its metadata comment.
 * Bundles emitted with `metadata: false` still have the runtime; supply the default header.
 */
const withBundleMetadata = (content: string): string => {
  const trimmed = content.trimStart();
  if (trimmed.startsWith("-- Bundled by luabundle")) {
    return trimmed;
  }
  return `${SYNTHETIC_BUNDLE_METADATA}${trimmed}`;
};

export const unbundleLua = (content: string): UnbundledData => {
  const source = isLuabundleSource(content) ? withBundleMetadata(content) : content;
  return luabundle.unbundleString(source);
};

/**
 * Returns the root module source. If `content` is a luabundle, always attempts
 * unbundle, including when the metadata comment is missing. Never returns a still-bundled payload.
 */
export const unbundleRootModule = (content: string) => {
  if (!isLuabundleSource(content)) {
    return content;
  }

  const unbundled = luabundle.unbundleString(withBundleMetadata(content), { rootOnly: true });
  const root = unbundled.modules[unbundled.metadata.rootModuleName]?.content;
  if (typeof root !== "string") {
    throw new Error("unbundleRootModule: bundled script has no root module content");
  }
  if (isLuabundleSource(root)) {
    throw new Error("unbundleRootModule: root module still looks like a luabundle payload");
  }
  return root;
};

export type GlobalObjectLuaUpdate =
  | { action: "keep" }
  | { action: "write"; content: string }
  | { action: "refuse"; message: string };

/**
 * Decide what sync may write to `objects/Global.lua`.
 * TTS sends the bundled script. That script is a build product. With stub preservation on,
 * the editor file stays a `require(...)` stub: write the reversed root only when that root
 * is itself a stub (a normal Save & Play bundle). Never write the raw bundle, and never
 * replace the stub with a generated root such as the session-start restore block.
 */
export const resolveGlobalObjectLua = (
  existing: string | undefined,
  incoming: string,
  preserveStubs: boolean
): GlobalObjectLuaUpdate => {
  let root: string;
  try {
    root = unbundleRootModule(incoming);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      action: "refuse",
      message:
        `Could not unbundle Global for objects/Global.lua (${detail}). ` +
        "Kept the previous file instead of writing a raw bundle.",
    };
  }

  if (isLuabundleSource(root)) {
    return {
      action: "refuse",
      message:
        "Refusing to write a luabundle into objects/Global.lua (that breaks Save & Play). Kept the previous file.",
    };
  }

  const normalized = root.endsWith("\n") ? root : `${root}\n`;
  if (preserveStubs) {
    if (existing !== undefined && looksLikeLuaRequireStub(existing)) {
      return { action: "keep" };
    }
    if (looksLikeLuaRequireStub(root)) {
      return { action: "write", content: normalized };
    }
    return {
      action: "refuse",
      message:
        "TTS Global script does not unbundle to a require() stub. Left objects/Global.lua unchanged so the hand-written stub is not replaced.",
    };
  }

  return { action: "write", content: normalized };
};

export const bundleLua = async (script: string, includePaths: string[]): Promise<string> => {
  return luabundle.bundleString(script, {
    paths: includePaths,
    isolate: true,
    resolveModule,
  });
};

interface BundleInfo {
  name: string;
  offset: number;
}

/**
 * @param source The bundled Lua script.
 * @param lineNumber The line number to start searching.
 * @returns The nearest bundle name of the Lua source starting from the given `lineNumber`.
 *          Returns `undefined` if no bundle can be found.
 */
export const findNearestBundle = async (source: string, lineNumber: number): Promise<Maybe<BundleInfo>> => {
  const lines = source.split("\n");
  for (let i = lineNumber - 1; i >= 0; i--) {
    const line = lines[i];
    const match = line.match(/^__bundle_register\("([^"]+)"/);
    if (match) {
      return { name: match[1], offset: i + 1 };
    }
  }

  return undefined;
};

/**
 * @param source A bundled Lua script.
 * @returns The name of the root bundle for the given bundled Lua.
 */
export const getRootName = (source: string): string => {
  const unbundled = luabundle.unbundleString(source, { rootOnly: true });
  return unbundled.metadata.rootModuleName;
};

export const unbundleXml = (content: string) => {
  return unbundle(content);
};

export const bundleXml = async (script: string, includePaths: string[]): Promise<string> => {
  return bundle(script, includePaths);
};

/** Resolves a `require` name to a file the same way bundling does (`?` patterns, then `?/index`). */
export const resolveModule = (name: string, packagePaths: readonly string[]) => {
  const platformName = name.replace(/\./g, pathSeparator);

  for (const pattern of packagePaths) {
    const filePath = pattern.replace(/\?/g, platformName);

    if (existsSync(filePath) && lstatSync(filePath).isFile()) {
      return filePath;
    }

    const indexPath = pattern.replace(/\?/g, `${platformName}${pathSeparator}index`);
    if (existsSync(indexPath) && lstatSync(indexPath).isFile()) {
      return indexPath;
    }
  }

  return null;
};
