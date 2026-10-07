// Runs the real gateway on spare ports against a fake TTS and checks event fan-out, Lua return
// matching, client takeover, the port-in-use error and shutdown. Needs no TTS; runs on every OS.
// Run from packages/tts-editor after `npm run build` at the repo root: node scripts/smoke-gateway.js
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const { startGateway } = require("../../tts-gateway/dist");
const { connectGateway } = require("@tts-tools/gateway-client");

const ports = { editorPort: 49_998, commandPort: 49_999, controlPort: 49_997 };
const pidDir = fs.mkdtempSync(path.join(os.tmpdir(), "tts-gateway-smoke-"));

const withTimeout = (promise, ms, what) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), ms)),
  ]);

const sendAsTts = (message) =>
  new Promise((resolve, reject) => {
    const socket = net.connect({ port: ports.editorPort, host: "127.0.0.1" }, () => {
      socket.end(JSON.stringify(message), resolve);
    });
    socket.on("error", reject);
  });

/** Fake TTS command port: answers every executeLua (messageID 3) with its script as the return value. */
const startFakeTts = () =>
  new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let data = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => (data += chunk));
      socket.on("end", () => {
        const message = JSON.parse(data);
        if (message.messageID === 3) {
          void sendAsTts({ messageID: 5, returnID: message.returnID, returnValue: `ran: ${message.script}` });
        }
      });
    });
    server.listen(ports.commandPort, "127.0.0.1", () => resolve(server));
  });

const nextEvent = (session, event, predicate = () => true) =>
  new Promise((resolve) => {
    const listener = (value) => {
      if (predicate(value)) {
        session.off(event, listener);
        resolve(value);
      }
    };
    session.on(event, listener);
  });

const main = async () => {
  const fakeTts = await startFakeTts();
  const gateway = await startGateway({ ...ports, pidFile: path.join(pidDir, "gateway.pid") });
  const clientOptions = { ...ports, clientId: "smoke", routeTag: "SMOKE", failover: false };

  const first = await connectGateway(clientOptions);
  assert.equal(first.mode, "gateway");
  console.log("ok   client connects through the gateway");

  const printed = nextEvent(first, "print");
  await sendAsTts({ messageID: 2, message: "hello from tts" });
  assert.equal(await withTimeout(printed, 5000, "print event"), "hello from tts");
  console.log("ok   TTS events reach the client");

  const [a, b] = await withTimeout(
    Promise.all([first.executeLua("return 1"), first.executeLua("return 2")]),
    5000,
    "Lua returns"
  );
  assert.equal(a, "ran: return 1");
  assert.equal(b, "ran: return 2");
  console.log("ok   overlapping Lua requests get their own return values");

  const dropped = nextEvent(first, "status", (status) => status.mode === "disconnected");
  const second = await connectGateway(clientOptions);
  const status = await withTimeout(dropped, 5000, "takeover status");
  assert.match(status.detail ?? "", /took over/);
  console.log(`ok   a second client with the same ID takes over; the first is told: "${status.detail}"`);

  const printedToSecond = nextEvent(second, "print");
  await sendAsTts({ messageID: 2, message: "after takeover" });
  assert.equal(await withTimeout(printedToSecond, 5000, "print after takeover"), "after takeover");
  console.log("ok   the new client receives events");

  await assert.rejects(
    startGateway({ ...ports, controlPort: ports.controlPort - 10, pidFile: path.join(pidDir, "second.pid") }),
    (error) => /already in use/.test(error.message)
  );
  console.log("ok   a held editor port gives a clear error");

  await second.requestShutdown();
  await withTimeout(gateway.whenStopped, 5000, "gateway shutdown");
  console.log("ok   shutdown request stops the gateway");

  await Promise.all([first.close(), second.close()]);
  fakeTts.close();
  fs.rmSync(pidDir, { recursive: true, force: true });
};

main().then(
  () => process.exit(0),
  (error) => {
    console.error("FAIL", error);
    process.exit(1);
  }
);
