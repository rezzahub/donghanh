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
- **trello** — 6 operations, boards/cards/members

## Initialize the database

```bash
bun run db:init
```

## Start dev server

```bash
bun run dev
```

Open `http://localhost:8787/api/operations` to see your operations.

## Try it

```bash
# List operations
curl localhost:8787/api/operations

# Get operation detail
curl localhost:8787/api/operations/list-items

# Execute a query
curl localhost:8787/api/query/list-items
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
