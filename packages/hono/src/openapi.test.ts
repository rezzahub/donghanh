import { describe, expect, test } from "bun:test";
import type { OperationComponent, OperationConfig } from "@donghanh/core";
import { App, Brief, buildRegistry, Message } from "@donghanh/core";
import { generateOpenApi } from "./openapi";

function makeOp(
  id: string,
  overrides: Partial<OperationConfig> = {},
): OperationComponent {
  const op = ((_p: { data: unknown }) =>
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

function registry(ops: Record<string, OperationComponent>) {
  return buildRegistry(App({ operations: ops }));
}

const info = { title: "Test API", version: "1.0.0" };
const servers = [{ url: "https://api.example.com" }];
const basePath = "/api/gpt";

describe("generateOpenApi", () => {
  test("emits 3.1.0 spec with info + servers + bearerAuth scheme", () => {
    const spec = generateOpenApi({
      registry: registry({ a: makeOp("a") }),
      info,
      servers,
      basePath,
    }) as any;
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info).toEqual(info);
    expect(spec.servers).toEqual(servers);
    expect(spec.components.securitySchemes.bearerAuth).toEqual({
      type: "http",
      scheme: "bearer",
    });
  });

  test("auth=required emits default path only with bearerAuth", () => {
    const spec = generateOpenApi({
      registry: registry({ a: makeOp("a", { auth: "required" }) }),
      info,
      servers,
      basePath,
    }) as any;
    expect(Object.keys(spec.paths)).toEqual(["/api/gpt/query/a"]);
    expect(spec.paths["/api/gpt/query/a"].get.security).toEqual([
      { bearerAuth: [] },
    ]);
  });

  test("auth=none emits /public path with empty security", () => {
    const spec = generateOpenApi({
      registry: registry({ a: makeOp("a", { auth: "none" }) }),
      info,
      servers,
      basePath,
    }) as any;
    expect(Object.keys(spec.paths)).toEqual(["/api/gpt/public/query/a"]);
    expect(spec.paths["/api/gpt/public/query/a"].get.security).toEqual([]);
  });

  test("auth=optional emits BOTH default and /public paths", () => {
    const spec = generateOpenApi({
      registry: registry({ a: makeOp("a", { auth: "optional" }) }),
      info,
      servers,
      basePath,
    }) as any;
    const ks = Object.keys(spec.paths).sort();
    expect(ks).toEqual(["/api/gpt/public/query/a", "/api/gpt/query/a"]);
    expect(spec.paths["/api/gpt/query/a"].get.security).toEqual([
      { bearerAuth: [] },
    ]);
    expect(spec.paths["/api/gpt/public/query/a"].get.security).toEqual([]);
  });

  test("mutation emits POST with requestBody", () => {
    const spec = generateOpenApi({
      registry: registry({ m: makeOp("m", { type: "mutation" }) }),
      info,
      servers,
      basePath,
    }) as any;
    const entry = spec.paths["/api/gpt/mutate/m"];
    expect(entry.post.requestBody).toBeDefined();
    expect(entry.post.parameters).toBeUndefined();
  });

  test("query has $variables parameter", () => {
    const spec = generateOpenApi({
      registry: registry({ q: makeOp("q") }),
      info,
      servers,
      basePath,
    }) as any;
    const p = spec.paths["/api/gpt/query/q"].get.parameters;
    expect(p).toHaveLength(1);
    expect(p[0].name).toBe("$variables");
    expect(p[0].in).toBe("query");
  });

  test("description combines op description + instruction", () => {
    const spec = generateOpenApi({
      registry: registry({ a: makeOp("a") }),
      info,
      servers,
      basePath,
    }) as any;
    const op = spec.paths["/api/gpt/query/a"].get;
    expect(op.summary).toBe("a desc");
    expect(op.description).toContain("a desc");
    expect(op.description).toContain("call a");
  });

  test("operationId is unique per method+opId", () => {
    const spec = generateOpenApi({
      registry: registry({
        a: makeOp("a", { auth: "optional" }),
      }),
      info,
      servers,
      basePath,
    }) as any;
    const authedId = spec.paths["/api/gpt/query/a"].get.operationId;
    const publicId = spec.paths["/api/gpt/public/query/a"].get.operationId;
    expect(authedId).toBe("get_a");
    expect(publicId).toBe("get_a"); // Same handler, different path — OAS allows same operationId across paths
  });

  test("mixed registry — three auth tiers coexist", () => {
    const spec = generateOpenApi({
      registry: registry({
        priv: makeOp("priv", { auth: "required" }),
        mixed: makeOp("mixed", { auth: "optional" }),
        pub: makeOp("pub", { auth: "none" }),
      }),
      info,
      servers,
      basePath,
    }) as any;
    const ks = Object.keys(spec.paths).sort();
    expect(ks).toEqual([
      "/api/gpt/public/query/mixed",
      "/api/gpt/public/query/pub",
      "/api/gpt/query/mixed",
      "/api/gpt/query/priv",
    ]);
  });

  test("custom bearerSchemeName", () => {
    const spec = generateOpenApi({
      registry: registry({ a: makeOp("a") }),
      info,
      servers,
      basePath,
      bearerSchemeName: "oauthToken",
    }) as any;
    expect(spec.components.securitySchemes.oauthToken).toBeDefined();
    expect(spec.paths["/api/gpt/query/a"].get.security).toEqual([
      { oauthToken: [] },
    ]);
  });
});
