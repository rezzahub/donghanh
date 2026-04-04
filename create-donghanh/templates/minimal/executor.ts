import type { Executor } from "@donghanh/core";

const queries: Record<string, (db: D1Database, vars: Record<string, unknown>) => Promise<unknown>> = {
  "list-items": async (db) => {
    const { results } = await db.prepare("SELECT * FROM items ORDER BY created_at DESC").all();
    return { items: results };
  },
  "add-item": async (db, vars) => {
    const { name } = vars as { name: string };
    await db.prepare("INSERT INTO items (name) VALUES (?)").bind(name).run();
    const { results } = await db.prepare("SELECT * FROM items ORDER BY created_at DESC").all();
    return { items: results };
  },
};

export function createExecutor(db: D1Database): Executor {
  return async (operationId, variables) => {
    const query = queries[operationId];
    if (!query) throw new Error(`Unknown operation: ${operationId}`);
    return query(db, variables);
  };
}
