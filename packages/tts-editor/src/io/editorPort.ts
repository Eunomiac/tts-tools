import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const TTS_EDITOR_PORT = 39998;

export type EditorPortListener = {
  readonly pid: number;
  readonly name: string;
  readonly addresses: readonly string[];
};

export type ReclaimResult = {
  readonly killed: readonly EditorPortListener[];
  readonly skipped: readonly EditorPortListener[];
  readonly leftover: readonly EditorPortListener[];
  readonly failed: readonly { readonly pid: number; readonly error: string }[];
};

const isTabletopSimulator = (listener: EditorPortListener): boolean => {
  const name = listener.name.trim().toLowerCase();
  return name.includes("tabletop") || name.includes("tabletopsimulator");
};

export const shouldKillListener = (listener: EditorPortListener, selfPid: number): boolean => {
  if (listener.pid === selfPid) {
    return false;
  }
  if (isTabletopSimulator(listener)) {
    return false;
  }
  return true;
};

export const parseNetstatListening = (stdout: string, port: number): { address: string; pid: number }[] => {
  const rows: { address: string; pid: number }[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] !== "TCP" || parts[3] !== "LISTENING" || parts[1] === undefined || parts[4] === undefined) {
      continue;
    }
    const local = parts[1];
    const colon = local.lastIndexOf(":");
    if (colon < 0) {
      continue;
    }
    if (Number(local.slice(colon + 1)) !== port) {
      continue;
    }
    const pid = Number(parts[4]);
    if (!Number.isInteger(pid) || pid <= 4) {
      continue;
    }
    rows.push({ address: local.slice(0, colon), pid });
  }
  return rows;
};

const friendlyExecError = (error: unknown, fallback: string): string => {
  if (typeof error === "object" && error !== null && "stderr" in error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
    if (stderr.length > 0 && !/powershell\.exe/i.test(stderr) && stderr.length < 180) {
      return stderr;
    }
  }
  return fallback;
};

const csvFirstField = (stdout: string): string => {
  const line = stdout.split(/\r?\n/).find((row) => row.trim().length > 0) ?? "";
  const match = line.match(/^"([^"]+)"/);
  if (match?.[1]) {
    return match[1];
  }
  return line.split(",")[0]?.replace(/^"|"$/g, "").trim() ?? "";
};

const processNameForPid = async (pid: number): Promise<string> => {
  try {
    const { stdout } = await execFileAsync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      windowsHide: true,
      encoding: "utf8",
    });
    const image = csvFirstField(stdout);
    return image.replace(/\.exe$/i, "") || `pid-${pid}`;
  } catch {
    return `pid-${pid}`;
  }
};

export const listEditorPortListeners = async (port: number = TTS_EDITOR_PORT): Promise<EditorPortListener[]> => {
  if (process.platform !== "win32") {
    throw new Error("Force-claiming the editor port is only implemented on Windows.");
  }
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("netstat.exe", ["-ano", "-p", "TCP"], {
      windowsHide: true,
      encoding: "utf8",
    }));
  } catch {
    try {
      ({ stdout } = await execFileAsync("netstat.exe", ["-ano"], {
        windowsHide: true,
        encoding: "utf8",
      }));
    } catch (error: unknown) {
      throw new Error(friendlyExecError(error, `Could not inspect port ${port}.`));
    }
  }
  const grouped = new Map<number, { pid: number; addresses: string[] }>();
  for (const row of parseNetstatListening(stdout, port)) {
    const existing = grouped.get(row.pid);
    if (existing) {
      if (!existing.addresses.includes(row.address)) {
        existing.addresses.push(row.address);
      }
      continue;
    }
    grouped.set(row.pid, { pid: row.pid, addresses: [row.address] });
  }
  const listeners: EditorPortListener[] = [];
  for (const row of grouped.values()) {
    listeners.push({
      pid: row.pid,
      name: await processNameForPid(row.pid),
      addresses: row.addresses,
    });
  }
  return listeners;
};

const killPid = async (pid: number): Promise<void> => {
  try {
    await execFileAsync("taskkill.exe", ["/PID", String(pid), "/F"], {
      windowsHide: true,
      encoding: "utf8",
    });
  } catch (error: unknown) {
    throw new Error(friendlyExecError(error, `Could not stop process ${pid}.`));
  }
};

/**
 * Stop reclaimable listeners on the TTS editor port. Never kills Tabletop Simulator itself.
 */
export const reclaimEditorPort = async (
  selfPid: number,
  port: number = TTS_EDITOR_PORT
): Promise<ReclaimResult> => {
  const listeners = await listEditorPortListeners(port);
  const skipped = listeners.filter((listener) => !shouldKillListener(listener, selfPid));
  const targets = listeners.filter((listener) => shouldKillListener(listener, selfPid));
  const killed: EditorPortListener[] = [];
  const failed: { pid: number; error: string }[] = [];
  for (const listener of targets) {
    try {
      await killPid(listener.pid);
      killed.push(listener);
    } catch (error: unknown) {
      failed.push({
        pid: listener.pid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const leftover = await listEditorPortListeners(port);
  return { killed, skipped, leftover, failed };
};
