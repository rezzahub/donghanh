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
| `/operations` | GET | List all operations |
| `/operations/:name` | GET | Operation detail (instruction, input schema) |
| `/query/:operation` | GET | Execute a query operation |
| `/mutate/:operation` | POST | Execute a mutation operation |

**Config:**
- `registry: Registry` — from `buildRegistry()`
- `executor: Executor` — data fetching function
- `authenticate: Authenticate` — returns `{ userId }` or error

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
