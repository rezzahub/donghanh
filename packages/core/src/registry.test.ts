import { describe, expect, test } from "bun:test";
import { App, Brief, Message } from "./primitives";
import { buildRegistry } from "./registry";
import type { OperationComponent, OperationConfig } from "./types";

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

describe("buildRegistry", () => {
  test("instructions come from App", () => {
    const reg = buildRegistry(
      App({ operations: {}, instructions: "Call start first." }),
    );
    expect(reg.instructions()).toBe("Call start first.");
    expect(
      buildRegistry(App({ operations: {} })).instructions(),
    ).toBeUndefined();
  });

  test("throws on two operations with the same id", () => {
    expect(() =>
      buildRegistry(App({ operations: { a: makeOp("x"), b: makeOp("x") } })),
    ).toThrow(/Duplicate operation id "x"/);
  });

  test("detail and list carry the new facts", () => {
    const op = makeOp("keep", {
      type: "mutation",
      title: "Keep",
      idempotent: true,
      tags: ["board"],
      meta: { "anthropic/maxResultSizeChars": 1000 },
      appCallable: true,
      destructive: false,
    });
    const reg = buildRegistry(App({ operations: { op } }));
    expect(reg.detail("keep")).toMatchObject({
      title: "Keep",
      idempotent: true,
      tags: ["board"],
      meta: { "anthropic/maxResultSizeChars": 1000 },
      appCallable: true,
    });
    expect(reg.list()[0]).toMatchObject({
      id: "keep",
      title: "Keep",
      tags: ["board"],
      destructive: false,
    });
  });

  test("list omits undefined optional keys", () => {
    const reg = buildRegistry(App({ operations: { a: makeOp("a") } }));
    expect(Object.keys(reg.list()[0]).sort()).toEqual([
      "description",
      "id",
      "type",
    ]);
  });
});
