import { execFile } from "node:child_process";
import * as net from "node:net";
import { promisify } from "node:util";

import { GATEWAY_CONTROL_PORT, TTS_EDITOR_PORT } from "./constants";
import { listEditorPortListeners, type EditorPortListener } from "./ports/editorPort";

const execFileAsync = promisify(execFile);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Process names that must never be killed by --force (case-insensitive). */
const PROTECTED_NAMES = new Set(["tabletopsimulator", "tabletop simulator"]);

export type ForceClaimOptions = {
  editorPort?: number;
  controlPort?: number;
  /** How long to wait after a graceful control shutdown before checking the editor port. */
  gracefulWaitMs?: number;
  log?: (message: string) => void;
};

export type ForceClaimResult = {
  sentShutdown: boolean;
  terminated: EditorPortListener[];
  remaining: EditorPortListener[];
};

const requestControlShutdown = (controlPort: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ port: controlPort, host: "127.0.0.1" });
    const fail = () => {
      socket.destroy();
      resolve(false);
    };
    socket.setTimeout(800);
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ type: "shutdown" })}\n`, () => {
        socket.end();
        resolve(true);
      });
    });
    socket.once("timeout", fail);
    socket.once("error", fail);
  });

const isProtectedListener = (listener: EditorPortListener): boolean => {
  if (listener.pid === process.pid) {
    return true;
  }
  const normalized = listener.name.replace(/\s+/g, "").toLowerCase();
  return PROTECTED_NAMES.has(normalized) || normalized.includes("tabletopsimulator");
};

const terminatePid = async (pid: number): Promise<void> => {
  if (process.platform === "win32") {
    await execFileAsync("taskkill.exe", ["/PID", String(pid), "/F"], {
      windowsHide: true,
      encoding: "utf8",
    });
    return;
  }
  process.kill(pid, "SIGTERM");
  await sleep(400);
  try {
    process.kill(pid, 0);
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone.
  }
};

/**
 * Explicitly free the TTS editor port for a new gateway.
 * Tries a graceful control-port shutdown first, then terminates remaining listeners
 * (never this process, never Tabletop Simulator).
 */
export const forceClaimEditorPort = async (options: ForceClaimOptions = {}): Promise<ForceClaimResult> => {
  const editorPort = options.editorPort ?? TTS_EDITOR_PORT;
  const controlPort = options.controlPort ?? GATEWAY_CONTROL_PORT;
  const gracefulWaitMs = options.gracefulWaitMs ?? 1500;
  const log = options.log;

  const sentShutdown = await requestControlShutdown(controlPort);
  if (sentShutdown) {
    log?.(`Sent shutdown on control port ${controlPort}`);
    await sleep(gracefulWaitMs);
  }

  const holders = await listEditorPortListeners(editorPort);
  const terminated: EditorPortListener[] = [];
  for (const listener of holders) {
    if (isProtectedListener(listener)) {
      log?.(`Refusing to terminate protected listener ${listener.name} (pid ${listener.pid})`);
      continue;
    }
    log?.(`Force-terminating ${listener.name} (pid ${listener.pid}) on port ${editorPort}`);
    try {
      await terminatePid(listener.pid);
      terminated.push(listener);
    } catch (error) {
      log?.(`Could not terminate pid ${listener.pid}: ${error}`);
    }
  }

  if (terminated.length > 0) {
    await sleep(300);
  }

  const remaining = await listEditorPortListeners(editorPort);
  return { sentShutdown, terminated, remaining };
};
