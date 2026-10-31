import { expect, test } from "bun:test";
import app from "./worker";

test("lists operations as MCP tools", async () => {
  const res = await app.request(
    "/mcp",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    },
    { DB: {} },
  );
  expect(res.status).toBe(200);
  const { result } = (await res.json()) as {
    result: { tools: { name: string }[] };
  };
  const names = result.tools.map((t) => t.name);
  expect(names).toContain("list-items");
  expect(names).toContain("add-item");
});
