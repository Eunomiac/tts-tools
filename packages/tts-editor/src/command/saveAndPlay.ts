import { TTSAdapter } from "../ttsAdapter";

export const saveAndPlay = (adapter: TTSAdapter) => () => {
  adapter.saveAndPlay();
};

export const saveAndPlayBundled = (adapter: TTSAdapter) => () => {
  adapter.saveAndPlay("bundle");
};

export const saveAndPlayFullResync = (adapter: TTSAdapter) => () => {
  adapter.saveAndPlayFullResync();
};

export const saveAndPlayBundledFullResync = (adapter: TTSAdapter) => () => {
  adapter.saveAndPlayFullResync("bundle");
};
