import type { TTSAdapter } from "../ttsAdapter";

export const claimEditorPort = (adapter: TTSAdapter) => () => {
  void adapter.claimEditorPort();
};

export const releaseEditorPort = (adapter: TTSAdapter) => () => {
  void adapter.releaseEditorPort();
};
