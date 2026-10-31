import { describe, expect, spyOn, test } from "bun:test";
import type {
  ChatNode,
  Executor,
  OperationComponent,
  OperationConfig,
} from "@donghanh/core";
import {
  Action,
  App,
  Brief,
  buildRegistry,
  Display,
  Message,
} from "@donghanh/core";
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
    expect(result.protocolVersion).toBe("2025-11-25");
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
      idempotentHint: false,
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
      idempotentHint: false,
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

  test("actions are appended to the text as a Next block", async () => {
    const list = makeOp("list", {}, () =>
      Brief({
        children: [
          Message({ children: "3 items." }),
          Action({ operation: "add_item", label: "Add an item" }),
        ],
      }),
    );
    const app = mcpRoutes({
      ...baseConfig,
      registry: makeApp({ list, add_item: makeOp("add_item") }),
    });
    const { result } = await rpc(app, "tools/call", {
      name: "list",
      arguments: {},
    });
    expect(result.content[0].text).toBe(
      "3 items.\n\nNext:\n- Add an item (add_item)",
    );
    expect(result.structuredContent.actions).toHaveLength(1);
  });

  test("actionsInText:false keeps the text unchanged", async () => {
    const list = makeOp("list", {}, () =>
      Brief({
        children: [
          Message({ children: "3 items." }),
          Action({ operation: "add_item", label: "Add an item" }),
        ],
      }),
    );
    const app = mcpRoutes({
      ...baseConfig,
      actionsInText: false,
      registry: makeApp({ list, add_item: makeOp("add_item") }),
    });
    const { result } = await rpc(app, "tools/call", {
      name: "list",
      arguments: {},
    });
    expect(result.content[0].text).toBe("3 items.");
    expect(result.structuredContent.actions).toHaveLength(1);
  });

  test("no Next block when there are no actions", async () => {
    const app = mcpRoutes({
      ...baseConfig,
      registry: makeApp({
        list: makeOp("list", {}, () =>
          Brief({ children: [Message({ children: "3 items." })] }),
        ),
      }),
    });
    const { result } = await rpc(app, "tools/call", {
      name: "list",
      arguments: {},
    });
    expect(result.content[0].text).toBe("3 items.");
    expect(result.structuredContent.actions).toBeUndefined();
  });

  test("actions without a message give a bare Next block", async () => {
    const app = mcpRoutes({
      ...baseConfig,
      registry: makeApp({
        list: makeOp("list", {}, () =>
          Brief({
            children: [Action({ operation: "add_item", label: "Add an item" })],
          }),
        ),
        add_item: makeOp("add_item"),
      }),
    });
    const { result } = await rpc(app, "tools/call", {
      name: "list",
      arguments: {},
    });
    expect(result.content[0].text).toBe("Next:\n- Add an item (add_item)");
  });

  test("tools/call: enrichResponse can add fields to structuredContent", async () => {
    const app = mcpRoutes({
      ...baseConfig,
      registry: makeApp({ q: makeOp("q") }),
      executor: async () => ({ v: 1 }),
      enrichResponse: async (structured, opts) => {
        structured.display = `${opts.operationId}:${opts.userId}`;
      },
    });
    const { result } = await rpc(app, "tools/call", { name: "q" });
    expect(result.structuredContent.display).toBe("q:u1");
    expect(result.structuredContent.q).toEqual({ v: 1 });
  });

  test("tools/call: enrichResponse receives the call arguments", async () => {
    let seen: Record<string, unknown> | undefined;
    const app = mcpRoutes({
      ...baseConfig,
      registry: makeApp({ q: makeOp("q") }),
      enrichResponse: async (_structured, opts) => {
        seen = opts.variables;
      },
    });
    await rpc(app, "tools/call", { name: "q", arguments: { groupId: "g1" } });
    expect(seen?.groupId).toBe("g1");
  });

  test("GET /mcp → 405 with Allow: POST", async () => {
    const app = mcpRoutes({ ...baseConfig, registry: makeApp({}) });
    const res = await app.request("/mcp");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
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

  test("initialize echoes each supported version", async () => {
    const app = mcpRoutes({ ...baseConfig, registry: makeApp({}) });
    for (const v of ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]) {
      const { result } = await rpc(app, "initialize", { protocolVersion: v });
      expect(result.protocolVersion).toBe(v);
    }
  });

  test("initialize answers unknown or missing versions with the newest", async () => {
    const app = mcpRoutes({ ...baseConfig, registry: makeApp({}) });
    expect(
      (await rpc(app, "initialize", { protocolVersion: "2099-01-01" })).result
        .protocolVersion,
    ).toBe("2025-11-25");
    expect((await rpc(app, "initialize")).result.protocolVersion).toBe(
      "2025-11-25",
    );
  });

  test("initialize carries app instructions plus the endpoint suffix", async () => {
    const reg = buildRegistry(App({ operations: {}, instructions: "Play." }));
    const app = mcpRoutes({
      ...baseConfig,
      registry: reg,
      instructionsSuffix: " Use find_operations.",
    });
    expect((await rpc(app, "initialize")).result.instructions).toBe(
      "Play. Use find_operations.",
    );
  });

  test("no instructions key when the app has none", async () => {
    const app = mcpRoutes({
      ...baseConfig,
      registry: makeApp({}),
      instructionsSuffix: " Suffix.",
    });
    const { result } = await rpc(app, "initialize");
    expect("instructions" in result).toBe(false);
  });

  test("warns once at startup above 4096 characters", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const reg = buildRegistry(
        App({ operations: {}, instructions: "x".repeat(4097) }),
      );
      const app = mcpRoutes({ ...baseConfig, registry: reg });
      await rpc(app, "initialize");
      await rpc(app, "initialize");
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockClear();
      mcpRoutes({
        ...baseConfig,
        registry: buildRegistry(
          App({ operations: {}, instructions: "x".repeat(4096) }),
        ),
      });
      expect(warn).toHaveBeenCalledTimes(0);
    } finally {
      warn.mockRestore();
    }
  });

  test("ping answers an empty result", async () => {
    const app = mcpRoutes({ ...baseConfig, registry: makeApp({}) });
    expect(await rpc(app, "ping")).toEqual<unknown>({
      jsonrpc: "2.0",
      id: 1,
      result: {},
    });
  });

  test("templates and prompts list empty", async () => {
    const app = mcpRoutes({ ...baseConfig, registry: makeApp({}) });
    expect(
      (await rpc(app, "resources/templates/list")).result.resourceTemplates,
    ).toEqual([]);
    expect((await rpc(app, "prompts/list")).result.prompts).toEqual([]);
  });

  test("any notification is 202 with an empty body", async () => {
    const app = mcpRoutes({ ...baseConfig, registry: makeApp({}) });
    for (const method of [
      "notifications/initialized",
      "notifications/roots/list_changed",
    ]) {
      const res = await app.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method }),
      });
      expect(res.status).toBe(202);
      expect(await res.text()).toBe("");
    }
  });

  test("unknown method, tool and resource are -32601 with HTTP 200", async () => {
    const app = mcpRoutes({ ...baseConfig, registry: makeApp({}) });
    const calls: Array<[string, Record<string, unknown>?]> = [
      ["nope/method"],
      ["tools/call", { name: "nope" }],
      ["resources/read", { uri: "ui://nope" }],
    ];
    for (const [method, params] of calls) {
      const res = await app.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).error.code).toBe(-32601);
    }
  });

  test("path mounts the endpoint elsewhere; metadata:false skips the metadata route", async () => {
    const app = mcpRoutes({
      ...baseConfig,
      registry: makeApp({}),
      path: "/agent",
      metadata: false,
    });
    const post = (p: string) =>
      app.request(p, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });
    expect((await post("/agent")).status).toBe(200);
    expect((await post("/mcp")).status).toBe(404);
    expect((await app.request("/agent")).status).toBe(405);
    expect(
      (await app.request("/.well-known/oauth-protected-resource")).status,
    ).toBe(404);
  });

  describe("tool listing", () => {
    const schema = { type: "object", properties: { n: { type: "number" } } };
    const withResponse = (cfg: Record<string, unknown> = {}) =>
      buildRegistry(App({ operations: { op: makeOp("op", cfg) } }), {
        op: schema,
      });
    const list = async (config: Record<string, unknown>) =>
      (await rpc(mcpRoutes({ ...baseConfig, ...config } as any), "tools/list"))
        .result.tools[0];

    test("tools carry title, idempotentHint and operation meta", async () => {
      const op = makeOp("keep", {
        type: "mutation",
        title: "Keep candidate",
        idempotent: true,
        meta: { "x/y": 1 },
      });
      const tool = await list({ registry: makeApp({ op }) });
      expect(tool.title).toBe("Keep candidate");
      expect(tool.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      });
      expect(tool._meta).toMatchObject({ "x/y": 1 });
    });

    test("widget keys win over operation meta", async () => {
      const op = makeOp("ui", {
        widget: "boards",
        meta: { ui: "mine", "x/y": 1 },
      });
      const tool = await list({
        registry: makeApp({ op }),
        widgets: { boards: { uri: "ui://w/b.html", html: "<div/>" } },
      });
      expect(tool._meta.ui.resourceUri).toBe("ui://w/b.html");
      expect(tool._meta["x/y"]).toBe(1);
    });

    test("outputSchema wraps the response schema under responseKey", async () => {
      const tool = await list({ registry: withResponse() });
      expect(tool.outputSchema).toEqual({
        type: "object",
        properties: { op: schema, actions: { type: "array" }, display: {} },
        required: ["op"],
      });
    });

    test("no outputSchema when enrichResponse is set without an outputSchema option", async () => {
      const tool = await list({
        registry: withResponse(),
        enrichResponse: async () => {},
      });
      expect(tool.outputSchema).toBeUndefined();
    });

    test("the outputSchema option replaces or removes the schema", async () => {
      const custom = { type: "object", properties: {} };
      const replaced = await list({
        registry: withResponse(),
        enrichResponse: async () => {},
        outputSchema: () => custom,
      });
      expect(replaced.outputSchema).toEqual(custom);
      const removed = await list({
        registry: withResponse(),
        outputSchema: () => undefined,
      });
      expect(removed.outputSchema).toBeUndefined();
    });

    test("no outputSchema without a response schema", async () => {
      const tool = await list({ registry: makeApp({ op: makeOp("op") }) });
      expect(tool.outputSchema).toBeUndefined();
      expect(tool._meta).toBeUndefined();
    });
  });
});
