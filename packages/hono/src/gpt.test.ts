import { describe, expect, test } from "bun:test";
import type {
  Executor,
  OperationComponent,
  OperationConfig,
} from "@donghanh/core";
import { App, Brief, buildRegistry, Message } from "@donghanh/core";
import { gptRoutes } from "./gpt";
import type { Authenticate } from "./middleware";

function makeOp(
  id: string,
  overrides: Partial<OperationConfig> = {},
): OperationComponent {
  const op = ((_props: { data: unknown }) =>
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

function makeApp(ops: Record<string, OperationComponent>) {
  return buildRegistry(App({ operations: ops }));
}

function makeExecutor(capture: { userId?: string; opId?: string }): Executor {
  return async (opId, _vars, ctx) => {
    capture.opId = opId;
    capture.userId = (ctx.userId ?? "") as string;
    return { ok: true };
  };
}

function makeAuth(
  mode: "valid" | "invalid",
  flag: { called: boolean },
): Authenticate {
  return async (request) => {
    flag.called = true;
    const token = request.headers
      .get("Authorization")
      ?.replace(/^Bearer\s+/i, "");
    if (mode === "valid" && token) return { userId: `user:${token}` };
    return { error: new Response("unauth", { status: 401 }) };
  };
}

async function req(
  app: ReturnType<typeof gptRoutes>,
  path: string,
  init: RequestInit = {},
) {
  const res = await app.request(path, init);
  let body: unknown = null;
  try {
    body = await res.clone().json();
  } catch {
    body = await res.text();
  }
  return { status: res.status, body };
}

describe("gptRoutes /operations listing", () => {
  test("includes auth for each op when set", async () => {
    const registry = makeApp({
      a: makeOp("a", { auth: "required" }),
      b: makeOp("b", { auth: "optional" }),
      c: makeOp("c", { auth: "none" }),
      d: makeOp("d"), // no auth → omitted in compact form
    });
    const app = gptRoutes({
      registry,
      executor: (async () => ({})) as Executor,
      authenticate: async () => ({ userId: "x" }),
    });
    const { status, body } = await req(app, "/operations");
    expect(status).toBe(200);
    const b = body as { operations: Array<{ id: string; auth?: string }> };
    const authById = Object.fromEntries(
      b.operations.map((o) => [o.id, o.auth]),
    );
    expect(authById).toEqual({
      a: "required",
      b: "optional",
      c: "none",
      d: undefined,
    });
  });
});

describe("gptRoutes default /query /mutate", () => {
  test("auth=required + no token → 401", async () => {
    const flag = { called: false };
    const app = gptRoutes({
      registry: makeApp({ op: makeOp("op", { auth: "required" }) }),
      executor: (async () => ({})) as Executor,
      authenticate: makeAuth("invalid", flag),
    });
    const r = await req(app, "/query/op");
    expect(r.status).toBe(401);
    expect(flag.called).toBe(true);
  });

  test("auth=required + valid token → 200 w/ userId", async () => {
    const capture: { userId?: string; opId?: string } = {};
    const flag = { called: false };
    const app = gptRoutes({
      registry: makeApp({ op: makeOp("op", { auth: "required" }) }),
      executor: makeExecutor(capture),
      authenticate: makeAuth("valid", flag),
    });
    const r = await req(app, "/query/op", {
      headers: { Authorization: "Bearer tok1" },
    });
    expect(r.status).toBe(200);
    expect(capture.userId).toBe("user:tok1");
    expect(flag.called).toBe(true);
  });

  test("auth=optional + no token → 200 anonymous", async () => {
    const capture: { userId?: string } = {};
    const flag = { called: false };
    const app = gptRoutes({
      registry: makeApp({ op: makeOp("op", { auth: "optional" }) }),
      executor: makeExecutor(capture),
      authenticate: makeAuth("invalid", flag),
    });
    const r = await req(app, "/query/op");
    expect(r.status).toBe(200);
    expect(capture.userId).toBe("anonymous");
    expect(flag.called).toBe(true);
  });

  test("auth=optional + valid token → 200 w/ real userId", async () => {
    const capture: { userId?: string } = {};
    const flag = { called: false };
    const app = gptRoutes({
      registry: makeApp({ op: makeOp("op", { auth: "optional" }) }),
      executor: makeExecutor(capture),
      authenticate: makeAuth("valid", flag),
    });
    const r = await req(app, "/query/op", {
      headers: { Authorization: "Bearer tok2" },
    });
    expect(r.status).toBe(200);
    expect(capture.userId).toBe("user:tok2");
  });

  test("auth=none + no token → 200 anonymous", async () => {
    const capture: { userId?: string } = {};
    const flag = { called: false };
    const app = gptRoutes({
      registry: makeApp({ op: makeOp("op", { auth: "none" }) }),
      executor: makeExecutor(capture),
      authenticate: makeAuth("invalid", flag),
    });
    const r = await req(app, "/query/op");
    expect(r.status).toBe(200);
    expect(capture.userId).toBe("anonymous");
    expect(flag.called).toBe(false);
  });

  test("auth=none + valid token → 200 ANONYMOUS (authenticate not called)", async () => {
    const capture: { userId?: string } = {};
    const flag = { called: false };
    const app = gptRoutes({
      registry: makeApp({ op: makeOp("op", { auth: "none" }) }),
      executor: makeExecutor(capture),
      authenticate: makeAuth("valid", flag),
    });
    const r = await req(app, "/query/op", {
      headers: { Authorization: "Bearer tok3" },
    });
    expect(r.status).toBe(200);
    expect(capture.userId).toBe("anonymous");
    expect(flag.called).toBe(false);
  });
});

describe("gptRoutes /public sub-paths", () => {
  test("unknown op → 404", async () => {
    const app = gptRoutes({
      registry: makeApp({}),
      executor: (async () => ({})) as Executor,
      authenticate: async () => ({ userId: "x" }),
    });
    const r = await req(app, "/public/query/nope");
    expect(r.status).toBe(404);
    const b = r.body as { error: string };
    expect(b.error).toContain("requires auth");
  });

  test("auth=required op → 404 (does not leak existence)", async () => {
    const app = gptRoutes({
      registry: makeApp({ priv: makeOp("priv", { auth: "required" }) }),
      executor: (async () => ({})) as Executor,
      authenticate: async () => ({ userId: "x" }),
    });
    const r = await req(app, "/public/query/priv");
    expect(r.status).toBe(404);
  });

  test("auth=none op → 200 anonymous", async () => {
    const capture: { userId?: string } = {};
    const flag = { called: false };
    const app = gptRoutes({
      registry: makeApp({ pub: makeOp("pub", { auth: "none" }) }),
      executor: makeExecutor(capture),
      authenticate: makeAuth("valid", flag),
    });
    const r = await req(app, "/public/query/pub");
    expect(r.status).toBe(200);
    expect(capture.userId).toBe("anonymous");
    expect(flag.called).toBe(false);
  });

  test("auth=optional + valid token → 200 w/ real userId", async () => {
    const capture: { userId?: string } = {};
    const flag = { called: false };
    const app = gptRoutes({
      registry: makeApp({ start: makeOp("start", { auth: "optional" }) }),
      executor: makeExecutor(capture),
      authenticate: makeAuth("valid", flag),
    });
    const r = await req(app, "/public/query/start", {
      headers: { Authorization: "Bearer tok4" },
    });
    expect(r.status).toBe(200);
    expect(capture.userId).toBe("user:tok4");
    expect(flag.called).toBe(true);
  });

  test("auth=optional + bad token → 200 anonymous (public swallows)", async () => {
    const capture: { userId?: string } = {};
    const flag = { called: false };
    const app = gptRoutes({
      registry: makeApp({ start: makeOp("start", { auth: "optional" }) }),
      executor: makeExecutor(capture),
      authenticate: makeAuth("invalid", flag),
    });
    const r = await req(app, "/public/query/start", {
      headers: { Authorization: "Bearer badtok" },
    });
    expect(r.status).toBe(200);
    expect(capture.userId).toBe("anonymous");
    expect(flag.called).toBe(true);
  });

  test("public mutate routes", async () => {
    const capture: { userId?: string; opId?: string } = {};
    const app = gptRoutes({
      registry: makeApp({
        pubmut: makeOp("pubmut", { auth: "none", type: "mutation" }),
      }),
      executor: makeExecutor(capture),
      authenticate: async () => ({ userId: "x" }),
    });
    const r = await req(app, "/public/mutate/pubmut", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ $variables: "{}" }),
    });
    expect(r.status).toBe(200);
    expect(capture.opId).toBe("pubmut");
    expect(capture.userId).toBe("anonymous");
  });
});
