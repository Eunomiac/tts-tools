// Spawns dist/mcp/server.js and exercises initialize, tools/list, tts_status, and (if connected) tts_execute_lua.
const { spawn } = require("node:child_process");
const path = require("node:path");
const readline = require("node:readline");

const child = spawn(process.execPath, [path.join(__dirname, "..", "dist", "mcp", "server.js")], {
  stdio: ["pipe", "pipe", "inherit"],
});
const pending = new Map();
let nextId = 1;

readline.createInterface({ input: child.stdout }).on("line", (line) => {
  const msg = JSON.parse(line);
  const resolve = pending.get(msg.id);
  if (resolve) {
    pending.delete(msg.id);
    resolve(msg);
  }
});

const request = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });

const toolText = (response) => JSON.parse(response.result.content[0].text);

(async () => {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  });
  console.log("initialize:", init.result.protocolVersion, init.result.serverInfo);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

  const list = await request("tools/list", {});
  console.log("tools:", list.result.tools.map((t) => t.name).join(", "));

  const status = toolText(await request("tools/call", { name: "tts_status", arguments: {} }));
  console.log("status:", status);

  if (status.connected) {
    const exec = await request("tools/call", {
      name: "tts_execute_lua",
      arguments: { script: 'print("tts-tools mcp smoke") return 1 + 1', maxWaitMs: 10000 },
    });
    console.log("execute:", toolText(exec));

    const noReturn = await request("tools/call", {
      name: "tts_execute_lua",
      arguments: { script: 'print("no return")', maxWaitMs: 10000 },
    });
    console.log("no-return:", toolText(noReturn));

    const delayed = await request("tools/call", {
      name: "tts_execute_lua",
      arguments: {
        script: 'Wait.time(function() print("later") end, 1) return "scheduled"',
        listenAfterReturnMs: 2500,
        maxWaitMs: 15000,
      },
    });
    console.log("delayed print:", toolText(delayed));

    const failing = await request("tools/call", {
      name: "tts_execute_lua",
      arguments: { script: "local x = nil; return x.y", maxWaitMs: 10000 },
    });
    console.log("error isError:", failing.result.isError, toolText(failing));
  }

  const missing = await request("nope/method", {});
  console.log("unknown method error code:", missing.error && missing.error.code);
  child.stdin.end();
})().catch((error) => {
  console.error(error);
  child.kill();
  process.exitCode = 1;
});
