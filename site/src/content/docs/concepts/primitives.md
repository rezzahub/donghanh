---
title: Brief & Primitives
description: The JSX primitives that make up the agent's HUD.
---

Every operation returns a `<Brief>` — a JSX tree that serves as the agent's heads-up display. It's **not shown to users**. The framework renders it differently per target.

Design each Brief as a screen: a `<Message>` that says where the agent is and what is here, `<Display>` for the data, and a few `<Action>`s with ids filled in for where it can go next. See [Think in screens](/guides/introduction/#think-in-screens).

## What the agent reads

Under `mcpRoutes` (MCP and the Apps SDK) a tool result has two parts, and each primitive lands in one of them:

| Primitive | Lands in |
|---|---|
| `<Message>` | Tool result text (all Messages joined into one paragraph) |
| `<Action>` | The `Next:` list in the text, with variables; and `structuredContent.actions` |
| `<Display>` | `structuredContent.display` |
| `<Context>` | `_meta["donghanh/context"]` |

Which part the model sees depends on the client:

| Client | The model sees |
|---|---|
| Claude Code | `structuredContent` when the result has it; the text only when it doesn't |
| ChatGPT (Apps SDK) | the text and `structuredContent`; widgets render from `structuredContent` |

By default `mcpRoutes` always sends `structuredContent`, so in Claude Code the model gets `actions` and `display` as JSON and never your Messages. For an app that targets text-reading agents, pass `structuredContent: "widgets"`: only tools bound to a widget (or marked `appCallable`, which widgets call) send `structuredContent`, and every other tool replies with the text alone (Messages, then the `Next:` list). Those tools also stop declaring an `outputSchema`, since MCP requires `structuredContent` for tools that declare one.

```ts
mcpRoutes({ /* ... */ structuredContent: "widgets" });
```

To keep JSON for clients that want it, pass a function instead. Widget and `appCallable` tools always send `structuredContent`; the function is called per call, before the operation runs, only for the other tools, with `{ operationId, widget, request }` (`widget` is undefined there), and returns `true` to send it:

```ts
mcpRoutes({
  /* ... */
  structuredContent: ({ request }) => request.headers.get("x-donghanh-json") === "1",
});
```

Anything the agent needs to act on goes in a Message or an Action.

## Primitives

### `<Brief>`

The root container. Every operation must return one.

```tsx
<Brief>
  Response text for the agent.
  <Display data={balances} />
  <Action operation="add-expense" label="Add expense" />
</Brief>
```

### `<Action>`

A button on the screen: a next operation for the agent, with the ids it needs filled in.

```tsx
<Action
  operation="record-settlement"
  label="Settle debt"
  variables={{ groupId: "abc", amount: 50000 }}
/>
```

### `<Display>`

Formatted data included in the response.

```tsx
<Display data={{ balances, debts }} />
```

### `<Message>`

Explicit text content. String children of `<Brief>` are auto-wrapped as messages.

```tsx
<Message>Use version={data.version} for the next mutation.</Message>
```

### `<Context>`

Metadata for the host, not displayed. Under `mcpRoutes` it goes to `_meta`, which models usually don't read: put what the agent needs in a `<Message>`.

```tsx
<Context value={{ locale: "vi", timezone: "Asia/Ho_Chi_Minh" }} />
```

### `<Form>`

Input schema — exposed via operation detail, not in response.

```tsx
<Form
  operation="add-expense"
  fields={[
    { name: "description", type: "string", required: true },
    { name: "amount", type: "number", required: true },
  ]}
/>
```

## How rendering works

The framework walks the JSX tree and calls a `Renderer<T>` for each node:

```ts
interface Renderer<T> {
  brief(node: BriefNode, children: T[]): T;
  message(node: MessageNode): T;
  action(node: ActionNode): T;
  display(node: DisplayNode): T;
  context(node: ContextNode): T;
  form(node: FormNode): T;
}
```

Built-in renderers:
- **ChatGPT renderer** — `<Action>` → `suggestedActions[]`, `<Message>` → `nextSteps`
- **LLM renderer** — `<Action>` → action metadata for chat buttons, `<Message>` → tool result text
