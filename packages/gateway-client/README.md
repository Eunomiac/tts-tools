# @tts-tools/gateway-client

Connect to Tabletop Simulator’s External Editor API through the TTS Tools local gateway — with automatic direct failover when the gateway is not running.

## Install

```bash
npm install @tts-tools/gateway-client
```

Until published to npm, use the monorepo path: `file:../gateway-client`.

## Quickstart (~10 lines)

```ts
import { connectGateway } from "@tts-tools/gateway-client";

const tts = await connectGateway({ routeTag: "MYAPP" });

tts.on("print", console.log);
tts.on("status", (s) => console.log("link:", s.mode, s.detail ?? ""));

const value = await tts.executeLua("return 1 + 1");
console.log(value);

await tts.close();
```

| `status.mode` | Meaning |
| --- | --- |
| `gateway` | Registered on control port **39997**; helper holds **39998** |
| `direct` | Listening on **39998** yourself (gateway absent) |
| `disconnected` | No link |

### Failover (default on)

1. Prefer gateway when control port **39997** accepts connections.
2. Else bind **39998** directly.
3. If the gateway appears while you are in `direct`, close direct and re-register.
4. If the gateway dies while you are in `gateway`, fall back to direct.

Disable failover when your app **owns** the helper (e.g. the TTS Tools extension):

```ts
await connectGateway({ routeTag: "TTSTOOLS", failover: false });
```

### Optional tags

```lua
print("<@MYAPP@>Only MYAPP should see this")
```

## Protocol (Layer 2)

Non-JS languages: see [PROTOCOL.md](./PROTOCOL.md).

## Copy-paste stub (Layer 3 — last resort)

Prefer this package. Minimal register-only sketch:

```ts
import * as net from "node:net";

const socket = net.connect(39997, "127.0.0.1");
socket.setEncoding("utf8");
socket.on("data", (chunk) => {
  for (const line of chunk.split("\n")) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.type === "hello") {
      socket.write(JSON.stringify({ type: "register", clientId: "stub" }) + "\n");
    }
    console.log(msg);
  }
});
```

You own keepalive, executeLua return routing, and failover if you paste this.
