# TTS Tools

Local / community fork of [Sebaestschjin/tts-tools](https://github.com/Sebaestschjin/tts-tools) (Sebastian Stern), used as the source of truth for Toronto Rising’s Cursor TTS extension and prepared for optional Marketplace publication under publisher **`eunomiac`**.

**Credit:** Original TTS Editor and related packages by Sebastian Stern. See [`packages/tts-editor/NOTICE`](packages/tts-editor/NOTICE) and [`packages/tts-editor/LICENSE`](packages/tts-editor/LICENSE).

## Layout

| Path | Role |
| --- | --- |
| [packages/tts-editor](packages/tts-editor/) | The Cursor / VS Code **extension** (ships as one VSIX) |
| [packages/savefile](packages/savefile/) | Local library: split / join TTS saves (bundled into the extension) |
| [packages/xmlbundle](packages/xmlbundle/) | Local library: XmlUI `<Include>` bundling (bundled into the extension) |

`savefile` and `xmlbundle` stay as separate packages so you can also use them from Node outside Cursor. They are **not** separate extensions — packaging the editor pulls them in via `file:` dependencies into a single `dist/tts-tools.vsix`.

Extension id: `eunomiac.tts-tools` (fork identity; uninstall the old Marketplace `sebaestschjin.tts-editor` if both would conflict).

## Build / package

From the `tts-tools` root (after a one-time `npm install` in each of `packages/xmlbundle`, `packages/savefile`, and `packages/tts-editor`):

```sh
npm run package
```

That builds the libraries, refreshes the editor’s local copies of those libraries, compiles the editor, and writes **`dist/tts-tools.vsix`**.

From the Toronto Rising workspace, use the VS Code / Cursor tasks:

- **BUILD TTS Tools Extension (VSIX)**
- **Update TTS Extension from VSIX**
- **BUILD + Install TTS Tools Extension** (both, in order)
