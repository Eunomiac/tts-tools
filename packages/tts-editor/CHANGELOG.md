# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Compatibility switches (2.7.0):** every behavior this fork changed can be switched back in the settings editor. `ttsEditor.compatibility.behaveLikeOriginal` turns them all back at once while keeping the bug fixes. Individual settings: `ttsEditor.connection.mode` (`gateway` / `direct`), `ttsEditor.sync.mode` (`fast` / `classic`), `ttsEditor.sync.cleanUpOnLoad` (`removedObjects` / `everything` / `nothing`), `ttsEditor.updateObject.source` (`liveTable` / `dataFile`), `ttsEditor.sync.preserveGlobalStubs`.
- **Bundled MCP server for AI agents (2.6.0):** The extension registers an MCP server named `tts-tools` with Cursor (`vscode.cursor.mcp.registerServer`) or VS Code 1.101+ (`mcpServerDefinitionProviders`). It joins the TTS gateway as route tag `MCP`, so agents and the extension work at the same time. Tools: `tts_execute_lua`, `tts_send_custom_message`, `tts_status`. Turn off with `ttsEditor.mcp.enabled`.
- **Get Object (2.5.3):** Right-click a row in TTS Objects (or Command Palette) to refresh that one object from the live table via `getJSON`, without a full Get Objects / prune.

- **TTS Objects icons (2.5.1):** Broader `Name` → icon mapping from the TTS Object Name list / `ObjectName` enum (custom model suffixes, RPG figurines, zones, tools, tables, stacks). Unknown types use a generic Codicon (`symbol-misc`). New classes without PNG assets use VS Code ThemeIcons (package, clock, note, bounding-box, …).
- **Gateway-client failover (2.5.0 / `@tts-tools/gateway-client` 0.2.0):** `connectGateway()` prefers the helper on **39997**, falls back to binding **39998** directly when the gateway is down, and rejoins when it returns. Pass `failover: false` when your app owns the helper (TTS Tools extension). See package README + PROTOCOL.md.
- **TTS editor gateway (2.4.x):** helper holds **39998**; control NDJSON on **39997**; extension registers as `TTSTOOLS`. Claim starts the helper; Release / deactivate stops it. Optional `<@TAG@>` routing; proxied `executeLua`.
- **Bundled Save & Play + Global Include stubs:** when `.tts/objects/Global.xml` (or `.lua`) is a thin `<Include>` / `require` stub, Bundled Save & Play rebundles Global from that stub so UI changes still reach TTS. Echo writes what was sent into `.tts/bundled` without replacing the objects stubs.
- **Claim / Release TTS Editor Port** commands and status-bar indicator (gateway / released / error).
- **Fast Save and Play (default):** after Save and Play, scripts/UI are refreshed from the TTS echo (`scriptStates`) without wiping `.tts` or running `getJSON` for every object.
- **Save and Play (Full Resync)** command (and bundled variant) plus setting `ttsEditor.resyncAfterSaveAndPlay` for the old thorough `getJSON` rebuild.
- Incremental **Get Objects** / load sync: apply `scriptStates` for Lua/XML; fetch `getJSON` only when `data.json` is missing; prune vanished GUIDs.
- `returnID` matching for Lua returns (fixes scramble risk when imports overlap) and a single-flight import mutex.
- Fix Load Objects / Get Objects crash (`Cannot read properties of undefined (reading 'includes')`) when reusing on-disk `data.json` without a `Name` field in the in-memory object map.

### Fixed

- **Update Object respawned stale objects (2.7.0):** Update Object now reads the object from the running game before respawning it, so moves and other changes made in TTS since the last full load are kept. Set `ttsEditor.updateObject.source` to `dataFile` to use `data.json` as before.
- **Leftover files from other mods (2.7.0):** when a game loads, files for objects that are not in it (removed objects, renamed objects, or a different mod in the same folder) are deleted, so Save and Play no longer sends scripts for objects from another game. Controlled by `ttsEditor.sync.cleanUpOnLoad`.
- **Gateway and MCP without Node.js (2.7.0):** the gateway helper and MCP server use Node.js from PATH when available and otherwise the editor's built-in runtime. If the helper still cannot start, the extension connects directly and says so once, instead of failing to connect.
- **Update Object cleared the TTS Objects list (2.5.2):** Single-object sync no longer treats the one GUID as a full inventory and prunes everything else (and deletes their `.tts` files). Pruning only runs after Get Objects / load / full resync.
- **2.4.3:** Parse TTS inbound messages like the upstream editor — one JSON document per TCP connection (accumulate until socket end). Fixes flood of “bad inbound JSON” errors from splitting pretty-printed payloads on newlines.
- **2.4.2:** Bundle the gateway helper under `dist/tts-gateway-helper/` so it no longer overwrites compiled `dist/gateway/ensureHelper.js` (activation “Cannot find module” error).
- **2.4.1:** Spawn the gateway with a real `node` binary (not Cursor/Electron `process.execPath`). Activate on startup; keep status bar / command stubs if adapter load fails so Get Objects is not “command not found”.

### Changed

- **Global stubs are opt-in (2.7.0):** keeping a hand-written `require` / `<Include>` stub in `objects/Global.*` (and always rebundling it on Save and Play) now needs `ttsEditor.sync.preserveGlobalStubs`. By default Global files are refreshed from TTS on load, like the original extension.
- Removed the unused in-process port listener code; connection handling lives in `@tts-tools/gateway-client`.
- Rebranded as a community fork for publisher `eunomiac` (`eunomiac.tts-tools`): clearer Marketplace-oriented naming, README fork notice, `LICENSE` / `NOTICE` attribution to Sebastian Stern / upstream Sebaestschjin/tts-tools.
- Status bar shows **TTS Port: gateway** when the helper is holding 39998.

## [2.1.3] - 2025-05-13

### Fixed

- Fixes "Update Object" not finding the object data file.

## [2.1.2] - 2025-05-13

### Fixed

- Fixes "Go To Error" not finding the module if it has multiple `.` in its name.

## [2.1.1] - 2025-05-10

### Fixed

- Fixes loading scripts for objects which contain line breaks in their name.

## [2.1.0] - 2025-05-10

### Changed

- The objects scripts are now written to the subdirectory `objects` inside the `.tts` output folder.
  You're advised to clean up and delete the remaining files in the `.tts` output once after updating to not confuse them with the actual used files.

### Add

- XML files are also unbundled when using the "Unbundle Library" command.
- XML files now also use multiple lookup paths during bundling just like Lua files.
- The `libray` path will be included in the lookup path to bundle Lua and XML files.

### Fixed

- Fixes "Go To Error" not finding the module if it has a `.` in its name.

## [2.0.0] - 2025-02-24

### Breaking

- Removed (undocumented) support for TSTL.
- Minimum VS Code version bumped to 1.96.0.

### Changed

- "Go To Error" now tries to locate and open the actual script file instead of always opening the bundled file.

### Added

- `require` can resolve `index.lua` files without explicitly including them in the module name.
- Command "Go to Last Error" added which opens the error line of the last reported error message.
- Command "Unbundle Library" added to reconstruct the file structure from `require`d modules.

## [1.1.0] - 2024-01-16

### Added

- The execute code command can take a parameter so that it's usable from other extension

### Changed

- Using the "Execute code" command while having a selection in the active editor now only executes the selected text instead of the whole file

## [1.0.1] - 2024-01-11

### Fixed

- Default base path to look for imports is the workspace directory instead of `src`
- Fixes the preview image in the marketplace

## [1.0.0] - 2024-01-10

### Added

- Adds command to add UI file from object view
- Adds command to get objects and save and play to object view toolbar
- Adds command to get and update the current state of an object
- Adds macro functions for executing Lua scripts to interact with VS Code
- Adds walkthrough

## [0.3.0] - 2024-01-05

### Added

- Adds a view that lists the objects in the game that have scripts attached
- Adds a command to show the current UI of an object as a file
- Adds a command to locate an object on the table
- Save and play can be used with the bundled scripts as well

### Fixed

- Fixes extension activation event for workspaces containing `.lua` or `.ttslua` files

## [0.2.0] - 2024-01-04

- Initial release
