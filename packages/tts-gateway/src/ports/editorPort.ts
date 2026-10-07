import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { TTS_EDITOR_PORT } from "../constants";

const execFileAsync = promisify(execFile);

export type EditorPortListener = {
  readonly pid: number;
  readonly name: string;
};

export const parseNetstatListeningPids = (stdout: string, port: number): number[] => {
  const pids = new Set<number>();
  for (const line of stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] !== "TCP" || parts[3] !== "LISTENING" || parts[1] === undefined || parts[4] === undefined) {
      continue;
    }
    const localAddress = parts[1];
    const colon = localAddress.lastIndexOf(":");
    const pid = Number(parts[4]);
    if (colon >= 0 && Number(localAddress.slice(colon + 1)) === port && Number.isInteger(pid) && pid > 4) {
      pids.add(pid);
    }
  }
  return [...pids];
};

const processNameForPid = async (pid: number): Promise<string> => {
  try {
    const { stdout } = await execFileAsync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      windowsHide: true,
      encoding: "utf8",
    });
    const imageName = stdout.match(/^"([^"]+)"/m)?.[1] ?? "";
    return imageName.replace(/\.exe$/i, "") || `pid ${pid}`;
  } catch {
    return `pid ${pid}`;
  }
};

/**
 * Which processes are listening on the TTS editor port (Windows only; empty elsewhere).
 * Used to explain a failed start — the gateway never stops other programs.
 */
export const listEditorPortListeners = async (port: number = TTS_EDITOR_PORT): Promise<EditorPortListener[]> => {
  if (process.platform !== "win32") {
    return [];
  }
  try {
    const { stdout } = await execFileAsync("netstat.exe", ["-ano", "-p", "TCP"], {
      windowsHide: true,
      encoding: "utf8",
    });
    const pids = parseNetstatListeningPids(stdout, port);
    return Promise.all(pids.map(async (pid) => ({ pid, name: await processNameForPid(pid) })));
  } catch {
    return [];
  }
};
