# TTS Tools (Community Fork)

> **Fork notice:** This is a community-maintained fork of Sebastian Stern’s [TTS Tools / TTS Editor](https://github.com/Sebaestschjin/tts-tools) (`sebaestschjin.tts-editor` on the Marketplace).
> Upstream docs: https://sebaestschjin.github.io/tts-tools/editor/latest
> This fork’s identity: **`eunomiac.tts-tools`**. If you also have the original installed, uninstall or disable one of them to avoid confusion.

Extension support for the [Tabletop Simulator External Editor API](https://api.tabletopsimulator.com/externaleditorapi/).

## Features

- Get scripts and XML UI from TTS
- Send scripts and XML UI back to TTS (while also bundling them)
- Execute scripts from opened text files
- Get the current UI of an object as a file in VS Code / Cursor
- Get and update the current script state of an object
- Update an individual object without reloading the whole game (including bundling its scripts and scripts of nested objects for containers)
- Locate an object on the table

Fork additions (also listed in the changelog):

- **Faster loads and Save & Play** on large saves: scripts are refreshed from TTS's load message instead of re-reading every object (optional full resync)
- **Update Object keeps changes made in TTS**: it reads the object from the running game before respawning it
- **Cleans up after other mods**: files for objects that are not in the loaded game are removed, so one folder can serve several mods
- **Shared TTS connection**: a small helper holds the TTS editor port so other local tools can use it at the same time (no Node.js install needed)
- **MCP server for AI agents** (`tts-tools`), registered automatically in VS Code 1.101+ and Cursor, so agents can run Lua in TTS while the extension keeps working
- **Claim / Release** in the status bar to hand the TTS port to another tool without restarting the editor
- Lua return values are matched to the request that asked for them, so overlapping requests no longer mix up results

## Prefer the original behavior?

Every behavior change above has a switch in the settings group **Compatibility with the original extension** (search the settings for `ttsEditor`).
Turn on **Compatibility: Behave Like Original** to get the original extension's behavior back in one click (direct connection, full re-read on every load, wipe `.tts` on load, Update Object from `data.json`, no MCP server) while keeping the bug fixes.

## Preview

Updating the script state of an object (upstream demo):

<img src="https://raw.githubusercontent.com/Eunomiac/tts-tools/main/packages/tts-editor/docs/modules/ROOT/images/update-state.gif" alt="Preview"/>

## Credits & license

- **Original author:** Sebastian Stern ([Sebaestschjin/tts-tools](https://github.com/Sebaestschjin/tts-tools))
- **This fork:** Eunomiac ([Eunomiac/tts-tools](https://github.com/Eunomiac/tts-tools))
- **License:** MIT — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE)

Please prefer filing bugs that belong to unchanged upstream behavior against the [upstream issue tracker](https://github.com/Sebaestschjin/tts-tools/issues), and fork-specific issues against this repository.

## Attributions (icons)

The object-type icons in the TTS Objects view are from [Flaticon](https://www.flaticon.com/), made by:

- [Amazona Adorada](https://www.flaticon.com/authors/amazona-adorada) from [www.flaticon.com](https://www.flaticon.com/)
- [Freepik](https://www.flaticon.com/authors/freepik) from [www.flaticon.com](https://www.flaticon.com/)
- [Good Ware](https://www.flaticon.com/authors/good-ware) from [www.flaticon.com](https://www.flaticon.com/)
- [Kiranshastry](https://www.flaticon.com/authors/kiranshastry) from [www.flaticon.com](https://www.flaticon.com/)
- [Mike Zuidgeest](https://www.flaticon.com/authors/mike-zuidgeest) from [www.flaticon.com](https://www.flaticon.com/)
- [riajulislam](https://www.flaticon.com/authors/riajulislam) from [www.flaticon.com](https://www.flaticon.com/)
