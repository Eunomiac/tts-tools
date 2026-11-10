#!/usr/bin/env node
import { forceClaimEditorPort } from "./forceClaim";
import { startGateway, defaultPidFilePath } from "./lifecycle";

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`tts-gateway — TTS External Editor multi-client gateway

Usage:
  tts-gateway [--force]

  --force   If port 39998 is held, ask any gateway on 39997 to shut down,
            then terminate remaining listeners (never Tabletop Simulator).

Listens on 39998 (TTS events) and 39997 (control NDJSON).
Writes PID to ${defaultPidFilePath()}
`);
    process.exit(0);
  }

  if (args.includes("--force")) {
    const result = await forceClaimEditorPort({
      log: (message) => console.log(`[tts-gateway] ${message}`),
    });
    if (result.remaining.length > 0) {
      const heldBy = result.remaining.map((l) => `${l.name} (pid ${l.pid})`).join(", ");
      console.error(`[tts-gateway] --force could not free editor port; still held by ${heldBy}`);
      process.exit(1);
    }
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
