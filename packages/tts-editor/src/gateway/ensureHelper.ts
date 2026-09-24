import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { GATEWAY_CONTROL_PORT, probeControlPort } from "@tts-tools/gateway-client";

export type HelperPaths = {
  /** Absolute path to gateway cli.js (bundled in VSIX or monorepo dist). */
  cliJs: string;
  pidFile: string;
};

let ownedHelper: ChildProcess | undefined;

export const defaultPidFilePath = (): string => {
  const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), ".local", "state");
  return path.join(base, "tts-tools", "gateway.pid");
};

/**
 * Resolve gateway CLI path: VSIX `dist/tts-gateway-helper/cli.js`, else monorepo `packages/tts-gateway/dist/cli.js`.
 */
export const resolveGatewayCli = (extensionPath: string): string => {
  const bundled = path.join(extensionPath, "dist", "tts-gateway-helper", "cli.js");
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  const monorepo = path.join(extensionPath, "..", "tts-gateway", "dist", "cli.js");
  if (fs.existsSync(monorepo)) {
    return monorepo;
  }
  // Dev: extensionPath is packages/tts-editor
  const sibling = path.join(extensionPath, "..", "..", "packages", "tts-gateway", "dist", "cli.js");
  if (fs.existsSync(sibling)) {
    return sibling;
  }
  throw new Error(
    `tts-gateway CLI not found. Expected ${bundled} (rebuild/package the extension) or monorepo packages/tts-gateway/dist/cli.js`
  );
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Extension Host `process.execPath` is Cursor/Electron — do not spawn the helper with it.
 * Prefer a real Node binary on PATH.
 */
const resolveNodeExecutable = (): string => {
  if (process.execPath && /node(\.exe)?$/i.test(process.execPath)) {
    return process.execPath;
  }
  return process.platform === "win32" ? "node.exe" : "node";
};

/**
 * Ensure the gateway helper is listening on the control port. Spawns it if needed.
 */
export const ensureGatewayHelper = async (
  extensionPath: string,
  controlPort: number = GATEWAY_CONTROL_PORT,
  log?: (message: string) => void
): Promise<{ alreadyRunning: boolean; pid?: number }> => {
  if (await probeControlPort(controlPort, 400)) {
    log?.(`Gateway control port ${controlPort} already up`);
    return { alreadyRunning: true };
  }

  const cliJs = resolveGatewayCli(extensionPath);
  const nodeExec = resolveNodeExecutable();
  log?.(`Spawning tts-gateway: ${nodeExec} ${cliJs}`);

  const child = spawn(nodeExec, [cliJs], {
    cwd: path.dirname(cliJs),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: false,
    shell: process.platform === "win32",
  });
  ownedHelper = child;

  child.stdout?.on("data", (chunk: Buffer) => log?.(`[gateway] ${chunk.toString("utf8").trimEnd()}`));
  child.stderr?.on("data", (chunk: Buffer) => log?.(`[gateway:err] ${chunk.toString("utf8").trimEnd()}`));
  child.on("exit", (code, signal) => {
    if (ownedHelper === child) {
      ownedHelper = undefined;
    }
    log?.(`Gateway helper exited code=${code} signal=${signal}`);
  });

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await probeControlPort(controlPort, 300)) {
      return { alreadyRunning: false, pid: child.pid };
    }
    if (child.exitCode !== null) {
      throw new Error(`Gateway helper exited early with code ${child.exitCode}`);
    }
    await sleep(200);
  }
  throw new Error(`Gateway helper did not open control port ${controlPort} within 15s`);
};

export const getOwnedHelper = (): ChildProcess | undefined => ownedHelper;

export const clearOwnedHelperRef = (): void => {
  ownedHelper = undefined;
};
