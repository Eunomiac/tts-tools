# TTS Tools Gateway — Control Protocol (Layer 2)

Stable wire format for non-JS clients. Prefer `@tts-tools/gateway-client` when you can use Node.

## Ports

| Port | Role |
| --- | --- |
| **39998** | TTS → editor events (held by gateway helper when running) |
| **39999** | Client → TTS commands |
| **39997** | Gateway **control** (NDJSON, one JSON object per line, localhost TCP) |

## Framing

- **Control (39997):** newline-delimited JSON in both directions.
- **TTS inbound (39998):** TTS opens a connection, writes **one** JSON document (often pretty-printed), then closes. Accumulate until socket `end`, then `JSON.parse` once.
- **TTS outbound (39999):** connect, write `JSON.stringify(payload)`, close.

## Client → gateway

```json
{"type":"register","clientId":"my-app","routeTag":"MYAPP"}
{"type":"heartbeat"}
{"type":"executeLua","requestId":1,"script":"return 1","guid":"-1"}
{"type":"command","payload":{"messageID":0}}
{"type":"shutdown"}
```

`routeTag` is optional; if present must match `^[A-Z][A-Z0-9_]{0,31}$`.

## Gateway → client

```json
{"type":"hello","version":1,"editorPort":39998,"commandPort":39999}
{"type":"registered","clientId":"my-app","routeTag":"MYAPP"}
{"type":"heartbeat"}
{"type":"event","messageID":2,"payload":{"messageID":2,"message":"hello"}}
{"type":"return","requestId":1,"returnValue":2}
{"type":"error","message":"...","requestId":1}
```

## Fan-out

| Inbound `messageID` | Routing |
| --- | --- |
| 2 print / 3 error / 1 load / 4 custom / … | Broadcast to all registrants, unless body starts with `<@TAG@>` and `TAG` matches one `routeTag` (unicast + strip). Unknown tag → broadcast unstripped. |
| 5 return | Unicast to the client that issued the matching proxied `executeLua` |

## Recommended client algorithm

1. Probe **39997**. If up → connect, wait for `hello`, `register`, heartbeat every ~2s, receive `event` / `return`.
2. If down → bind **39998** and speak the [External Editor API](https://api.tabletopsimulator.com/externaleditorapi/) directly; demux `returnMessage` by `returnID` yourself.
3. If your direct listen dies and **39997** is up → treat as gateway claim → go to step 1.
4. If heartbeat fails → close → go to step 2 (or reconnect when control returns).

## Do not

- Kill `TabletopSimulator.exe` when claiming ports.
- Send `executeLua` to 39999 while registered with the gateway and expect the return on your own 39998 socket — use proxied `executeLua` on the control port.
