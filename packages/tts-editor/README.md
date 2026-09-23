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

Fork-specific work in progress (Toronto Rising / local development) includes faster Save & Play sync behavior and a multi-client **TTS editor gateway** — see the fork repository README and `.dev` design notes when those ship.

## Preview

Updating the script state of an object (upstream demo):

<img src="https://raw.githubusercontent.com/Sebaestschjin/tts-tools/master/packages/tts-editor/media/update-state.gif" alt="Preview"/>

## Credits & license

- **Original author:** Sebastian Stern ([Sebaestschjin/tts-tools](https://github.com/Sebaestschjin/tts-tools))
- **This fork:** Eunomiac ([Eunomiac/tts-tools](https://github.com/Eunomiac/tts-tools))
- **License:** MIT — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE)

Please prefer filing bugs that belong to unchanged upstream behavior against the [upstream issue tracker](https://github.com/Sebaestschjin/tts-tools/issues), and fork-specific issues against this repository.

## Attributions (icons)

Icons taken from flaticon.com created by:

- <a href="https://www.flaticon.com/authors/amazona-adorada">Amazona Adorada</a>
- <a href="https://www.flaticon.com/authors/freepik">Freepik</a>
- <a href="https://www.flaticon.com/authors/good-ware">Good Ware</a>
- <a href="https://www.flaticon.com/authors/kiranshastry">Kiranshastry</a>
- <a href="https://www.flaticon.com/authors/mike-zuidgeest">Mike Zuidgeest</a>
- <a href="https://www.flaticon.com/authors/riajulislam">riajulislam</a>
