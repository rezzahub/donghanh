import type {
  Executor,
  OperationComponent,
  OperationConfig,
} from "@donghanh/core";
import { App, Brief, buildRegistry, Message } from "@donghanh/core";
import { describe, expect, test } from "vitest";
import { mcpRoutes } from "./mcp";

function makeOp(
  id: string,
  overrides: Partial<OperationConfig> = {},
): OperationComponent {
  const op = (() =>
    Brief({
      children: [Message({ children: "ok" })],
    })) as unknown as OperationComponent;
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

const reg = (ops: Record<string, OperationComponent>) =>
  buildRegistry(App({ operations: ops }));

const baseConfig = {
  resource: "https://app.example.com",
  authorizationServers: ["https://auth.example.com"],
  scopes: ["read"],
  authenticate: async () => ({ userId: "u1" }) as any,
  executor: (async (opId) => ({ opId })) as Executor,
};

async function rpc(
  app: ReturnType<typeof mcpRoutes>,
  method: string,
  params?: Record<string, unknown>,
) {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json() as Promise<{ result?: any; error?: any }>;
}

const call = (
  app: ReturnType<typeof mcpRoutes>,
  name: string,
  args: Record<string, unknown>,
) => rpc(app, "tools/call", { name, arguments: args });

const catalogApp = (
  ops: Record<string, OperationComponent>,
  extra: Record<string, unknown> = {},
) =>
  mcpRoutes({
    ...baseConfig,
    registry: reg(ops),
    exposure: { default: "catalog" },
    ...extra,
  });

const names = async (app: ReturnType<typeof mcpRoutes>) =>
  ((await rpc(app, "tools/list")).result.tools as any[]).map((t) => t.name);

describe("catalog meta-tools", () => {
  test("only applicable meta-tools are listed", async () => {
    const app = catalogApp({ q: makeOp("q"), r: makeOp("r") });
    expect(await names(app)).toEqual([
      "find_operations",
      "get_operation",
      "run_read",
    ]);
    const all = catalogApp({
      q: makeOp("q"),
      m: makeOp("m", { type: "mutation" }),
      d: makeOp("d", { type: "mutation", destructive: true }),
    });
    expect(await names(all)).toEqual([
      "find_operations",
      "get_operation",
      "run_read",
      "run_write",
      "run_destructive",
    ]);
    const none = mcpRoutes({
      ...baseConfig,
      registry: reg({ q: makeOp("q") }),
    });
    expect(await names(none)).toEqual(["q"]);
  });

  test("meta-tool hints", async () => {
    const app = catalogApp({
      q: makeOp("q"),
      m: makeOp("m", { type: "mutation" }),
      d: makeOp("d", { type: "mutation", destructive: true }),
    });
    const tools = (await rpc(app, "tools/list")).result.tools as any[];
    const by = (n: string) => tools.find((t) => t.name === n);
    for (const n of ["find_operations", "get_operation", "run_read"]) {
      expect(by(n).annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      });
      expect(typeof by(n).title).toBe("string");
    }
    expect(by("run_write").annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    });
    expect(by("run_destructive").annotations.destructiveHint).toBe(true);
    expect(by("run_write").inputSchema.required).toEqual([
      "id",
      "variables",
      "intent",
    ]);
    expect(by("run_write").inputSchema.properties.intent.minLength).toBe(1);
  });

  test("securitySchemes is the union over the class's operations", async () => {
    const app = catalogApp({
      a: makeOp("a", { auth: "none" }),
      b: makeOp("b", { auth: "required", scopes: ["s"] }),
    });
    const tools = (await rpc(app, "tools/list")).result.tools as any[];
    const schemes = tools.find((t) => t.name === "run_read").securitySchemes;
    expect(schemes).toContainEqual({ type: "noauth" });
    const oauth = schemes.find((s: any) => s.type === "oauth2");
    expect(oauth.scopes).toContain("s");
    expect(oauth.scopes).toContain("read");
    expect(schemes.filter((s: any) => s.type === "oauth2")).toHaveLength(1);
  });

  test("find_operations hides required operations from anonymous callers", async () => {
    const app = catalogApp(
      {
        open: makeOp("open", { auth: "none" }),
        opt: makeOp("opt", { auth: "optional" }),
        req: makeOp("req", { auth: "required" }),
      },
      { authenticate: async () => ({ error: "no" }) },
    );
    const { result } = await call(app, "find_operations", {});
    const ids = result.structuredContent.operations.map((o: any) => o.id);
    expect(ids.sort()).toEqual(["open", "opt"]);
    expect(result.structuredContent.hint).toBe(
      "Call get_operation with an id before running it.",
    );
    expect(JSON.parse(result.content[0].text)).toEqual(
      result.structuredContent,
    );
  });

  test("find_operations matches id, title, description and tags case-insensitively", async () => {
    const app = catalogApp({
      alpha: makeOp("alpha"),
      b: makeOp("b", { title: "Zebra Finder" }),
      c: makeOp("c", { description: "Counts PANDAS" }),
      d: makeOp("d", { tags: ["Mammal"] }),
    });
    const find = async (args: Record<string, unknown>) =>
      (
        (await call(app, "find_operations", args)).result.structuredContent
          .operations as any[]
      ).map((o) => o.id);
    expect(await find({ query: "ALPH" })).toEqual(["alpha"]);
    expect(await find({ query: "zebra" })).toEqual(["b"]);
    expect(await find({ query: "pandas" })).toEqual(["c"]);
    expect(await find({ query: "mammal" })).toEqual(["d"]);
    expect(await find({ tags: ["mammal"] })).toEqual(["d"]);
    expect((await find({})).length).toBe(4);
  });

  test("get_operation returns input, instruction, response and siblings", async () => {
    const app = catalogApp({
      q: makeOp("q", { input: { type: "object", properties: { x: {} } } }),
      r: makeOp("r"),
    });
    const { result } = await call(app, "get_operation", { id: "q" });
    const s = result.structuredContent;
    expect(s.id).toBe("q");
    expect(s.instruction).toBe("call q");
    expect(s.input.properties.x).toEqual({});
    expect(s.operations.map((o: any) => o.id)).toEqual(["q", "r"]);
    expect(JSON.parse(result.content[0].text)).toEqual(s);
  });

  test("get_operation errors for unknown and listed-tool ids", async () => {
    const app = mcpRoutes({
      ...baseConfig,
      registry: reg({ q: makeOp("q"), t: makeOp("t") }),
      exposure: { catalog: { ids: ["q"] } },
    });
    const u = (await call(app, "get_operation", { id: "zz" })).result;
    expect(u.isError).toBe(true);
    expect(u.content[0].text).toBe(
      'Unknown operation "zz". Call find_operations to list available operations.',
    );
    const t = (await call(app, "get_operation", { id: "t" })).result;
    expect(t.isError).toBe(true);
    expect(t.content[0].text).toBe(
      '"t" is a tool on this endpoint; call it directly.',
    );
  });

  test("run_read runs a catalog query like a direct call", async () => {
    const seen: any[] = [];
    const app = catalogApp(
      { q: makeOp("q") },
      {
        executor: (async (opId: string, vars: any) => {
          seen.push([opId, vars]);
          return { n: 1 };
        }) as Executor,
        enrichResponse: async (s: any, o: any) => {
          s.enrichedFor = o.operationId;
        },
      },
    );
    const { result } = await call(app, "run_read", {
      id: "q",
      variables: { a: 1 },
    });
    expect(seen).toEqual([["q", { a: 1 }]]);
    expect(result.structuredContent.q).toEqual({ n: 1 });
    expect(result.structuredContent.enrichedFor).toBe("q");
    expect(result.isError).toBeUndefined();
  });

  test("run_* refuse the wrong class and name the right tool", async () => {
    const app = catalogApp({
      q: makeOp("q"),
      m: makeOp("m", { type: "mutation" }),
      d: makeOp("d", { type: "mutation", destructive: true }),
    });
    const a = (await call(app, "run_read", { id: "m", variables: {} })).result;
    expect(a.isError).toBe(true);
    expect(a.content[0].text).toBe('"m" is a mutation; use run_write.');
    const b = (
      await call(app, "run_write", { id: "d", variables: {}, intent: "x" })
    ).result;
    expect(b.content[0].text).toBe(
      '"d" is a destructive mutation; use run_destructive.',
    );
    const c = (
      await call(app, "run_destructive", {
        id: "q",
        variables: {},
        intent: "x",
      })
    ).result;
    expect(c.content[0].text).toBe('"q" is a query; use run_read.');
  });

  test("run_write requires intent and passes it to the executor", async () => {
    const ctxs: any[] = [];
    const app = catalogApp(
      { m: makeOp("m", { type: "mutation" }) },
      {
        executor: (async (_o: string, _v: any, ctx: any) => {
          ctxs.push(ctx);
          return {};
        }) as Executor,
      },
    );
    for (const args of [
      { id: "m", variables: {} },
      { id: "m", variables: {}, intent: "" },
    ]) {
      const r = (await call(app, "run_write", args)).result;
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toBe(
        "intent is required: one sentence saying what this call does for the user.",
      );
    }
    expect(ctxs).toHaveLength(0);
    const ok = (
      await call(app, "run_write", {
        id: "m",
        variables: {},
        intent: "Keep it",
      })
    ).result;
    expect(ok.isError).toBeUndefined();
    expect(ctxs[0].intent).toBe("Keep it");
  });

  test("run_read with an unknown id points to find_operations", async () => {
    const app = catalogApp({ q: makeOp("q") });
    const r = (await call(app, "run_read", { id: "nope", variables: {} }))
      .result;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/find_operations/);
  });

  test("an app operation named like a generated meta-tool throws at startup", () => {
    expect(() =>
      catalogApp({ run_read: makeOp("run_read"), q: makeOp("q") }),
    ).toThrow(/run_read/);
    // not generated (no catalog ops): no conflict
    expect(() =>
      mcpRoutes({
        ...baseConfig,
        registry: reg({ run_read: makeOp("run_read") }),
      }),
    ).not.toThrow();
  });

  test("run_* applies the target operation's auth challenge", async () => {
    const app = catalogApp(
      { q: makeOp("q", { auth: "required" }) },
      { authenticate: async () => ({ error: "no" }) },
    );
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "run_read", arguments: { id: "q", variables: {} } },
      }),
    });
    expect(res.headers.get("WWW-Authenticate")).toMatch(/resource_metadata/);
    const body = (await res.json()) as any;
    expect(body.result.isError).toBe(true);
    expect(body.result._meta["mcp/www_authenticate"]).toHaveLength(1);
  });

  test("a second mount with default catalog lists find_operations", async () => {
    const registry = reg({ q: makeOp("q") });
    const cat = mcpRoutes({
      ...baseConfig,
      registry,
      path: "/mcp/catalog",
      exposure: { default: "catalog" },
    });
    const res = await cat.request("/mcp/catalog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const b = (await res.json()) as any;
    expect(b.result.tools.map((t: any) => t.name)).toContain("find_operations");
  });
});

describe("catalog meta-tools: final review fixes", () => {
  const anon = { authenticate: async () => ({ error: "no" }) };

  test("run_* reject a non-object variables and do not call the executor", async () => {
    let calls = 0;
    const app = catalogApp(
      {
        q: makeOp("q"),
        m: makeOp("m", { type: "mutation" }),
        d: makeOp("d", { type: "mutation", destructive: true }),
      },
      {
        executor: (async () => {
          calls++;
          return {};
        }) as Executor,
      },
    );
    const cases: [string, string][] = [
      ["run_read", "q"],
      ["run_write", "m"],
      ["run_destructive", "d"],
    ];
    for (const [tool, id] of cases) {
      for (const variables of ['{"a":1}', [1]]) {
        const r = (await call(app, tool, { id, variables, intent: "x" }))
          .result;
        expect(r.isError).toBe(true);
        expect(r.content[0].text).toBe("variables must be an object.");
      }
    }
    expect(calls).toBe(0);
    for (const [tool, id] of cases) {
      for (const variables of [undefined, null]) {
        const r = (await call(app, tool, { id, variables, intent: "x" }))
          .result;
        expect(r.isError).toBeUndefined();
      }
    }
    expect(calls).toBe(6);
  });

  test("run_write/run_destructive openWorldHint follows reachable external operations", async () => {
    const hints = async (ops: Record<string, OperationComponent>) => {
      const tools = (await rpc(catalogApp(ops), "tools/list")).result
        .tools as any[];
      const by = (n: string) => tools.find((t) => t.name === n);
      return [
        by("run_write")?.annotations.openWorldHint,
        by("run_destructive")?.annotations.openWorldHint,
      ];
    };
    expect(
      await hints({
        m: makeOp("m", { type: "mutation" }),
        d: makeOp("d", { type: "mutation", destructive: true }),
      }),
    ).toEqual([false, false]);
    expect(
      await hints({
        m: makeOp("m", { type: "mutation", external: true }),
        d: makeOp("d", { type: "mutation", destructive: true }),
      }),
    ).toEqual([true, false]);
    expect(
      await hints({
        m: makeOp("m", { type: "mutation" }),
        d: makeOp("d", {
          type: "mutation",
          destructive: true,
          external: true,
        }),
      }),
    ).toEqual([false, true]);
  });

  test("get_operation hides required siblings from anonymous callers", async () => {
    const app = catalogApp(
      {
        open: makeOp("open", { auth: "none" }),
        req: makeOp("req", { auth: "required" }),
      },
      anon,
    );
    const { result } = await call(app, "get_operation", { id: "open" });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.operations.map((o: any) => o.id)).toEqual([
      "open",
    ]);
  });

  test("get_operation on a required operation challenges an anonymous caller", async () => {
    const app = catalogApp({ req: makeOp("req", { auth: "required" }) }, anon);
    const { result } = await call(app, "get_operation", { id: "req" });
    expect(result.isError).toBe(true);
    expect(result._meta["mcp/www_authenticate"]).toHaveLength(1);
  });

  test("find_operations challenges when hiding removed every operation", async () => {
    const app = catalogApp({ req: makeOp("req", { auth: "required" }) }, anon);
    const { result } = await call(app, "find_operations", {});
    expect(result.isError).toBe(true);
    expect(result._meta["mcp/www_authenticate"]).toHaveLength(1);
    const mixed = catalogApp(
      {
        req: makeOp("req", { auth: "required" }),
        open: makeOp("open", { auth: "none" }),
      },
      anon,
    );
    const ok = (await call(mixed, "find_operations", {})).result;
    expect(ok.isError).toBeUndefined();
    expect(ok.structuredContent.operations.map((o: any) => o.id)).toEqual([
      "open",
    ]);
  });

  test("find_operations matches any whitespace-separated token", async () => {
    const app = catalogApp({
      del: makeOp("del", {
        title: "Delete a candidate",
        description: "Delete a candidate from project",
      }),
      other: makeOp("other"),
    });
    const find = async (query: string) =>
      (
        (await call(app, "find_operations", { query })).result.structuredContent
          .operations as any[]
      ).map((o) => o.id);
    expect(await find("delete candidate")).toEqual(["del"]);
    expect(await find("  CANDIDATE   zzz ")).toEqual(["del"]);
    expect(await find("zzz qqq")).toEqual([]);
  });

  test("an appCallable catalog mutation is callable by name and listed app-only", async () => {
    const app = catalogApp({
      m: makeOp("m", { type: "mutation", appCallable: true }),
      q: makeOp("q"),
    });
    const tools = (await rpc(app, "tools/list")).result.tools as any[];
    expect(tools.find((t) => t.name === "m")._meta.ui.visibility).toEqual([
      "app",
    ]);
    const r = (await call(app, "m", {})).result;
    expect(r.isError).toBeUndefined();
  });

  test("run_* on an optional-auth operation runs anonymously with userId null", async () => {
    const users: unknown[] = [];
    const app = catalogApp(
      { q: makeOp("q", { auth: "optional" }) },
      {
        ...anon,
        executor: (async (_o: string, _v: any, ctx: any) => {
          users.push(ctx.userId);
          return {};
        }) as Executor,
      },
    );
    const r = (await call(app, "run_read", { id: "q", variables: {} })).result;
    expect(r.isError).toBeUndefined();
    expect(users).toEqual([null]);
  });
});
