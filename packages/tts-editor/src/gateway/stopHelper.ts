import * as net from "node:net";

import { GATEWAY_CONTROL_PORT } from "@tts-tools/gateway-client";

import { clearOwnedHelperRef, getOwnedHelper } from "./ensureHelper";

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
 * Ask the gateway helper to shut down over its control port, then make sure a helper this
 * extension started has exited. Never signals a process the extension did not start.
 */
export const stopGatewayHelper = async (
  controlPort: number = GATEWAY_CONTROL_PORT,
  log?: (message: string) => void
): Promise<void> => {
  if (await requestShutdown(controlPort)) {
    log?.("Asked the gateway helper to shut down");
    await waitForOwnedHelperExit();
  }

  const owned = getOwnedHelper();
  if (owned && owned.exitCode === null) {
    log?.(`Stopping gateway helper (pid ${owned.pid})`);
    owned.kill();
  }
  clearOwnedHelperRef();
};
