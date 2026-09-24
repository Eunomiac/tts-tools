# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **TTS editor gateway (2.4.0):** a helper process holds port **39998** and fans events out over control port **39997** (NDJSON). The extension registers as `TTSTOOLS` via `@tts-tools/gateway-client`. Claim starts the helper; Release / deactivate stops it so other local tools can bind 39998. Optional `<@TAG@>` print/error routing; proxied `executeLua` with return demux.

### Fixed

- **2.4.3:** Parse TTS inbound messages like the upstream editor — one JSON document per TCP connection (accumulate until socket end). Fixes flood of “bad inbound JSON” errors from splitting pretty-printed payloads on newlines.
- **2.4.2:** Bundle the gateway helper under `dist/tts-gateway-helper/` so it no longer overwrites compiled `dist/gateway/ensureHelper.js` (activation “Cannot find module” error).
- **2.4.1:** Spawn the gateway with a real `node` binary (not Cursor/Electron `process.execPath`). Activate on startup; keep status bar / command stubs if adapter load fails so Get Objects is not “command not found”.
- **Bundled Save & Play + Global Include stubs:** when `.tts/objects/Global.xml` (or `.lua`) is a thin `<Include>` / `require` stub, Bundled Save & Play rebundles Global from that stub so UI changes still reach TTS. Echo writes what was sent into `.tts/bundled` without replacing the objects stubs.
- **Claim / Release TTS Editor Port** commands and status-bar indicator (gateway / released / error).
- **Fast Save and Play (default):** after Save and Play, scripts/UI are refreshed from the TTS echo (`scriptStates`) without wiping `.tts` or running `getJSON` for every object.
- **Save and Play (Full Resync)** command (and bundled variant) plus setting `ttsEditor.resyncAfterSaveAndPlay` for the old thorough `getJSON` rebuild.
- Incremental **Get Objects** / load sync: apply `scriptStates` for Lua/XML; fetch `getJSON` only when `data.json` is missing; prune vanished GUIDs.
- `returnID` matching for Lua returns (fixes scramble risk when imports overlap) and a single-flight import mutex.
- Fix Load Objects / Get Objects crash (`Cannot read properties of undefined (reading 'includes')`) when reusing on-disk `data.json` without a `Name` field in the in-memory object map.

### Changed

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
