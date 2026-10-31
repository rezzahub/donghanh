import { expect, test } from "bun:test";
import app from "./worker";

type Tool = {
  name: string;
  securitySchemes: { type: string }[];
};

async function listTools() {
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
  const { result } = (await res.json()) as { result: { tools: Tool[] } };
  return result.tools;
}

test("lists operations as MCP tools", async () => {
  const names = (await listTools()).map((t) => t.name);
  expect(names).toContain("list-items");
  expect(names).toContain("add-item");
});

test("no tool asks for OAuth, since the template has no sign-in", async () => {
  for (const tool of await listTools()) {
    expect(tool.securitySchemes).toEqual([{ type: "noauth" }]);
  }
});
