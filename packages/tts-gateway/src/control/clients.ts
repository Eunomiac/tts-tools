import * as net from "node:net";

import type { ControlServerMessage, RouteTag } from "../protocol";

export type GatewayClient = {
  clientId: string;
  routeTag?: RouteTag;
  socket: net.Socket;
  lastHeartbeat: number;
  buffer: string;
};

export class ClientRegistry {
  private readonly bySocket = new Map<net.Socket, GatewayClient>();
  private readonly byId = new Map<string, GatewayClient>();

  register(client: GatewayClient): void {
    const existing = this.byId.get(client.clientId);
    if (existing && existing.socket !== client.socket) {
      this.remove(existing.socket);
    }
    this.bySocket.set(client.socket, client);
    this.byId.set(client.clientId, client);
  }

  remove(socket: net.Socket): GatewayClient | undefined {
    const client = this.bySocket.get(socket);
    if (!client) {
      return undefined;
    }
    this.bySocket.delete(socket);
    if (this.byId.get(client.clientId) === client) {
      this.byId.delete(client.clientId);
    }
    return client;
  }

  get(socket: net.Socket): GatewayClient | undefined {
    return this.bySocket.get(socket);
  }

  getById(clientId: string): GatewayClient | undefined {
    return this.byId.get(clientId);
  }

  all(): GatewayClient[] {
    return [...this.bySocket.values()];
  }

  findByRouteTag(tag: string): GatewayClient | undefined {
    for (const client of this.bySocket.values()) {
      if (client.routeTag === tag) {
        return client;
      }
    }
    return undefined;
  }

  touchHeartbeat(socket: net.Socket): void {
    const client = this.bySocket.get(socket);
    if (client) {
      client.lastHeartbeat = Date.now();
    }
  }
}

export const writeControlMessage = (socket: net.Socket, message: ControlServerMessage): void => {
  if (socket.destroyed) {
    return;
  }
  try {
    socket.write(`${JSON.stringify(message)}\n`);
  } catch (error) {
    console.error("[tts-gateway] write failed:", error);
  }
};
