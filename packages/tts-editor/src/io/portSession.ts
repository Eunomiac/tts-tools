import ExternalEditorApi from "@matanlurey/tts-editor";
import { Server } from "net";

import { reclaimEditorPort, TTS_EDITOR_PORT } from "./editorPort";

export type PortHoldState = "holding" | "gateway" | "released" | "error";

type ApiInternals = {
  server: Server;
  serverPort: number;
};

export const isEditorApiListening = (api: ExternalEditorApi): boolean => {
  const { server } = api as unknown as ApiInternals;
  return server.listening;
};

/**
 * Listen via the upstream helper (registers TTS connection handlers) while still
 * failing fast on EADDRINUSE.
 */
export const listenEditorApi = async (api: ExternalEditorApi): Promise<number> => {
  const { server, serverPort } = api as unknown as ApiInternals;

  if (server.listening) {
    const address = server.address();
    return typeof address === "object" && address ? address.port : serverPort;
  }

  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      reject(error);
    };
    server.once("error", onError);

    void api
      .listen()
      .then((port) => {
        server.off("error", onError);
        resolve(port ?? serverPort);
      })
      .catch((error: unknown) => {
        server.off("error", onError);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
};

export const closeEditorApi = async (api: ExternalEditorApi): Promise<void> => {
  const { server } = api as unknown as ApiInternals;
  if (!server.listening) {
    // Still call close() so upstream cleans up; ignore "not running" style errors.
    try {
      api.close();
    } catch {
      // ignore
    }
    return;
  }
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
};

export type ClaimListenResult = { port: number; detail: string };

/**
 * Force-claim reclaimable holders (other local tools, stale editors), then listen. Never kills TTS.
 * Caller should pass a fresh ExternalEditorApi if the previous one was closed (connection handlers).
 */
export const prepareAndListen = async (api: ExternalEditorApi): Promise<ClaimListenResult> => {
  if (isEditorApiListening(api)) {
    return { port: TTS_EDITOR_PORT, detail: "Already holding the editor port." };
  }

  if (process.platform === "win32") {
    const result = await reclaimEditorPort(process.pid, TTS_EDITOR_PORT);
    const leftoverBlocking = result.leftover.filter((l) => l.pid !== process.pid);
    if (leftoverBlocking.length > 0) {
      const names = leftoverBlocking.map((l) => `${l.name} (${l.pid})`).join(", ");
      const ttsHeld = leftoverBlocking.some((l) => /tabletop/i.test(l.name));
      if (ttsHeld) {
        throw new Error(
          `Port ${TTS_EDITOR_PORT} is held by Tabletop Simulator — that process is never force-cleared.`
        );
      }
      throw new Error(`Port ${TTS_EDITOR_PORT} still in use after reclaim: ${names}`);
    }
    const killedNote =
      result.killed.length > 0
        ? `Stopped ${result.killed.map((l) => l.name).join(", ")}. `
        : "No other reclaimable listener. ";
    const port = await listenEditorApi(api);
    return { port, detail: `${killedNote}Listening on ${port}.` };
  }

  try {
    const port = await listenEditorApi(api);
    return { port, detail: `Listening on ${port}.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not listen on ${TTS_EDITOR_PORT}: ${message}. On this OS, force-claim is not implemented — free the port manually, then Claim again.`
    );
  }
};
