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
- `instructions?: string` — the app's playbook (Markdown). `mcpRoutes` sends it as `initialize.instructions`, `gptRoutes` returns it from `GET /operations`, and `chatRoutes` uses it as the default system prompt. `registry.instructions()` reads it.

Writing rule: put the essentials (what the app is, what to call first, the one or two rules that matter most) in the first 512 characters; ChatGPT and Codex read that far. Keep the total under 4,096 characters; Claude Code truncates there, and `mcpRoutes` warns at startup above it.

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
- `title?: string` — human-readable title for tool listings
- `idempotent?: boolean` — repeating the call has no further effect (`idempotentHint`)
- `tags?: string[]` — grouping tags; searchable and usable in `exposure` selectors
- `meta?: Record<string, unknown>` — extra protocol metadata passed through to tool listings
- `appCallable?: boolean` — the app's widget may call this operation directly; a catalog operation with it is listed with visibility `["app"]`

`ExecutorContext.intent` carries the caller-stated reason when the call came through `run_write` or `run_destructive`.

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

## Skills

```ts
import { skillOperations, staticSkills } from "@donghanh/core/skills";
import type { SkillProvider } from "@donghanh/core/skills";
```

Skills are Markdown playbooks (`SKILL.md`: frontmatter with `name` and `description`, then a body) that the agent searches and loads on demand. They are dynamic, so `instructions` and tool descriptions never list them; the app's `instructions` tells the agent to search first.

### `SkillProvider`
`{ key, search(query, ctx), get(slug, ctx), create?, update?, delete? }`. `key` uses letters, digits, `_` or `-` and must be unique. A provider with `create`, `update` or `delete` is writable. `canCreate?(ctx)` (default true when `create` exists) decides per caller whether the provider is a create target; a throwing `canCreate` counts as false. `ctx` is `{ userId, request, intent? }`; `userId` is `null` for an unauthenticated caller, except through `gptRoutes`, where an anonymous caller arrives as the string `"anonymous"`, not `null`.

### `staticSkills(key, files)`
Read-only provider over `SKILL.md` strings. The slug is the frontmatter `name` (lowercase letters, digits, single hyphens).

### `skillOperations({ providers, prefix?, auth? })`
Returns `{ operations, wrap(executor) }`. `prefix` is prepended to the operation ids below. Spread `operations` into `App`, and wrap your executor with `wrap`.

| Operation | Type | Purpose |
|---|---|---|
| `search_skills` | query | Search by keyword across providers; lists `writableTargets` |
| `use_skill` | query | Load a skill's Markdown by slug; optional `provider` asks only that provider |
| `manage_skill` | mutation | Create or update a skill (exactly one of `create`, `update`); Markdown up to 65,536 characters |
| `delete_skill` | mutation, destructive | Delete a skill by id |

Ids returned to the agent are `<provider key>:<id>`. A failing provider is skipped on search and get; the log carries only the error's name. If a provider failed and nothing was found, the call throws `Skill providers are unavailable (<keys>); try again.` instead of reporting no match.
