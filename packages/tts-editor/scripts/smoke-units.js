/**
 * Smoke checks for small pure helpers (no vscode import, no TTS needed).
 * Run from packages/tts-editor after `npm run compile` (and the gateway build):
 *   node scripts/smoke-units.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { luaLongString } = require("../out/tts/luaString");
const { parseNetstatListeningPids } = require("../../tts-gateway/dist/ports/editorPort");

const assertEq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
};

/** Minimal Lua long-string reader: enough to prove the quoting round-trips. */
const readLuaLongString = (literal) => {
  const open = literal.match(/^\[(=*)\[/);
  if (!open) {
    throw new Error(`not a long string: ${literal}`);
  }
  const close = `]${open[1]}]`;
  let body = literal.slice(open[0].length);
  if (!body.endsWith(close) || body.slice(0, -close.length).includes(close)) {
    throw new Error(`long string closes early or not at all: ${literal}`);
  }
  body = body.slice(0, -close.length);
  return body.startsWith("\r\n") ? body.slice(2) : body.startsWith("\n") ? body.slice(1) : body;
};

for (const text of ["plain", "a]]b", "x]=]y]]z", "\nleading newline", "", "]", "ends with ]"]) {
  assertEq(readLuaLongString(luaLongString(text)), text, `luaLongString(${JSON.stringify(text)})`);
}

const netstat = [
  "  Proto  Local Address          Foreign Address        State           PID",
  "  TCP    127.0.0.1:39998        0.0.0.0:0              LISTENING       4242",
  "  TCP    0.0.0.0:39998          0.0.0.0:0              LISTENING       4242",
  "  TCP    [::1]:39998            [::]:0                 LISTENING       5151",
  "  TCP    127.0.0.1:39997        0.0.0.0:0              LISTENING       7777",
  "  TCP    127.0.0.1:51000        127.0.0.1:39998        ESTABLISHED     8888",
  "  TCP    0.0.0.0:39998          0.0.0.0:0              LISTENING       4",
].join("\r\n");
assertEq(parseNetstatListeningPids(netstat, 39998), [4242, 5151], "parseNetstatListeningPids");

console.log("smoke-units: OK");
