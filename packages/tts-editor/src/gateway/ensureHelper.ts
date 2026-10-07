import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { GATEWAY_CONTROL_PORT, probeControlPort } from "@tts-tools/gateway-client";

let ownedHelper: ChildProcess | undefined;

/**
 * Resolve gateway CLI path: VSIX `dist/tts-gateway-helper/cli.js`, else (running from the repo)
 * `packages/tts-gateway/dist/cli.js`.
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
  throw new Error(
    `tts-gateway CLI not found. Expected ${bundled} (rebuild/package the extension) or monorepo packages/tts-gateway/dist/cli.js`
  );
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A command line that runs a plain Node.js script, plus the extra environment it needs. */
export type NodeRuntime = {
  command: string;
  env: Record<string, string>;
  description: string;
};

const findOnPath = (executableName: string): string | undefined => {
  const directories = (process.env.PATH ?? "").split(path.delimiter).filter((dir) => dir.length > 0);
  for (const directory of directories) {
    const candidate = path.join(directory, executableName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

/**
 * Prefer a Node.js install on PATH. Without one, reuse the editor's own runtime: VS Code, Cursor and
 * other Electron-based editors behave like plain Node when started with `ELECTRON_RUN_AS_NODE=1`
 * (without that variable, `process.execPath` would open another editor window).
 */
export const resolveNodeRuntime = (): NodeRuntime => {
  if (/^node(\.exe)?$/i.test(path.basename(process.execPath))) {
    return { command: process.execPath, env: {}, description: `Node.js at ${process.execPath}` };
  }

  const nodeOnPath = findOnPath(process.platform === "win32" ? "node.exe" : "node");
  if (nodeOnPath) {
    return { command: nodeOnPath, env: {}, description: `Node.js at ${nodeOnPath}` };
  }

  return {
    command: process.execPath,
    env: { ELECTRON_RUN_AS_NODE: "1" },
    description: `the editor's built-in runtime (${process.execPath})`,
  };
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
  const runtime = resolveNodeRuntime();
  log?.(`Starting the TTS gateway helper with ${runtime.description}`);

  const child = spawn(runtime.command, [cliJs], {
    cwd: path.dirname(cliJs),
    env: { ...process.env, ...runtime.env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: false,
  });
  ownedHelper = child;

  let spawnError: Error | undefined;
  child.on("error", (error) => {
    spawnError = error;
  });
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
    if (spawnError) {
      throw new Error(`Could not start the gateway helper: ${spawnError.message}`);
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
