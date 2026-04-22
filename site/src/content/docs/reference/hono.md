---
title: "@donghanh/hono"
description: Hono routes for GPT Store and LLM chat.
---

## GPT Store Routes

```ts
import { gptRoutes } from "@donghanh/hono";
```

### `gptRoutes(config)`

Returns a Hono app with routes:

| Route | Method | Description |
|-------|--------|-------------|
| `/operations` | GET | List all operations (each includes `auth` when set) |
| `/operations/:name` | GET | Operation detail (instruction, input schema, auth) |
| `/query/:operation` | GET | Execute a query operation — honors `OperationConfig.auth` |
| `/mutate/:operation` | POST | Execute a mutation — honors `OperationConfig.auth` |
| `/public/query/:operation` | GET | Public query — 404 if op's `auth === "required"` |
| `/public/mutate/:operation` | POST | Public mutation — 404 if op's `auth === "required"` |

**Config:**
- `registry: Registry` — from `buildRegistry()`
- `executor: Executor` — data fetching function
- `authenticate: Authenticate` — returns `{ userId }` or error
- `includeOperationsInDetail?: boolean` — when true, `GET /operations/:name` includes a siblings list (`operations: CompactOperation[]`) in its response. Each entry includes `id`, `type`, `description`, and `auth` (when set). Default `false`.

**Per-op `auth` behavior** (derived from `OperationConfig.auth`, default `"required"`):

| `auth` | Default path (`/query` / `/mutate`) | Public path (`/public/...`) |
|---|---|---|
| `"required"` | 401 on missing/invalid token | 404 (not exposed) |
| `"optional"` | Calls `authenticate`; on error → `userId: "anonymous"`; on success → real `userId` | Same lenient behavior |
| `"none"` | `authenticate` is **not called**; `userId: "anonymous"` even if a token is present | 200 anonymous |

**Why `/public`?** ChatGPT Actions use OpenAPI security schemes that are per-path, not per-operation. The `/public` sub-path gives OAS-driven clients an unambiguous no-auth surface — they can point an Action at `/public/query/check-offer` without triggering an OAuth prompt, while `/query/check-offer` continues to work for first-party callers.

The compact listing (`GET /operations`) advertises each op's `auth` field so clients can route requests to the right path:

```ts
{ id: "start",       type: "query", description: "...", auth: "optional" }
{ id: "check-offer", type: "query", description: "...", auth: "none" }
{ id: "my-balance",  type: "query", description: "..." }   // auth omitted = "required"
```

### OpenAPI generation

```ts
import { generateOpenApi } from "@donghanh/hono";

const spec = generateOpenApi({
  registry,
  info: { title: "My API", version: "1.0.0" },
  servers: [{ url: "https://api.example.com" }],
  basePath: "/api/gpt",
  // bearerSchemeName: "bearerAuth",   // default
});

// Serve it from your worker:
app.get("/openapi.json", (c) => c.json(spec));
```

Derives one OpenAPI 3.1 `paths` entry per operation from the registry, honoring the same auth rules as `gptRoutes`:

| Op's `auth` | Emitted path(s) |
|---|---|
| `"required"` (default) | `${basePath}/query/{op}` (or `/mutate/{op}`) with `security: [{ bearerAuth: [] }]` |
| `"optional"` | Both the authed default path AND `${basePath}/public/...` with `security: []` |
| `"none"` | Only `${basePath}/public/...` with `security: []` |

ChatGPT Actions upload this spec. The `/public` entries are callable without an OAuth prompt; the default entries drive the linked-user flow.

**Config:**
- `registry: Registry`
- `info: { title, description?, version }`
- `servers: { url, description? }[]`
- `basePath?: string` — matches the prefix you mounted `gptRoutes` at, e.g. `"/api/gpt"`
- `bearerSchemeName?: string` — defaults to `"bearerAuth"`
- `includeDiscoveryEndpoints?: boolean` — default `true`. Emits `GET /operations` (`listOperations`) and `GET /operations/{name}` (`getOperationDetail`) paths so ChatGPT Actions can discover the registry and fetch per-op schemas. Set `false` to omit them.
- `securityScheme?: object` — full OAS security scheme object placed under `components.securitySchemes[bearerSchemeName]`. Defaults to `{ type: "http", scheme: "bearer" }`. Pass an `oauth2` flow object to match ChatGPT Custom GPT OAuth requirements.
- `pathStyle?: "parametric" | "per-op"` — default `"parametric"`. Parametric collapses all ops under `/query/{operation}` + `/mutate/{operation}` with an enum on the `operation` path parameter — 2–4 paths total regardless of registry size. `"per-op"` emits one path per operation for richer ChatGPT Action discovery.
- `includeDescription?: boolean` — default `false`. When off, only `summary` is emitted per path, keeping the spec compact and safely under ChatGPT Actions' 300-char description limit. Opt in when you want longer Action instructions in the OAS. (For listing sibling operations, use `includeOperationsInDetail` on `gptRoutes` instead — the GPT fetches `GET /operations/:name` to learn other available ops.)
- `maxDescriptionLength?: number` — descriptions longer than this are truncated with an ellipsis. No effect when `includeDescription` is off. Defaults to `300`; summaries are always capped at 120 regardless.

## MCP Routes

```ts
import { mcpRoutes } from "@donghanh/hono";
```

### `mcpRoutes(config)`

Returns a Hono app with MCP (Model Context Protocol) endpoints that expose registered operations as Apps SDK tools, per the [MCP authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization).

| Route | Method | Description |
|-------|--------|-------------|
| `/.well-known/oauth-protected-resource` | GET | RFC 9728 protected resource metadata |
| `/mcp` | POST | JSON-RPC: `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read` |

**Config:**
- `registry: Registry`
- `executor: Executor`
- `authenticate: Authenticate`
- `resource: string` — canonical HTTPS identifier for this MCP server
- `authorizationServers: string[]` — issuer base URLs for your OAuth provider
- `scopes?: string[]` — default advertised scopes
- `resourceDocumentation?: string`
- `serverInfo?: { name: string; version: string }`
- `encodeVariables?: (vars) => string` — shared with `gptRoutes`
- `widgets?: Record<string, WidgetConfig>` — named widget iframes

**WidgetConfig:** `{ uri, html, domain?, csp?, prefersBorder? }` — `uri` is the stable MCP resource URI (content-hashed for cache-bust), `html` is the full iframe document served with MIME `text/html;profile=mcp-app`.

**Auth flow (per-tool):** each operation's `securitySchemes` is derived from `OperationConfig.auth` (default `"required"`):
- `"none"` → `[{ type: "noauth" }]`
- `"optional"` → `[{ type: "noauth" }, { type: "oauth2", scopes }]`
- `"required"` → `[{ type: "oauth2", scopes }]`

When an auth-required tool runs without a valid token, the response is `{ isError: true, _meta: { "mcp/www_authenticate": [challenge] } }` which triggers ChatGPT's OAuth UI. Your authorization server must publish `/.well-known/oauth-authorization-server`, support DCR, and advertise PKCE `S256`.

**Tool annotations:** derived from `OperationConfig`:
- `query` → `readOnlyHint: true`
- `mutation` → `readOnlyHint: false`, `destructiveHint` from `config.destructive`, `openWorldHint` from `config.external`

**Widget binding:** set `OperationConfig.widget: "name"` to attach a widget. The tool descriptor gets `_meta.ui.resourceUri` + `_meta["openai/outputTemplate"]`. Ops without `widget` are data-only (no iframe).

**Tool result:** `{ content: [{ type: "text", text }], structuredContent: { [responseKey]: data, display?, actions? }, _meta?: { ui?, donghanh/context?, openai/outputTemplate? } }`.

## Chat Routes

```ts
import { chatRoutes } from "@donghanh/hono";
```

### `chatRoutes(config)`

Returns a Hono app with SSE streaming chat endpoint.

| Route | Method | Description |
|-------|--------|-------------|
| `/` | POST | LLM chat with tool use loop |

**Config:**
- `registry: Registry`
- `executor: Executor`
- `authenticate: Authenticate`
- `apiKey?: string` — LLM API key (e.g. OpenRouter)
- `model?: string` — LLM model (default: `google/gemini-2.5-flash`)
- `baseUrl?: string` — LLM API base URL (default: OpenRouter)
- `systemPrompt?: string` — system prompt for the LLM
- `enrichData?: (data, context) => Promise<void>` — mutate data before rendering

**SSE Events:**
- `text` — streamed content chunks
- `actions` — JSON array of suggested actions
- `done` — signal completion

## Renderers

```ts
import { renderForChatGpt, renderForLlm } from "@donghanh/hono";
```

### `renderForChatGpt(brief, opts?)`
Returns `ChatGptResult`: `{ nextSteps?, suggestedActions, display?, context? }`

### `renderForLlm(brief)`
Returns `LlmResult`: `{ text, actions, context? }`

## Middleware

```ts
import type { Authenticate } from "@donghanh/hono";
```

### `Authenticate`
```ts
type Authenticate = (request: Request) => Promise<{ userId: string } | { error: Response }>;
```

`ExecutorContext.userId` is `string | null` — null when the operation's `auth` is `"none"` or `"optional"` and no token was presented. Guard accordingly in executors.
