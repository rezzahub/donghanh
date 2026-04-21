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

describe("generateOpenApi common", () => {
  test("emits 3.1.0 spec with info + servers + bearerAuth + empty schemas", () => {
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
    expect(spec.components.schemas).toEqual({});
  });

  test("includeDescription is off by default — no description field", () => {
    const spec = generateOpenApi({
      registry: registry({ a: makeOp("a") }),
      info,
      servers,
      basePath,
      pathStyle: "per-op",
    }) as any;
    const entry = spec.paths["/api/gpt/query/a"].get;
    expect(entry.description).toBeUndefined();
    expect(entry.summary).toBe("a desc");
  });

  test("includeDescription: true emits description built from desc+instruction", () => {
    const spec = generateOpenApi({
      registry: registry({ a: makeOp("a") }),
      info,
      servers,
      basePath,
      pathStyle: "per-op",
      includeDescription: true,
    }) as any;
    const d = spec.paths["/api/gpt/query/a"].get.description as string;
    expect(d).toContain("a desc");
    expect(d).toContain("call a");
  });

  test("description truncated at maxDescriptionLength when included", () => {
    const spec = generateOpenApi({
      registry: registry({
        a: makeOp("a", { instruction: "x".repeat(500) }),
      }),
      info,
      servers,
      basePath,
      pathStyle: "per-op",
      includeDescription: true,
    }) as any;
    const d = spec.paths["/api/gpt/query/a"].get.description as string;
    expect(d.length).toBeLessThanOrEqual(300);
    expect(d.endsWith("…")).toBe(true);
  });

  test("summary capped at 120 chars", () => {
    const spec = generateOpenApi({
      registry: registry({
        a: makeOp("a", { description: "y".repeat(200) }),
      }),
      info,
      servers,
      basePath,
      pathStyle: "per-op",
    }) as any;
    const s = spec.paths["/api/gpt/query/a"].get.summary as string;
    expect(s.length).toBeLessThanOrEqual(120);
  });

  test("custom bearerSchemeName", () => {
    const spec = generateOpenApi({
      registry: registry({ a: makeOp("a") }),
      info,
      servers,
      basePath,
      pathStyle: "per-op",
      bearerSchemeName: "oauthToken",
    }) as any;
    expect(spec.components.securitySchemes.oauthToken).toBeDefined();
    expect(spec.paths["/api/gpt/query/a"].get.security).toEqual([
      { oauthToken: [] },
    ]);
  });
});

describe("generateOpenApi pathStyle: 'per-op'", () => {
  const opts = {
    info,
    servers,
    basePath,
    pathStyle: "per-op" as const,
  };

  test("auth=required emits default path only with bearerAuth", () => {
    const spec = generateOpenApi({
      ...opts,
      registry: registry({ a: makeOp("a", { auth: "required" }) }),
    }) as any;
    expect(Object.keys(spec.paths)).toEqual(["/api/gpt/query/a"]);
    expect(spec.paths["/api/gpt/query/a"].get.security).toEqual([
      { bearerAuth: [] },
    ]);
  });

  test("auth=none emits /public path with empty security", () => {
    const spec = generateOpenApi({
      ...opts,
      registry: registry({ a: makeOp("a", { auth: "none" }) }),
    }) as any;
    expect(Object.keys(spec.paths)).toEqual(["/api/gpt/public/query/a"]);
    expect(spec.paths["/api/gpt/public/query/a"].get.security).toEqual([]);
  });

  test("auth=optional emits both default and /public paths", () => {
    const spec = generateOpenApi({
      ...opts,
      registry: registry({ a: makeOp("a", { auth: "optional" }) }),
    }) as any;
    const ks = Object.keys(spec.paths).sort();
    expect(ks).toEqual(["/api/gpt/public/query/a", "/api/gpt/query/a"]);
  });

  test("mutation emits POST with requestBody", () => {
    const spec = generateOpenApi({
      ...opts,
      registry: registry({ m: makeOp("m", { type: "mutation" }) }),
    }) as any;
    const entry = spec.paths["/api/gpt/mutate/m"];
    expect(entry.post.requestBody).toBeDefined();
    expect(entry.post.parameters).toBeUndefined();
  });

  test("query has $variables parameter", () => {
    const spec = generateOpenApi({
      ...opts,
      registry: registry({ q: makeOp("q") }),
    }) as any;
    const p = spec.paths["/api/gpt/query/q"].get.parameters;
    expect(p).toHaveLength(1);
    expect(p[0].name).toBe("$variables");
  });
});

describe("generateOpenApi pathStyle: 'parametric' (default)", () => {
  test("collapses all query ops under one /query/{operation} path with enum", () => {
    const spec = generateOpenApi({
      registry: registry({
        a: makeOp("a", { auth: "required" }),
        b: makeOp("b", { auth: "required" }),
      }),
      info,
      servers,
      basePath,
    }) as any;
    const ks = Object.keys(spec.paths);
    expect(ks).toEqual(["/api/gpt/query/{operation}"]);
    const opParam = spec.paths["/api/gpt/query/{operation}"].get.parameters[0];
    expect(opParam.name).toBe("operation");
    expect(opParam.in).toBe("path");
    expect(opParam.schema.enum).toEqual(["a", "b"]);
  });

  test("emits /public/{operation} when any op is auth=none or optional", () => {
    const spec = generateOpenApi({
      registry: registry({
        priv: makeOp("priv", { auth: "required" }),
        pub: makeOp("pub", { auth: "none" }),
        both: makeOp("both", { auth: "optional" }),
      }),
      info,
      servers,
      basePath,
    }) as any;
    const ks = Object.keys(spec.paths).sort();
    expect(ks).toEqual([
      "/api/gpt/public/query/{operation}",
      "/api/gpt/query/{operation}",
    ]);
    // Default enum contains authed ops: required + optional (not "none")
    expect(
      spec.paths["/api/gpt/query/{operation}"].get.parameters[0].schema.enum,
    ).toEqual(["priv", "both"]);
    // Public enum contains guest-callable ops: none + optional (not "required")
    expect(
      spec.paths["/api/gpt/public/query/{operation}"].get.parameters[0].schema
        .enum,
    ).toEqual(["pub", "both"]);
  });

  test("separate /mutate/{operation} path for mutations", () => {
    const spec = generateOpenApi({
      registry: registry({
        m: makeOp("m", { type: "mutation" }),
      }),
      info,
      servers,
      basePath,
    }) as any;
    expect(spec.paths["/api/gpt/mutate/{operation}"]).toBeDefined();
    expect(
      spec.paths["/api/gpt/mutate/{operation}"].post.requestBody,
    ).toBeDefined();
  });

  test("no description field by default (ChatGPT-safe)", () => {
    const spec = generateOpenApi({
      registry: registry({ a: makeOp("a") }),
      info,
      servers,
      basePath,
    }) as any;
    const entry = spec.paths["/api/gpt/query/{operation}"].get;
    expect(entry.description).toBeUndefined();
  });

  test("includeDescription: true emits a short description", () => {
    const spec = generateOpenApi({
      registry: registry({ a: makeOp("a") }),
      info,
      servers,
      basePath,
      includeDescription: true,
    }) as any;
    const d = spec.paths["/api/gpt/query/{operation}"].get
      .description as string;
    expect(typeof d).toBe("string");
    expect(d.length).toBeLessThanOrEqual(300);
  });
});
