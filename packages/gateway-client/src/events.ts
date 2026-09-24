/**
 * Shared External Editor event dispatch (messageID → session event names).
 */
export const dispatchTtsEvent = (
  emit: (event: string, ...args: unknown[]) => boolean,
  messageID: number,
  payload: Record<string, unknown>
): void => {
  switch (messageID) {
    case 0:
      emit("pushingNewObject", payload);
      break;
    case 1:
      emit("loadingANewGame", payload);
      break;
    case 2:
      emit("print", typeof payload.message === "string" ? payload.message : String(payload.message ?? ""));
      break;
    case 3:
      emit("error", payload);
      break;
    case 4:
      emit("customMessage", payload);
      break;
    case 6:
      emit("gameSaved", payload);
      break;
    case 7:
      emit("objectCreated", payload);
      break;
    default:
      break;
  }
};
