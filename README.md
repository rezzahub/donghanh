# @donghanh

Conversational UI framework. Build agent interfaces with JSX.

Operations declare what the agent sees with `<Brief>` — the framework renders it differently per target (ChatGPT GPT Store, LLM tool results, in-app chat).

## Quick Start

```bash
bunx create-donghanh my-app
cd my-app
bun install
bun run dev
```

## How It Works

```tsx
/** @jsxImportSource @donghanh/core */
import { Action, Brief, Display, registerOperation } from "@donghanh/core";

function ListItems({ data }) {
  return (
    <Brief>
      You have {data.items.length} items.
      <Display data={data.items} />
      <Action operation="add-item" label="Add an item" />
    </Brief>
  );
}

export default registerOperation(ListItems, {
  id: "list-items",
  type: "query",
  description: "List all items",
  instruction: "Call this to see all items.",
  input: {},
  responseKey: "listItems",
  auth: "required",    // "none" | "optional" | "required"
  widget: "items",     // optional — binds to an Apps SDK widget
});
```

The `<Brief>` is the agent's HUD — not shown to users. The framework renders it differently per target:

| Target | Adapter | `<Message>` | `<Action>` | `<Display>` |
|--------|---------|------------|-----------|------------|
| **ChatGPT GPT Store** | `gptRoutes` | `nextSteps` | `suggestedActions[]` | `display` field |
| **ChatGPT Apps SDK (MCP)** | `mcpRoutes` + `@donghanh/widget` | `content[]` text | `structuredContent.actions` → iframe buttons | `structuredContent.display` → iframe |
| **Self-hosted React chat** | `chatRoutes` + `@donghanh/react` | tool-result text | action metadata | formatted text |

## Packages

| Package | Description |
|---------|-------------|
| `@donghanh/core` | Custom JSX runtime, primitives, registry, executor |
| `@donghanh/hono` | Hono routes: `gptRoutes` (GPT Store), `mcpRoutes` (Apps SDK), `chatRoutes` (LLM chat) |
| `@donghanh/react` | Headless React hooks for self-hosted chat (useChat, useInitOperation) |
| `@donghanh/widget` | Iframe runtime for Apps SDK widgets — MCP bridge, hooks, renderers |
| `@donghanh/widget-vite` | Vite plugin that bundles widgets into inline HTML + manifest for `mcpRoutes` |
| `create-donghanh` | CLI scaffolding tool |

## Templates

```bash
bunx create-donghanh my-app --template minimal     # 2 operations, D1 SQLite
bunx create-donghanh my-app --template kanban-gpt  # 6 operations, OAuth, Better Auth
```

## Architecture

```
your-app/
├── operations/          # One .tsx file per operation
│   ├── list-items.tsx   # Returns <Brief> with actions + display
│   └── index.ts         # Registry (as const)
├── executor.ts          # Maps operation IDs → data fetching
└── worker.ts            # Hono entry, mounts routes
```

**Executor is injected** — the framework doesn't care about your data source. Use D1 SQLite, Turso, Postgres, REST APIs, or anything else.

**Operations are components** — each `.tsx` file receives `{ data, variables }` and returns a `<Brief>`. Metadata is attached via `registerOperation()`.

## Reference

[Tán Đồng](https://github.com/vuadu/splitbee) — bill-splitting app built with @donghanh. 14 operations, GPT Store integration, in-app chat assistant.

## License

MIT
