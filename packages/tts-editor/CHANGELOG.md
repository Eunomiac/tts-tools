# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.0] - 2026-10-09

### Fixed

- **Go To Error** did nothing for errors spanning several lines, which TTS reports as `(line,column-line,column)` (common for multi-line `error(...)` calls). It also failed silently whenever it could not open a location; it now says why.
- **Go To Error** finds modules stored as `name/index.lua`, the same way bundling does.

### Changed

- **Go To Error** follows the failing line when the file was edited after the last Save and Play, using the surrounding lines to tell apart repeated lines such as `end`. When the line cannot be found reliably, it opens the bundled copy TTS ran at the exact line.
- No **Go To Error** button for errors without a line number or for code run with Execute Lua (including MCP agents), since there is no file to open.

## [3.0.3] - 2026-10-08

### Fixed

- **Save and Play** failed with "ENOENT ... dist/runtime.lua" when a script uses `require()` (a 3.0.0 packaging regression).
- Icons in the TTS Objects view were missing (same cause).

## [3.0.2] - 2026-10-07

### Fixed

- **Get Objects** failed with "ModelType is not defined" on saves containing custom models or assetbundles (a 3.0.0 packaging regression).

## [3.0.1] - 2026-10-07

### Changed

- Marketplace listing: the extension is listed under **Other** only, no longer under **AI**.

## [3.0.0] - 2026-10-07

First Marketplace release of TTS Tools (Community Fork), `eunomiac.tts-tools`. This section lists every difference from the original extension's last release, 2.1.3. Fork previews 2.2.0 to 2.7.0 were shared on GitHub only and are included here.

Every behavior change can be switched back in the settings group **Compatibility with the original extension**; **Behave Like Original** switches them all back at once and keeps the bug fixes. Details: [Differences from the original extension](https://eunomiac.github.io/tts-tools/editor/latest/compatibility.html).

### Added

- **Shared TTS connection:** a small helper process holds the TTS editor port and shares it with other local tools. It uses Node.js from PATH or the editor's built-in runtime, so no Node.js install is needed. If it cannot start, the extension connects directly and says so once. Setting: `ttsEditor.connection.mode`.
- **MCP server for AI agents:** registered automatically as `tts-tools` in Cursor and VS Code 1.101+, with tools to run Lua in TTS, send custom messages, and check the connection. Setting: `ttsEditor.mcp.enabled`.
- **Claim / Release TTS Editor Port** commands and a **TTS Port** status bar item, to hand the port to another tool without restarting the editor.
- **Get Object:** refresh a single object from the running game (right-click it in TTS Objects).
- **Save and Play (Full Resync)** commands and the `ttsEditor.resyncAfterSaveAndPlay` setting.
- **Compatibility settings:** `ttsEditor.compatibility.behaveLikeOriginal`, `ttsEditor.connection.mode`, `ttsEditor.sync.mode`, `ttsEditor.sync.cleanUpOnLoad`, `ttsEditor.updateObject.source`, and the opt-in `ttsEditor.sync.preserveGlobalStubs` (keep a hand-written `require` / `<Include>` stub in `objects/Global.*`).
- `.ttslua` files open as Lua without a `files.associations` setting.
- More object types get icons in TTS Objects.
- Docs page *Differences from the original extension*.

### Changed

- **Faster loads and Save and Play:** scripts and UI are written from TTS's load message, and full object data is requested only for objects without a `data.json`. After Save and Play, only what was sent is refreshed. Setting: `ttsEditor.sync.mode`.
- **Cleaning up on load** deletes files only for objects that are not in the loaded game, so one folder can serve several mods. Setting: `ttsEditor.sync.cleanUpOnLoad`.
- **Update Object** reads the object from the running game before respawning it, so changes made in TTS are kept. Setting: `ttsEditor.updateObject.source`.
- When a second editor window connects to TTS, the first one says so in its status bar (click to claim the connection back).
- The gateway helper never stops other programs. If another program holds the TTS editor port, the helper names it in the TTS Editor output and exits.
- The editor port is closed when the extension is deactivated.
- The extension ships as bundled files: the package is about 350 KB instead of several MB.

### Fixed

- Lua return values are matched to the request that asked for them, so one object's script can no longer end up in another object's file.
- A load that arrives while another is still being processed waits for it instead of mixing results.
- A Lua request that TTS never answers fails after two minutes with an error.
- **Update Object State** works on macOS and Linux, and script states containing `]]` no longer break it.
- If an object's script file is missing, Save and Play sends its last bundled copy instead of clearing the script in TTS.
- XML `<Include>` files whose names contain capital letters are found on Linux and other case-sensitive file systems. Include names stay case-insensitive on every system.

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
