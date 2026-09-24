import type { GatewayClient } from "../control/clients";
import { writeControlMessage } from "../control/clients";

type PendingReturn = {
  client: GatewayClient;
  requestId: number;
};

/**
 * Maps TTS returnID → client request so returnMessage can be unicast.
 */
export class ReturnIdTracker {
  private nextReturnId = 1;
  private readonly pending = new Map<number, PendingReturn>();

  allocate(client: GatewayClient, requestId: number): number {
    const returnID = this.nextReturnId++;
    this.pending.set(returnID, { client, requestId });
    return returnID;
  }

  resolve(returnID: number, returnValue: unknown): boolean {
    const entry = this.pending.get(returnID);
    if (!entry) {
      return false;
    }
    this.pending.delete(returnID);
    writeControlMessage(entry.client.socket, {
      type: "return",
      requestId: entry.requestId,
      returnValue,
    });
    return true;
  }

  dropClient(client: GatewayClient): void {
    for (const [id, entry] of this.pending) {
      if (entry.client === client) {
        this.pending.delete(id);
        writeControlMessage(entry.client.socket, {
          type: "error",
          requestId: entry.requestId,
          message: "Client disconnected before Lua return",
        });
      }
    }
  }

  cancel(returnID: number): void {
    this.pending.delete(returnID);
  }
}
