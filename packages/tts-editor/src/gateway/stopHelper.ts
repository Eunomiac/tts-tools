import * as net from "node:net";

import { GATEWAY_CONTROL_PORT } from "@tts-tools/gateway-client";

import { clearOwnedHelperRef, didStartOwnedHelper, getOwnedHelper } from "./ensureHelper";

const SHUTDOWN_WAIT_MS = 5000;

const requestShutdown = (controlPort: number): Promise<boolean> =>
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

const waitForOwnedHelperExit = async (): Promise<void> => {
  const deadline = Date.now() + SHUTDOWN_WAIT_MS;
  while (Date.now() < deadline) {
    const owned = getOwnedHelper();
    if (!owned || owned.exitCode !== null) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

/**
 * Stop a gateway helper that this extension started. Never signals a process the extension did not start.
 */
export const stopOwnedGatewayHelper = async (
  controlPort: number = GATEWAY_CONTROL_PORT,
  log?: (message: string) => void
): Promise<boolean> => {
  if (!didStartOwnedHelper()) {
    log?.("Gateway helper is external or already stopped; leaving it running");
    clearOwnedHelperRef();
    return false;
  }

  if (await requestShutdown(controlPort)) {
    log?.("Asked the owned gateway helper to shut down");
    await waitForOwnedHelperExit();
  }

  const owned = getOwnedHelper();
  if (owned && owned.exitCode === null) {
    log?.(`Stopping owned gateway helper (pid ${owned.pid})`);
    try {
      owned.kill();
    } catch {
      // Detached process may already be gone.
    }
  }
  clearOwnedHelperRef();
  return true;
};

/** @deprecated Prefer stopOwnedGatewayHelper — only stops helpers this extension started. */
export const stopGatewayHelper = stopOwnedGatewayHelper;
