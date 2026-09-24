import * as fs from "node:fs";
import * as net from "node:net";

import { GATEWAY_CONTROL_PORT } from "@tts-tools/gateway-client";

import { clearOwnedHelperRef, defaultPidFilePath, getOwnedHelper } from "./ensureHelper";

/**
 * Stop the gateway helper: prefer graceful shutdown over control port, else kill owned process / PID file.
 */
export const stopGatewayHelper = async (
  controlPort: number = GATEWAY_CONTROL_PORT,
  log?: (message: string) => void
): Promise<void> => {
  // Graceful: send shutdown on a short-lived control connection
  const sent = await new Promise<boolean>((resolve) => {
    const socket = net.connect({ port: controlPort, host: "127.0.0.1" });
    const fail = () => {
      socket.destroy();
      resolve(false);
    };
    socket.setTimeout(800);
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ type: "shutdown" })}\n`, () => {
        socket.end();
        resolve(true);
      });
    });
    socket.once("timeout", fail);
    socket.once("error", fail);
  });

  if (sent) {
    log?.("Sent shutdown to gateway helper");
    // Wait briefly for exit
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const owned = getOwnedHelper();
      if (!owned || owned.exitCode !== null) {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const owned = getOwnedHelper();
  if (owned && owned.exitCode === null && owned.pid) {
    log?.(`Killing owned gateway pid ${owned.pid}`);
    try {
      owned.kill();
    } catch {
      // ignore
    }
  }
  clearOwnedHelperRef();

  const pidFile = defaultPidFilePath();
  try {
    if (fs.existsSync(pidFile)) {
      const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid);
          log?.(`Signaled gateway pid file process ${pid}`);
        } catch {
          // already gone
        }
      }
      fs.unlinkSync(pidFile);
    }
  } catch {
    // ignore
  }
};
