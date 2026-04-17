# Apps SDK (MCP) Support

Track work to make donghanh a first-class ChatGPT Apps SDK target.

## Goal

Same operations + executor power three modes:

| Mode | Adapter | Protocol | UI |
|---|---|---|---|
| GPT Store | `@donghanh/hono` `gptRoutes` | REST (GPT Actions) | ChatGPT default |
| GPT Apps | `@donghanh/hono` `mcpRoutes` + `@donghanh/widget` | MCP over HTTP | iframe widget |
| React | `@donghanh/hono` `chatRoutes` + `@donghanh/react` | SSE chat | Self-hosted React |

## Architecture

```
packages/
  core/                @donghanh/core          primitives, registry, execute
  react/               @donghanh/react         chat UI
  hono/                @donghanh/hono          routes (gpt/chat/mcp)
  widget/              @donghanh/widget        iframe runtime (NEW)
  widget-vite/         @donghanh/widget-vite   Vite plugin (NEW)
  config/              @donghanh/config        defineConfig + loader (NEW)
  cli/                 @donghanh/cli           `donghanh` bin (NEW)
create-donghanh/                               bootstrapper
```

## Protocol flow (Apps SDK)

```
1. ChatGPT → POST /mcp initialize        caps: { tools, resources }
2. ChatGPT → POST /mcp tools/list        per-op tools w/ annotations + resourceUri
3. ChatGPT → POST /mcp resources/list    widget URIs
4. user prompt
5. ChatGPT → POST /mcp tools/call        { structuredContent, content, _meta }
6. ChatGPT → POST /mcp resources/read    widget HTML (text/html;profile=mcp-app)
7. iframe mounts, bridge init (postMessage JSON-RPC)
8. host → iframe: ui/notifications/tool-result
9. widget renders from structuredContent
10. widget → host: tools/call (user clicks Action)
```

## Data mapping (donghanh Brief → MCP)

| Brief node | MCP channel | Visible to |
|---|---|---|
| `Message` | `content: [{ type: "text" }]` | model |
| `Display` | `structuredContent.display` | widget + model |
| `Action` | `structuredContent.actions` | widget |
| `Form` | `structuredContent.form` | widget |
| `Context` | `_meta.donghanh.context` | widget only |

Always emit `structuredContent` (empty fields if node absent). Widget renders what's present.

## Auth (per MCP authorization spec)

- `GET /.well-known/oauth-protected-resource` — RFC 9728 metadata
- `POST /mcp initialize` — advertise capabilities
- `tools/call` with no token → return success result with:
  - `isError: true`
  - `_meta["mcp/www_authenticate"]: [Bearer resource_metadata="...", error="...", error_description="..."]`
- Per-tool `securitySchemes: [{ type: "oauth2" | "noauth", scopes? }]`
- Auth server: publishes `.well-known/oauth-authorization-server`, DCR, PKCE S256

Per-op auth control via `OperationConfig.auth: "none" | "optional" | "required"` (default `required`).

## Tool annotations (required per docs)

Derive from OperationConfig:
- `query` → `readOnlyHint: true`
- `mutation` → `readOnlyHint: false`, `openWorldHint: false` (bounded)
- New flag `destructive?: boolean` on OperationConfig → `destructiveHint`

## Widget registration

`@donghanh/widget-vite` plugin bundles multiple widgets → single HTML per entry with inline JS/CSS + content-hash URI:

```
ui://widget/boards-a1b2c3.html
```

Plugin emits manifest imported by server:

```ts
import { widgets } from "./dist/widgets.manifest.js";

mcpRoutes({ widgets, /* ... */ });
```

Per-op widget opt-in via `OperationConfig.widget?: string` (name matches manifest key).

## Config

`donghanh.config.ts` as single source of truth:

```ts
import { defineConfig } from "@donghanh/config";

export default defineConfig({
  operations: "./operations/**/*.tsx",
  widgets: {
    boards: "./widgets/boards.tsx",
  },
  server: {
    resource: "https://kanban.example.com",
    authorizationServers: ["https://auth.example.com"],
    widgetDomain: "https://kanban.example.com",
    csp: { /* ... */ },
  },
});
```

Consumed by: Vite plugin (entries), CLI (scaffold paths), server (mcpRoutes wiring).

## CLI

```
donghanh widget <name>       scaffold widget + patch config
donghanh operation <name>    scaffold op + patch config
donghanh dev                 vite dev + server watch
donghanh build               widgets → manifest → server bundle
```

## Phases

### Phase 1 — fix mcp.ts blockers
- [ ] Add tool annotations (derive from `query`/`mutation` + new `destructive?` flag)
- [ ] Per-op auth: `OperationConfig.auth` → per-tool `securitySchemes` + conditional authenticate
- [ ] Add `resources/list` handler
- [ ] Add `resources/read` handler
- [ ] Single `widget` config on `mcpRoutes` (name + html + domain + csp)
- [ ] Attach `_meta.ui.resourceUri` + `openai/outputTemplate` on tools
- [ ] `ExecutorContext.userId` → `string | null` (or sentinel for anon)
- [ ] Bump protocol version to `2026-01-26` (verify vs auth spec)
- [ ] Test w/ MCP Inspector
- [ ] Docs update in `site/src/content/docs/reference/hono.md`

### Phase 2 — widget runtime + Vite plugin
- [ ] `@donghanh/widget` package
  - bridge (postMessage JSON-RPC init + rpc helpers)
  - hooks: `useToolResult`, `useCallTool`, `useSendMessage`, `useUpdateModelContext`
  - renderers: `<Display>`, `<Action>`, `<Form>`
  - `<DongHanhWidget />` default composition
- [ ] `@donghanh/widget-vite` plugin
  - takes `entries: Record<name, path>`
  - bundles each with inline JS/CSS
  - content-hash URIs
  - emits manifest module
- [ ] mcpRoutes multi-widget support (`widgets: Record<name, config>`)
- [ ] `OperationConfig.widget?: string` reference by name

### Phase 3 — config + CLI
- [ ] `@donghanh/config` defineConfig + loadConfig
- [ ] `@donghanh/cli` scaffold commands
  - `donghanh widget <name>`
  - `donghanh operation <name>`
  - `donghanh dev`
  - `donghanh build`
- [ ] Vite plugin + CLI both read donghanh.config

### Phase 4 — template migration
- [ ] Update `kanban-gpt` template to use config + mcpRoutes + widget
- [ ] Add Apps SDK setup guide to site docs
- [ ] Bump `create-donghanh` version

## Open questions

- Streamable HTTP transport vs plain POST JSON-RPC — test w/ MCP Inspector
- `userId: string | null` breaking change vs sentinel — decide Phase 1
- Preact swap for smaller widget bundle — defer to Phase 2
- `ui/update-model-context` integration — Phase 2 hooks

## References

- [MCP Apps quickstart](https://developers.openai.com/apps-sdk/quickstart)
- [Build MCP server](https://developers.openai.com/apps-sdk/build/mcp-server)
- [Build ChatGPT UI](https://developers.openai.com/apps-sdk/build/chatgpt-ui)
- [Auth](https://developers.openai.com/apps-sdk/build/auth)
- [State](https://developers.openai.com/apps-sdk/build/managing-state)
- [Examples](https://github.com/openai/openai-apps-sdk-examples)
