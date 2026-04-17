---
name: donghanh
description: Build conversational apps with donghanh — JSX primitives, operations, executor, and adapters for GPT Store, ChatGPT Apps SDK (MCP), and self-hosted React chat. Use when the user wants to create operations, wire an adapter, build widgets, or scaffold a donghanh app.
---

# donghanh

donghanh is a framework for building conversational apps. Same operations power three modes:

| Mode | Adapter | Protocol | UI |
|---|---|---|---|
| GPT Store | `@donghanh/hono` `gptRoutes` | REST (GPT Actions) | ChatGPT default |
| GPT Apps | `@donghanh/hono` `mcpRoutes` + `@donghanh/widget` | MCP over HTTP | iframe widget |
| React | `@donghanh/hono` `chatRoutes` + `@donghanh/react` | SSE chat | self-hosted React |

## When to use

- User writes or modifies `registerOperation(...)`
- User wires `gptRoutes`, `chatRoutes`, or `mcpRoutes`
- User builds an Apps SDK widget (MCP iframe)
- User scaffolds via `create-donghanh` or the `donghanh` CLI
- User edits `donghanh.config.ts`
- User asks about protocol specifics (MCP, GPT Actions, Apps SDK)

## Core concepts

### Operations

Every op is a JSX component + config:

```tsx
/** @jsxImportSource @donghanh/core */
import { Brief, Display, Action, registerOperation } from "@donghanh/core";

function ListBoards({ data }: OperationProps<{ boards: Board[] }>) {
  return (
    <Brief>
      You have {data.boards.length} boards.
      <Display data={data.boards} />
      {data.boards.map(b => (
        <Action key={b.id} operation="board-detail" label={`View ${b.name}`} variables={{ boardId: b.id }} />
      ))}
    </Brief>
  );
}

export default registerOperation(ListBoards, {
  id: "list-boards",
  type: "query",          // or "mutation"
  description: "List all boards",
  instruction: "Call first to see boards.",
  input: {},              // JSON Schema
  responseKey: "listBoards",
  auth: "required",       // "none" | "optional" | "required"
  destructive: false,     // only for mutations
  widget: "boards",       // optional widget name
});
```

**Recommended: zod for input schemas.** donghanh accepts raw JSON Schema in `input`, but write schemas with zod and convert via `zod-to-json-schema` for type safety + runtime validation:

```ts
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const schema = z.object({ boardId: z.string() });

registerOperation<z.infer<typeof schema>>(BoardDetail, {
  id: "board-detail",
  input: zodToJsonSchema(schema),
  // validate in executor: schema.parse(variables)
});
```

Keeps core dep-free while giving user type inference + validation at boundaries.

### Executor

Runs the op, returns data. Same executor for all three modes.

```ts
export const executor: Executor = async (operationId, variables, context) => {
  switch (operationId) {
    case "list-boards": return queries.listBoards(context.userId);
    // ...
  }
};
```

### Primitives

| Node | Purpose | MCP channel |
|---|---|---|
| `Message` / string | model narration | `content[]` |
| `Display` | visual data | `structuredContent.display` |
| `Action` | button (calls op) | `structuredContent.actions` |
| `Form` | input fields | `structuredContent.form` |
| `Context` | widget-only hidden | `_meta.donghanh.context` |

## Project layout (convention)

```
my-app/
  donghanh.config.ts
  operations/
    list-boards.tsx
  widgets/
    boards.tsx
  server/
    worker.ts
    executor.ts
```

`donghanh.config.ts` = single source of truth:

```ts
import { defineConfig } from "@donghanh/config";

export default defineConfig({
  operations: "./operations/**/*.tsx",
  widgets: { boards: "./widgets/boards.tsx" },
  server: {
    resource: "https://kanban.example.com",
    authorizationServers: ["https://auth.example.com"],
    widgetDomain: "https://kanban.example.com",
    csp: { connectDomains: ["https://api.kanban.example.com"] },
  },
});
```

## Adapters

### GPT Store — `gptRoutes`

Exposes `GET /operations`, `GET /query/:op`, `POST /mutate/:op`. ChatGPT treats as GPT Actions via OpenAPI. No UI control.

```ts
app.route("/api", gptRoutes({ registry, executor, authenticate, ... }));
```

**Per-op auth is URL-based, not declarative.** `gptRoutes` runs `authenticate` before every op. For public ops (e.g. `start`, `search`, preview), your `authenticate` hook must inspect the URL and return a sentinel userId instead of failing:

```ts
const PUBLIC_OPS = new Set(["start", "check-offer"]);
const authenticate: Authenticate = async (request) => {
  const opId = new URL(request.url).pathname.match(/\/(query|mutate)\/([^/?]+)/)?.[2];
  const isPublic = opId ? PUBLIC_OPS.has(opId) : false;
  const session = await resolveSessionFromRequest(request);
  if (!session) {
    if (isPublic) return { userId: "anonymous" };
    return { error: new Response("Unauthorized", { status: 401 }) };
  }
  return { userId: session.user.id };
};
```

The executor should also short-circuit auth-gated GraphQL queries for guest callers to avoid hitting `requireAuth` in resolvers.

**Better Auth gotcha.** ChatGPT sends the session as `Authorization: Bearer <token>`, not as a cookie. `auth.api.getSession({ headers })` only parses cookies. Use `internalAdapter.findSession(token)` instead:

```ts
const ctx = await auth.$context;
const session = await ctx.internalAdapter.findSession(token).catch(() => null);
```

### GPT Apps — `mcpRoutes`

Exposes `/mcp` JSON-RPC + `/.well-known/oauth-protected-resource`. Per-op tools with annotations + `securitySchemes`. Widget in iframe via MCP resources.

```ts
app.route("/", mcpRoutes({
  registry, executor, authenticate,
  resource: "https://kanban.example.com",
  authorizationServers: ["https://auth.example.com"],
  widgets,           // from widget-vite manifest
}));
```

Auth: per-tool via `OperationConfig.auth`. Unauth + required → return success result with `isError: true` + `_meta["mcp/www_authenticate"]` to trigger OAuth UI.

Tool annotations required: `readOnlyHint`, `openWorldHint`, `destructiveHint`.

### React — `chatRoutes` + `@donghanh/react`

Self-hosted LLM chat. You bring the model (OpenRouter key). React provider streams SSE.

```tsx
<DongHanhProvider config={{ endpoint: "/api/chat", getAuthToken }}>
  <YourChatUI />
</DongHanhProvider>
```

## Apps SDK widget

Widget = iframe inside ChatGPT. Receives `structuredContent` via `ui/notifications/tool-result` postMessage. Calls back via `tools/call`.

Build with `@donghanh/widget` (runtime) + `@donghanh/widget-vite` (plugin):

```tsx
// widgets/boards.tsx
import { createRoot } from "react-dom/client";
import { DongHanhWidget } from "@donghanh/widget";
createRoot(document.getElementById("root")!).render(<DongHanhWidget />);
```

```ts
// vite.config.ts
import { donghanhWidgets } from "@donghanh/widget-vite";
export default { plugins: [donghanhWidgets()] };
```

Plugin: bundles each widget w/ inline JS/CSS, content-hash URI (`ui://widget/boards-a1b2c3.html`), emits manifest module imported by server.

Per-op widget via `OperationConfig.widget: "boards"`.

## CLI (`@donghanh/cli`)

```
donghanh widget <name>       scaffold widget + patch config
donghanh operation <name>    scaffold op + patch config
donghanh dev                 vite dev + server watch
donghanh build               widgets → manifest → server bundle
```

## Key rules

- **Data-only ops**: don't set `widget`. Model reads `structuredContent`, no iframe.
- **Visual ops**: set `widget` name. Widget renders `display`/`actions`/`form`.
- **Mutations**: always set `destructive` accurately (`true` for delete/overwrite).
- **Auth**: default `required`. Set `"none"` only for genuinely public ops.
- **URI versioning**: widget URIs include content hash → cache-bust on change.
- **Iframe stability**: same URI across tool calls = no remount.
- **structuredContent = authoritative**: always return updated snapshot on mutations so widget re-renders from truth.
- **_meta is widget-only**: never visible to model. Don't put narration there.

## Protocol references

- [Apps SDK quickstart](https://developers.openai.com/apps-sdk/quickstart)
- [Build MCP server](https://developers.openai.com/apps-sdk/build/mcp-server)
- [Build ChatGPT UI](https://developers.openai.com/apps-sdk/build/chatgpt-ui)
- [Auth](https://developers.openai.com/apps-sdk/build/auth) (MCP OAuth 2.1 + RFC 9728)
- [State management](https://developers.openai.com/apps-sdk/build/managing-state)

## Common pitfalls

- Missing tool annotations → docs treat as validation error
- `_meta.ui.resourceUri` on tool without registering the resource → widget never loads
- Wrong MIME type (`text/html;profile=mcp-app` required) → no `ui/*` bridge
- Returning 401 instead of success + `_meta["mcp/www_authenticate"]` → OAuth UI never appears
- Mutating `structuredContent` shape across calls → widget can't diff reliably
- Using `localStorage` for widget state → gets cleared; use `window.openai.setWidgetState` or `ui/update-model-context`
