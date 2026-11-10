# @tts-tools/tts-gateway

Local helper that holds Tabletop Simulator’s External Editor port **39998** and fans events out to registered clients on control port **39997** (NDJSON).

## Run outside the IDE

The TTS Tools extension prefers an already-running gateway. You can start one yourself so MCP and other tools keep working after the editor closes:

```sh
npm run build
node dist/cli.js
# or, after packaging the extension:
# node path/to/extension/dist/tts-gateway-helper/cli.js
```

```
tts-gateway [--force]
```

`--force` asks any gateway on 39997 to shut down, then terminates remaining listeners on 39998 (never Tabletop Simulator itself). Use only when another local tool is stuck on the port.

Writes a PID file under `%LOCALAPPDATA%/tts-tools/gateway.pid` (or XDG state on Linux/macOS).
