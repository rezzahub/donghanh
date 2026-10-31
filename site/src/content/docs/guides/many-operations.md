---
title: "Many operations: hybrid exposure"
description: Keep the tool list short when an app has dozens of operations.
---

Every operation is an MCP tool by default. That is right for a handful of operations. With dozens, the tool list grows large, hosts load all of it into context, and the model picks worse.

Hybrid exposure keeps the few operations the model needs at all times as tools and puts the rest in a catalog, reached through five generated meta-tools: `find_operations`, `get_operation`, `run_read`, `run_write` and `run_destructive`.

## When to use it

- You have more than about 15 operations.
- Most of them are lookups the model needs only some of the time.
- A few operations (`start`, a main search) are used in nearly every session.

If every operation is used constantly, leave exposure at the default.

## Example

Queries go to the catalog. Writes stay tools. `start` is pinned as a tool.

```ts
mcpRoutes({
  registry,
  executor,
  authenticate,
  resource,
  authorizationServers,
  exposure: { default: "tool", catalog: { type: "query" }, pin: ["start"] },
});
```

The model then calls `find_operations` to locate a read, `get_operation` for its input schema, and `run_read` to run it.

## Why writes stay tools

Hosts ask for approval per tool. A write that is its own tool gets its own approval prompt, with its own name and annotations, and the user can allow or deny it on its own. If writes go through `run_write`, one approval covers whatever operation the model passes. `run_write` and `run_destructive` therefore require an `intent` sentence for the approval dialog, but a named tool is still the clearer surface. Keep writes you care about as tools, and send only low-risk, rarely used ones to the catalog.

## Widget-called reads

A widget often calls reads that the model never needs to see. Mark such an operation `appCallable: true` in its config. If it is in the catalog, it is listed with visibility `["app"]`: the widget can call it directly, and the model does not see it as a tool.

Operations with a `widget` are always tools, whatever the selectors say.

## Selectors

`exposure` takes `default`, `tools`, `catalog` and `pin`. Selectors match on `type`, `tags`, `ids`, `widget` and `destructive`. Precedence: widget operations, then `pin`, then `tools`, then `catalog`, then `default`. See the [hono reference](../../reference/hono/).

Tag operations in their config (`tags: ["reports"]`) and select by tag to move a group at once.

## Tell the model about it

Say in `App({ instructions })` that the rest of the operations are found with `find_operations`. The model reads instructions at session start, before it has seen any tool.
