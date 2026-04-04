import { describe, expect, test } from "bun:test";
import type { ChatNode, Renderer } from "./index";
import { Fragment, jsx, jsxs } from "./jsx-runtime";
// Test the JSX runtime + primitives by simulating what the transpiler produces
import { Action, Brief, Display } from "./primitives";
import { renderNode } from "./render";

// Simple renderer that collects node types for verification
const collectTypes: Renderer<string[]> = {
  brief(_node, children) {
    return children.flat();
  },
  message(node) {
    return [`message:${node.content}`];
  },
  action(node) {
    return [`action:${node.operation}`];
  },
  form() {
    return ["form"];
  },
  display() {
    return ["display"];
  },
  context() {
    return ["context"];
  },
};

describe("Brief with nested fragments from map", () => {
  test("map returning fragments produces valid children", () => {
    // Simulates what JSX transpiler produces for:
    //   <Brief>
    //     Some text
    //     {items.map(item => (
    //       <>
    //         <Display data={item.data} />
    //         <Action operation={item.op} label={item.label} />
    //       </>
    //     ))}
    //   </Brief>

    const items = [
      { data: "balance1", op: "settle-1", label: "Settle 1" },
      { data: "balance2", op: "settle-2", label: "Settle 2" },
    ];

    // Fragment produces ChatNode[]
    const fragments = items.map((item) =>
      jsx(Fragment as any, {
        children: [
          jsx(Display as any, { data: item.data }),
          jsx(Action as any, { operation: item.op, label: item.label }),
        ],
      }),
    );

    // Brief receives [string, ...ChatNode[][]] as children
    const brief = jsxs(Brief as any, {
      children: ["Some text", ...fragments],
    });

    // This should not throw — all children should be valid ChatNode objects
    expect(brief.type).toBe("brief");

    const types = renderNode(brief as ChatNode, collectTypes);
    expect(types).toContain("message:Some text");
    expect(types).toContain("display");
    expect(types).toContain("action:settle-1");
    expect(types).toContain("action:settle-2");
  });

  test("deeply nested arrays from map+filter+map are flattened", () => {
    // Simulates:
    //   <Brief>
    //     {groups.map(group => (
    //       <>
    //         <Display data={group.display} />
    //         {group.debts.filter(...).map(debt => (
    //           <Action operation="settle" label={debt.label} />
    //         ))}
    //       </>
    //     ))}
    //   </Brief>

    const groups = [
      {
        display: "Group 1 balances",
        debts: [{ label: "Debt A" }, { label: "Debt B" }],
      },
    ];

    const fragments = groups.map((group) => {
      const debtActions = group.debts.map((debt) =>
        jsx(Action as any, { operation: "settle", label: debt.label }),
      );
      return jsx(Fragment as any, {
        children: [
          jsx(Display as any, { data: group.display }),
          ...debtActions,
        ],
      });
    });

    const brief = jsxs(Brief as any, {
      children: [...fragments],
    });

    expect(brief.type).toBe("brief");

    const types = renderNode(brief as ChatNode, collectTypes);
    expect(types).toContain("display");
    expect(types).toContain("action:settle");
    expect(types).toHaveLength(3); // 1 display + 2 actions
  });

  test("null and undefined children from conditional rendering are filtered", () => {
    // Simulates:
    //   <Brief>
    //     {condition && <Display data="x" />}
    //     <Action operation="a" label="A" />
    //   </Brief>

    const brief = jsxs(Brief as any, {
      children: [
        false, // condition && <Display />
        null,
        undefined,
        jsx(Action as any, { operation: "a", label: "A" }),
      ],
    });

    expect(brief.type).toBe("brief");

    // Should not throw on null/undefined/false children
    const types = renderNode(brief as ChatNode, collectTypes);
    expect(types).toContain("action:a");
  });
});
