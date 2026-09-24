export { connectGateway, type ConnectGatewayOptions, type GatewaySession, type GatewayStatus } from "./session";
export { probeControlPort } from "./probe";
export {
  GATEWAY_CONTROL_PORT,
  TTS_EDITOR_PORT,
  TTS_COMMAND_PORT,
  HEARTBEAT_INTERVAL_MS,
  REJOIN_POLL_MS,
  isValidRouteTag,
  ROUTE_TAG_RE,
} from "./protocol";
