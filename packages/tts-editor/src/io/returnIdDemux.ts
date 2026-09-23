import ExternalEditorApi, { ReturnMessage } from "@matanlurey/tts-editor";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type SendFn = (message: unknown) => Promise<void>;

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Patch `@matanlurey/tts-editor` so `executeLuaCodeAndReturn` waits for the
 * matching `returnID` instead of the next `returnMessage` (race that can scramble imports).
 */
export const installReturnIdDemux = (api: ExternalEditorApi, timeoutMs: number = DEFAULT_TIMEOUT_MS): void => {
  const pending = new Map<number, Pending>();
  let nextReturnId = 1;
  // `send` is private on the published types; runtime instance still has it.
  const send = (api as unknown as { send: SendFn }).send.bind(api);

  api.on("returnMessage", (message: ReturnMessage) => {
    const id = message.returnID;
    const waiter = pending.get(id);
    if (!waiter) {
      return;
    }
    pending.delete(id);
    clearTimeout(waiter.timer);
    waiter.resolve(message.returnValue);
  });

  api.executeLuaCodeAndReturn = async <T>(script: string, guid: string = "-1"): Promise<T> => {
    const id = nextReturnId++;
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`TTS executeLua timed out after ${timeoutMs}ms (returnID ${id})`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
    });

    await send({
      messageID: 3,
      script,
      guid,
      returnID: id,
    });

    return result as Promise<T>;
  };
};
