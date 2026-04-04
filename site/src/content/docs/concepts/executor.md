---
title: Executor
description: Injected data fetching — connect any data source.
---

The executor maps operation IDs to data fetching. The framework calls it, passes the result to the operation component.

```ts
type Executor = (
  operationId: string,
  variables: Record<string, unknown>,
  context: ExecutorContext,
) => Promise<unknown>;

interface ExecutorContext {
  userId: string;
  request: Request;
}
```

## Example: D1 SQLite

```ts
import type { Executor } from "@donghanh/core";

const queries = {
  "list-items": async (db: D1Database) => {
    const { results } = await db.prepare("SELECT * FROM items").all();
    return { items: results };
  },
  "add-item": async (db: D1Database, vars: Record<string, unknown>) => {
    await db.prepare("INSERT INTO items (name) VALUES (?)").bind(vars.name).run();
    const { results } = await db.prepare("SELECT * FROM items").all();
    return { items: results };
  },
};

export function createExecutor(db: D1Database): Executor {
  return async (operationId, variables) => {
    const query = queries[operationId];
    if (!query) throw new Error(`Unknown: ${operationId}`);
    return query(db, variables);
  };
}
```

## Example: REST API

```ts
const executor: Executor = async (operationId, variables, context) => {
  const res = await fetch(`https://api.example.com/${operationId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${context.userId}`,
    },
    body: JSON.stringify(variables),
  });
  return res.json();
};
```

## Example: GraphQL

```ts
const executor: Executor = async (operationId, variables, context) => {
  const doc = graphqlDocuments[operationId];
  const result = await yoga.fetch(new Request(url, {
    method: "POST",
    body: JSON.stringify({ query: doc, variables }),
  }), { userId: context.userId });
  return (await result.json()).data[doc.responseKey];
};
```

The framework doesn't care which approach you use. The executor is the only place where your data source is wired in.
