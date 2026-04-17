---
title: "@donghanh/widget-vite"
description: Vite plugin that bundles donghanh widgets into inline HTML + manifest.
---

Vite plugin that takes a map of widget entries, bundles each with inline JS + CSS, assigns content-hashed URIs, and emits a manifest module compatible with `mcpRoutes({ widgets })`.

## Install

```bash
npm install -D @donghanh/widget-vite vite
```

## Usage

```ts
// vite.config.ts
import { donghanhWidgets } from "@donghanh/widget-vite";

export default {
  plugins: [
    donghanhWidgets({
      entries: {
        boards: "./widgets/boards.tsx",
        cards: "./widgets/cards.tsx",
      },
      domain: "https://myapp.example.com",
      csp: {
        connectDomains: ["https://api.myapp.example.com"],
        resourceDomains: ["https://persistent.oaistatic.com"],
      },
    }),
  ],
};
```

## Output

After `vite build`:

```
dist/widgets/
  boards.html       # inline widget for boards
  cards.html        # inline widget for cards
  manifest.js       # generated manifest
  manifest.d.ts     # type declarations
```

`manifest.js`:

```js
export const widgets = {
  boards: {
    uri: "ui://widget/boards-a1b2c3d4e5.html",
    html: "<!DOCTYPE html>...",
    domain: "https://myapp.example.com",
    csp: { connectDomains: [...] },
  },
  cards: { /* ... */ },
};
```

## Server wiring

```ts
import { widgets } from "./dist/widgets/manifest.js";
import { mcpRoutes } from "@donghanh/hono";

app.route("/", mcpRoutes({
  registry,
  executor,
  authenticate,
  resource: "https://myapp.example.com",
  authorizationServers: ["https://auth.example.com"],
  widgets,
}));
```

## Options

| Field | Default | Description |
|---|---|---|
| `entries` | required | Widget name → entry TSX path |
| `outDir` | `"dist/widgets"` | Where to write HTML + manifest |
| `manifestFile` | `"manifest.js"` | Manifest file name |
| `uriPrefix` | `"ui://widget/"` | URI prefix |
| `domain` | — | Shared sandbox domain |
| `csp` | — | Shared CSP applied to every widget |
| `prefersBorder` | — | Host rendering hint |

## Cache-bust

URIs include a 10-char SHA-256 prefix of the final HTML. Any change to the bundle produces a new URI, forcing ChatGPT to reload the widget instead of using a cached version.
