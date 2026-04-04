---
title: Brief & Primitives
description: The JSX primitives that make up the agent's HUD.
---

Every operation returns a `<Brief>` — a JSX tree that serves as the agent's heads-up display. It's **not shown to users**. The framework renders it differently per target.

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

A suggested next operation — a tool hint for the agent.

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

Raw context for the agent (not displayed).

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
