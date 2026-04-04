---
title: Introduction
description: What is @donghanh and why does it exist.
---

**@donghanh** is a framework for building conversational interfaces with JSX.

You write operations as components. Each returns a `<Brief>` — the agent's HUD. The framework renders it differently per target:

| Target | What the agent sees |
|--------|-------------------|
| **ChatGPT GPT Store** | JSON: `nextSteps`, `suggestedActions`, `display` |
| **LLM chat (in-app)** | Tool result text + action metadata |

## Key ideas

- **Operations are components** — one `.tsx` file per operation, metadata via `registerOperation()`
- **Brief is the agent's HUD** — not shown to users. Instructions, actions, display data.
- **Executor is injected** — framework doesn't care about your data source (D1, Turso, REST, etc.)
- **Hono for routing** — runs on Cloudflare Workers, Bun, Deno, Node, Next.js

## Architecture

```
your-app/
├── operations/          # One .tsx per operation
│   ├── list-items.tsx   # Returns <Brief>
│   └── index.ts         # Registry (as const)
├── executor.ts          # Maps operation IDs → data
└── worker.ts            # Hono entry
```
