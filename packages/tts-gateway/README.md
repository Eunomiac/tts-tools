# @tts-tools/tts-gateway

Local helper that holds Tabletop Simulator’s External Editor port **39998** and fans events out to registered clients on control port **39997** (NDJSON).

Started automatically by the TTS Tools extension. Not meant to be run by hand unless debugging.

```
npm run build
node dist/cli.js
```
