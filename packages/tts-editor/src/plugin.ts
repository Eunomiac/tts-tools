import { OutputChannel, ProgressLocation, StatusBarAlignment, StatusBarItem, ThemeColor, window } from "vscode";

import { LoadedObject, SetLoadedObject } from "./model/objectData";
import { FileHandler, hasOutputFile, writeOutputFile } from "./io/files";
import { PortHoldState } from "./io/portSession";
import { command } from "./command";

export class Plugin {
  public readonly fileHandler: FileHandler;
  private output: OutputChannel;
  private portStatus: StatusBarItem;
  private loadedObjects: Map<string, LoadedObject> = new Map();

  public constructor(fileHandler: FileHandler) {
    this.fileHandler = fileHandler;
    this.output = window.createOutputChannel("TTS Editor");
    this.portStatus = window.createStatusBarItem("tts.portStatus", StatusBarAlignment.Left, -1);
    this.portStatus.command = "ttsEditor.claimEditorPort";

    this.setPortStatus("released");
  }

  resetLoadedObjects = () => {
    this.loadedObjects.clear();

    command.refreshView();
  };

  createObjectFile = async (object: LoadedObject, extension: string, content: string) => {
    const file = `${object.fileName}.${extension}`;
    if (await hasOutputFile(file)) {
      window.showWarningMessage("UI file already exists.");
    } else {
      writeOutputFile(file, content);
    }

    command.refreshView();
  };

  setLoadedObject = (loaded: SetLoadedObject) => {
    const guid = loaded.isGlobal ? "-1" : loaded.guid;
    const loadedObject: LoadedObject = loaded.isGlobal
      ? {
          isGlobal: true,
          name: "Global",
          guid: "-1",
          fileName: loaded.fileName,
          data: loaded.data,
          hasUi: !!loaded.data.XmlUI,
        }
      : {
          isGlobal: false,
          name: loaded.name,
          guid: loaded.guid,
          fileName: loaded.fileName,
          data: loaded.data,
          hasUi: !!loaded.data.XmlUI,
        };

    this.loadedObjects.set(guid, loadedObject);

    command.refreshView();
  };

  removeLoadedObject = (guid: string) => {
    this.loadedObjects.delete(guid);

    command.refreshView();
  };

  getLoadedObject = (guid: string): LoadedObject | undefined => {
    return this.loadedObjects.get(guid);
  };

  getLoadedObjectByFileName = (fileName: string): LoadedObject | undefined => {
    for (const [_, object] of this.loadedObjects) {
      if (object.fileName.toLocaleLowerCase() === fileName.toLocaleLowerCase()) {
        return object;
      }
    }

    return undefined;
  };

  getLoadedObjects = (): LoadedObject[] => {
    const objects: LoadedObject[] = [];

    for (const [_, object] of this.loadedObjects) {
      objects.push(object);
    }

    return objects;
  };

  /** Brief sync notes go to the TTS Editor output channel (no extra status-bar chip). */
  setStatus = (result: string) => {
    this.info(result);
  };

  setPortStatus = (state: PortHoldState, detail?: string) => {
    switch (state) {
      case "holding":
        this.portStatus.text = "$(plug) TTS Port: 39998";
        this.portStatus.tooltip = detail
          ? `${detail}\nClick to Release the editor port.`
          : "Holding editor port 39998. Click to Release for another local tool.";
        this.portStatus.backgroundColor = undefined;
        this.portStatus.command = "ttsEditor.releaseEditorPort";
        break;
      case "released":
        this.portStatus.text = "$(debug-disconnect) TTS Port: released";
        this.portStatus.tooltip = detail
          ? `${detail}\nClick to Claim the editor port.`
          : "Not listening on 39998. Click to Claim.";
        this.portStatus.backgroundColor = undefined;
        this.portStatus.command = "ttsEditor.claimEditorPort";
        break;
      case "error":
        this.portStatus.text = "$(error) TTS Port: error";
        this.portStatus.tooltip = detail ?? "Editor port error. Click to retry Claim.";
        this.portStatus.backgroundColor = new ThemeColor("statusBarItem.errorBackground");
        this.portStatus.command = "ttsEditor.claimEditorPort";
        break;
    }
    this.portStatus.show();
  };

  showOutput = () => {
    this.output.show();
  };

  debug = (message: string) => {
    console.debug(message);
  };

  info = (message: string) => {
    console.log(message);
    this.output.appendLine(message);
  };

  error = (message: string) => {
    console.error(message);
    this.output.appendLine(message);
  };

  progress = <T>(title: string, handler: () => Promise<T>): Thenable<T> => {
    return window.withProgress(
      {
        location: ProgressLocation.Window,
        title: title,
      },
      handler
    );
  };

  dispose = () => {
    this.portStatus.dispose();
    this.output.dispose();
  };
}
