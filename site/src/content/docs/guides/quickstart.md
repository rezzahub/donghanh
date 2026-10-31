---
title: Quick Start
description: Create your first donghanh app in 2 minutes.
---

## Scaffold

```bash
bunx create-donghanh my-app
cd my-app
bun install
```

Choose a template:
- **minimal** — 2 operations, D1 SQLite
- **kanban-gpt** — 6 operations, boards/cards/members

## Initialize the database

```bash
bun run db:init
```

## Start dev server

```bash
bun run dev
```

Your operations are now available as MCP tools at `http://localhost:8787/mcp`. Before you deploy, set `resource` in `worker.ts` to your deployed URL, because MCP clients check it against the URL they connect to.

## Try it

```bash
# List operations
curl -X POST localhost:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Execute a query
curl -X POST localhost:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list-items","arguments":{}}}'
```

## What's inside

```
my-app/
├── operations/
│   ├── list-items.tsx    # Query operation
│   ├── add-item.tsx      # Mutation operation
│   └── index.ts          # Registry
├── executor.ts           # D1 SQLite queries
├── schema.sql            # Database schema
├── worker.ts             # Hono entry point
└── wrangler.toml         # Cloudflare config
```

## Next steps

- [Brief & Primitives](/concepts/primitives/) — understand `<Brief>`, `<Action>`, `<Display>`
- [Operations](/concepts/operations/) — how to write operations
- [Executor](/concepts/executor/) — connect to your data source
