import * as net from "node:net";

import { TTS_EDITOR_PORT } from "../constants";

export type TtsInboundHandler = (message: Record<string, unknown>) => void;

/**
 * Listen on TTS editor port 39998 for inbound External Editor API messages.
 */
export const listenTtsInbound = (
  onMessage: TtsInboundHandler,
  port: number = TTS_EDITOR_PORT
): Promise<net.Server> => {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      let buffer = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (!line) {
            continue;
          }
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            onMessage(parsed);
          } catch (error) {
            console.error("[tts-gateway] bad inbound JSON:", error);
          }
        }
        // TTS sometimes sends a single JSON object without trailing newline
        if (buffer.trim().length > 0 && buffer.trim().startsWith("{") && buffer.trim().endsWith("}")) {
          try {
            const parsed = JSON.parse(buffer.trim()) as Record<string, unknown>;
            buffer = "";
            onMessage(parsed);
          } catch {
            // wait for more data
          }
        }
      });
    });

    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
};
