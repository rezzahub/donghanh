import type { OperationComponent, OperationConfig } from "@donghanh/core";
import { App, buildRegistry } from "@donghanh/core";
import { describe, expect, test } from "vitest";
import { resolveExposure } from "./exposure";

function op(
  id: string,
  overrides: Partial<OperationConfig> = {},
): OperationComponent {
  const c = (() => null) as unknown as OperationComponent;
  c.operationConfig = {
    id,
    type: "query",
    description: `${id} desc`,
    instruction: `call ${id}`,
    input: { type: "object", properties: {} },
    responseKey: id,
    ...overrides,
  };
  return c;
}

const reg = buildRegistry(
  App({
    operations: {
      w: op("w", { widget: "board" }),
      p: op("p"),
      q: op("q"),
      m: op("m", { type: "mutation", tags: ["x"] }),
    },
  }),
);

describe("resolveExposure", () => {
  test("no exposure: every operation is a tool", () => {
    const r = resolveExposure(reg, undefined);
    expect([...r.placement.values()].every((v) => v === "tool")).toBe(true);
    expect(r.placement.size).toBe(4);
    expect(r.catalogIds()).toEqual([]);
    expect(r.pinned.size).toBe(0);
    expect(r.appOnly.size).toBe(0);
  });

  test("order: widget > pin > tools > catalog > default", () => {
    const r = resolveExposure(reg, {
      default: "tool",
      catalog: { type: "query" },
      tools: { tags: ["x"] },
      pin: ["p"],
    });
    expect(r.placement.get("w")).toBe("tool");
    expect(r.placement.get("p")).toBe("tool");
    expect(r.placement.get("q")).toBe("catalog");
    expect(r.placement.get("m")).toBe("tool");
    expect(r.pinned.has("p")).toBe(true);
    expect(r.catalogIds()).toEqual(["q"]);
  });

  test("tools selector beats catalog selector; default applies last", () => {
    const r = resolveExposure(reg, {
      default: "catalog",
      tools: { ids: ["q"] },
      catalog: { ids: ["q", "m"] },
    });
    expect(r.placement.get("q")).toBe("tool");
    expect(r.placement.get("m")).toBe("catalog");
    expect(r.placement.get("p")).toBe("catalog");
    expect(r.placement.get("w")).toBe("tool");
  });

  test("selector fields AND together; tags match any", () => {
    const r = resolveExposure(reg, {
      default: "catalog",
      tools: { type: "mutation", tags: ["y", "x"] },
    });
    expect(r.placement.get("m")).toBe("tool");
    const r2 = resolveExposure(reg, {
      default: "catalog",
      tools: { type: "query", tags: ["x"] },
    });
    expect(r2.placement.get("m")).toBe("catalog");
    expect(r2.placement.get("q")).toBe("catalog");
  });

  test("empty selector matches nothing", () => {
    const r = resolveExposure(reg, { default: "catalog", tools: {} });
    expect(r.placement.get("q")).toBe("catalog");
  });

  test("widget and destructive selectors", () => {
    const r2 = buildRegistry(
      App({
        operations: {
          a: op("a", { widget: "b" }),
          b: op("b"),
          c: op("c", { type: "mutation", destructive: true }),
          d: op("d", { type: "mutation" }),
        },
      }),
    );
    const r = resolveExposure(r2, {
      default: "tool",
      catalog: { widget: false, destructive: false },
    });
    expect(r.placement.get("a")).toBe("tool");
    expect(r.placement.get("b")).toBe("catalog");
    expect(r.placement.get("c")).toBe("tool");
    expect(r.placement.get("d")).toBe("catalog");
  });

  test("unknown ids in pin or selectors throw naming the id", () => {
    expect(() => resolveExposure(reg, { pin: ["nope"] })).toThrow(/nope/);
    expect(() => resolveExposure(reg, { tools: { ids: ["nah"] } })).toThrow(
      /nah/,
    );
    expect(() => resolveExposure(reg, { catalog: { ids: ["zip"] } })).toThrow(
      /zip/,
    );
  });

  test("appCallable catalog operations are app-only", () => {
    const r2 = buildRegistry(
      App({
        operations: {
          a: op("a", { appCallable: true }),
          b: op("b"),
          c: op("c", { appCallable: true }),
        },
      }),
    );
    const r = resolveExposure(r2, {
      default: "catalog",
      tools: { ids: ["c"] },
    });
    expect([...r.appOnly]).toEqual(["a"]);
  });
});
