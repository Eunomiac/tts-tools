/** Mirror of tts-gateway control protocol (keep in sync). */

export const GATEWAY_CONTROL_PORT = 39997;
export const TTS_EDITOR_PORT = 39998;
export const TTS_COMMAND_PORT = 39999;
export const HEARTBEAT_INTERVAL_MS = 2000;
export const REJOIN_POLL_MS = 2000;

export type ControlHello = {
  type: "hello";
  version: 1;
  editorPort: number;
  commandPort: number;
};

export type ControlRegister = {
  type: "register";
  clientId: string;
  routeTag?: string;
};

export type ControlRegistered = {
  type: "registered";
  clientId: string;
  routeTag?: string;
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
  payload: Record<string, unknown>;
};

export type ControlEvent = {
  type: "event";
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

export type ControlServerMessage =
  | ControlHello
  | ControlRegistered
  | ControlHeartbeat
  | ControlReturn
  | ControlEvent
  | ControlError;

export type ControlClientMessage =
  | ControlRegister
  | ControlHeartbeat
  | ControlExecuteLua
  | ControlCommand
  | ControlShutdown;

export const ROUTE_TAG_RE = /^[A-Z][A-Z0-9_]{0,31}$/;

export const isValidRouteTag = (tag: string | undefined): boolean => {
  return typeof tag === "string" && ROUTE_TAG_RE.test(tag);
};
