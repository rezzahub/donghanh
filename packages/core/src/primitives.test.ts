import { describe, expect, test } from "vitest";
import type { ChatNode, Renderer } from "./index";
import { Fragment, jsx, jsxs } from "./jsx-runtime";
// Test the JSX runtime + primitives by simulating what the transpiler produces
import { Action, Brief, Display, Message } from "./primitives";
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

const action = { operation: "a", label: "A" };

describe("text children", () => {
  const messages = (brief: ChatNode) =>
    renderNode(brief, collectTypes).filter((t) => t.startsWith("message:"));

  test("a number between text renders as one message", () => {
    const brief = jsxs(Brief as never, {
      children: ["You have ", 3, " items."],
    });
    expect(messages(brief)).toEqual(["message:You have 3 items."]);
  });

  test("a lone zero is kept", () => {
    const brief = jsx(Brief as never, { children: 0 });
    expect(messages(brief)).toEqual(["message:0"]);
  });

  test("a zero inside a fragment is kept", () => {
    const brief = jsx(Brief as never, {
      children: jsx(Fragment as never, { children: 0 }),
    });
    expect(messages(brief)).toEqual(["message:0"]);
  });

  test("an element keeps the text on each side separate", () => {
    const brief = jsxs(Brief as never, {
      children: ["before ", 1, jsx(Action as never, action), "after"],
    });
    expect(messages(brief)).toEqual(["message:before 1", "message:after"]);
  });

  test("Message joins mixed children", () => {
    const node = jsxs(Message as never, {
      children: ["Use version ", 2, " next."],
    });
    expect(node).toEqual({ type: "message", content: "Use version 2 next." });
  });
});
