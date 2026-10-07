<img src="packages/tts-editor/media/icon.png" alt="TTS Tools logo" width="128" align="right"/>

# TTS Tools (Community Fork)

A community-maintained fork of [Sebaestschjin/tts-tools](https://github.com/Sebaestschjin/tts-tools) by Sebastian Stern: a VS Code extension and supporting libraries for scripting [Tabletop Simulator](https://www.tabletopsimulator.com/) mods through its External Editor API.

**Credit:** the original TTS Editor extension and the `savefile` / `xmlbundle` libraries are by Sebastian Stern. See [`packages/tts-editor/NOTICE`](packages/tts-editor/NOTICE) and [`packages/tts-editor/LICENSE`](packages/tts-editor/LICENSE).

## Layout

| Path | Role |
| --- | --- |
| [packages/tts-editor](packages/tts-editor/) | The VS Code **extension** (ships as one VSIX) |
| [packages/tts-gateway](packages/tts-gateway/) | Small helper process that holds the TTS editor port and shares it between several local tools (bundled into the extension) |
| [packages/gateway-client](packages/gateway-client/) | Node client for the gateway, with direct-connection fallback (bundled into the extension; usable by other tools) |
| [packages/savefile](packages/savefile/) | Library: split / join TTS saves (bundled into the extension) |
| [packages/xmlbundle](packages/xmlbundle/) | Library: XmlUI `<Include>` bundling (bundled into the extension) |

The libraries are separate packages so they can also be used from Node on their own. Packaging the extension pulls them into a single `dist/tts-tools.vsix`.

Extension id: `eunomiac.tts-tools`. If you also have the original `sebaestschjin.tts-editor` installed, disable one of them.

## Build / package

From the repository root, after a one-time `npm install` in each package folder:

```sh
npm run package
```

That builds the libraries and the gateway, type-checks the extension, bundles it with esbuild into `packages/tts-editor/dist/`, and writes **`dist/tts-tools.vsix`**.
Install it with **Extensions: Install from VSIX…** in VS Code (or `code --install-extension dist/tts-tools.vsix`).

The extension copies the sibling packages into its `node_modules` when installed (`install-links=true`), and npm does not re-copy them while their version is unchanged. `npm run package` removes those copies and reinstalls them; after changing a library without packaging, run `npm run refresh:editor-deps`.

## Checks

```sh
npm test --prefix packages/xmlbundle
npm test --prefix packages/savefile
npm run lint --prefix packages/tts-editor
npm run smoke --prefix packages/tts-editor
```

The smoke checks include a gateway test against a fake TTS. If TTS is running with a game loaded, the MCP smoke check also runs a few harmless Lua snippets in it (prints and one deliberate error).
CI runs all of these on Windows, Linux and macOS. The connection to a real TTS is tested on Windows only.

Releases are published by pushing a version tag; see [`.dev/release-audit/publishing.md`](.dev/release-audit/publishing.md).

## License

The extension is MIT licensed (original work by Sebastian Stern, fork changes by Eunomiac). `savefile` and `xmlbundle` are CC0-1.0. The gateway packages are MIT. The repository root `LICENSE` (CC0-1.0) is inherited from upstream and covers files that have no license of their own.
