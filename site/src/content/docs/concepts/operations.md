---
title: Operations
description: How to write operation components.
---

An operation is a `.tsx` file that receives data and returns a `<Brief>`. Metadata is attached via `registerOperation()`.

## Anatomy

```tsx
/** @jsxImportSource @donghanh/core */
import { Action, Brief, Display, registerOperation } from "@donghanh/core";
import type { OperationProps } from "@donghanh/core";

interface Data {
  items: { id: string; name: string }[];
}

function ListItems({ data, variables }: OperationProps<Data>) {
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

## Config fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique operation ID (kebab-case) |
| `type` | yes | `"query"` or `"mutation"` |
| `description` | yes | Short description for the agent (~80 chars) |
| `instruction` | yes | Detailed guidance on when/how to use |
| `input` | yes | JSON Schema for the operation's variables |
| `responseKey` | yes | Key in GraphQL/API response (camelCase of id) |

## Registry

Operations are collected in a typed registry:

```ts
// operations/index.ts
import ListItems from "./list-items";
import AddItem from "./add-item";

export const operations = {
  "list-items": ListItems,
  "add-item": AddItem,
} as const;

export type Operations = typeof operations;
```

The `as const` preserves operation IDs as literal types — enables type-safe `<Action operation="...">`.

## Conditional content

Use standard JSX conditionals in `<Brief>`:

```tsx
<Brief>
  {items.length === 0 && "No items yet."}
  {items.length > 0 && <Display data={items} />}
  <Action operation="add-item" label="Add item" />
</Brief>
```

## Dynamic actions

Map over data to generate actions:

```tsx
<Brief>
  {groups.map(group => (
    <Action
      key={group.id}
      operation="group-detail"
      label={`View ${group.name}`}
      variables={{ groupId: group.id }}
    />
  ))}
</Brief>
```
