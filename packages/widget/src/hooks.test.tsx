import { describe, expect, test } from "bun:test";
import { act, render } from "@testing-library/react";
import { useToolResult } from "./hooks";

function deliver(data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data, source: window }));
}

describe("useToolResult", () => {
  test("updates on ui/notifications/tool-result", async () => {
    let latest: unknown = null;
    function Probe() {
      const r = useToolResult();
      latest = r;
      return null;
    }
    render(<Probe />);
    expect(latest).toBeNull();

    act(() => {
      deliver({
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: {
          structuredContent: { tasks: [{ id: 1 }] },
        },
      });
    });

    expect(latest).toEqual({ structuredContent: { tasks: [{ id: 1 }] } });
  });

  test("ignores unrelated methods", async () => {
    let latest: unknown = "init";
    function Probe() {
      latest = useToolResult();
      return null;
    }
    render(<Probe />);

    act(() => {
      deliver({ jsonrpc: "2.0", method: "other/method", params: {} });
    });

    expect(latest).toBeNull();
  });
});
