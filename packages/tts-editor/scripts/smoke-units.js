/**
 * Smoke checks for small pure helpers (no vscode import, no TTS needed).
 * Run from packages/tts-editor after `npm run compile` (and the gateway build):
 *   node scripts/smoke-units.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { luaLongString } = require("../out/tts/luaString");
const { isExecutedSnippet, parseErrorLocation, reanchorLine } = require("../out/tts/errorLocation");
const { bundleLua, findNearestBundle, getRootName, resolveModule } = require("../out/io/bundle");
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

// Error messages as TTS reports them.
const locationCases = [
  ["Lua Error <onObjectDrop>: Global:(17423,4-40): attempt to call a nil value at Gameboard.x", ["Global", 17423, 4, 17423, 40]],
  ["Lua Error: Global:(25012,9-25022,5): rotational-seat-layout: could not resolve", ["Global", 25012, 9, 25022, 5]],
  ["Lua Error: CSHEET_PAGE_3_PINK - 5166e7:(4423,4-4427,5): Attempt to perform", ["CSHEET_PAGE_3_PINK - 5166e7", 4423, 4, 4427, 5]],
  ["Error in Script (Global) function <onLoad>: chunk_0:(36,4):", ["chunk_0", 36, 4, 36, 4]],
  ["[Global] Lua Error <executeScript>: [Global] executeScript:(2,5-4,1): probe\n    at error", ["executeScript", 2, 5, 4, 1]],
];
for (const [text, [chunk, startLine, startColumn, endLine, endColumn]] of locationCases) {
  assertEq(parseErrorLocation(text), { chunk, startLine, startColumn, endLine, endColumn }, `parseErrorLocation(${text})`);
}
assertEq(parseErrorLocation("Lua Error <startLuaCoroutine/X>: Object reference not set"), undefined, "no location");
assertEq(isExecutedSnippet(parseErrorLocation(locationCases[4][0])), true, "isExecutedSnippet");
assertEq(isExecutedSnippet(parseErrorLocation(locationCases[0][0])), false, "not isExecutedSnippet");

// The bundled module starts at line 11 of the script TTS ran (module line 1 = ran line 11).
const ran = [...Array(10).fill("-- loader"), "local function a()", "  return 1", "end", "local function b()", "  error('boom')", "end", "return a\r"];
const file = ran.slice(10);
assertEq(reanchorLine(ran, 15, file, 5), 5, "reanchorLine unchanged");
assertEq(reanchorLine(ran, 15, ["-- new", "-- lines", ...file], 5), 7, "reanchorLine moved down");
assertEq(reanchorLine(ran, 15, file.map((l) => `  ${l}`), 5), 5, "reanchorLine reindented");
assertEq(reanchorLine(ran, 17, file, 7), 7, "reanchorLine CRLF");
assertEq(reanchorLine(ran, 15, file.filter((l) => !l.includes("boom")), 5), undefined, "reanchorLine missing");
assertEq(reanchorLine(ran, 16, ["-- new", ...file], 6), 7, "reanchorLine generic line found by context");
const shuffled = ["end", "x = 1", "end", "end", "y = 2", "end"];
assertEq(reanchorLine(ran, 16, shuffled, 2), undefined, "reanchorLine generic line without context is ambiguous");
assertEq(reanchorLine(ran, 16, shuffled, 4), 4, "reanchorLine generic line kept where expected");
assertEq(reanchorLine([...ran.slice(0, 11), ""], 12, file, 2), undefined, "reanchorLine blank");

// Module line numbers: bundle a module and map a bundled line back to the module file.
const main = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tts-tools-smoke-"));
  try {
    fs.mkdirSync(path.join(dir, "lib", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(dir, "lib", "thing.lua"), "local M = {}\n\nfunction M.fail()\n  error('THING_MARKER')\nend\n\nreturn M\n");
    fs.writeFileSync(path.join(dir, "lib", "pkg", "index.lua"), "return { 'PKG_MARKER' }\n");
    const includePaths = [path.join(dir, "?.lua")];
    const bundled = await bundleLua("local thing = require('lib.thing')\nlocal pkg = require('lib.pkg')\n", includePaths);
    const bundledLines = bundled.split("\n");

    const thingLine = bundledLines.findIndex((l) => l.includes("THING_MARKER")) + 1;
    const thing = await findNearestBundle(bundled, thingLine);
    assertEq(thing.name, "lib.thing", "findNearestBundle name");
    assertEq(thingLine - thing.offset, 4, "findNearestBundle module line");
    assertEq(getRootName(bundled), "__root", "getRootName");
    assertEq(resolveModule("lib.thing", includePaths), path.join(dir, "lib", "thing.lua"), "resolveModule file");
    assertEq(resolveModule("lib.pkg", includePaths), path.join(dir, "lib", "pkg", "index.lua"), "resolveModule index");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log("smoke-units: OK");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
