import { EventEmitter } from "node:events";
import * as net from "node:net";

import { dispatchTtsEvent } from "./events";
import { TTS_COMMAND_PORT, TTS_EDITOR_PORT } from "./protocol";
import { sendToTts } from "./ttsSend";

type PendingLua = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type DirectSessionOptions = {
  editorPort?: number;
  commandPort?: number;
  clientId: string;
  routeTag?: string;
};

/**
 * Direct External Editor listener (binds 39998) when the gateway is not running.
 */
export class DirectSession extends EventEmitter {
  readonly clientId: string;
  readonly routeTag?: string;
  private readonly editorPort: number;
  private readonly commandPort: number;
  private server?: net.Server;
  private nextReturnId = 1;
  private pending = new Map<number, PendingLua>();
  private closed = false;

  private constructor(options: DirectSessionOptions) {
    super();
    this.clientId = options.clientId;
    this.routeTag = options.routeTag;
    this.editorPort = options.editorPort ?? TTS_EDITOR_PORT;
    this.commandPort = options.commandPort ?? TTS_COMMAND_PORT;
  }

  static async start(options: DirectSessionOptions): Promise<DirectSession> {
    const session = new DirectSession(options);
    await session.listen();
    return session;
  }

  private listen = (): Promise<void> => {
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
            const message = JSON.parse(text) as Record<string, unknown>;
            this.handleInbound(message);
          } catch (error) {
            this.emit("status", {
              mode: "direct",
              detail: `Bad inbound JSON: ${error}`,
            });
          }
        });
      });

      server.once("error", reject);
      server.listen(this.editorPort, "127.0.0.1", () => {
        server.off("error", reject);
        this.server = server;
        server.on("error", (error) => {
          if (!this.closed) {
            this.emit("transportGone", `Direct listener error: ${error}`);
          }
        });
        server.on("close", () => {
          if (!this.closed) {
            this.emit("transportGone", "Direct listener closed");
          }
        });
        resolve();
      });
    });
  };

  private handleInbound = (message: Record<string, unknown>): void => {
    const messageID = Number(message.messageID);
    if (messageID === 5) {
      const returnID = Number(message.returnID);
      const pending = this.pending.get(returnID);
      if (!pending) {
        return;
      }
      this.pending.delete(returnID);
      clearTimeout(pending.timer);
      pending.resolve(message.returnValue);
      return;
    }
    dispatchTtsEvent((event, ...args) => this.emit(event, ...args), messageID, message);
  };

  async executeLua<T = unknown>(script: string, guid: string = "-1"): Promise<T> {
    const returnID = this.nextReturnId++;
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(returnID);
        reject(new Error(`executeLua timed out (returnID ${returnID})`));
      }, 120_000);
      this.pending.set(returnID, { resolve, reject, timer });
    });
    await sendToTts(
      {
        messageID: 3,
        script,
        guid,
        returnID,
      },
      this.commandPort
    );
    return result as Promise<T>;
  }

  async sendCommand(payload: Record<string, unknown>): Promise<void> {
    await sendToTts(payload, this.commandPort);
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
    // No helper to stop in direct mode.
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Session closed"));
      this.pending.delete(id);
    }
    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
    this.emit("status", { mode: "disconnected", detail: "Direct session closed" });
  }
}
