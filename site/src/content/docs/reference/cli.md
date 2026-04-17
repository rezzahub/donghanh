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

### `donghanh help`

Prints usage summary.

## Conventions

- Widget files live in `widgets/<name>.tsx`
- Operation files live in `operations/<name>.tsx`
- Kebab-case names → PascalCase components + camelCase `responseKey`
- Existing files are not overwritten — the CLI prints `• exists` instead of `✓ wrote`
