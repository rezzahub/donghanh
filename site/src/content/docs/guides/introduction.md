---
title: Introduction
description: What is @donghanh and why does it exist.
---

**@donghanh** is a framework for building conversational interfaces with JSX.

You write operations as components. Each returns a `<Brief>`: the agent's HUD. A Brief is a screen for the agent, the way an app screen is for a user: where it is, what is here, and where it can go next.

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
- **Put what the agent must read in a Message.** Under `mcpRoutes` the model reads the tool text: Messages, then the `Next:` list. `<Display>` goes to `structuredContent` (the widget, and clients that pass it on) and `<Context>` goes to `_meta`, which models usually don't see.

```tsx
// Not a screen: no location, no next step
<Brief>{JSON.stringify(board)}</Brief>

// A screen
<Brief>
  <Message>{`Board "${board.name}" in workspace "${ws.name}": ${board.cards.length} cards, ${overdue} overdue.`}</Message>
  <Display data={board.cards} />
  <Action operation="card-detail" label="Open the first overdue card" variables={{ cardId: firstOverdue.id }} />
  <Action operation="add-card" label="Add a card" variables={{ boardId: board.id }} />
  <Action operation="list-boards" label="Back to the workspace's boards" variables={{ workspaceId: ws.id }} />
</Brief>
```

Messages in one Brief are joined into one paragraph in the MCP text. Put line breaks inside a single Message when the layout matters.

## Targets

The framework renders the same Brief differently per target:

| Target | Adapter | What the agent sees |
|--------|---------|-------------------|
| **GPT Store (Custom GPTs)** (deprecated) | `gptRoutes` | REST JSON: `nextSteps`, `suggestedActions`, `display` |
| **Apps SDK (MCP)** | `mcpRoutes` | MCP tools + widget iframe (`structuredContent`, `_meta.ui`) |
| **Self-hosted React chat** | `chatRoutes` | Tool result text + action metadata streamed over SSE |

## Key ideas

- **Operations are components** — one `.tsx` file per operation, metadata via `registerOperation()`
- **Brief is the agent's HUD** — a screen for the agent, not shown to users: where it is, what is here, and Actions for where it can go next.
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
