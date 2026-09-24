import type { GatewayClient } from "../control/clients";
import { writeControlMessage } from "../control/clients";
import { parseRouteTagPrefix } from "../protocol";

const stringBodyFromPayload = (messageID: number, payload: Record<string, unknown>): string | undefined => {
  if (messageID === 2 && typeof payload.message === "string") {
    return payload.message;
  }
  if (messageID === 3 && typeof payload.errorMessagePrefix === "string") {
    return payload.errorMessagePrefix;
  }
  if (messageID === 4) {
    const custom = payload.customMessage;
    if (typeof custom === "string") {
      return custom;
    }
  }
  return undefined;
};

const applyStrippedBody = (
  messageID: number,
  payload: Record<string, unknown>,
  body: string
): Record<string, unknown> => {
  if (messageID === 2) {
    return { ...payload, message: body };
  }
  if (messageID === 3) {
    return { ...payload, errorMessagePrefix: body };
  }
  if (messageID === 4 && typeof payload.customMessage === "string") {
    return { ...payload, customMessage: body };
  }
  return payload;
};

/**
 * Fan-out an inbound TTS event to registered clients.
 * Optional `<@TAG@>` on string bodies unicasts + strips when a matching routeTag exists;
 * otherwise broadcasts unstripped (safer while debugging).
 */
export const fanOutEvent = (
  clients: GatewayClient[],
  findByRouteTag: (tag: string) => GatewayClient | undefined,
  messageID: number,
  payload: Record<string, unknown>
): void => {
  // returnMessage handled elsewhere
  if (messageID === 5) {
    return;
  }

  const text = stringBodyFromPayload(messageID, payload);
  if (text !== undefined) {
    const { tag, body } = parseRouteTagPrefix(text);
    if (tag) {
      const target = findByRouteTag(tag);
      if (target) {
        writeControlMessage(target.socket, {
          type: "event",
          messageID,
          payload: applyStrippedBody(messageID, payload, body),
        });
        return;
      }
    }
  }

  for (const client of clients) {
    writeControlMessage(client.socket, { type: "event", messageID, payload });
  }
};
