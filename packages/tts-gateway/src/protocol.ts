/**
 * NDJSON control-plane messages between gateway helper and registered clients.
 * One JSON object per line on TCP port 39997.
 */

export type RouteTag = string;

export type ControlHello = {
  type: "hello";
  version: 1;
  editorPort: number;
  commandPort: number;
};

export type ControlRegister = {
  type: "register";
  clientId: string;
  routeTag?: RouteTag;
};

export type ControlRegistered = {
  type: "registered";
  clientId: string;
  routeTag?: RouteTag;
};

export type ControlHeartbeat = {
  type: "heartbeat";
};

export type ControlExecuteLua = {
  type: "executeLua";
  requestId: number;
  script: string;
  guid?: string;
};

export type ControlReturn = {
  type: "return";
  requestId: number;
  returnValue: unknown;
};

export type ControlCommand = {
  type: "command";
  /** Raw External Editor API outbound payload (messageID 0/1/2/…). */
  payload: Record<string, unknown>;
};

export type ControlEvent = {
  type: "event";
  /** External Editor inbound messageID. */
  messageID: number;
  payload: Record<string, unknown>;
};

export type ControlError = {
  type: "error";
  message: string;
  requestId?: number;
};

export type ControlShutdown = {
  type: "shutdown";
};

export type ControlClientMessage =
  | ControlRegister
  | ControlHeartbeat
  | ControlExecuteLua
  | ControlCommand
  | ControlShutdown;

export type ControlServerMessage =
  | ControlHello
  | ControlRegistered
  | ControlHeartbeat
  | ControlReturn
  | ControlEvent
  | ControlError;

export const ROUTE_TAG_RE = /^[A-Z][A-Z0-9_]{0,31}$/;

export const isValidRouteTag = (tag: string | undefined): tag is RouteTag => {
  return typeof tag === "string" && ROUTE_TAG_RE.test(tag);
};

/** Match optional `<@TAG@>` prefix on string bodies. */
export const parseRouteTagPrefix = (text: string): { tag?: string; body: string } => {
  const match = text.match(/^<@([A-Z][A-Z0-9_]{0,31})@>([\s\S]*)$/);
  if (!match) {
    return { body: text };
  }
  return { tag: match[1], body: match[2] ?? "" };
};
