import type { Executor, OperationDetail, Registry } from "@donghanh/core";
import { executeOperation } from "@donghanh/core";
import { Hono } from "hono";
import type { Authenticate } from "./middleware";
import { renderForChatGpt } from "./renderers/chatgpt";

const MCP_PROTOCOL_VERSION = "2026-01-26";
const UI_MIME_TYPE = "text/html;profile=mcp-app";

export interface WidgetConfig {
  /** Stable URI, content-hashed for cache-bust (e.g. "ui://widget/boards-a1b2c3.html"). */
  uri: string;
  /** Full iframe HTML. */
  html: string;
  /** Domain for sandbox. Required for submission. */
  domain?: string;
  csp?: {
    connectDomains?: string[];
    resourceDomains?: string[];
    frameDomains?: string[];
  };
  prefersBorder?: boolean;
}

export interface McpRoutesConfig {
  registry: Registry;
  executor: Executor;
  authenticate: Authenticate;
  /** Canonical HTTPS identifier for this MCP server. */
  resource: string;
  /** Authorization server issuer base URL(s). */
  authorizationServers: string[];
  /** Scopes advertised in protected-resource metadata (default scopes). */
  scopes?: string[];
  resourceDocumentation?: string;
  serverInfo?: { name: string; version: string };
  encodeVariables?: (vars: Record<string, unknown>) => string;
  /** Named widgets. Operation's `widget` config key must match a name here. */
  widgets?: Record<string, WidgetConfig>;
}

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcSuccess = {
  jsonrpc: "2.0";
  id: number | string | null;
  result: unknown;
};

type JsonRpcFailure = {
  jsonrpc: "2.0";
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
};

function success(id: number | string | null, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

function failure(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  const error: { code: number; message: string; data?: unknown } = {
    code,
    message,
  };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

function wwwAuthenticate(
  resource: string,
  error: string,
  description: string,
): string {
  return `Bearer resource_metadata="${resource}/.well-known/oauth-protected-resource", error="${error}", error_description="${description}"`;
}

function securitySchemesFor(
  detail: OperationDetail | null,
  defaultScopes: string[],
): Array<{ type: "noauth" } | { type: "oauth2"; scopes: string[] }> {
  const auth = detail?.auth ?? "required";
  const scopes = detail?.scopes ?? defaultScopes;
  if (auth === "none") return [{ type: "noauth" }];
  if (auth === "optional")
    return [{ type: "noauth" }, { type: "oauth2", scopes }];
  return [{ type: "oauth2", scopes }];
}

function annotationsFor(detail: OperationDetail | null): {
  readOnlyHint: boolean;
  openWorldHint: boolean;
  destructiveHint: boolean;
} {
  if (!detail) {
    return {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    };
  }
  const readOnly = detail.type === "query";
  return {
    readOnlyHint: readOnly,
    openWorldHint: readOnly ? false : (detail.external ?? false),
    destructiveHint: readOnly ? false : (detail.destructive ?? false),
  };
}

function widgetMetaFor(widget: WidgetConfig): Record<string, unknown> {
  const ui: Record<string, unknown> = {};
  if (widget.prefersBorder) ui.prefersBorder = true;
  if (widget.domain) ui.domain = widget.domain;
  if (widget.csp) ui.csp = widget.csp;
  return ui;
}

export function mcpRoutes(config: McpRoutesConfig): Hono {
  const {
    registry,
    executor,
    authenticate,
    resource,
    authorizationServers,
    scopes = [],
    resourceDocumentation,
    serverInfo = { name: "donghanh-mcp", version: "0.1.0" },
    encodeVariables,
    widgets = {},
  } = config;

  const app = new Hono();

  // RFC 9728 protected resource metadata
  app.get("/.well-known/oauth-protected-resource", (c) =>
    c.json({
      resource,
      authorization_servers: authorizationServers,
      ...(scopes.length > 0 && { scopes_supported: scopes }),
      ...(resourceDocumentation && {
        resource_documentation: resourceDocumentation,
      }),
    }),
  );

  app.post("/mcp", async (c) => {
    let body: JsonRpcRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json(failure(null, -32700, "Parse error"), 400);
    }

    const id = body.id ?? null;
    const method = body.method;

    if (body.jsonrpc !== "2.0" || !method) {
      return c.json(failure(id, -32600, "Invalid Request"), 400);
    }

    switch (method) {
      case "initialize":
        return c.json(
          success(id, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: {},
              ...(Object.keys(widgets).length > 0 && { resources: {} }),
            },
            serverInfo,
          }),
        );

      case "notifications/initialized":
      case "notifications/cancelled":
        return new Response(null, { status: 204 });

      case "tools/list": {
        const tools = registry.list().map((op) => {
          const detail = registry.detail(op.id);
          const widgetName = detail?.widget;
          const widget = widgetName ? widgets[widgetName] : undefined;

          const tool: Record<string, unknown> = {
            name: op.id,
            description: detail?.instruction
              ? `${op.description}\n\n${detail.instruction}`
              : op.description,
            inputSchema: detail?.input ?? {
              type: "object",
              properties: {},
            },
            annotations: annotationsFor(detail),
            securitySchemes: securitySchemesFor(detail, scopes),
          };

          if (widget) {
            tool._meta = {
              ui: { resourceUri: widget.uri },
              "openai/outputTemplate": widget.uri,
            };
          }

          return tool;
        });
        return c.json(success(id, { tools }));
      }

      case "resources/list": {
        const resources = Object.entries(widgets).map(([name, w]) => ({
          uri: w.uri,
          name,
          mimeType: UI_MIME_TYPE,
        }));
        return c.json(success(id, { resources }));
      }

      case "resources/read": {
        const uri = body.params?.uri as string | undefined;
        if (!uri) return c.json(failure(id, -32602, "Missing uri"), 400);
        const widget = Object.values(widgets).find((w) => w.uri === uri);
        if (!widget) {
          return c.json(failure(id, -32601, `Unknown resource "${uri}"`), 404);
        }
        return c.json(
          success(id, {
            contents: [
              {
                uri: widget.uri,
                mimeType: UI_MIME_TYPE,
                text: widget.html,
                _meta: { ui: widgetMetaFor(widget) },
              },
            ],
          }),
        );
      }

      case "tools/call": {
        const params = (body.params ?? {}) as {
          name?: string;
          arguments?: Record<string, unknown>;
        };
        const toolName = params.name;
        if (!toolName) {
          return c.json(failure(id, -32602, "Missing tool name"), 400);
        }

        const op = registry.get(toolName);
        if (!op) {
          return c.json(failure(id, -32601, `Unknown tool "${toolName}"`), 404);
        }

        const detail = registry.detail(toolName);
        const authMode = detail?.auth ?? "required";

        let userId: string | null = null;
        if (authMode !== "none") {
          const authResult = await authenticate(c.req.raw);
          if ("error" in authResult) {
            if (authMode === "required") {
              const challenge = wwwAuthenticate(
                resource,
                "insufficient_scope",
                "You need to login to continue",
              );
              return c.json(
                success(id, {
                  content: [{ type: "text", text: "Authentication required." }],
                  isError: true,
                  _meta: { "mcp/www_authenticate": [challenge] },
                }),
                {
                  headers: { "WWW-Authenticate": challenge },
                },
              );
            }
            // optional: proceed anonymously
          } else {
            userId = authResult.userId;
          }
        }

        try {
          const { data, brief } = await executeOperation({
            registry,
            operationId: toolName,
            variables: params.arguments ?? {},
            executor,
            context: { userId, request: c.req.raw },
          });

          const rendered = renderForChatGpt(brief, {
            encodeVariables,
            getOperationInput: (opId) => registry.detail(opId)?.input,
          });

          const structured: Record<string, unknown> = {
            [op.operationConfig.responseKey]: data,
          };
          if (rendered.suggestedActions.length > 0) {
            structured.actions = rendered.suggestedActions;
          }
          if (rendered.display !== undefined) {
            structured.display = rendered.display;
          }

          const meta: Record<string, unknown> = {};
          if (rendered.context && rendered.context.length > 0) {
            meta["donghanh/context"] = rendered.context;
          }

          const widgetName = detail?.widget;
          const widget = widgetName ? widgets[widgetName] : undefined;
          if (widget) {
            meta.ui = { resourceUri: widget.uri };
            meta["openai/outputTemplate"] = widget.uri;
          }

          return c.json(
            success(id, {
              content: [{ type: "text", text: rendered.nextSteps ?? "OK" }],
              structuredContent: structured,
              ...(Object.keys(meta).length > 0 && { _meta: meta }),
            }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : "Internal error";
          return c.json(
            success(id, {
              content: [{ type: "text", text: message }],
              isError: true,
            }),
          );
        }
      }

      default:
        return c.json(failure(id, -32601, `Method not found: ${method}`), 404);
    }
  });

  return app;
}
