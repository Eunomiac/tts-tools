import { selectObject } from "../interaction/selectObject";
import { Plugin } from "../plugin";
import type { TTSAdapter } from "../ttsAdapter";
import { TTSObjectItem } from "../view/ttsObjectTreeProvider";

export default (plugin: Plugin, adapter: TTSAdapter) => async (arg?: TTSObjectItem) => {
  if (arg) {
    await adapter.getObject(arg.object);
    return;
  }
  const selection = await selectObject(plugin, { placeholder: "Select an object to get from TTS" });
  if (!selection) {
    return;
  }
  await adapter.getObject(selection);
};
