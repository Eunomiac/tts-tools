import * as path from "node:path";
import * as vscode from "vscode";

import configuration, { mcpSettings } from "../configuration";
import { resolveNodeRuntime } from "../gateway/ensureHelper";

export const MCP_SERVER_NAME = "tts-tools";
const VSCODE_PROVIDER_ID = "ttsEditor.mcpServer";

type CursorMcpApi = {
  registerServer: (config: {
    name: string;
    server: { command: string; args: string[]; env: Record<string, string> };
  }) => void;
  unregisterServer: (name: string) => void;
};

type VsCodeMcpApi = {
  registerMcpServerDefinitionProvider: (
    id: string,
    provider: {
      onDidChangeMcpServerDefinitions: vscode.Event<void>;
      provideMcpServerDefinitions: () => unknown[];
    }
  ) => vscode.Disposable;
};

type McpStdioServerDefinitionCtor = new (
  label: string,
  command: string,
  args?: string[],
  env?: Record<string, string>,
  version?: string
) => unknown;

/**
 * Exposes the bundled stdio MCP server (`dist/mcp/server.js`) to agents.
 * Cursor: `vscode.cursor.mcp.registerServer`. VS Code 1.101+: `lm.registerMcpServerDefinitionProvider`.
 * Older hosts without either API skip registration.
 */
export const registerMcpServer = (context: vscode.ExtensionContext, log: (message: string) => void): void => {
  const serverJs = path.join(context.extensionPath, "dist", "mcp", "server.js");
  const runtime = resolveNodeRuntime();
  const command = runtime.command;
  const version = String(context.extension.packageJSON.version ?? "");
  const env = { ...runtime.env, TTS_TOOLS_VERSION: version };
  const affectsMcp = (event: vscode.ConfigurationChangeEvent) =>
    mcpSettings.some((setting) => event.affectsConfiguration(setting));

  const cursorMcp = (vscode as unknown as { cursor?: { mcp?: CursorMcpApi } }).cursor?.mcp;
  if (cursorMcp?.registerServer) {
    let registered = false;
    const sync = () => {
      if (configuration.mcpEnabled() && !registered) {
        cursorMcp.registerServer({ name: MCP_SERVER_NAME, server: { command, args: [serverJs], env } });
        registered = true;
        log(`Registered MCP server "${MCP_SERVER_NAME}" with Cursor (runs on ${runtime.description})`);
      } else if (!configuration.mcpEnabled() && registered) {
        cursorMcp.unregisterServer(MCP_SERVER_NAME);
        registered = false;
        log(`Unregistered MCP server "${MCP_SERVER_NAME}" from Cursor`);
      }
    };
    sync();
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (affectsMcp(event)) {
          sync();
        }
      }),
      {
        dispose: () => {
          if (registered) {
            cursorMcp.unregisterServer(MCP_SERVER_NAME);
          }
        },
      }
    );
    return;
  }

  const lm = (vscode as unknown as { lm?: Partial<VsCodeMcpApi> }).lm;
  const StdioDefinition = (vscode as unknown as { McpStdioServerDefinition?: McpStdioServerDefinitionCtor })
    .McpStdioServerDefinition;
  if (lm?.registerMcpServerDefinitionProvider && StdioDefinition) {
    const changed = new vscode.EventEmitter<void>();
    context.subscriptions.push(
      changed,
      lm.registerMcpServerDefinitionProvider(VSCODE_PROVIDER_ID, {
        onDidChangeMcpServerDefinitions: changed.event,
        provideMcpServerDefinitions: () =>
          configuration.mcpEnabled() ? [new StdioDefinition(MCP_SERVER_NAME, command, [serverJs], env, version)] : [],
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (affectsMcp(event)) {
          changed.fire();
        }
      })
    );
    log(`Registered MCP server provider "${VSCODE_PROVIDER_ID}" with VS Code`);
    return;
  }

  log("This editor has no extension MCP API; add dist/mcp/server.js to your MCP config manually to use it.");
};
