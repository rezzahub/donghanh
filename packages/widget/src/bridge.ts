/**
 * MCP Apps bridge — JSON-RPC 2.0 over postMessage between widget iframe and host.
 *
 * Usage:
 *   await initBridge({ name: "my-widget", version: "0.1.0" });
 *   const result = await rpcRequest("tools/call", { name: "foo", arguments: {} });
 *   const off = onNotification("ui/notifications/tool-result", (params) => {...});
 */

export const PROTOCOL_VERSION = "2026-01-26";

export interface AppInfo {
  name: string;
  version: string;
}

export interface ToolResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  _meta?: Record<string, unknown>;
  isError?: boolean;
}

type Resolver = {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
};

type NotificationHandler = (params: unknown) => void;

const pending = new Map<number, Resolver>();
const notifHandlers = new Map<string, Set<NotificationHandler>>();
let rpcId = 0;
let installed = false;
let initPromise: Promise<unknown> | null = null;

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener(
    "message",
    (event) => {
      if (event.source !== window.parent) return;
      const msg = event.data as {
        jsonrpc?: string;
        id?: number;
        method?: string;
        params?: unknown;
        result?: unknown;
        error?: { code: number; message: string };
      } | null;
      if (!msg || msg.jsonrpc !== "2.0") return;

      // Response
      if (typeof msg.id === "number") {
        const r = pending.get(msg.id);
        if (!r) return;
        pending.delete(msg.id);
        if (msg.error) r.reject(msg.error);
        else r.resolve(msg.result);
        return;
      }

      // Notification
      if (typeof msg.method === "string") {
        const handlers = notifHandlers.get(msg.method);
        if (!handlers) return;
        for (const h of handlers) h(msg.params);
      }
    },
    { passive: true },
  );
}

export function rpcRequest<T = unknown>(
  method: string,
  params?: unknown,
): Promise<T> {
  install();
  return new Promise<T>((resolve, reject) => {
    const id = ++rpcId;
    pending.set(id, {
      resolve: resolve as (v: unknown) => void,
      reject,
    });
    window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
  });
}

export function rpcNotify(method: string, params?: unknown): void {
  install();
  window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
}

export function onNotification(
  method: string,
  handler: NotificationHandler,
): () => void {
  install();
  let set = notifHandlers.get(method);
  if (!set) {
    set = new Set();
    notifHandlers.set(method, set);
  }
  set.add(handler);
  return () => {
    set?.delete(handler);
  };
}

export function initBridge(appInfo: AppInfo): Promise<unknown> {
  if (initPromise) return initPromise;
  install();
  initPromise = rpcRequest("ui/initialize", {
    appInfo,
    appCapabilities: {},
    protocolVersion: PROTOCOL_VERSION,
  }).then((result) => {
    rpcNotify("ui/notifications/initialized", {});
    return result;
  });
  return initPromise;
}

/** Call an MCP tool via the host bridge. */
export function callTool(
  name: string,
  args?: Record<string, unknown>,
): Promise<ToolResult> {
  return rpcRequest<ToolResult>("tools/call", { name, arguments: args ?? {} });
}

/** Post a message into the chat transcript. */
export function sendMessage(text: string, role: "user" | "assistant" = "user") {
  rpcNotify("ui/message", {
    role,
    content: [{ type: "text", text }],
  });
}

/** Update model-visible context from UI state. */
export function updateModelContext(
  content: Array<{ type: string; text?: string }>,
): Promise<unknown> {
  return rpcRequest("ui/update-model-context", { content });
}
