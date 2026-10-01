/**
 * Stdio MCP server bundled with TTS Tools. Registers with the local TTS gateway as route tag `MCP`
 * so agents can run Lua in Tabletop Simulator while the extension keeps its own connection.
 *
 * Runs as a separate Node process (no `vscode` import). Stdout carries only newline-delimited
 * JSON-RPC; diagnostics go to stderr.
 */
import * as readline from "node:readline";

import { connectGateway, type GatewaySession } from "@tts-tools/gateway-client";

const SERVER_NAME = "tts-tools";
const SERVER_VERSION = process.env.TTS_TOOLS_VERSION ?? "0.0.0";
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const ROUTE_TAG = "MCP";

const DEFAULT_MAX_WAIT_MS = 30_000;
const MAX_WAIT_CAP_MS = 120_000;
/** TTS sends the return, prints, and errors on separate connections, so prints/errors can trail the return. */
const RETURN_GRACE_MS = 250;

type JsonRpcId = string | number;
type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: JsonRpcId | null;
  method?: string;
  params?: Record<string, unknown>;
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

const log = (message: string): void => {
  process.stderr.write(`[tts-tools-mcp] ${message}\n`);
};

const send = (message: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
};

let sessionPromise: Promise<GatewaySession> | undefined;

/** Connect lazily; reconnect when the previous session dropped (gateway restarted or port released). */
const getSession = async (): Promise<GatewaySession> => {
  if (sessionPromise) {
    const existing = await sessionPromise.catch(() => undefined);
    if (existing && existing.mode !== "disconnected") {
      return existing;
    }
    await existing?.close().catch(() => undefined);
    sessionPromise = undefined;
  }
  const attempt = connectGateway({
    routeTag: ROUTE_TAG,
    clientId: `tts-tools-mcp-${process.pid}`,
    failover: false,
  });
  sessionPromise = attempt;
  try {
    return await attempt;
  } catch (error) {
    sessionPromise = undefined;
    throw new Error(
      `TTS gateway is not running (${error instanceof Error ? error.message : error}). ` +
        "Open a workspace with the TTS Tools extension active, or run “TTS Editor: Claim TTS Editor Port”."
    );
  }
};

let chain: Promise<unknown> = Promise.resolve();
const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
};

const clampMs = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), MAX_WAIT_CAP_MS);
};

type ExecuteResult = {
  returnValue?: unknown;
  prints: string[];
  error?: { message: string; guid: string; errorMessagePrefix?: string };
  customMessages: unknown[];
  finishedBy: "return" | "error" | "quietAfterReturn" | "maxWait";
  timedOut: boolean;
};

const executeLua = async (args: Record<string, unknown>): Promise<ExecuteResult> => {
  const script = args.script;
  if (typeof script !== "string" || script.length === 0) {
    throw new Error("`script` must be a non-empty string");
  }
  const guid = typeof args.guid === "string" && args.guid.length > 0 ? args.guid : "-1";
  const maxWaitMs = clampMs(args.maxWaitMs, DEFAULT_MAX_WAIT_MS);
  const listenAfterReturnMs = Math.max(clampMs(args.listenAfterReturnMs, 0), RETURN_GRACE_MS);
  const session = await getSession();

  return new Promise<ExecuteResult>((resolve) => {
    const prints: string[] = [];
    const customMessages: unknown[] = [];
    let error: ExecuteResult["error"];
    let returnValue: unknown;
    let returned = false;
    let done = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const onPrint = (message: string) => {
      prints.push(message);
      resetIdle();
    };
    const onError = (payload: Record<string, unknown>) => {
      error = {
        message: String(payload.error ?? payload.message ?? "Unknown Lua error"),
        guid: String(payload.guid ?? guid),
        errorMessagePrefix: typeof payload.errorMessagePrefix === "string" ? payload.errorMessagePrefix : undefined,
      };
      finish("error");
    };
    const onCustom = (payload: Record<string, unknown>) => {
      customMessages.push(payload.customMessage ?? payload);
      resetIdle();
    };

    const maxTimer = setTimeout(() => finish("maxWait"), maxWaitMs);

    function resetIdle(): void {
      if (!returned) {
        return;
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(
        () => finish(listenAfterReturnMs > RETURN_GRACE_MS ? "quietAfterReturn" : "return"),
        listenAfterReturnMs
      );
    }

    function finish(by: ExecuteResult["finishedBy"]): void {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(maxTimer);
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      session.off("print", onPrint as (...a: unknown[]) => void);
      session.off("error", onError as (...a: unknown[]) => void);
      session.off("customMessage", onCustom as (...a: unknown[]) => void);
      resolve({ returnValue, prints, error, customMessages, finishedBy: by, timedOut: by === "maxWait" });
    }

    session.on("print", onPrint);
    session.on("error", onError);
    session.on("customMessage", onCustom);

    session.executeLua(script, guid).then(
      (value) => {
        returnValue = value;
        returned = true;
        resetIdle();
      },
      (err: unknown) => {
        if (!done) {
          error = { message: err instanceof Error ? err.message : String(err), guid };
          finish("error");
        }
      }
    );
  });
};

const textResult = (payload: unknown, isError = false): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

const TOOLS = [
  {
    name: "tts_execute_lua",
    description:
      "Run a Lua snippet in the live Tabletop Simulator game (via the TTS Tools gateway, alongside the editor extension). " +
      "Waits for TTS to report the chunk finished (it always does, with `returnValue` when the chunk returns one), a Lua error, or `maxWaitMs`. " +
      "Nested Lua tables may not survive as return values — `return JSON.encode(tbl)` instead. " +
      "For scripts that keep printing after the chunk returns (Wait.time, coroutines), set `listenAfterReturnMs`. " +
      "Prints are broadcast by TTS, so output from other scripts running at the same moment can appear in `prints`.",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string", description: "Lua source to execute." },
        guid: { type: "string", description: 'Object GUID whose script context runs the code (default Global: "-1").' },
        maxWaitMs: {
          type: "integer",
          minimum: 1,
          maximum: MAX_WAIT_CAP_MS,
          description: `Hard cap for the whole call (default ${DEFAULT_MAX_WAIT_MS}).`,
        },
        listenAfterReturnMs: {
          type: "integer",
          minimum: 0,
          maximum: MAX_WAIT_CAP_MS,
          description:
            "After the chunk returns, keep collecting prints until this much silence passes (default: a short grace period only). Still capped by maxWaitMs.",
        },
      },
      required: ["script"],
    },
  },
  {
    name: "tts_send_custom_message",
    description:
      "Send a JSON object to the game's `onExternalMessage(data)` handler (External Editor messageID 2). Does not wait for a reply.",
    inputSchema: {
      type: "object",
      properties: {
        customMessage: { type: "object", description: "Table passed to onExternalMessage." },
      },
      required: ["customMessage"],
    },
  },
  {
    name: "tts_status",
    description: "Report whether this MCP is connected to Tabletop Simulator through the TTS Tools gateway.",
    inputSchema: { type: "object", properties: {} },
  },
];

const callTool = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
  switch (name) {
    case "tts_execute_lua": {
      const result = await serialize(() => executeLua(args));
      return textResult(result, result.error !== undefined);
    }
    case "tts_send_custom_message": {
      const customMessage = args.customMessage;
      if (typeof customMessage !== "object" || customMessage === null || Array.isArray(customMessage)) {
        throw new Error("`customMessage` must be a JSON object");
      }
      await serialize(async () => (await getSession()).customMessage(customMessage));
      return textResult({ ok: true });
    }
    case "tts_status": {
      try {
        const session = await getSession();
        return textResult({ connected: true, mode: session.mode, routeTag: ROUTE_TAG });
      } catch (error) {
        return textResult({ connected: false, detail: error instanceof Error ? error.message : String(error) });
      }
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
};

const handleRequest = async (message: JsonRpcMessage): Promise<unknown> => {
  const params = message.params ?? {};
  switch (message.method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions:
          "Tabletop Simulator bridge from the TTS Tools extension. Requires TTS running with a game loaded and the TTS Tools gateway up (the extension starts it).",
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const name = String(params.name ?? "");
      const args = (params.arguments as Record<string, unknown> | undefined) ?? {};
      try {
        return await callTool(name, args);
      } catch (error) {
        return textResult({ ok: false, error: error instanceof Error ? error.message : String(error) }, true);
      }
    }
    default: {
      const err = new Error(`Method not found: ${message.method}`) as Error & { code: number };
      err.code = -32601;
      throw err;
    }
  }
};

const onLine = (line: string): void => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  let message: JsonRpcMessage;
  try {
    message = JSON.parse(trimmed) as JsonRpcMessage;
  } catch {
    send({ id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  const id = message.id;
  if (id === undefined || id === null || !message.method) {
    return;
  }
  handleRequest(message).then(
    (result) => send({ id, result }),
    (error: unknown) => {
      const code = typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : -32603;
      send({ id, error: { code, message: error instanceof Error ? error.message : String(error) } });
    }
  );
};

const shutdown = async (): Promise<void> => {
  const session = await sessionPromise?.catch(() => undefined);
  await session?.close().catch(() => undefined);
  process.exit(0);
};

readline.createInterface({ input: process.stdin }).on("line", onLine).on("close", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
log(`started (v${SERVER_VERSION}, route tag ${ROUTE_TAG})`);
