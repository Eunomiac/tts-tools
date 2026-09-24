import * as net from "node:net";

import {
  GATEWAY_CONTROL_PORT,
  HEARTBEAT_TIMEOUT_MS,
  TTS_COMMAND_PORT,
  TTS_EDITOR_PORT,
} from "../constants";
import { fanOutEvent } from "../fanout/router";
import { ReturnIdTracker } from "../fanout/returnIds";
import { sendToTts } from "../ports/ttsOutbound";
import {
  ControlClientMessage,
  isValidRouteTag,
} from "../protocol";
import { ClientRegistry, writeControlMessage } from "./clients";

export type ControlServerOptions = {
  controlPort?: number;
  commandPort?: number;
  editorPort?: number;
  onShutdownRequest?: () => void;
};

export type ControlServer = {
  server: net.Server;
  clients: ClientRegistry;
  returns: ReturnIdTracker;
  handleTtsInbound: (message: Record<string, unknown>) => void;
  close: () => Promise<void>;
};

const parseClientLine = (line: string): ControlClientMessage | undefined => {
  try {
    return JSON.parse(line) as ControlClientMessage;
  } catch {
    return undefined;
  }
};

export const startControlServer = (options: ControlServerOptions = {}): Promise<ControlServer> => {
  const controlPort = options.controlPort ?? GATEWAY_CONTROL_PORT;
  const commandPort = options.commandPort ?? TTS_COMMAND_PORT;
  const editorPort = options.editorPort ?? TTS_EDITOR_PORT;
  const clients = new ClientRegistry();
  const returns = new ReturnIdTracker();

  const handleMessage = async (socket: net.Socket, message: ControlClientMessage): Promise<void> => {
    switch (message.type) {
      case "register": {
        const routeTag = isValidRouteTag(message.routeTag) ? message.routeTag : undefined;
        if (message.routeTag && !routeTag) {
          writeControlMessage(socket, {
            type: "error",
            message: `Invalid routeTag "${message.routeTag}" (expected [A-Z][A-Z0-9_]{0,31})`,
          });
        }
        clients.register({
          clientId: message.clientId,
          routeTag,
          socket,
          lastHeartbeat: Date.now(),
          buffer: "",
        });
        writeControlMessage(socket, {
          type: "registered",
          clientId: message.clientId,
          routeTag,
        });
        console.log(`[tts-gateway] registered ${message.clientId}${routeTag ? ` tag=${routeTag}` : ""}`);
        return;
      }
      case "heartbeat": {
        clients.touchHeartbeat(socket);
        writeControlMessage(socket, { type: "heartbeat" });
        return;
      }
      case "executeLua": {
        const client = clients.get(socket);
        if (!client) {
          writeControlMessage(socket, {
            type: "error",
            requestId: message.requestId,
            message: "Not registered",
          });
          return;
        }
        const returnID = returns.allocate(client, message.requestId);
        try {
          await sendToTts(
            {
              messageID: 3,
              script: message.script,
              guid: message.guid ?? "-1",
              returnID,
            },
            commandPort
          );
        } catch (error) {
          returns.cancel(returnID);
          writeControlMessage(socket, {
            type: "error",
            requestId: message.requestId,
            message: `executeLua send failed: ${error}`,
          });
        }
        return;
      }
      case "command": {
        try {
          await sendToTts(message.payload, commandPort);
        } catch (error) {
          writeControlMessage(socket, {
            type: "error",
            message: `command send failed: ${error}`,
          });
        }
        return;
      }
      case "shutdown": {
        console.log("[tts-gateway] shutdown requested by client");
        options.onShutdownRequest?.();
        return;
      }
      default:
        writeControlMessage(socket, { type: "error", message: "Unknown control message type" });
    }
  };

  const handleTtsInbound = (message: Record<string, unknown>): void => {
    const messageID = Number(message.messageID);
    if (messageID === 5) {
      const returnID = Number(message.returnID);
      returns.resolve(returnID, message.returnValue);
      return;
    }
    fanOutEvent(
      clients.all(),
      (tag) => clients.findByRouteTag(tag),
      messageID,
      message
    );
  };

  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.setEncoding("utf8");
      writeControlMessage(socket, {
        type: "hello",
        version: 1,
        editorPort,
        commandPort,
      });

      let buffer = "";
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
          const parsed = parseClientLine(line);
          if (!parsed) {
            writeControlMessage(socket, { type: "error", message: "Invalid JSON" });
            continue;
          }
          void handleMessage(socket, parsed);
        }
      });

      socket.on("close", () => {
        const removed = clients.remove(socket);
        if (removed) {
          returns.dropClient(removed);
          console.log(`[tts-gateway] client left ${removed.clientId}`);
        }
      });

      socket.on("error", () => {
        clients.remove(socket);
      });
    });

    const sweep = setInterval(() => {
      const now = Date.now();
      for (const client of clients.all()) {
        if (now - client.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
          console.log(`[tts-gateway] heartbeat timeout ${client.clientId}`);
          client.socket.destroy();
          clients.remove(client.socket);
          returns.dropClient(client);
        }
      }
    }, HEARTBEAT_TIMEOUT_MS / 2);

    server.once("error", reject);
    server.listen(controlPort, "127.0.0.1", () => {
      server.off("error", reject);
      console.log(`[tts-gateway] control listening on ${controlPort}`);
      resolve({
        server,
        clients,
        returns,
        handleTtsInbound,
        close: () =>
          new Promise((res) => {
            clearInterval(sweep);
            for (const client of clients.all()) {
              client.socket.destroy();
            }
            server.close(() => res());
          }),
      });
    });
  });
};
