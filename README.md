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
});
```

The `<Brief>` is the agent's HUD — not shown to users. The framework renders it differently per target:

| Target | `<Message>` | `<Action>` | `<Display>` |
|--------|------------|-----------|------------|
| **ChatGPT** | `nextSteps` string | `suggestedActions[]` | `display` field |
| **LLM chat** | Tool result text | Action metadata for buttons | Formatted text |

## Packages

| Package | Description |
|---------|-------------|
| `@donghanh/core` | Custom JSX runtime, primitives, registry, executor |
| `@donghanh/hono` | Hono routes for GPT Store + LLM chat |
| `@donghanh/react` | Headless React hooks (useChat, useInitOperation) |
| `create-donghanh` | CLI scaffolding tool |

## Templates

```bash
bunx create-donghanh my-app --template minimal   # 2 operations, D1 SQLite
bunx create-donghanh my-app --template trello     # 6 operations, boards/cards/members
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
