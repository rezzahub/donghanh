# Changelog

Versions below follow `@donghanh/core` and `@donghanh/hono`. Other packages note their own version where it differs.

## 0.5.1 (unreleased)

### Added

- `Skill.folder`: the uri of the folder holding a skill's files, for skills whose `uri` is the folder node rather than a `SKILL.md` file.
- `attachSkillFiles` and `renderSkillBrief` are exported from `@donghanh/core/skills`, for hosts with their own `use_skill`.

## 0.5.0 (unreleased)

### Added

- `@donghanh/core/files`: `FileProvider`, the `list_files`, `read_file` and `grep_files` tools, and an optional `search_files` hook, all through `fileOperations`.
- `FILES_INSTRUCTIONS`, `filesInstructions(prefix)` (the same paragraph naming prefixed tools) and `staticFiles` for serving a fixed tree of files. `fileOperations().instructions` starts with a blank line so it can be passed as `instructionsSuffix` as is.
- Ref and markdown helpers: `resolveRef`, `extractRefs`, `absolutizeRefs`, `chunkMarkdown`, `describeMarkdown` and `parseFrontmatter`.
- Skills now have a `uri` and a file manifest.
- `metadata.include` inlines files into `use_skill`, which also returns a resolved `refs` table.
- `skillOperations({ files })`.

### Changed

- `staticSkills(key, tree)` takes a path-to-content tree and returns a provider with a `.files` file provider; it throws on a non-empty tree with no `<slug>/SKILL.md` entry (the old `{ name: markdown }` form) or on a root `SKILL.md`, so a migration fails loudly.
- `parseSkillMarkdown` also returns `metadata`.
- `use_skill` output gains a footer.

### Removed

- **Breaking:** `Skill.files` changes from `Record<string, string>` (inline text) to a `FileEntry[]` manifest; inline content moves to `metadata.include` / `included`.
- **Breaking:** the old `staticSkills(key, files)` signature.

### create-donghanh 0.6.0

- Templates depend on `^0.5.0`.

## 0.4.1 (2026-10-31)

### Fixed

- `<Brief>` no longer crashes on number children such as `{data.items.length}`, and adjacent text now joins into one message.
- `<Message>` accepts mixed text and number children, and fragments keep a `0` child.
- `mcpRoutes` always lists tools with `type: "object"` in `inputSchema`, including operations with `input: {}`.

### Changed

- Text next to text in a `<Brief>` now joins with nothing added between. `{"a"}{"b"}` gives `ab`, where it used to give `a b`.

### Deprecated

- GPT Store support: `gptRoutes` and `generateOpenApi` keep working. Use Apps SDK (`mcpRoutes`) for new projects.

### create-donghanh 0.5.1

- The `minimal` template now uses `mcpRoutes`, and no longer asks for OAuth it can't complete.
- Templates depend on `^0.4.0`.
- Fixed template operations that crashed on number children.

## 0.4.0 (2026-10-31)

### Added

- Per-endpoint exposure in `mcpRoutes`: unrolled tools, a discovery catalog, or a hybrid, with pinned and app-only tools.
- Catalog meta-tools: `find_operations`, `get_operation`, `run_read`, `run_write` and `run_destructive`.
- App-level `instructions` with `App({ instructions })`, used by `mcpRoutes`, `chatRoutes` and `gptRoutes`.
- Operation `title`, `idempotent`, `tags`, `meta` and `appCallable`, plus `outputSchema` on tools.
- Skills helper in `@donghanh/core/skills`: dynamic providers with search, use and manage operations.
- Next-step actions in tool result text, so models see them as well as widgets.

### Fixed

- MCP protocol handling in `mcpRoutes`: version negotiation, `ping`, notifications, and errors returned as JSON-RPC results.

### Deprecated

- `server` in `donghanh.config.ts`: pass these options to `mcpRoutes` or `chatRoutes`. `App({ instructions })` replaces `systemPrompt`. Removal is planned for 0.5.

See [Upgrading to 0.4](/reference/hono/#upgrading-to-04).

## 0.3.5 (2026-10-27)

### Added

- `enrichResponse` hook in `mcpRoutes`.

### Changed

- `GET /mcp` returns 405.

## 0.3.0 to 0.3.4 (2026-04-21 to 2026-04-22)

### Added

- Per-operation auth in `gptRoutes`, with `/public` sub-paths for operations that don't need sign-in.
- `generateOpenApi()`, with discovery endpoints, an `OperationResponse` schema and a `securityScheme` override.
- Opt-in sibling list on operation detail.

## 0.2.0 (2026-04-17)

### Added

- Apps SDK support with `mcpRoutes`.
- `@donghanh/widget` and `@donghanh/widget-vite`.
- `@donghanh/config` and `@donghanh/cli`, with `donghanh dev` and `donghanh build`.

## 0.1.1 (2026-04-04)

### Fixed

- Dependencies now use `peerDependencies` and no longer publish `workspace:*`.

## 0.1.0 (2026-04-04)

First release of the `@donghanh` framework and `create-donghanh`.
