#!/usr/bin/env node
import { startGateway, defaultPidFilePath } from "./lifecycle";

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`tts-gateway — TTS External Editor multi-client gateway

Usage:
  tts-gateway

Listens on 39998 (TTS events) and 39997 (control NDJSON).
Writes PID to ${defaultPidFilePath()}
`);
    process.exit(0);
  }

  const gateway = await startGateway();

  let exiting = false;
  const shutdown = async (signal: string) => {
    if (exiting) {
      return;
    }
    exiting = true;
    console.log(`[tts-gateway] ${signal}`);
    await gateway.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Client-requested shutdown (Release / deactivate) resolves when stop() finishes
  await gateway.whenStopped;
  if (!exiting) {
    process.exit(0);
  }
};

main().catch((error) => {
  console.error("[tts-gateway] fatal:", error);
  process.exit(1);
});
