---
title: "@donghanh/cli"
description: Scaffold operations and widgets — patch donghanh.config.ts.
---

The `donghanh` CLI scaffolds operations and widgets, and patches `donghanh.config.ts` in place.

## Install

```bash
bunx @donghanh/cli help
# or install globally
bun add -g @donghanh/cli
```

## Commands

### `donghanh widget <name>`

Creates `widgets/<name>.tsx` with a `DongHanhWidget` scaffold, then adds the entry to `donghanh.config.ts`'s `widgets` map.

```bash
donghanh widget boards
```

Output:
```
✓ wrote widgets/boards.tsx
✓ patched /path/to/donghanh.config.ts
```

If the config can't be patched automatically (no `widgets: {}` block), the CLI prints a snippet to paste manually.

### `donghanh operation <name> [--mutation]`

Creates `operations/<name>.tsx` with a `registerOperation` scaffold. Defaults to `type: "query"`; pass `--mutation` for a write op.

```bash
donghanh operation list-items
donghanh operation delete-item --mutation
```

You still need to register the op in `operations/index.ts` manually.

### `donghanh build`

Runs `vite build` via `bun x vite` in the directory containing `donghanh.config.ts`. Requires a `vite.config.ts` wired to `@donghanh/widget-vite`.

```bash
donghanh build
```

Output: widgets bundled to the `outDir` configured in the Vite plugin (for example, `manifest/`), plus a generated `manifest.js` consumed by `mcpRoutes({ widgets })`.

Exits with code `1` if no `donghanh.config.ts` is found (walks up from cwd); otherwise propagates Vite's exit code.

### `donghanh dev`

Runs `vite build --watch` so widgets rebuild on change. The CLI does **not** start your server — run it in a separate terminal (for example, `wrangler dev`, `bun run dev`, `node --watch`).

```bash
# terminal 1
donghanh dev

# terminal 2
npm run dev   # or: wrangler dev, bun run dev, etc.
```

Same config-missing behavior as `donghanh build`.

### `donghanh help`

Prints usage summary.

## Conventions

- Widget files live in `widgets/<name>.tsx`
- Operation files live in `operations/<name>.tsx`
- Kebab-case names → PascalCase components + camelCase `responseKey`
- Existing files are not overwritten — the CLI prints `• exists` instead of `✓ wrote`
