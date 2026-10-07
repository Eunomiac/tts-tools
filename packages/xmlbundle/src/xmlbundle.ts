import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "fs";
import { dirname } from "path";

const INCLUDE_REGEX = /^([\t ]*)<Include src=(["'])(.+)\2\s*\/>/im;
const BORDER_REGEX = /([ \t]*)<!-- include (.*?) -->\r?\n(.*?)<!-- include \2 -->/gs;

export interface BundleInformation {
  /** All bundles found in an unbundled module mappyed by their name. */
  bundles: Bundles;
  /** The root bundle content. */
  root: string;
}

type Bundles = Record<string, Bundle>;

export interface Bundle {
  /** The name of the bundle. Does not include the `.xml` extension. */
  name: string;
  /** The content of the bundle. */
  content: string;
}

/**
 * Bundles the given XML by resolving `Include` nodes with a `src` attribute.
 */
export const bundle = (xmlUi: string, includePath: string | string[]): string => {
  if (typeof includePath === "string") {
    includePath = [includePath];
  }

  return resolve(xmlUi, includePath, [], true);
};

/**
 * Unbundles the given XML by replacing comments generated from `bundle` with their respective `Include` node and `src`
 * attribute.
 */
export const unbundle = (xmlUi: string): BundleInformation => {
  const result: BundleInformation = {
    bundles: {},
    root: unbundleContent(xmlUi),
  };

  result.bundles = unbundleFrom(xmlUi);

  return result;
};

const unbundleFrom = (xmlBundle: string): Bundles => {
  let bundles: Bundles = {};

  for (const match of xmlBundle.matchAll(BORDER_REGEX)) {
    let [_, indent, name, content] = match;
    name = name.replace(".xml", "");
    bundles = {
      ...bundles,
      [name]: { name, content: unbundleContent(content, indent) },
      ...unbundleFrom(content),
    };
  }

  return bundles;
};

const unbundleContent = (xmlBundle: string, indent?: string): string => {
  const replacement = '$1<Include src="$2" />';
  let base = xmlBundle.replaceAll(BORDER_REGEX, replacement);
  if (indent) {
    const regex = new RegExp(`^${indent}`, "gm");
    base = base.replaceAll(regex, "");
  }
  return base;
};

const resolve = (xmlUi: string, rootPaths: string[], alreadyResolved: string[], topLevel: boolean) => {
  let resolved = xmlUi;
  let match = resolved.match(INCLUDE_REGEX);

  while (match) {
    let resolvedInclude = readInclude(match[3], rootPaths, alreadyResolved);
    if (topLevel) {
      alreadyResolved = [];
    }

    const indent = match[1] ?? "";
    resolvedInclude = resolvedInclude
      .split("\n")
      .map((line) => (line ? indent + line : line))
      .join("\n");

    const start = match.index!;
    const end = start + match[0].length;

    resolved = resolved.substring(0, start) + resolvedInclude + resolved.substring(end);
    match = resolved.match(INCLUDE_REGEX);
  }

  return resolved;
};

const withXmlExtension = (fileName: string): string => (/\.xml$/i.test(fileName) ? fileName : `${fileName}.xml`);

const readInclude = (file: string, rootPaths: string[], alreadyResolved: string[]) => {
  const border = `<!-- include ${file} -->`;
  const filePath = findFromRoots(withXmlExtension(file), rootPaths);
  const canonicalPath = realpathSync.native(filePath);

  if (alreadyResolved.includes(canonicalPath)) {
    throw new Error(`Cycle detected! File "${filePath}" was already included before.`);
  }

  alreadyResolved.push(canonicalPath);

  const includeContent = readFileSync(filePath, { encoding: "utf-8" });
  const resolved = resolve(includeContent, [dirname(filePath)], alreadyResolved, false);

  return `${border}\n${resolved}\n${border}`;
};

/**
 * Include names are case-insensitive, as in TTS. The name as written wins; otherwise each path segment is matched
 * ignoring case, so includes written on Windows also resolve on case-sensitive file systems.
 */
const findIgnoringCase = (root: string, relativePath: string): string | undefined => {
  let current = root;
  for (const segment of relativePath.split("/")) {
    const exact = `${current}/${segment}`;
    if (existsSync(exact)) {
      current = exact;
      continue;
    }
    if (!existsSync(current) || !statSync(current).isDirectory()) {
      return undefined;
    }
    const match = readdirSync(current).find((entry) => entry.toLowerCase() === segment.toLowerCase());
    if (!match) {
      return undefined;
    }
    current = `${current}/${match}`;
  }
  return current;
};

const findFromRoots = (file: string, rootPaths: string[]): string => {
  for (const root of rootPaths) {
    const filePath = findIgnoringCase(root, file);
    if (filePath) {
      return filePath;
    }
  }

  throw new Error(`Can not resolve file '${file}'!`);
};
