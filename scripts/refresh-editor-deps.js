// The extension installs the sibling packages as copies (install-links=true), and npm does not re-copy a local
// package whose version is unchanged. Remove the copies so `npm install` picks up freshly built libraries.
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const editor = path.join(__dirname, "..", "packages", "tts-editor");
fs.rmSync(path.join(editor, "node_modules", "@tts-tools"), { recursive: true, force: true });
execSync("npm install", { cwd: editor, stdio: "inherit" });
