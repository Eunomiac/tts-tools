#!/usr/bin/env node
import { resolve } from "path";

import { bundleIntoSaveFiles } from "./bundleIntoSave";

// Compiled to dist/cliBundleIntoSave.js — package bin: tts-bundle-into-save

const printHelp = () => {
  console.log(`tts-bundle-into-save — bundle .tts/objects stubs into TTS save JSON files

Usage:
  tts-bundle-into-save --save <path> [--save <path> ...] --objects <dir> [--include <dir> ...]
                       [--preserve-global-for <path>] [--no-backup]

  --save <path>                 Save JSON to update (repeatable)
  --objects <dir>               Directory of object stubs (e.g. .tts/objects)
  --include <dir>               Lua/XML include root (repeatable; default: .)
  --preserve-global-for <path>  Do not overwrite Global on this save (repeatable)
  --no-backup                   Skip .bak copies before writing
`);
};

const parseArgs = (argv: string[]) => {
  const saves: string[] = [];
  const includes: string[] = [];
  const preserveGlobalFor = new Set<string>();
  let objectsDir: string | undefined;
  let backup = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--no-backup") {
      backup = false;
      continue;
    }
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    if (arg === "--save") {
      saves.push(resolve(next));
      i += 1;
    } else if (arg === "--objects") {
      objectsDir = resolve(next);
      i += 1;
    } else if (arg === "--include") {
      includes.push(resolve(next));
      i += 1;
    } else if (arg === "--preserve-global-for") {
      preserveGlobalFor.add(resolve(next));
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (saves.length === 0) {
    throw new Error("At least one --save is required");
  }
  if (!objectsDir) {
    throw new Error("--objects is required");
  }

  return {
    saves,
    objectsDir,
    includes: includes.length > 0 ? includes : [resolve(".")],
    preserveGlobalFor,
    backup,
  };
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const result = bundleIntoSaveFiles({
    objectsDir: args.objectsDir,
    includePaths: args.includes,
    targets: args.saves.map((path) => ({
      path,
      backup: args.backup,
      preserveGlobal: args.preserveGlobalFor.has(path),
    })),
  });

  console.log(`Bundled scripts for ${result.scriptsBundled} GUID(s)`);
  for (const file of result.files) {
    console.log(
      `${file.path}: updated ${file.stats.updated}` +
        (file.stats.skippedGlobal ? `, preserved Global` : "") +
        (file.stats.missingInSave.length
          ? `, ${file.stats.missingInSave.length} stub GUID(s) not in save`
          : "")
    );
  }
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
