import * as net from "node:net";

import { GATEWAY_CONTROL_PORT } from "./protocol";

/**
 * Returns true if something accepts TCP connections on the gateway control port.
 */
export const probeControlPort = (port: number = GATEWAY_CONTROL_PORT, timeoutMs: number = 500): Promise<boolean> => {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
};
