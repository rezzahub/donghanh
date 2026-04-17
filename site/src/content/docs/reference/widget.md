---
title: "@donghanh/widget"
description: Iframe runtime for donghanh Apps SDK widgets.
---

Runtime that lives inside the ChatGPT widget iframe. Initializes the MCP Apps bridge (JSON-RPC over `postMessage`), subscribes to tool results, exposes hooks for tool calls, and provides default React renderers for donghanh Brief data.

## Install

```bash
npm install @donghanh/widget react react-dom
```

## Quick start

```tsx
import { createRoot } from "react-dom/client";
import { DongHanhWidget } from "@donghanh/widget";

createRoot(document.getElementById("root")!).render(<DongHanhWidget />);
```

Bundle with `@donghanh/widget-vite` to produce inline HTML for `mcpRoutes({ widgets })`.

## Bridge

```ts
import {
  initBridge,
  rpcRequest,
  rpcNotify,
  onNotification,
  callTool,
  sendMessage,
  updateModelContext,
  PROTOCOL_VERSION,
} from "@donghanh/widget";
```

Low-level helpers over the host `postMessage` bridge. Messages follow JSON-RPC 2.0. Protocol version is `2026-01-26`.

## Hooks

```ts
import {
  useBridge,
  useToolResult,
  useToolInput,
  useCallTool,
  useSendMessage,
  useUpdateModelContext,
} from "@donghanh/widget";
```

| Hook | Purpose |
|---|---|
| `useBridge(appInfo?)` | Initializes the bridge. Returns `true` when ready. |
| `useToolResult<T>()` | Subscribes to `ui/notifications/tool-result`. |
| `useToolInput<T>()` | Subscribes to `ui/notifications/tool-input`. |
| `useCallTool()` | Returns `(name, args?) => Promise<ToolResult>`. |
| `useSendMessage()` | Posts a message into the chat transcript. |
| `useUpdateModelContext()` | Pushes UI state back to the model. |

## Renderers

```ts
import { Display, Actions, Form, Layout, WidgetStyles } from "@donghanh/widget";
```

Default components that render donghanh Brief nodes from `structuredContent`:

- `<Display data={...} />` — renders strings, numbers, arrays, and records.
- `<Actions items={...} />` — renders Brief `Action` nodes as buttons that call tools.
- `<Form descriptor={...} />` — renders Brief `Form` nodes with submit wiring.
- `<Layout>`, `<WidgetStyles>` — default shell and inline CSS.

## `DongHanhWidget`

Convenience component that composes the hooks + renderers:

```tsx
<DongHanhWidget
  appName="kanban-widget"
  appVersion="0.1.0"
  css={customCss}
  fallback={<div>Loading…</div>}
/>
```

Reads `structuredContent.display`, `structuredContent.actions`, and `structuredContent.form` from the latest tool result.
