import type { TTSAdapter } from "../ttsAdapter";

export default (adapter: TTSAdapter) => () => {
  adapter.unbundleLibrary();
};
