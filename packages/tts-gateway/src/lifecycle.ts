import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import { GATEWAY_CONTROL_PORT, TTS_COMMAND_PORT, TTS_EDITOR_PORT } from "./constants";
import { startControlServer, type ControlServer } from "./control/server";
import { reclaimEditorPort } from "./ports/editorPort";
import { listenTtsInbound } from "./ports/ttsInbound";

export type GatewayOptions = {
  editorPort?: number;
  commandPort?: number;
  controlPort?: number;
  pidFile?: string;
};

export type RunningGateway = {
  editorServer: net.Server;
  control: ControlServer;
  stop: () => Promise<void>;
  whenStopped: Promise<void>;
};

export const defaultPidFilePath = (): string => {
  const base =
    process.env.LOCALAPPDATA ??
    process.env.XDG_STATE_HOME ??
    path.join(os.homedir(), ".local", "state");
  return path.join(base, "tts-tools", "gateway.pid");
};

export const writePidFile = (pidFile: string, pid: number): void => {
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, String(pid), "utf8");
};

export const readPidFile = (pidFile: string): number | undefined => {
  try {
    const raw = fs.readFileSync(pidFile, "utf8").trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
};

export const clearPidFile = (pidFile: string): void => {
  try {
    fs.unlinkSync(pidFile);
  } catch {
    // ignore
  }
};

export const startGateway = async (options: GatewayOptions = {}): Promise<RunningGateway> => {
  const editorPort = options.editorPort ?? TTS_EDITOR_PORT;
  const commandPort = options.commandPort ?? TTS_COMMAND_PORT;
  const controlPort = options.controlPort ?? GATEWAY_CONTROL_PORT;
  const pidFile = options.pidFile ?? defaultPidFilePath();

  if (process.platform === "win32") {
    const reclaim = await reclaimEditorPort(process.pid, editorPort);
    if (reclaim.killed.length > 0) {
      console.log(
        `[tts-gateway] reclaimed 39998 from: ${reclaim.killed.map((k) => `${k.name}(${k.pid})`).join(", ")}`
      );
    }
    if (reclaim.leftover.some((l) => l.pid !== process.pid)) {
      const names = reclaim.leftover.map((l) => `${l.name}(${l.pid})`).join(", ");
      throw new Error(`Cannot bind editor port ${editorPort}; still held by: ${names}`);
    }
  }

  let control: ControlServer | undefined;
  let editorServer: net.Server | undefined;
  let resolveStopped!: () => void;
  const whenStopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });
  let stopped = false;

  const stop = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (control) {
      await control.close();
      control = undefined;
    }
    if (editorServer) {
      await new Promise<void>((resolve) => editorServer!.close(() => resolve()));
      editorServer = undefined;
    }
    clearPidFile(pidFile);
    console.log("[tts-gateway] stopped");
    resolveStopped();
  };

  control = await startControlServer({
    controlPort,
    commandPort,
    editorPort,
    onShutdownRequest: () => {
      void stop();
    },
  });

  try {
    editorServer = await listenTtsInbound(control.handleTtsInbound, editorPort);
  } catch (error) {
    await control.close();
    throw error;
  }

  writePidFile(pidFile, process.pid);
  console.log(`[tts-gateway] editor listening on ${editorPort}; pid=${process.pid}; pidFile=${pidFile}`);

  return {
    editorServer,
    control,
    stop,
    whenStopped,
  };
};
