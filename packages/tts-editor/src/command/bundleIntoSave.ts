import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { bundleIntoSaveFiles } from "@tts-tools/savefile";
import { window, workspace } from "vscode";

import configuration from "../configuration";
import { getOutputPath } from "../io/files";
import type { Plugin } from "../plugin";

const resolveTargetPath = (configured: string): string => {
  if (isAbsolute(configured)) {
    return configured;
  }
  const folder = workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    throw new Error("Open a workspace folder to use relative Bundle Into Save paths.");
  }
  return join(folder, configured);
};

export const bundleIntoSave = (plugin: Plugin) => async () => {
  try {
    const configured = configuration.bundleIntoSaveTargets();
    let targets = configured.map((entry) => ({
      path: resolveTargetPath(entry.path),
      preserveGlobal: entry.preserveGlobal === true,
      backup: true,
    }));

    if (targets.length === 0) {
      const picked = await window.showOpenDialog({
        canSelectMany: true,
        filters: { "TTS Save": ["json"] },
        title: "Bundle Into Save — choose save JSON file(s)",
      });
      if (!picked || picked.length === 0) {
        return;
      }
      targets = picked.map((uri) => ({
        path: uri.fsPath,
        preserveGlobal: /TS_Save_9001\.json$/i.test(uri.fsPath),
        backup: true,
      }));
    }

    for (const target of targets) {
      if (!existsSync(target.path)) {
        throw new Error(`Save file not found: ${target.path}`);
      }
    }

    const objectsDir = getOutputPath("script").fsPath;
    const includePaths = configuration.xmlIncludePaths();

    const result = await plugin.progress("Bundling into save file(s)", async () =>
      bundleIntoSaveFiles({
        targets,
        objectsDir,
        includePaths: includePaths.length > 0 ? includePaths : ["."],
      })
    );

    const summary = result.files
      .map(
        (file) =>
          `${file.path}: updated ${file.stats.updated}` +
          (file.stats.skippedGlobal ? " (Global preserved)" : "") +
          (file.stats.missingInSave.length ? `, ${file.stats.missingInSave.length} stub(s) not in save` : "")
      )
      .join("\n");
    plugin.info(`Bundle Into Save finished (${result.scriptsBundled} GUID(s))\n${summary}`);
    window.showInformationMessage(
      `Bundle Into Save updated ${result.files.length} save(s) from ${result.scriptsBundled} object stub(s).`
    );
  } catch (error) {
    const message = `Bundle Into Save failed: ${error}`;
    plugin.error(message);
    window.showErrorMessage(message);
  }
};
