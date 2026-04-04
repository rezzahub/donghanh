---
title: "@donghanh/core"
description: JSX runtime, primitives, registry, executor.
---

## JSX Primitives

```tsx
import { Brief, Message, Action, Display, Context, Form, App } from "@donghanh/core";
```

### `Brief(props)`
Root container. Accepts `children` of type `Child | Child[]`.

### `Action(props)`
- `operation: string` — target operation ID
- `label: string` — human-readable label
- `variables?: Record<string, unknown>` — pre-filled variables

### `Display(props)`
- `data: unknown` — data to display

### `Message(props)`
- `children?: string` — text content

### `Context(props)`
- `value: unknown` — raw context

### `Form(props)`
- `fields: FieldDef[]` — input field definitions
- `operation: string` — target operation

### `App(props)`
- `operations: Record<string, OperationComponent>` — typed operations map

## Registration

```tsx
import { registerOperation } from "@donghanh/core";
import type { OperationProps, OperationConfig } from "@donghanh/core";
```

### `registerOperation(component, config)`
Attaches metadata to a component function. Returns an `OperationComponent`.

### `OperationConfig`
- `id: string`
- `type: "query" | "mutation"`
- `description: string`
- `instruction: string`
- `input: object` — JSON Schema
- `responseKey: string`

## Registry

```tsx
import { buildRegistry } from "@donghanh/core";
```

### `buildRegistry(appNode, responseSchemas?)`
Builds a registry from an `AppNode`. Returns `Registry` with:
- `list()` — all operations (compact)
- `detail(name)` — full operation detail
- `get(name)` — operation component

## Executor

```tsx
import { executeOperation } from "@donghanh/core";
```

### `executeOperation(opts)`
- `registry: Registry`
- `operationId: string`
- `variables: Record<string, unknown>`
- `executor: Executor`
- `context: ExecutorContext`

Returns `{ data, brief }`.

## Rendering

```tsx
import { renderNode } from "@donghanh/core";
import type { Renderer } from "@donghanh/core";
```

### `renderNode(node, renderer)`
Walks a `ChatNode` tree, calling renderer methods for each node type.
