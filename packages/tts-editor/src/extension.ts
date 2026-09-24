import { ExtensionContext, commands, window } from "vscode";

import { claimEditorPort, releaseEditorPort } from "./command/claimEditorPort";
import createUi from "./command/createUi";
import executeScript from "./command/executeScript";
import getScripts from "./command/getScripts";
import goToLastError from "./command/goToLastError";
import openBundledScript from "./command/openBundledScript";
import unbundleLibrary from "./command/unbundleLibrary";
import {
  saveAndPlay,
  saveAndPlayBundled,
  saveAndPlayBundledFullResync,
  saveAndPlayFullResync,
} from "./command/saveAndPlay";
import showOutput from "./command/showOutput";
import showView from "./command/showView";
import updateObject from "./command/updateObject";
import updateObjectState from "./command/updateObjectState";
import { FileHandler } from "./io/files";
import { Plugin } from "./plugin";
import { TTSObjectItem, TTSObjectTreeProvider } from "./view/ttsObjectTreeProvider";

export const extensionName = "ttsEditor";

let activeAdapter: { dispose: () => Promise<void> } | undefined;
let activePlugin: Plugin | undefined;

export function activate(context: ExtensionContext) {
  const fileHandler = new FileHandler(context.extension);
  const plugin = new Plugin(fileHandler);
  activePlugin = plugin;
  context.subscriptions.push({ dispose: () => plugin.dispose() });

  const registerCommand = (name: string, handler: Parameters<typeof commands.registerCommand>[1]) => {
    context.subscriptions.push(commands.registerCommand(`${extensionName}.${name}`, handler));
  };

  try {
    // Load adapter after Plugin so a gateway/client require failure still leaves the status bar visible.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TTSAdapter } = require("./ttsAdapter") as typeof import("./ttsAdapter");
    const viewProvider = new TTSObjectTreeProvider(plugin);
    const view = window.createTreeView("ttsEditor.objectView", {
      treeDataProvider: viewProvider,
    });
    context.subscriptions.push(view);

    const adapter = new TTSAdapter(plugin);
    activeAdapter = adapter;

    const registerMacro = (name: string) => {
      registerCommand(name, (arg?: TTSObjectItem) => adapter.executeMacro(name, arg?.object));
    };

    registerCommand("getObjects", getScripts(adapter));
    registerCommand("saveAndPlay", saveAndPlay(adapter));
    registerCommand("saveAndPlayBundled", saveAndPlayBundled(adapter));
    registerCommand("saveAndPlayFullResync", saveAndPlayFullResync(adapter));
    registerCommand("saveAndPlayBundledFullResync", saveAndPlayBundledFullResync(adapter));
    registerCommand("claimEditorPort", claimEditorPort(adapter));
    registerCommand("releaseEditorPort", releaseEditorPort(adapter));
    registerCommand("executeCode", executeScript(adapter));
    registerCommand("showOutput", showOutput(plugin));
    registerCommand("goToLastError", goToLastError(adapter));
    registerCommand("showView", showView(view));
    registerCommand("updateView", () => viewProvider.refresh());
    registerCommand("openBundledScript", openBundledScript);
    registerCommand("createUi", createUi(plugin));
    registerCommand("updateObject", updateObject(plugin, adapter));
    registerCommand("updateObjectState", updateObjectState(plugin, adapter));
    registerCommand("unbundleLibrary", unbundleLibrary(adapter));

    registerMacro("getObjectState");
    registerMacro("getRuntimeUi");
    registerMacro("locateObject");

    window.registerTreeDataProvider("ttsEditor.objectView", viewProvider);

    console.log("tts-tools-vscode activated");
  } catch (error) {
    const message = `TTS Tools failed to finish activating: ${error}`;
    console.error(message, error);
    plugin.setPortStatus("error", message);
    void window.showErrorMessage(message);

    const report = () => {
      void window.showErrorMessage(message);
      plugin.showOutput();
    };
    // Register stubs so toolbar / palette commands are not "not found"
    for (const name of [
      "getObjects",
      "saveAndPlay",
      "saveAndPlayBundled",
      "saveAndPlayFullResync",
      "saveAndPlayBundledFullResync",
      "claimEditorPort",
      "releaseEditorPort",
      "executeCode",
      "showOutput",
      "goToLastError",
      "showView",
      "updateView",
      "openBundledScript",
      "createUi",
      "updateObject",
      "updateObjectState",
      "unbundleLibrary",
      "getObjectState",
      "getRuntimeUi",
      "locateObject",
    ]) {
      registerCommand(name, report);
    }
  }
}

export async function deactivate() {
  console.log(`${extensionName} deactivating — stopping TTS gateway helper`);
  try {
    await activeAdapter?.dispose();
  } catch (e) {
    console.error(e);
  }
  activePlugin?.dispose();
  activeAdapter = undefined;
  activePlugin = undefined;
}
