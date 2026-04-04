# @donghanh — Conversational UI Framework

Build conversational interfaces with JSX. Operations return a `<Brief>` — the agent's HUD — and the framework renders it differently per target (ChatGPT JSON, LLM tool results, in-app chat).

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
5. Mount with `gptRoutes()` from `@donghanh/hono`

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
| `<Action>` | Suggested next operation (tool hint) |
| `<Display>` | Formatted data |
| `<Context>` | Raw context for the agent |
| `<Form>` | Input schema (for operation detail) |

### Key files

| File | Purpose |
|------|---------|
| `operations/*.tsx` | One component per operation |
| `operations/index.ts` | Registry (`as const`) |
| `executor.ts` | Maps operation IDs to data fetching |
| `worker.ts` | Hono entry, mounts routes |
