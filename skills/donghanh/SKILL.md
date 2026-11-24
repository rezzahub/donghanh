---
name: donghanh
description: Build conversational apps with donghanh, where every operation returns a <Brief>, the agent's HUD — a screen with where the agent is, what is here and Actions for where it can go next, like screen navigation in a mobile app. JSX primitives, operations, executor, and adapters for ChatGPT Apps SDK (MCP), self-hosted React chat, and GPT Store (deprecated). Use when the user wants to create operations, wire an adapter, build widgets, scaffold a donghanh app, or expose skills or files to the agent (skillOperations, fileOperations).
---

# donghanh

donghanh is a framework for building conversational apps. Each operation returns a `<Brief>`: the agent's HUD, a screen the agent reads and navigates from. Read *Think in screens* before writing an operation.

## Think in screens

The `<Brief>` is the agent's HUD. Design each operation's response the way you design a screen in a mobile app. A user on a screen sees where they are, what is on it, and the buttons that lead on. An agent should get the same from every Brief:

| A screen has | In the Brief | What the agent gets under `mcpRoutes` |
|---|---|---|
| A title bar: where am I | The first `<Message>` names the thing and its parent | Tool result text |
| Content: what is here | A short `<Message>` summary; `<Display>` for the data | Text; `structuredContent.display` |
| Buttons: where can I go | 2–5 `<Action>`s with ids filled in | The `Next:` list, variables included |

The agent moves through your app by following Actions, the way a user taps buttons. It should never have to guess an id or which tool comes next.

- **Say where the agent is first.** Name the item and its parent ("Board *Q3 launch* in workspace *Acme*: 12 cards").
- **Summarize, don't dump.** The Message says what matters on this screen; `<Display>` carries the rows.
- **End with the next moves.** Fill `variables` with the ids from this screen, and include the way up or back when there is one.
- **Offer the few moves that make sense here**, not every operation in the app.
- **Errors are screens too.** Say what went wrong and offer the Action that fixes it.
- **Put what the agent must read in a Message, and know your client.** Under `mcpRoutes` a result has two parts: the tool text (Messages, then the `Next:` list) and `structuredContent` (`actions`, `display`). Clients choose which one the model sees: Claude Code shows `structuredContent` whenever it is present, so the Messages never reach the model there. `<Context>` goes to `_meta`, which models usually don't see. For an agent that reads text, leave `structuredContent` out of replies that have no widget (see [What the agent reads](https://donghanh.dev/concepts/primitives/#what-the-agent-reads)).

```tsx
// Not a screen: no location, no next step
<Brief>{JSON.stringify(board)}</Brief>

// A screen (data: { ws, board, overdue })
<Brief>
  <Message>{`Board "${board.name}" in workspace "${ws.name}": ${board.cards.length} cards, ${overdue.length} overdue.`}</Message>
  <Display data={board.cards} />
  {overdue[0] && (
    <Action operation="card-detail" label="Open the first overdue card" variables={{ cardId: overdue[0].id }} />
  )}
  <Action operation="add-card" label="Add a card" variables={{ boardId: board.id }} />
  <Action operation="list-boards" label="Back to the workspace's boards" variables={{ workspaceId: ws.id }} />
</Brief>
```

Messages in one Brief are joined into one paragraph in the MCP text. Put line breaks inside a single Message when the layout matters.

## Modes

The same operations power three modes:

| Mode | Adapter | Protocol | UI |
|---|---|---|---|
| GPT Store (deprecated) | `@donghanh/hono` `gptRoutes` | REST (GPT Actions) | ChatGPT default |
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
      {`You have ${data.boards.length} boards.`}
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
| `Message` / string | where the agent is, what is here | `content[]` text |
| `Display` | visual data | `structuredContent.display` |
| `Action` | button (calls op) | `Next:` list in `content[]` text; `structuredContent.actions` |
| `Form` | input fields | operation detail, not in responses |
| `Context` | widget-only hidden | `_meta["donghanh/context"]` |

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

> **Deprecated:** GPT Store support is deprecated. Use Apps SDK (`mcpRoutes`) for new projects. `gptRoutes` keeps working.

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
donghanh widget <name>                scaffold widgets/<name>.tsx + patch donghanh.config.ts
donghanh operation <name> [--mutation]  scaffold operations/<name>.tsx (query by default)
donghanh help
```

- Kebab-case names → PascalCase component + camelCase `responseKey`
- Existing files are not overwritten (`• exists` instead of `✓ wrote`)
- If config can't be patched, CLI prints a snippet to paste
- User must still register the op in `operations/index.ts` manually

## Key rules

- **Data-only ops**: don't set `widget`. Model reads `structuredContent`, no iframe.
- **Visual ops**: set `widget` name. Widget renders `display`/`actions`/`form`.
- **Mutations**: always set `destructive` accurately (`true` for delete/overwrite).
- **Auth**: default `required`. Set `"none"` only for genuinely public ops.
- **URI versioning**: widget URIs include content hash → cache-bust on change.
- **Iframe stability**: same URI across tool calls = no remount.
- **structuredContent = authoritative**: always return updated snapshot on mutations so widget re-renders from truth.
- **_meta is widget-only**: never visible to model. Don't put narration there.

## Files and skills

Add `fileOperations` (`@donghanh/core/files`) when the agent must list, read in pages or grep files: docs, transcripts, or the folders skills bring with them. `skillOperations({ providers, files })` takes the file providers, and `use_skill` then returns the skill's manifest, the files its `metadata.include` names, and a table of resolved links.

```ts
const files = fileOperations({ providers: [docs] }); // same prefix as skillOperations
App({ operations: { ...ops, ...skills.operations, ...files.operations }, instructions });
mcpRoutes({
  registry,
  executor: files.wrap(skills.wrap(executor)),
  instructionsSuffix: files.instructions, // starts with a blank line; appended only when the app has instructions
  /* ... */
});
```

With a suffix of your own, pass `` `${mine}${files.instructions}` ``. A host that wraps the engine in its own operations (`readFile`, `listFiles`, `grepFiles`) includes `FILES_INSTRUCTIONS` (or `filesInstructions(prefix)`) in its own `instructions`, with its own separator. A `FileProvider` returns `null` for both "missing" and "not allowed". For the contract, the caps and the implementer rules see `docs/features/files.md`; skill authors want the guide `donghanh.dev/guides/skills-and-files`.

## References

Up-to-date API docs for every package:

- [donghanh.dev](https://donghanh.dev) — full framework docs
- [donghanh.dev/reference/core](https://donghanh.dev/reference/core) — `@donghanh/core` primitives, registry, executor
- [donghanh.dev/reference/hono](https://donghanh.dev/reference/hono) — `gptRoutes`, `mcpRoutes`, `chatRoutes`
- [donghanh.dev/reference/widget](https://donghanh.dev/reference/widget) — widget runtime
- [donghanh.dev/reference/widget-vite](https://donghanh.dev/reference/widget-vite) — Vite plugin
- [donghanh.dev/reference/config](https://donghanh.dev/reference/config) — `defineConfig`
- [donghanh.dev/reference/cli](https://donghanh.dev/reference/cli) — `donghanh` CLI
- [donghanh.dev/reference/react](https://donghanh.dev/reference/react) — React hooks

Prefer these over re-deriving from this skill — the site is generated from the current code.

Apps SDK protocol docs:

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
- Returning a whole large file from an operation (a transcript, a doc) → fills the agent's context; page it and cap it, or use the file tools (`read_file`, `grep_files`)
- `fileOperations` with a different `prefix` than `skillOperations` → the `use_skill` footer names tools that do not exist
- Flat top-level `include:` in a SKILL.md → ignored; `include` goes in the nested `metadata:` block
