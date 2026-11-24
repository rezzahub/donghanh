# @donghanh — Conversational UI Framework

Build conversational interfaces with JSX. Operations return a `<Brief>` — the agent's HUD — and the framework renders it differently per target (ChatGPT JSON, LLM tool results, in-app chat).

## Think in screens (read first)

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

## Usage

- "Create a donghanh app" — scaffold a new project
- "Add an operation" — create a new operation component
- "List operations" — show available operations

## Instructions

### Scaffolding a new project

Run `bunx create-donghanh my-app` or scaffold manually:

1. Create `operations/` directory with `.tsx` files
2. Each operation uses `/** @jsxImportSource @donghanh/core */` and returns `<Brief>`
3. Register operations in `operations/index.ts` using `as const`
4. Create an executor that maps operation IDs to data fetching
5. Mount with `mcpRoutes()` from `@donghanh/hono`

### Creating an operation

```tsx
/** @jsxImportSource @donghanh/core */
import { Action, Brief, Display, registerOperation } from "@donghanh/core";
import type { OperationProps } from "@donghanh/core";

function MyOperation({ data, variables }: OperationProps<MyData>) {
  return (
    <Brief>
      Result message for the agent.
      <Display data={data} />
      <Action operation="next-op" label="Do next thing" variables={{ id: data.id }} />
    </Brief>
  );
}

export default registerOperation(MyOperation, {
  id: "my-operation",
  type: "query",           // or "mutation"
  description: "Short description for agent",
  instruction: "Detailed guidance for when/how to use this operation.",
  input: {                 // JSON Schema for variables
    type: "object",
    properties: { id: { type: "string" } },
  },
  responseKey: "myOperation",
});
```

### Primitives

| Primitive | Purpose |
|-----------|---------|
| `<Brief>` | Root container — the agent's HUD (not shown to users) |
| `<Message>` | Text content for the agent |
| `<Action>` | A button: a next operation with its ids filled in |
| `<Display>` | Formatted data |
| `<Context>` | Metadata for the host (`_meta` under MCP; models usually don't read it) |
| `<Form>` | Input schema (for operation detail) |

### Key files

| File | Purpose |
|------|---------|
| `operations/*.tsx` | One component per operation |
| `operations/index.ts` | Registry (`as const`) |
| `executor.ts` | Maps operation IDs to data fetching |
| `worker.ts` | Hono entry, mounts routes |

### Files for the agent

Add `fileOperations` from `@donghanh/core/files` when the agent must browse, read in pieces or grep files: docs, transcripts, or the folders skills bring with them (`skillOperations` takes `files: [provider]` and `use_skill` then returns a manifest, included files and resolved links). Wire it:

- Spread `files.operations` into `App`, wrap the executor with `files.wrap(...)` (compose with `skills.wrap`), and pass `instructionsSuffix: files.instructions` to `mcpRoutes` (appended only when the app has `instructions`; it starts with a blank line, so with your own suffix pass `` `${mine}${files.instructions}` ``).
- Give `fileOperations` the same `prefix` as `skillOperations`; the `use_skill` footer, the file tool instructions and their errors name `<prefix>read_file` and `<prefix>list_files`.
- A provider returns `null` for a file that is missing and for one the caller may not read. Reads are paged and capped by the engine.

Full contract, caps and implementer rules: `docs/features/files.md`.
