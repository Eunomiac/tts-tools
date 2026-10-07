/**
 * Message shapes of the Tabletop Simulator External Editor API.
 * @see https://api.tabletopsimulator.com/externaleditorapi/
 */

/** Script and UI for one object, as sent to TTS on Save & Play (`guid` "-1" is Global). */
export interface OutgoingJsonObject {
  guid: string;
  script?: string;
  ui?: string;
}

/** Script and UI for one object, as received from TTS. */
export interface IncomingJsonObject extends OutgoingJsonObject {
  name: string;
  script: string;
}

/** Sent when an object's "Scripting Editor" context menu entry is used in TTS. */
export interface PushingNewObject {
  messageID: 0;
  scriptStates: IncomingJsonObject[];
}

/** Sent after a game loads (including after Save & Play), listing every object that has a script or UI. */
export interface LoadingANewGame {
  messageID: 1;
  scriptStates: IncomingJsonObject[];
}

export interface PrintDebugMessage {
  messageID: 2;
  message: string;
}

export interface ErrorMessage {
  messageID: 3;
  error: string;
  /** GUID of the object whose script failed, or "-1" for Global. */
  guid: string;
  /** Where the error happened, e.g. "Error in Global Script: ". */
  errorMessagePrefix: string;
}

/** Sent by `sendExternalMessage(table)` in Lua. */
export interface CustomMessage {
  messageID: 4;
  customMessage: unknown;
}

export interface ObjectCreated {
  messageID: 7;
  guid: string;
}
