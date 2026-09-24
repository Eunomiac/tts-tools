import * as net from "node:net";

import { TTS_EDITOR_PORT } from "../constants";

export type TtsInboundHandler = (message: Record<string, unknown>) => void;

/**
 * Listen on TTS editor port 39998 for inbound External Editor API messages.
 *
 * TTS opens a connection, writes one JSON document (often pretty-printed with
 * newlines), then closes. Match @matanlurey/tts-editor: accumulate until `end`,
 * then parse once — do not split on newlines.
 */
export const listenTtsInbound = (
  onMessage: TtsInboundHandler,
  port: number = TTS_EDITOR_PORT
): Promise<net.Server> => {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      const chunks: Buffer[] = [];
      socket.on("data", (data: Buffer) => {
        chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
      });
      socket.on("end", () => {
        if (chunks.length === 0) {
          return;
        }
        const text = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "").trim();
        if (!text) {
          return;
        }
        try {
          const parsed = JSON.parse(text) as Record<string, unknown>;
          onMessage(parsed);
        } catch (error) {
          const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text;
          console.error(`[tts-gateway] bad inbound JSON (${text.length} chars):`, error);
          console.error(`[tts-gateway] preview: ${preview}`);
        }
      });
      socket.on("error", (error) => {
        console.error("[tts-gateway] inbound socket error:", error);
      });
    });

    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
};
