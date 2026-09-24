import { EventEmitter } from "node:events";
import * as net from "node:net";
import { randomUUID } from "node:crypto";

import {
  ControlClientMessage,
  ControlServerMessage,
  GATEWAY_CONTROL_PORT,
  HEARTBEAT_INTERVAL_MS,
  isValidRouteTag,
} from "./protocol";

export type GatewayStatus = {
  mode: "gateway" | "disconnected";
  detail?: string;
};

export type ConnectGatewayOptions = {
  routeTag?: string;
  controlPort?: number;
  clientId?: string;
  /** How long to wait for hello + registered (ms). */
  connectTimeoutMs?: number;
};

type PendingLua = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type GatewaySession = {
  readonly clientId: string;
  readonly routeTag?: string;
  on(event: "print", listener: (message: string) => void): void;
  on(event: "error", listener: (payload: Record<string, unknown>) => void): void;
  on(event: "loadingANewGame", listener: (payload: Record<string, unknown>) => void): void;
  on(event: "pushingNewObject", listener: (payload: Record<string, unknown>) => void): void;
  on(event: "objectCreated", listener: (payload: Record<string, unknown>) => void): void;
  on(event: "customMessage", listener: (payload: Record<string, unknown>) => void): void;
  on(event: "gameSaved", listener: (payload: Record<string, unknown>) => void): void;
  on(event: "status", listener: (status: GatewayStatus) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
  executeLua<T = unknown>(script: string, guid?: string): Promise<T>;
  getLuaScripts(): Promise<void>;
  saveAndPlay(scriptStates: unknown[]): Promise<void>;
  customMessage(customMessage: unknown): Promise<void>;
  sendCommand(payload: Record<string, unknown>): Promise<void>;
  requestShutdown(): Promise<void>;
  close(): Promise<void>;
};

class GatewaySessionImpl extends EventEmitter implements GatewaySession {
  readonly clientId: string;
  readonly routeTag?: string;
  private socket: net.Socket;
  private buffer = "";
  private nextRequestId = 1;
  private pending = new Map<number, PendingLua>();
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(socket: net.Socket, clientId: string, routeTag: string | undefined, initialBuffer: string) {
    super();
    this.socket = socket;
    this.clientId = clientId;
    this.routeTag = routeTag;
    this.buffer = initialBuffer;

    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.onData(chunk));
    socket.on("close", () => this.onDisconnected("Control connection closed"));
    socket.on("error", (error) => this.onDisconnected(`Control error: ${error}`));

    this.heartbeatTimer = setInterval(() => {
      this.write({ type: "heartbeat" });
    }, HEARTBEAT_INTERVAL_MS);

    if (this.buffer.length > 0) {
      this.onData("");
    }
  }

  private write(message: ControlClientMessage): void {
    if (this.socket.destroyed || this.closed) {
      return;
    }
    this.socket.write(`${JSON.stringify(message)}\n`);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf("\n");
      if (!line) {
        continue;
      }
      try {
        const message = JSON.parse(line) as ControlServerMessage;
        this.handleServerMessage(message);
      } catch {
        // ignore malformed
      }
    }
  }

  private handleServerMessage(message: ControlServerMessage): void {
    switch (message.type) {
      case "hello":
      case "registered":
      case "heartbeat":
        return;
      case "return": {
        const pending = this.pending.get(message.requestId);
        if (!pending) {
          return;
        }
        this.pending.delete(message.requestId);
        clearTimeout(pending.timer);
        pending.resolve(message.returnValue);
        return;
      }
      case "error": {
        if (message.requestId !== undefined) {
          const pending = this.pending.get(message.requestId);
          if (pending) {
            this.pending.delete(message.requestId);
            clearTimeout(pending.timer);
            pending.reject(new Error(message.message));
            return;
          }
        }
        this.emit("status", { mode: "gateway", detail: message.message } satisfies GatewayStatus);
        return;
      }
      case "event": {
        this.dispatchEvent(message.messageID, message.payload);
        return;
      }
      default:
        return;
    }
  }

  private dispatchEvent(messageID: number, payload: Record<string, unknown>): void {
    switch (messageID) {
      case 0:
        this.emit("pushingNewObject", payload);
        break;
      case 1:
        this.emit("loadingANewGame", payload);
        break;
      case 2:
        this.emit("print", typeof payload.message === "string" ? payload.message : String(payload.message ?? ""));
        break;
      case 3:
        this.emit("error", payload);
        break;
      case 4:
        this.emit("customMessage", payload);
        break;
      case 6:
        this.emit("gameSaved", payload);
        break;
      case 7:
        this.emit("objectCreated", payload);
        break;
      default:
        break;
    }
  }

  private onDisconnected(detail: string): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(detail));
      this.pending.delete(id);
    }
    this.emit("status", { mode: "disconnected", detail } satisfies GatewayStatus);
  }

  async executeLua<T = unknown>(script: string, guid: string = "-1"): Promise<T> {
    const requestId = this.nextRequestId++;
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`executeLua timed out (requestId ${requestId})`));
      }, 120_000);
      this.pending.set(requestId, { resolve, reject, timer });
    });
    this.write({ type: "executeLua", requestId, script, guid });
    return result as Promise<T>;
  }

  async sendCommand(payload: Record<string, unknown>): Promise<void> {
    this.write({ type: "command", payload });
  }

  async getLuaScripts(): Promise<void> {
    await this.sendCommand({ messageID: 0 });
  }

  async saveAndPlay(scriptStates: unknown[]): Promise<void> {
    await this.sendCommand({ messageID: 1, scriptStates });
  }

  async customMessage(customMessage: unknown): Promise<void> {
    await this.sendCommand({ messageID: 2, customMessage });
  }

  async requestShutdown(): Promise<void> {
    this.write({ type: "shutdown" });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Session closed"));
      this.pending.delete(id);
    }
    this.socket.destroy();
    this.emit("status", { mode: "disconnected", detail: "Session closed" } satisfies GatewayStatus);
  }
}

/**
 * Connect to a running TTS Tools gateway and register as a client.
 */
export const connectGateway = async (options: ConnectGatewayOptions = {}): Promise<GatewaySession> => {
  const controlPort = options.controlPort ?? GATEWAY_CONTROL_PORT;
  const clientId = options.clientId ?? randomUUID();
  const routeTag = options.routeTag && isValidRouteTag(options.routeTag) ? options.routeTag : undefined;
  if (options.routeTag && !routeTag) {
    throw new Error(`Invalid routeTag "${options.routeTag}"`);
  }
  const connectTimeoutMs = options.connectTimeoutMs ?? 5000;

  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect({ port: controlPort, host: "127.0.0.1" });
    const timer = setTimeout(() => {
      s.destroy();
      reject(new Error(`Gateway control port ${controlPort} did not accept within ${connectTimeoutMs}ms`));
    }, connectTimeoutMs);
    s.once("connect", () => {
      clearTimeout(timer);
      resolve(s);
    });
    s.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  socket.setEncoding("utf8");

  let buffer = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Timed out waiting for gateway hello/register"));
    }, connectTimeoutMs);

    const onData = (chunk: string) => {
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
          const message = JSON.parse(line) as ControlServerMessage;
          if (message.type === "hello") {
            socket.write(
              `${JSON.stringify({
                type: "register",
                clientId,
                routeTag,
              } satisfies ControlClientMessage)}\n`
            );
          } else if (message.type === "registered") {
            clearTimeout(timer);
            socket.off("data", onData);
            resolve();
            return;
          } else if (message.type === "error") {
            clearTimeout(timer);
            socket.off("data", onData);
            reject(new Error(message.message));
            return;
          }
        } catch {
          // ignore
        }
      }
    };
    socket.on("data", onData);
  });

  const session = new GatewaySessionImpl(socket, clientId, routeTag, buffer);
  session.emit("status", { mode: "gateway", detail: `Registered as ${clientId}` } satisfies GatewayStatus);
  return session;
};
