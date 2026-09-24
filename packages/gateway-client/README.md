# @tts-tools/gateway-client

Connect to the TTS Tools local gateway (control port **39997**) to share Tabletop Simulator’s External Editor API with other apps.

```ts
import { connectGateway } from "@tts-tools/gateway-client";

const tts = await connectGateway({ routeTag: "MYAPP" });
tts.on("print", console.log);
const value = await tts.executeLua("return 1 + 1");
await tts.close();
```

When the gateway is not running, start it via the TTS Tools extension (or `tts-gateway` CLI). Full direct↔gateway failover lands in a later release.
