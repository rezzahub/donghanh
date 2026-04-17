---
title: "@donghanh/config"
description: defineConfig + loadConfig for donghanh.config.ts.
---

Typed config helper for donghanh apps. `donghanh.config.ts` is the single source of truth for operations, widgets, and server wiring — read by the CLI (`@donghanh/cli`) when scaffolding and by the Vite plugin (`@donghanh/widget-vite`) when building widgets.

## Install

```bash
npm install @donghanh/config
```

## defineConfig

```ts
import { defineConfig } from "@donghanh/config";

export default defineConfig({
  operations: "./operations/**/*.tsx",
  widgets: {
    boards: "./widgets/boards.tsx",
  },
  server: {
    resource: "https://kanban.example.com",
    authorizationServers: ["https://auth.example.com"],
    widgetDomain: "https://kanban.example.com",
    csp: {
      connectDomains: ["https://api.kanban.example.com"],
      resourceDomains: ["https://persistent.oaistatic.com"],
    },
  },
});
```

Identity function — no runtime effect, just type inference.

## loadConfig

```ts
import { loadConfig, findConfig } from "@donghanh/config";

const loaded = await loadConfig();        // walks up from cwd
if (loaded) {
  console.log(loaded.path, loaded.config);
}
```

Returns `{ config, path, root }` or `null` if no config found. Requires a runtime that can import `.ts` files directly (Bun, tsx, or Node ≥22 with `--experimental-strip-types`).

## Fields

| Field | Type | Purpose |
|---|---|---|
| `operations` | `string` | Glob for operation files |
| `widgets` | `Record<name, path>` | Named widget entries — matches `OperationConfig.widget` |
| `server.resource` | `string` | Canonical MCP server URL |
| `server.authorizationServers` | `string[]` | OAuth issuer URLs |
| `server.scopes` | `string[]` | Default scopes |
| `server.widgetDomain` | `string` | Apps SDK sandbox domain |
| `server.csp` | `{ connectDomains, resourceDomains, frameDomains }` | Widget CSP |
| `server.apiKey` / `model` / `systemPrompt` | chat config | For `chatRoutes` |
