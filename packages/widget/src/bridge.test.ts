import { beforeEach, describe, expect, test } from "bun:test";

// Minimal DOM stub — we only need window, postMessage, addEventListener, MessageEvent.
type Listener = (event: { source: unknown; data: unknown }) => void;

interface WindowStub {
  parent: WindowStub;
  postMessage: (data: unknown, target: string) => void;
  addEventListener: (type: string, listener: Listener, opts?: unknown) => void;
  removeEventListener: (type: string, listener: Listener) => void;
}

function installWindow(): {
  window: WindowStub;
  outgoing: Array<{ data: unknown; target: string }>;
  deliver: (data: unknown) => void;
} {
  const listeners: Listener[] = [];
  const outgoing: Array<{ data: unknown; target: string }> = [];
  const w = {
    postMessage: (data: unknown, target: string) => {
      outgoing.push({ data, target });
    },
    addEventListener: (_type: string, listener: Listener) => {
      listeners.push(listener);
    },
    removeEventListener: () => {},
  } as unknown as WindowStub;
  w.parent = w;
  (globalThis as unknown as { window: WindowStub }).window = w;

  const deliver = (data: unknown) => {
    for (const l of listeners) l({ source: w, data });
  };
  return { window: w, outgoing, deliver };
}

async function freshBridge() {
  const mod = await import(`./bridge?v=${Math.random()}`);
  return mod as typeof import("./bridge");
}

describe("bridge", () => {
  let ctx: ReturnType<typeof installWindow>;

  beforeEach(() => {
    ctx = installWindow();
  });

  test("rpcRequest posts jsonrpc message and resolves on response", async () => {
    const bridge = await freshBridge();
    const promise = bridge.rpcRequest("foo/bar", { x: 1 });

    expect(ctx.outgoing).toHaveLength(1);
    const sent = ctx.outgoing[0].data as {
      jsonrpc: string;
      id: number;
      method: string;
      params: unknown;
    };
    expect(sent.jsonrpc).toBe("2.0");
    expect(sent.method).toBe("foo/bar");
    expect(sent.params).toEqual({ x: 1 });

    ctx.deliver({ jsonrpc: "2.0", id: sent.id, result: { ok: true } });
    const result = await promise;
    expect(result).toEqual({ ok: true });
  });

  test("rpcRequest rejects on error response", async () => {
    const bridge = await freshBridge();
    const promise = bridge.rpcRequest("foo");
    const sent = ctx.outgoing[0].data as { id: number };
    ctx.deliver({
      jsonrpc: "2.0",
      id: sent.id,
      error: { code: -32601, message: "nope" },
    });
    await expect(promise).rejects.toEqual({ code: -32601, message: "nope" });
  });

  test("rpcNotify posts message without id", async () => {
    const bridge = await freshBridge();
    bridge.rpcNotify("ping", { a: 1 });
    expect(ctx.outgoing).toHaveLength(1);
    const sent = ctx.outgoing[0].data as { id?: number; method: string };
    expect(sent.id).toBeUndefined();
    expect(sent.method).toBe("ping");
  });

  test("onNotification fires on matching method", async () => {
    const bridge = await freshBridge();
    const received: unknown[] = [];
    bridge.onNotification("ui/notifications/tool-result", (p) => {
      received.push(p);
    });
    ctx.deliver({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: { hello: "world" },
    });
    expect(received).toEqual([{ hello: "world" }]);
  });

  test("onNotification returns unsubscribe", async () => {
    const bridge = await freshBridge();
    const received: unknown[] = [];
    const off = bridge.onNotification("x", (p) => received.push(p));
    off();
    ctx.deliver({ jsonrpc: "2.0", method: "x", params: 1 });
    expect(received).toEqual([]);
  });

  test("ignores non-jsonrpc messages", async () => {
    const bridge = await freshBridge();
    const received: unknown[] = [];
    bridge.onNotification("x", (p) => received.push(p));
    ctx.deliver({ method: "x", params: 1 });
    ctx.deliver("random string");
    expect(received).toEqual([]);
  });

  test("initBridge sends ui/initialize then notifications/initialized", async () => {
    const bridge = await freshBridge();
    const p = bridge.initBridge({ name: "app", version: "1" });
    const first = ctx.outgoing[0].data as {
      id: number;
      method: string;
      params: { appInfo: { name: string }; protocolVersion: string };
    };
    expect(first.method).toBe("ui/initialize");
    expect(first.params.appInfo.name).toBe("app");
    expect(first.params.protocolVersion).toBe(bridge.PROTOCOL_VERSION);

    ctx.deliver({ jsonrpc: "2.0", id: first.id, result: {} });
    await p;

    const second = ctx.outgoing[1].data as { method: string };
    expect(second.method).toBe("ui/notifications/initialized");
  });

  test("callTool wraps tools/call", async () => {
    const bridge = await freshBridge();
    const p = bridge.callTool("foo", { a: 1 });
    const sent = ctx.outgoing[0].data as {
      id: number;
      method: string;
      params: { name: string; arguments: unknown };
    };
    expect(sent.method).toBe("tools/call");
    expect(sent.params).toEqual({ name: "foo", arguments: { a: 1 } });
    ctx.deliver({
      jsonrpc: "2.0",
      id: sent.id,
      result: { structuredContent: { ok: true } },
    });
    const result = await p;
    expect(result.structuredContent).toEqual({ ok: true });
  });
});
