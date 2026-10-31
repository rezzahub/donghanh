import type { Executor, OperationDetail, Registry } from "@donghanh/core";
import { executeOperation } from "@donghanh/core";
import { Hono } from "hono";
import {
  catalogTools,
  isMetaTool,
  RUN_CLASS,
  runToolFor,
  securitySchemesFor,
} from "./catalog";
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
 * actions as a `Next:` list (`- label (operation id)`, or `run_*` for catalog operations). Falls back to "OK".
 */
function toolText(
  rendered: ChatGptResult,
  actionsInText: boolean,
  runTool: (operationId: string) => string | undefined = () => undefined,
): string {
  const blocks: string[] = [];
  if (rendered.nextSteps) blocks.push(rendered.nextSteps);
  if (actionsInText && rendered.suggestedActions.length > 0) {
    blocks.push(
      [
        "Next:",
        ...rendered.suggestedActions.map((a) => {
          const vars = a.variables ? JSON.stringify(a.variables) : undefined;
          const run = runTool(a.id);
          if (run) {
            return `- ${a.description} (${run} id="${a.id}"${vars ? ` variables=${vars}` : ""})`;
          }
          return `- ${a.description} (${a.id}${vars ? ` ${vars}` : ""})`;
        }),
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
  const metaTools = catalogTools(registry, resolved, scopes);
  const metaNames = new Set(metaTools.map((t) => t.name));
  for (const name of metaNames) {
    if (registry.get(name)) {
      throw new Error(
        `Operation id "${name}" collides with the generated catalog meta-tool of the same name`,
      );
    }
  }

  const authFailure = () => {
    const challenge = wwwAuthenticate(
      resource,
      "insufficient_scope",
      "You need to login to continue",
    );
    return {
      body: {
        content: [{ type: "text", text: "Authentication required." }],
        isError: true,
        _meta: { "mcp/www_authenticate": [challenge] },
      },
      challenge,
    };
  };

  const errorResult = (text: string) => ({
    content: [{ type: "text", text }],
    isError: true,
  });

  /** Execute one operation exactly as a direct tool call does. */
  async function runOperation(
    request: Request,
    operationId: string,
    variables: Record<string, unknown>,
    intent?: string,
  ): Promise<{ body: Record<string, unknown>; challenge?: string }> {
    const op = registry.get(operationId);
    if (!op) return { body: errorResult(`Unknown operation "${operationId}"`) };
    const detail = registry.detail(operationId);
    const authMode = detail?.auth ?? "required";

    let userId: string | null = null;
    if (authMode !== "none") {
      const authResult = await authenticate(request);
      if ("error" in authResult) {
        if (authMode === "required") return authFailure();
        // optional: proceed anonymously
      } else {
        userId = authResult.userId;
      }
    }

    try {
      const { data, brief } = await executeOperation({
        registry,
        operationId,
        variables,
        executor,
        context: {
          userId,
          request,
          ...(intent !== undefined && { intent }),
        },
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
          operationId,
          data,
          variables,
          userId,
          request,
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

      return {
        body: {
          content: [
            {
              type: "text",
              text: toolText(rendered, actionsInText, (opId) => {
                if (
                  resolved.placement.get(opId) !== "catalog" ||
                  resolved.appOnly.has(opId)
                ) {
                  return undefined;
                }
                const d = registry.detail(opId);
                return d ? runToolFor(d) : undefined;
              }),
            },
          ],
          structuredContent: structured,
          ...(Object.keys(meta).length > 0 && { _meta: meta }),
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      return { body: errorResult(message) };
    }
  }

  const catalogIdSet = new Set(resolved.catalogIds());

  /** Resolve a meta-tool's target id to a catalog operation, or an error message. */
  function catalogTarget(id: unknown): { detail: OperationDetail } | string {
    if (typeof id !== "string" || !registry.get(id)) {
      return `Unknown operation "${String(id)}". Call find_operations to list available operations.`;
    }
    if (!catalogIdSet.has(id)) {
      return `"${id}" is a tool on this endpoint; call it directly.`;
    }
    const detail = registry.detail(id);
    if (!detail)
      return `Unknown operation "${id}". Call find_operations to list available operations.`;
    return { detail };
  }

  const metaResult = (value: unknown) => ({
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
  });

  async function callMetaTool(
    name: string,
    args: Record<string, unknown>,
    request: Request,
  ): Promise<{ body: Record<string, unknown>; challenge?: string }> {
    if (name === "find_operations") {
      const authResult = await authenticate(request);
      const anonymous = "error" in authResult;
      const tokens =
        typeof args.query === "string"
          ? args.query.toLowerCase().split(/\s+/).filter(Boolean)
          : [];
      const tags = Array.isArray(args.tags)
        ? args.tags.map((t) => String(t).toLowerCase())
        : [];
      const catalog = registry.list().filter((o) => catalogIdSet.has(o.id));
      const visible = catalog.filter(
        (o) => !anonymous || (o.auth ?? "required") !== "required",
      );
      if (anonymous && catalog.length > 0 && visible.length === 0) {
        return authFailure();
      }
      const operations = visible
        .filter((o) => {
          const own = (o.tags ?? []).map((t) => t.toLowerCase());
          if (tags.length > 0 && !tags.some((t) => own.includes(t)))
            return false;
          if (tokens.length === 0) return true;
          const fields = [o.id, o.title ?? "", o.description, ...own].map((f) =>
            f.toLowerCase(),
          );
          return tokens.some((tok) => fields.some((f) => f.includes(tok)));
        })
        .map((o) => ({
          id: o.id,
          ...(o.title !== undefined && { title: o.title }),
          description: o.description,
          type: o.type,
          ...(o.destructive !== undefined && { destructive: o.destructive }),
          ...(o.tags !== undefined && { tags: o.tags }),
        }));
      return {
        body: metaResult({
          operations,
          hint: "Call get_operation with an id before running it.",
        }),
      };
    }

    const target = catalogTarget(args.id);
    if (typeof target === "string") return { body: errorResult(target) };
    const { detail } = target;

    if (name === "get_operation") {
      const authResult = await authenticate(request);
      const anonymous = "error" in authResult;
      if (anonymous && (detail.auth ?? "required") === "required") {
        return authFailure();
      }
      const operations = registry
        .list()
        .filter((o) => catalogIdSet.has(o.id))
        .filter((o) => !anonymous || (o.auth ?? "required") !== "required");
      return { body: metaResult({ ...detail, operations }) };
    }

    const expected = runToolFor(detail);
    if (name !== expected) {
      return {
        body: errorResult(
          `"${detail.id}" is a ${RUN_CLASS[expected]}; use ${expected}.`,
        ),
      };
    }
    let intent: string | undefined;
    if (name !== "run_read") {
      intent = typeof args.intent === "string" ? args.intent.trim() : "";
      if (intent === "") {
        return {
          body: errorResult(
            "intent is required: one sentence saying what this call does for the user.",
          ),
        };
      }
    }
    const raw = args.variables;
    if (raw != null && (typeof raw !== "object" || Array.isArray(raw))) {
      return { body: errorResult("variables must be an object.") };
    }
    const variables = (raw ?? {}) as Record<string, unknown>;
    return runOperation(request, detail.id, variables, intent);
  }

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
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return c.json(failure(null, -32600, "Invalid Request"), 400);
    }

    const id = body.id ?? null;
    const method = body.method;

    if (body.jsonrpc !== "2.0" || typeof method !== "string" || !method) {
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
            inputSchema:
              detail?.input && "type" in detail.input
                ? detail.input
                : { type: "object", properties: {}, ...detail?.input },
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
            const ui = (meta.ui ?? {}) as Record<string, unknown>;
            meta.ui = { ...ui, resourceUri: widget.uri };
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
        return c.json(success(id, { tools: [...tools, ...metaTools] }));
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

        if (isMetaTool(toolName) && metaNames.has(toolName)) {
          const out = await callMetaTool(
            toolName,
            params.arguments ?? {},
            c.req.raw,
          );
          return c.json(
            success(id, out.body),
            out.challenge
              ? { headers: { "WWW-Authenticate": out.challenge } }
              : undefined,
          );
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

        const out = await runOperation(
          c.req.raw,
          toolName,
          params.arguments ?? {},
        );
        return c.json(
          success(id, out.body),
          out.challenge
            ? { headers: { "WWW-Authenticate": out.challenge } }
            : undefined,
        );
      }

      default:
        return c.json(failure(id, -32601, `Method not found: ${method}`));
    }
  });

  return app;
}
