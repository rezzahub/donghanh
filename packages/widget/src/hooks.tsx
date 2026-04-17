import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AppInfo,
  callTool as bridgeCallTool,
  sendMessage as bridgeSendMessage,
  updateModelContext as bridgeUpdateCtx,
  initBridge,
  onNotification,
  type ToolResult,
} from "./bridge";

const DEFAULT_APP_INFO: AppInfo = {
  name: "donghanh-widget",
  version: "0.1.0",
};

/** Initialize the MCP Apps bridge exactly once for this widget instance. */
export function useBridge(appInfo: AppInfo = DEFAULT_APP_INFO): boolean {
  const [ready, setReady] = useState(false);
  const infoRef = useRef(appInfo);
  infoRef.current = appInfo;

  useEffect(() => {
    let cancelled = false;
    initBridge(infoRef.current)
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}

/** Subscribe to `ui/notifications/tool-result`. Re-renders when host pushes new data. */
export function useToolResult<T = unknown>():
  | (ToolResult & {
      structuredContent?: T;
    })
  | null {
  const [result, setResult] = useState<ToolResult | null>(null);
  useEffect(() => {
    return onNotification("ui/notifications/tool-result", (params) => {
      setResult(params as ToolResult);
    });
  }, []);
  return result as (ToolResult & { structuredContent?: T }) | null;
}

/** Subscribe to `ui/notifications/tool-input` — the arguments the model sent when invoking. */
export function useToolInput<T = unknown>(): T | null {
  const [input, setInput] = useState<T | null>(null);
  useEffect(() => {
    return onNotification("ui/notifications/tool-input", (params) => {
      const p = params as { arguments?: T } | T;
      if (p && typeof p === "object" && "arguments" in (p as object)) {
        setInput((p as { arguments?: T }).arguments ?? null);
      } else {
        setInput(p as T);
      }
    });
  }, []);
  return input;
}

/** Return a callback that invokes an MCP tool through the host. */
export function useCallTool() {
  return useCallback(
    (name: string, args?: Record<string, unknown>) =>
      bridgeCallTool(name, args),
    [],
  );
}

/** Return a callback that posts a message into the chat transcript. */
export function useSendMessage() {
  return useCallback(
    (text: string, role?: "user" | "assistant") =>
      bridgeSendMessage(text, role),
    [],
  );
}

/** Return a callback that updates the model-visible context from UI state. */
export function useUpdateModelContext() {
  return useCallback(
    (content: Array<{ type: string; text?: string }>) =>
      bridgeUpdateCtx(content),
    [],
  );
}
