import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createExecutor } from "./executor";

function createTestDb(): D1Database {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // Wrap bun:sqlite to match D1Database.prepare() interface
  return {
    prepare(query: string) {
      const stmt = sqlite.prepare(query);
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              stmt.run(...(params as any[]));
              return { success: true, meta: {} };
            },
            async all() {
              return { results: stmt.all(...(params as any[])), success: true };
            },
            async first() {
              return stmt.get(...(params as any[])) ?? null;
            },
          };
        },
        async run() {
          stmt.run();
          return { success: true, meta: {} };
        },
        async all() {
          return { results: stmt.all(), success: true };
        },
        async first() {
          return stmt.get() ?? null;
        },
      } as any;
    },
  } as any;
}

const ctx = { userId: "test", request: new Request("http://localhost") };

describe("executor", () => {
  test("list-items returns empty array", async () => {
    const executor = createExecutor(createTestDb());
    const result = (await executor("list-items", {}, ctx)) as any;
    expect(result.items).toEqual([]);
  });

  test("add-item creates an item", async () => {
    const executor = createExecutor(createTestDb());
    const result = (await executor(
      "add-item",
      { name: "Buy milk" },
      ctx,
    )) as any;
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("Buy milk");
  });

  test("add-item then list-items", async () => {
    const db = createTestDb();
    const executor = createExecutor(db);
    await executor("add-item", { name: "Item 1" }, ctx);
    await executor("add-item", { name: "Item 2" }, ctx);
    const result = (await executor("list-items", {}, ctx)) as any;
    expect(result.items).toHaveLength(2);
  });

  test("unknown operation throws", () => {
    const executor = createExecutor(createTestDb());
    expect(executor("unknown", {}, ctx)).rejects.toThrow(
      "Unknown operation: unknown",
    );
  });
});
