---
title: ChatGPT Apps SDK
description: Deploy a donghanh app as a ChatGPT Apps SDK connector with MCP + widget iframe.
---

The Apps SDK lets users add your app to ChatGPT as a connector. Your server speaks MCP (Model Context Protocol); ChatGPT renders your widget in an iframe.

## Architecture

```
ChatGPT ─── MCP (JSON-RPC over HTTP) ───► your /mcp endpoint
             │
             └── resources/read ──► widget HTML ──► iframe (postMessage bridge)
```

- `mcpRoutes` (from `@donghanh/hono`) exposes `/mcp` + `/.well-known/oauth-protected-resource`.
- `@donghanh/widget-vite` bundles widgets into inline HTML with content-hashed URIs and emits a manifest.
- The worker imports the manifest and passes it to `mcpRoutes({ widgets })`.

## Server side

```ts
import { mcpRoutes } from "@donghanh/hono";
import { widgets } from "./dist/widgets-build/widgets/manifest.js";

app.route("/", mcpRoutes({
  registry,
  executor,
  authenticate,
  resource: "https://your-app.example.com",
  authorizationServers: ["https://auth.example.com"],
  scopes: ["profile"],
  widgets,
}));
```

Per-op widget binding:

```ts
registerOperation(ListBoards, {
  id: "list-boards",
  // ...
  widget: "boards",   // matches a key in the widgets map
});
```

Data-only ops (no visual UI) omit the `widget` field — the model reads `structuredContent` directly without loading an iframe.

## Widget side

Create a widget entry:

```tsx
// widgets/boards.tsx
import { createRoot } from "react-dom/client";
import { DongHanhWidget } from "@donghanh/widget";

createRoot(document.getElementById("root")!).render(<DongHanhWidget />);
```

Register it in `donghanh.config.ts`:

```ts
import { defineConfig } from "@donghanh/config";

export default defineConfig({
  widgets: { boards: "./widgets/boards.tsx" },
  server: {
    widgetDomain: "https://your-app.example.com",
    csp: {
      connectDomains: ["https://api.your-app.example.com"],
      resourceDomains: ["https://persistent.oaistatic.com"],
    },
  },
});
```

Vite build:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { donghanhWidgets } from "@donghanh/widget-vite";
import config from "./donghanh.config";

export default defineConfig({
  plugins: [
    donghanhWidgets({
      entries: config.widgets ?? {},
      domain: config.server?.widgetDomain,
      csp: config.server?.csp,
    }),
  ],
});
```

Run `vite build` → `dist/widgets-build/widgets/manifest.js` is generated. Import it in the worker.

## Auth

The MCP authorization spec requires:

- RFC 9728 protected resource metadata at `/.well-known/oauth-protected-resource` (mcpRoutes serves this).
- Your OAuth authorization server publishing `/.well-known/oauth-authorization-server` with DCR + PKCE `S256`.
- Per-op `securitySchemes` on tools (mcpRoutes derives from `OperationConfig.auth`).
- Unauth responses include `_meta["mcp/www_authenticate"]` to trigger ChatGPT's OAuth UI.

Better Auth's `oidcProvider` plugin covers the authorization-server side.

## Adding to ChatGPT

1. **Settings → Apps & Connectors → Advanced settings** → enable **Developer Mode**.
2. **Settings → Connectors → Create** → paste `https://your-app.example.com/mcp`.
3. Name it, add a description, click Create.
4. Open a chat, click **+** → **More** → select your connector.

## Testing with MCP Inspector

Before hooking up ChatGPT, verify with [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector):

```bash
npx @modelcontextprotocol/inspector@latest --server-url http://localhost:8787/mcp --transport http
```

## Submission

For broader distribution, review the [ChatGPT app submission guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines). You'll need a production HTTPS endpoint, valid `widgetDomain`, declared CSP, and tool annotations that accurately describe destructiveness.

## Further reading

- [`@donghanh/hono` mcpRoutes reference](/reference/hono)
- [`@donghanh/widget` reference](/reference/widget)
- [`@donghanh/widget-vite` reference](/reference/widget-vite)
- [Apps SDK quickstart](https://developers.openai.com/apps-sdk/quickstart)
