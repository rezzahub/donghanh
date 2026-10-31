import type { Executor, OperationDetail, Registry } from "@donghanh/core";
import { executeOperation } from "@donghanh/core";
import { Hono } from "hono";
import type { ExposureConfig } from "./exposure";
import { resolveExposure } from "./exposure";
import type { Authenticate } from "./middleware";
import { negotiateProtocolVersion } from "./protocol";
import type { ChatGptResult } from "./renderers/chatgpt";
import { renderForChatGpt } from "./renderers/chatgpt";

const INSTRUCTIONS_WARN_LENGTH = 4096;
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
  /** Endpoint path for the JSON-RPC handler (default "/mcp"). */
  path?: string;
  /** Mount `/.well-known/oauth-protected-resource` (default true). */
  metadata?: boolean;
  /** Appended to the app's instructions in `initialize` (only when the app has instructions). */
  instructionsSuffix?: string;
  encodeVariables?: (vars: Record<string, unknown>) => string;
  /**
   * Append the result's next-step actions to the tool text as a `Next:` block
   * (default true). `structuredContent.actions` is unaffected.
   */
  actionsInText?: boolean;
  /** Which operations are tools, and which only the catalog (default: all tools). */
  exposure?: ExposureConfig;
  /** Named widgets. Operation's `widget` config key must match a name here. */
  widgets?: Record<string, WidgetConfig>;
  /**
   * Final say on a tool's `outputSchema`. Called for every tool with the default
   * wrapped schema (or undefined when the operation has no response schema);
   * the return value is used as is, undefined omits it.
   */
  outputSchema?: (
    op: OperationDetail,
    wrapped: object | undefined,
  ) => object | undefined;
  /** Hook to enrich `structuredContent` after execution (e.g. inject display text) */
  enrichResponse?: (
    structured: Record<string, unknown>,
    opts: {
      operationId: string;
      data: unknown;
      variables: Record<string, unknown>;
      userId: string | null;
      request: Request;
    },
  ) => Promise<void>;
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
  idempotentHint: boolean;
} {
  if (!detail) {
    return {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
      idempotentHint: false,
    };
  }
  const readOnly = detail.type === "query";
  return {
    readOnlyHint: readOnly,
    openWorldHint: readOnly ? false : (detail.external ?? false),
    destructiveHint: readOnly ? false : (detail.destructive ?? false),
    idempotentHint: detail.idempotent ?? false,
  };
}

/**
 * Model-visible text for a tool result: the brief's messages, then the next-step
 * actions as a `Next:` list (`- label (operation id)`). Falls back to "OK".
 */
function toolText(rendered: ChatGptResult, actionsInText: boolean): string {
  const blocks: string[] = [];
  if (rendered.nextSteps) blocks.push(rendered.nextSteps);
  if (actionsInText && rendered.suggestedActions.length > 0) {
    blocks.push(
      [
        "Next:",
        ...rendered.suggestedActions.map((a) => `- ${a.description} (${a.id})`),
      ].join("\n"),
    );
  }
  return blocks.length > 0 ? blocks.join("\n\n") : "OK";
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
    path = "/mcp",
    metadata = true,
    instructionsSuffix = "",
    encodeVariables,
    actionsInText = true,
    widgets = {},
    enrichResponse,
    outputSchema,
    exposure,
  } = config;

  const resolved = resolveExposure(registry, exposure);

  const appInstructions = registry.instructions();
  const instructions =
    appInstructions === undefined
      ? undefined
      : appInstructions + instructionsSuffix;
  if (
    instructions !== undefined &&
    instructions.length > INSTRUCTIONS_WARN_LENGTH
  ) {
    console.warn(
      `[donghanh] MCP instructions are ${instructions.length} characters; clients may truncate above ${INSTRUCTIONS_WARN_LENGTH}.`,
    );
  }

  const app = new Hono();

  // RFC 9728 protected resource metadata
  if (metadata) {
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
  }

  // Stateless server: no SSE stream to open
  app.get(
    path,
    () => new Response(null, { status: 405, headers: { Allow: "POST" } }),
  );

  app.post(path, async (c) => {
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

    if (method.startsWith("notifications/")) {
      return new Response(null, { status: 202 });
    }

    switch (method) {
      case "initialize":
        return c.json(
          success(id, {
            protocolVersion: negotiateProtocolVersion(
              body.params?.protocolVersion,
            ),
            capabilities: {
              tools: {},
              ...(Object.keys(widgets).length > 0 && { resources: {} }),
            },
            serverInfo,
            ...(instructions !== undefined && { instructions }),
          }),
        );

      case "ping":
        return c.json(success(id, {}));

      case "resources/templates/list":
        return c.json(success(id, { resourceTemplates: [] }));

      case "prompts/list":
        return c.json(success(id, { prompts: [] }));

      case "tools/list": {
        const listed = registry
          .list()
          .filter(
            (op) =>
              resolved.placement.get(op.id) !== "catalog" ||
              resolved.appOnly.has(op.id),
          );
        const tools = listed.map((op) => {
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

          if (detail?.title) tool.title = detail.title;

          const responseKey = registry.get(op.id)?.operationConfig.responseKey;
          const wrapped =
            detail?.response && responseKey
              ? {
                  type: "object",
                  properties: {
                    [responseKey]: detail.response,
                    actions: { type: "array" },
                    display: {},
                  },
                  required: [responseKey],
                }
              : undefined;
          const out = outputSchema
            ? detail && outputSchema(detail, wrapped)
            : enrichResponse
              ? undefined
              : wrapped;
          if (out) tool.outputSchema = out;

          const meta: Record<string, unknown> = { ...detail?.meta };
          if (widget) {
            meta.ui = { resourceUri: widget.uri };
            meta["openai/outputTemplate"] = widget.uri;
          }
          if (resolved.pinned.has(op.id)) meta["anthropic/alwaysLoad"] = true;
          if (resolved.placement.get(op.id) === "catalog") {
            const ui = (meta.ui ?? {}) as Record<string, unknown>;
            meta.ui = { ...ui, visibility: ["app"] };
          }
          if (Object.keys(meta).length > 0) tool._meta = meta;

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
          return c.json(failure(id, -32601, `Unknown resource "${uri}"`));
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
          return c.json(failure(id, -32601, `Unknown tool "${toolName}"`));
        }

        const detail = registry.detail(toolName);
        if (
          resolved.placement.get(toolName) === "catalog" &&
          !resolved.appOnly.has(toolName) &&
          op.operationConfig.type === "mutation"
        ) {
          const runner = detail?.destructive ? "run_destructive" : "run_write";
          return c.json(
            failure(
              id,
              -32601,
              `Operation "${toolName}" is not a tool on this endpoint; call it with ${runner}`,
            ),
          );
        }
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

        const variables = params.arguments ?? {};
        try {
          const { data, brief } = await executeOperation({
            registry,
            operationId: toolName,
            variables,
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

          if (enrichResponse) {
            await enrichResponse(structured, {
              operationId: toolName,
              data,
              variables,
              userId,
              request: c.req.raw,
            });
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
              content: [
                { type: "text", text: toolText(rendered, actionsInText) },
              ],
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
        return c.json(failure(id, -32601, `Method not found: ${method}`));
    }
  });

  return app;
}
