import * as net from "node:net";

import { TTS_COMMAND_PORT } from "./protocol";

/**
 * Send one External Editor API JSON message to TTS on the command port.
 */
export const sendToTts = (
  payload: Record<string, unknown>,
  commandPort: number = TTS_COMMAND_PORT
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const socket = net.connect(commandPort, "127.0.0.1");
    socket.setTimeout(10_000);
    socket.once("connect", () => {
      // Upstream library writes JSON without requiring a trailing newline.
      socket.end(JSON.stringify(payload), () => resolve());
    });
    socket.once("error", (error) => reject(error));
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`TTS command port ${commandPort} timed out`));
    });
  });
};
