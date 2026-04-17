import { describe, expect, test } from "bun:test";
import type {
  ChatNode,
  Executor,
  OperationComponent,
  OperationConfig,
} from "@donghanh/core";
import { App, Brief, buildRegistry, Display, Message } from "@donghanh/core";
import { mcpRoutes } from "./mcp";

function makeOp(
  id: string,
  overrides: Partial<OperationConfig> = {},
  render: (data: unknown) => ChatNode = () =>
    Brief({ children: [Message({ children: "ok" })] }),
): OperationComponent {
  const op = ((props: { data: unknown }) =>
    render(props.data)) as unknown as OperationComponent;
  op.operationConfig = {
    id,
    type: "query",
    description: `${id} desc`,
    instruction: `call ${id}`,
    input: { type: "object", properties: {} },
    responseKey: id,
    ...overrides,
  };
  return op;
}

function makeApp(ops: Record<string, OperationComponent>) {
  return buildRegistry(App({ operations: ops }));
}

async function rpc(
  app: ReturnType<typeof mcpRoutes>,
  method: string,
  params?: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json() as Promise<{ result?: any; error?: any }>;
}

const baseConfig = {
  resource: "https://app.example.com",
  authorizationServers: ["https://auth.example.com"],
  scopes: ["read", "write"],
  authenticate: async () => ({ userId: "u1" }),
  executor: (async (opId) => ({ opId })) as Executor,
};

describe("mcpRoutes", () => {
  test("initialize returns protocol version + capabilities", async () => {
    const app = mcpRoutes({ ...baseConfig, registry: makeApp({}) });
    const { result } = await rpc(app, "initialize");
    expect(result.protocolVersion).toBe("2026-01-26");
    expect(result.capabilities.tools).toEqual({});
  });

  test("initialize advertises resources when widgets configured", async () => {
    const app = mcpRoutes({
      ...baseConfig,
      registry: makeApp({}),
      widgets: {
        boards: { uri: "ui://w/b.html", html: "<div/>" },
      },
    });
    const { result } = await rpc(app, "initialize");
    expect(result.capabilities.resources).toEqual({});
  });

  test("tools/list annotations: query → readOnlyHint true", async () => {
    const app = mcpRoutes({
      ...baseConfig,
      registry: makeApp({ list: makeOp("list", { type: "query" }) }),
    });
    const { result } = await rpc(app, "tools/list");
    expect(result.tools[0].annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    });
  });

  test("tools/list annotations: mutation + destructive flags", async () => {
    const app = mcpRoutes({
      ...baseConfig,
      registry: makeApp({
        del: makeOp("del", {
          type: "mutation",
          destructive: true,
          external: true,
        }),
      }),
    });
    const { result } = await rpc(app, "tools/list");
    expect(result.tools[0].annotations).toEqual({
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: true,
    });
  });

  test("tools/list securitySchemes: auth=none → noauth", async () => {
    const app = mcpRoutes({
      ...baseConfig,
      registry: makeApp({ public: makeOp("public", { auth: "none" }) }),
    });
    const { result } = await rpc(app, "tools/list");
    expect(result.tools[0].securitySchemes).toEqual([{ type: "noauth" }]);
  });

  test("tools/list securitySchemes: auth=optional → both", async () => {
    const app = mcpRoutes({
      ...baseConfig,
      registry: makeApp({ maybe: makeOp("maybe", { auth: "optional" }) }),
    });
    const { result } = await rpc(app, "tools/list");
    expect(result.tools[0].securitySchemes).toEqual([
      { type: "noauth" },
      { type: "oauth2", scopes: ["read", "write"] },
    ]);
  });

  test("tools/list attaches resourceUri when widget configured", async () => {
    const app = mcpRoutes({
      ...baseConfig,
      registry: makeApp({ ui: makeOp("ui", { widget: "boards" }) }),
      widgets: { boards: { uri: "ui://w/b.html", html: "<div/>" } },
    });
    const { result } = await rpc(app, "tools/list");
    expect(result.tools[0]._meta.ui.resourceUri).toBe("ui://w/b.html");
    expect(result.tools[0]._meta["openai/outputTemplate"]).toBe(
      "ui://w/b.html",
    );
  });

  test("tools/list omits resourceUri when op has no widget", async () => {
    const app = mcpRoutes({
      ...baseConfig,
      registry: makeApp({ data: makeOp("data") }),
      widgets: { boards: { uri: "ui://w/b.html", html: "<div/>" } },
    });
    const { result } = await rpc(app, "tools/list");
    expect(result.tools[0]._meta).toBeUndefined();
  });

  test("resources/list enumerates widgets", async () => {
    const app = mcpRoutes({
      ...baseConfig,
      registry: makeApp({}),
      widgets: {
        boards: { uri: "ui://w/b.html", html: "<b/>" },
        cards: { uri: "ui://w/c.html", html: "<c/>" },
      },
    });
    const { result } = await rpc(app, "resources/list");
    expect(result.resources).toHaveLength(2);
    expect(result.resources[0].mimeType).toBe("text/html;profile=mcp-app");
  });

  test("resources/read returns widget contents + csp meta", async () => {
    const app = mcpRoutes({
      ...baseConfig,
      registry: makeApp({}),
      widgets: {
        boards: {
          uri: "ui://w/b.html",
          html: "<body>hi</body>",
          domain: "https://app.example.com",
          csp: { connectDomains: ["https://api.example.com"] },
        },
      },
    });
    const { result } = await rpc(app, "resources/read", {
      uri: "ui://w/b.html",
    });
    expect(result.contents[0].text).toBe("<body>hi</body>");
    expect(result.contents[0].mimeType).toBe("text/html;profile=mcp-app");
    expect(result.contents[0]._meta.ui.domain).toBe("https://app.example.com");
    expect(result.contents[0]._meta.ui.csp.connectDomains).toEqual([
      "https://api.example.com",
    ]);
  });

  test("resources/read unknown uri → error", async () => {
    const app = mcpRoutes({ ...baseConfig, registry: makeApp({}) });
    const { error } = await rpc(app, "resources/read", { uri: "ui://nope" });
    expect(error.code).toBe(-32601);
  });

  test("tools/call: auth required + no token → www_authenticate", async () => {
    const app = mcpRoutes({
      ...baseConfig,
      registry: makeApp({ priv: makeOp("priv") }),
      authenticate: async () => ({
        error: new Response("nope", { status: 401 }),
      }),
    });
    const { result } = await rpc(app, "tools/call", { name: "priv" });
    expect(result.isError).toBe(true);
    expect(result._meta["mcp/www_authenticate"][0]).toContain(
      "resource_metadata=",
    );
  });

  test("tools/call: auth=none bypasses authenticate", async () => {
    let authCalled = false;
    const app = mcpRoutes({
      ...baseConfig,
      registry: makeApp({ pub: makeOp("pub", { auth: "none" }) }),
      authenticate: async () => {
        authCalled = true;
        return { error: new Response("x", { status: 401 }) };
      },
      executor: async () => ({ ok: 1 }),
    });
    const { result } = await rpc(app, "tools/call", { name: "pub" });
    expect(authCalled).toBe(false);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.pub).toEqual({ ok: 1 });
  });

  test("tools/call: auth=optional proceeds anon when no token", async () => {
    const app = mcpRoutes({
      ...baseConfig,
      registry: makeApp({ maybe: makeOp("maybe", { auth: "optional" }) }),
      authenticate: async () => ({ error: new Response("x", { status: 401 }) }),
      executor: async (_id, _vars, ctx) => ({ userId: ctx.userId }),
    });
    const { result } = await rpc(app, "tools/call", { name: "maybe" });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.maybe).toEqual({ userId: null });
  });

  test("tools/call: returns structuredContent + content text", async () => {
    const app = mcpRoutes({
      ...baseConfig,
      registry: makeApp({
        greet: makeOp("greet", {}, () =>
          Brief({
            children: [
              Message({ children: "hello!" }),
              Display({ data: { x: 1 } }),
            ],
          }),
        ),
      }),
      executor: async () => ({ msg: "hi" }),
    });
    const { result } = await rpc(app, "tools/call", { name: "greet" });
    expect(result.content[0].text).toBe("hello!");
    expect(result.structuredContent.greet).toEqual({ msg: "hi" });
    expect(result.structuredContent.display).toEqual({ x: 1 });
  });

  test("unknown tool → error", async () => {
    const app = mcpRoutes({ ...baseConfig, registry: makeApp({}) });
    const { error } = await rpc(app, "tools/call", { name: "nope" });
    expect(error.code).toBe(-32601);
  });

  test("protected resource metadata endpoint", async () => {
    const app = mcpRoutes({
      ...baseConfig,
      registry: makeApp({}),
    });
    const res = await app.request("/.well-known/oauth-protected-resource");
    const body = (await res.json()) as any;
    expect(body.resource).toBe("https://app.example.com");
    expect(body.authorization_servers).toEqual(["https://auth.example.com"]);
    expect(body.scopes_supported).toEqual(["read", "write"]);
  });
});
