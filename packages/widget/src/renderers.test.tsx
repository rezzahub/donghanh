import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Actions, Display, Form } from "./renderers";

describe("Display", () => {
  test("renders string as paragraph", () => {
    render(<Display data="hello" />);
    expect(screen.getByText("hello")).toBeTruthy();
  });

  test("renders array of primitives as list", () => {
    render(<Display data={["a", "b", "c"]} />);
    expect(screen.getByText("a")).toBeTruthy();
    expect(screen.getByText("b")).toBeTruthy();
    expect(screen.getByText("c")).toBeTruthy();
  });

  test("renders object as record", () => {
    render(<Display data={{ name: "Alice", age: 30 }} />);
    expect(screen.getByText("name")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("age")).toBeTruthy();
    expect(screen.getByText("30")).toBeTruthy();
  });

  test("empty array shows muted message", () => {
    render(<Display data={[]} />);
    expect(screen.getByText("No items.")).toBeTruthy();
  });

  test("null data renders nothing", () => {
    const { container } = render(<Display data={null} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("Actions", () => {
  test("renders buttons from items", () => {
    render(
      <Actions
        items={[
          { id: "a", type: "action", description: "Click A" },
          { id: "b", type: "action", description: "Click B" },
        ]}
      />,
    );
    expect(screen.getByText("Click A")).toBeTruthy();
    expect(screen.getByText("Click B")).toBeTruthy();
  });

  test("onCall override called with id + variables", async () => {
    const captured: { id: string; vars?: unknown }[] = [];
    render(
      <Actions
        items={[
          {
            id: "greet",
            type: "action",
            description: "Greet",
            variables: { name: "X" },
          },
        ]}
        onCall={(id, vars) => {
          captured.push({ id, vars });
        }}
      />,
    );
    (screen.getByText("Greet") as HTMLButtonElement).click();
    expect(captured[0]).toEqual({ id: "greet", vars: { name: "X" } });
  });

  test("no items → nothing rendered", () => {
    const { container } = render(<Actions items={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("Form", () => {
  test("renders fields from descriptor", () => {
    render(
      <Form
        descriptor={{
          operation: "create",
          fields: [
            { name: "title", type: "text", label: "Title", required: true },
            { name: "count", type: "number" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Title")).toBeTruthy();
    expect(screen.getByText("count")).toBeTruthy();
  });

  test("submit calls onSubmit with operation + values", () => {
    const captured: { op: string; values: Record<string, unknown> }[] = [];
    const { container } = render(
      <Form
        descriptor={{
          operation: "create",
          fields: [{ name: "title", type: "text" }],
        }}
        onSubmit={(op, values) => {
          captured.push({ op, values });
        }}
      />,
    );
    const input = container.querySelector(
      "input[name=title]",
    ) as HTMLInputElement;
    input.value = "hello";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const form = container.querySelector("form") as HTMLFormElement;
    form.dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true }),
    );

    expect(captured[0]?.op).toBe("create");
  });

  test("no descriptor → nothing", () => {
    const { container } = render(<Form />);
    expect(container.innerHTML).toBe("");
  });
});
