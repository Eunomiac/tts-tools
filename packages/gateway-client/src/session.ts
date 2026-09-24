import { EventEmitter } from "node:events";
import * as net from "node:net";
import { randomUUID } from "node:crypto";

import { DirectSession } from "./directSession";
import { dispatchTtsEvent } from "./events";
import { probeControlPort } from "./probe";
import {
  ControlClientMessage,
  ControlServerMessage,
  GATEWAY_CONTROL_PORT,
  HEARTBEAT_INTERVAL_MS,
  isValidRouteTag,
  REJOIN_POLL_MS,
  TTS_COMMAND_PORT,
  TTS_EDITOR_PORT,
} from "./protocol";

export type GatewayStatus = {
  mode: "gateway" | "direct" | "disconnected";
  detail?: string;
};

export type ConnectGatewayOptions = {
  routeTag?: string;
  controlPort?: number;
  editorPort?: number;
  commandPort?: number;
  clientId?: string;
  /** How long to wait for hello + registered (ms). */
  connectTimeoutMs?: number;
  /**
   * When true (default), fall back to binding the editor port directly if the
   * gateway is down, and rejoin the gateway when it returns.
   * Set false for owners that manage the helper themselves (e.g. TTS Tools extension).
   */
  failover?: boolean;
  /** Poll interval while in direct/disconnected mode looking for gateway (ms). */
  rejoinPollMs?: number;
};

type PendingLua = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type GatewaySession = {
  readonly clientId: string;
  readonly routeTag?: string;
  /** Current link mode (may change when failover is enabled). */
  readonly mode: GatewayStatus["mode"];
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

type InnerSession = {
  on(event: string, listener: (...args: unknown[]) => void): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
  removeAllListeners?(event?: string): void;
  executeLua<T = unknown>(script: string, guid?: string): Promise<T>;
  getLuaScripts(): Promise<void>;
  saveAndPlay(scriptStates: unknown[]): Promise<void>;
  customMessage(customMessage: unknown): Promise<void>;
  sendCommand(payload: Record<string, unknown>): Promise<void>;
  requestShutdown(): Promise<void>;
  close(): Promise<void>;
};

/** Control-port transport (registered with the gateway helper). */
class GatewayTransport extends EventEmitter {
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
        return;
      }
      case "event": {
        dispatchTtsEvent((event, ...args) => this.emit(event, ...args), message.messageID, message.payload);
        return;
      }
      default:
        return;
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
    this.emit("transportGone", detail);
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
  }
}

const openGatewayTransport = async (
  options: Required<
    Pick<ConnectGatewayOptions, "controlPort" | "clientId" | "connectTimeoutMs">
  > & { routeTag?: string }
): Promise<GatewayTransport> => {
  const { controlPort, clientId, routeTag, connectTimeoutMs } = options;

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

  return new GatewayTransport(socket, clientId, routeTag, buffer);
};

class ManagedGatewaySession extends EventEmitter implements GatewaySession {
  readonly clientId: string;
  readonly routeTag?: string;
  private readonly options: Required<
    Pick<
      ConnectGatewayOptions,
      "controlPort" | "editorPort" | "commandPort" | "connectTimeoutMs" | "failover" | "rejoinPollMs"
    >
  >;
  private inner: InnerSession | undefined;
  private currentMode: GatewayStatus["mode"] = "disconnected";
  private closed = false;
  private switching = false;
  private rejoinTimer?: ReturnType<typeof setInterval>;
  private readonly forwardEvents = [
    "print",
    "error",
    "loadingANewGame",
    "pushingNewObject",
    "objectCreated",
    "customMessage",
    "gameSaved",
  ] as const;

  constructor(
    clientId: string,
    routeTag: string | undefined,
    options: ManagedGatewaySession["options"]
  ) {
    super();
    this.clientId = clientId;
    this.routeTag = routeTag;
    this.options = options;
  }

  get mode(): GatewayStatus["mode"] {
    return this.currentMode;
  }

  async start(): Promise<void> {
    const gatewayUp = await probeControlPort(this.options.controlPort, 400);
    if (gatewayUp) {
      await this.useGateway("Registered with gateway");
      return;
    }
    if (this.options.failover) {
      await this.useDirect("Gateway not running; listening on editor port directly");
      return;
    }
    throw new Error(
      `Gateway control port ${this.options.controlPort} is not available (failover disabled)`
    );
  }

  private setMode(mode: GatewayStatus["mode"], detail?: string): void {
    this.currentMode = mode;
    this.emit("status", { mode, detail } satisfies GatewayStatus);
  }

  private unbindInner(): void {
    if (!this.inner) {
      return;
    }
    this.inner.removeAllListeners?.();
    this.inner = undefined;
  }

  private bindInner(inner: InnerSession, mode: "gateway" | "direct", detail: string): void {
    this.unbindInner();
    this.inner = inner;
    for (const event of this.forwardEvents) {
      inner.on(event, (...args: unknown[]) => {
        this.emit(event, ...args);
      });
    }
    if (inner instanceof GatewayTransport) {
      inner.on("transportGone", (reason: unknown) => {
        void this.onTransportGone(String(reason ?? "gateway gone"));
      });
    } else if (inner instanceof DirectSession) {
      inner.on("transportGone", (reason: unknown) => {
        void this.onDirectGone(String(reason ?? "direct gone"));
      });
    }
    this.setMode(mode, detail);
    this.ensureRejoinWatch();
  }

  private async useGateway(detail: string): Promise<void> {
    const transport = await openGatewayTransport({
      controlPort: this.options.controlPort,
      clientId: this.clientId,
      routeTag: this.routeTag,
      connectTimeoutMs: this.options.connectTimeoutMs,
    });
    this.bindInner(transport, "gateway", detail);
  }

  private async useDirect(detail: string): Promise<void> {
    const direct = await DirectSession.start({
      clientId: this.clientId,
      routeTag: this.routeTag,
      editorPort: this.options.editorPort,
      commandPort: this.options.commandPort,
    });
    this.bindInner(direct, "direct", detail);
  }

  private async dropInner(): Promise<void> {
    const current = this.inner;
    this.unbindInner();
    if (current) {
      try {
        await current.close();
      } catch {
        // ignore
      }
    }
  }

  private onTransportGone = async (detail: string): Promise<void> => {
    if (this.closed || this.switching) {
      return;
    }
    this.switching = true;
    try {
      this.unbindInner();
      if (!this.options.failover) {
        this.setMode("disconnected", detail);
        return;
      }
      try {
        await this.useDirect(`Gateway lost (${detail}); fell back to direct`);
      } catch (error) {
        this.setMode("disconnected", `Gateway lost and direct bind failed: ${error}`);
      }
    } finally {
      this.switching = false;
    }
  };

  private onDirectGone = async (detail: string): Promise<void> => {
    if (this.closed || this.switching) {
      return;
    }
    this.switching = true;
    try {
      this.unbindInner();
      // Prefer gateway (often the force-claimer); else try direct again; else disconnected.
      const gatewayUp = await probeControlPort(this.options.controlPort, 400);
      if (gatewayUp) {
        try {
          await this.useGateway(`Direct lost (${detail}); joined gateway`);
          return;
        } catch {
          // fall through
        }
      }
      if (this.options.failover) {
        try {
          await this.useDirect(`Direct lost (${detail}); rebound editor port`);
          return;
        } catch (error) {
          this.setMode("disconnected", `Direct lost and rebound failed: ${error}`);
          return;
        }
      }
      this.setMode("disconnected", detail);
    } finally {
      this.switching = false;
    }
  };

  private ensureRejoinWatch(): void {
    if (!this.options.failover || this.rejoinTimer || this.closed) {
      return;
    }
    this.rejoinTimer = setInterval(() => {
      void this.tryRejoinGateway();
    }, this.options.rejoinPollMs);
  }

  private tryRejoinGateway = async (): Promise<void> => {
    if (this.closed || this.switching) {
      return;
    }
    if (this.currentMode === "gateway") {
      return;
    }
    const up = await probeControlPort(this.options.controlPort, 300);
    if (!up) {
      return;
    }
    this.switching = true;
    try {
      await this.dropInner();
      await this.useGateway("Rejoined gateway");
    } catch (error) {
      // Stay in previous mode if possible
      if (!this.inner && this.options.failover) {
        try {
          await this.useDirect(`Rejoin failed (${error}); staying direct`);
        } catch {
          this.setMode("disconnected", `Rejoin failed: ${error}`);
        }
      } else {
        this.setMode(this.currentMode === "direct" ? "direct" : "disconnected", `Rejoin failed: ${error}`);
      }
    } finally {
      this.switching = false;
    }
  };

  private requireInner(): InnerSession {
    if (!this.inner) {
      throw new Error(`Not connected to TTS (mode=${this.currentMode})`);
    }
    return this.inner;
  }

  async executeLua<T = unknown>(script: string, guid?: string): Promise<T> {
    return this.requireInner().executeLua(script, guid);
  }

  async getLuaScripts(): Promise<void> {
    await this.requireInner().getLuaScripts();
  }

  async saveAndPlay(scriptStates: unknown[]): Promise<void> {
    await this.requireInner().saveAndPlay(scriptStates);
  }

  async customMessage(customMessage: unknown): Promise<void> {
    await this.requireInner().customMessage(customMessage);
  }

  async sendCommand(payload: Record<string, unknown>): Promise<void> {
    await this.requireInner().sendCommand(payload);
  }

  async requestShutdown(): Promise<void> {
    if (this.inner) {
      await this.inner.requestShutdown();
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.rejoinTimer) {
      clearInterval(this.rejoinTimer);
      this.rejoinTimer = undefined;
    }
    await this.dropInner();
    this.setMode("disconnected", "Session closed");
  }
}

/**
 * Connect to TTS via the local gateway when present, with optional direct failover.
 */
export const connectGateway = async (options: ConnectGatewayOptions = {}): Promise<GatewaySession> => {
  const clientId = options.clientId ?? randomUUID();
  const routeTag = options.routeTag && isValidRouteTag(options.routeTag) ? options.routeTag : undefined;
  if (options.routeTag && !routeTag) {
    throw new Error(`Invalid routeTag "${options.routeTag}"`);
  }

  const session = new ManagedGatewaySession(clientId, routeTag, {
    controlPort: options.controlPort ?? GATEWAY_CONTROL_PORT,
    editorPort: options.editorPort ?? TTS_EDITOR_PORT,
    commandPort: options.commandPort ?? TTS_COMMAND_PORT,
    connectTimeoutMs: options.connectTimeoutMs ?? 5000,
    failover: options.failover !== false,
    rejoinPollMs: options.rejoinPollMs ?? REJOIN_POLL_MS,
  });
  await session.start();
  return session;
};
