---
title: "@donghanh/core"
description: JSX runtime, primitives, registry, executor.
---

## JSX Primitives

```tsx
import { Brief, Message, Action, Display, Context, Form, App } from "@donghanh/core";
```

### `Brief(props)`
Root container. Accepts `children` of type `Child | Child[]`.

### `Action(props)`
- `operation: string` — target operation ID
- `label: string` — human-readable label
- `variables?: Record<string, unknown>` — pre-filled variables

### `Display(props)`
- `data: unknown` — data to display

### `Message(props)`
- `children?: string` — text content

### `Context(props)`
- `value: unknown` — raw context

### `Form(props)`
- `fields: FieldDef[]` — input field definitions
- `operation: string` — target operation

### `App(props)`
- `operations: Record<string, OperationComponent>` — typed operations map
- `instructions?: string` — the app's playbook (Markdown). `mcpRoutes` sends it as `initialize.instructions`, `gptRoutes` returns it from `GET /operations`, and `chatRoutes` uses it as the default system prompt. `registry.instructions()` reads it.

Writing rule: put the essentials (what the app is, what to call first, the one or two rules that matter most) in the first 512 characters; ChatGPT and Codex read that far. Keep the total under 4,096 characters; Claude Code truncates there, and `mcpRoutes` warns at startup above it.

## Registration

```tsx
import { registerOperation } from "@donghanh/core";
import type { OperationProps, OperationConfig } from "@donghanh/core";
```

### `registerOperation(component, config)`
Attaches metadata to a component function. Returns an `OperationComponent`.

### `OperationConfig`
- `id: string`
- `type: "query" | "mutation"`
- `description: string`
- `instruction: string`
- `input: object` — JSON Schema
- `responseKey: string`
- `title?: string` — human-readable title for tool listings
- `idempotent?: boolean` — repeating the call has no further effect (`idempotentHint`)
- `tags?: string[]` — grouping tags; searchable and usable in `exposure` selectors
- `meta?: Record<string, unknown>` — extra protocol metadata passed through to tool listings
- `appCallable?: boolean` — the app's widget may call this operation directly; a catalog operation with it is listed with visibility `["app"]`

`ExecutorContext.intent` carries the caller-stated reason when the call came through `run_write` or `run_destructive`.

## Registry

```tsx
import { buildRegistry } from "@donghanh/core";
```

### `buildRegistry(appNode, responseSchemas?)`
Builds a registry from an `AppNode`. Returns `Registry` with:
- `list()` — all operations (compact)
- `detail(name)` — full operation detail
- `get(name)` — operation component

## Executor

```tsx
import { executeOperation } from "@donghanh/core";
```

### `executeOperation(opts)`
- `registry: Registry`
- `operationId: string`
- `variables: Record<string, unknown>`
- `executor: Executor`
- `context: ExecutorContext`

Returns `{ data, brief }`.

## Rendering

```tsx
import { renderNode } from "@donghanh/core";
import type { Renderer } from "@donghanh/core";
```

### `renderNode(node, renderer)`
Walks a `ChatNode` tree, calling renderer methods for each node type.

## Skills

```ts
import { skillOperations, staticSkills } from "@donghanh/core/skills";
import type { SkillProvider } from "@donghanh/core/skills";
```

Skills are Markdown playbooks (`SKILL.md`: frontmatter with `name` and `description`, then a body) that the agent searches and loads on demand. They are dynamic, so `instructions` and tool descriptions never list them; the app's `instructions` tells the agent to search first.

### `SkillProvider`
`{ key, search(query, ctx), get(slug, ctx), create?, update?, delete? }`. `key` uses letters, digits, `_` or `-` and must be unique. A provider with `create`, `update` or `delete` is writable. `canCreate?(ctx)` (default true when `create` exists) decides per caller whether the provider is a create target; a throwing `canCreate` counts as false. `ctx` is `{ userId, request, intent? }`; `userId` is `null` for an unauthenticated caller, except through `gptRoutes`, where an anonymous caller arrives as the string `"anonymous"`, not `null`.

### `Skill` and `SkillSummary`
`SkillSummary` is `{ id, slug, name, description, hash, writableBy? }`; `hash` is the hash of `SKILL.md` only. `Skill` adds `markdown` and the file fields below, all optional so a provider with no file tree can leave them out:

- `uri`: the uri of this skill's `SKILL.md`. Without one, `use_skill` returns the skill as is.
- `files`: manifest of the skill's folder, files only (binary ones marked by mime), sorted by path, with `uri`, `bytes`, `lines` and `description`. At most 50 entries.
- `moreFiles`: how many files the manifest left out; `list_files` with the skill folder's uri shows them.
- `included`: `{ path, text }[]`, the files named in `metadata.include`, in order.
- `refs`: `{ raw, uri }[]`, each relative link in `SKILL.md` with its resolved uri.
- `notice`: one line per include that could not be inlined (over the cap, missing, binary, or a line cut), with the reason. The rendered footer adds a pointer to `<prefix>read_file` on each line.

`parseSkillMarkdown(md)` returns `{ name, description, metadata, body }`; `metadata` is read from the indented one-level `metadata:` block of the frontmatter. A flat top-level `include:` is not read.

### `staticSkills(key, tree)`
Read-only provider over a file tree (`Record<path, string>`). The `<slug>/SKILL.md` entries are the skills; every other entry is a file in the tree. The slug is the frontmatter `name` (lowercase letters, digits, single hyphens) and must equal the folder name. It returns a `SkillProvider` with a `files` property, an in-memory `FileProvider` over the same tree with scheme `skills`. A skill's uri is `skills://<key>/<slug>/SKILL.md`.

```ts
const team = staticSkills("team", {
  "pricing/SKILL.md": [
    "---",
    "name: pricing",
    "description: Quote prices and apply discounts.",
    "metadata:",
    "  include: references/plans.md",
    "---",
    "# Pricing",
    "Discounts: [discounts](references/discounts.md).",
  ].join("\n"),
  "pricing/references/plans.md": "# Plans\n\nStarter, Team, Scale.\n",
  "pricing/references/discounts.md": "# Discounts\n\nUp to 10% without approval.\n",
});
const skills = skillOperations({ providers: [team], files: [team.files] });
```

### `skillOperations({ providers, files?, prefix?, auth? })`
Returns `{ operations, wrap(executor) }`. `files` is the list of `FileProvider`s `use_skill` builds the manifest, includes and refs from; it uses the providers whose scheme matches the skill's `uri`, and a skill with no match comes back without file fields. `prefix` is prepended to the operation ids below. Spread `operations` into `App`, and wrap your executor with `wrap`. To let the agent read the files, add [`fileOperations`](#files) with the same `prefix`, because the `use_skill` footer names `<prefix>read_file` and `<prefix>list_files`.

| Operation | Type | Purpose |
|---|---|---|
| `search_skills` | query | Search by keyword across providers; lists `writableTargets` |
| `use_skill` | query | Load a skill by slug: its Markdown, file manifest, included files and resolved links; optional `provider` asks only that provider |
| `manage_skill` | mutation | Create or update a skill (exactly one of `create`, `update`); Markdown up to 65,536 characters |
| `delete_skill` | mutation, destructive | Delete a skill by id |

Ids returned to the agent are `<provider key>:<id>`. A failing provider is skipped on search and get; the log carries only the error's name. If a provider failed and nothing was found, the call throws `Skill providers are unavailable (<keys>); try again.` instead of reporting no match.

`use_skill` returns the `Skill` with its `id` namespaced as `<provider key>:<id>`. The text the agent reads is `SKILL.md` verbatim; then each included file under `--- included: <path> ---`; then a footer, `--- files (<skill uri>) ---`, with the manifest (path, size, lines, description), `N more` when `moreFiles` is set, the refs table (`<raw> → <uri>`), any `notice` lines, a line saying relative links in `SKILL.md` resolve against the skill uri, and a line saying to read a listed file with `<prefix>read_file { path: "<path as listed above>", base: "<skill uri>" }`.

## Files

```ts
import { fileOperations, staticFiles } from "@donghanh/core/files";
import type { FileProvider } from "@donghanh/core/files";
```

A generic, paged, read-side file interface over URIs (`scheme://path`). Skills are built on it. For the provider contract and the rules for implementers see `docs/features/files.md` in the repository.

### `FileProvider`
`{ scheme, roots?, stat, list, read, readLines?, grep?, search? }`. `stat`, `read` and `readLines` return `null` for a file that is missing and for one the caller may not read; there is no "forbidden". `read` returns whole text and the engine slices and caps it; `readLines(uri, { from, to })` is an optional cheaper path (1-based, inclusive; it must return `totalLines`, else the engine falls back to `read`; `null` only for a missing file, empty `text` plus `totalLines` for a range at or past the end). `grep` is an optional native override of the default scan. `search` is an optional ranked hook; donghanh does not build an index. Several providers may share a scheme: they are tried in order and the first non-null result wins. A provider that throws is skipped; if none answered and one threw, the call throws `File providers are unavailable (<scheme>); try again.` rather than not found.

### `fileOperations({ providers, prefix?, auth? })`
Returns `{ operations, wrap(executor), instructions }`. Wire it like `skillOperations`: spread `operations` into `App`, wrap the executor (`files.wrap(skills.wrap(executor))` with skills), and pass `instructionsSuffix: files.instructions` to `mcpRoutes`; the suffix is appended only when the app has `instructions`. `instructions` starts with a blank line, so it can be appended as is; with a suffix of your own, pass `` `${mine}${files.instructions}` ``. Use the same `prefix` as `skillOperations`: tool instructions and error messages name the prefixed tools.

| Operation | Input | Purpose |
|---|---|---|
| `list_files` | `uri?`, `depth?`, `glob?`, `limit?`, `after?` | List folders and files; no `uri` lists the roots; `after` continues from a `next` cursor |
| `read_file` | `uri`, or `path` + `base`; `head`, `tail` or `offset` + `limit` | Read one page of a text file; binary returns type, size and `url` |
| `grep_files` | `pattern`, `uri`, `glob?`, `ignoreCase?`, `context?`, `limit?` | Find lines matching a JavaScript regular expression |
| `search_files` | `query`, `uri?`, `limit?` | Ranked search; registered only when a provider implements `search` |

`read_file` results carry `lines: { from, to, total }`, `truncated`, and `next: { uri, offset, limit? }` when more remains, so the agent follows `next` and never builds an offset. `lineCut: true` means a line was cut to the 2,000-character cap. Pass only one of `head`, `tail` and `offset`/`limit`; a relative `path` without `base` fails with an error that says to pass the uri of the file that links it.

| Limit | Value |
|---|---|
| Read default | first 200 lines, at most 16 KB |
| Line length | 2,000 chars, then `…[line truncated]` |
| List | default 100, max 500 per page, `after` cursor |
| Grep | 50 matches, 2 lines of context, scans at most 200 files / 2 MB |
| Search | default 10, max 25 |

The values are exported as `FILE_LIMITS` (which also holds the 32 KB `includeBytes` cap for skill includes and the 50-entry `manifestMax`). `grep_files` takes a JavaScript regular expression: lines are cut to 2,000 characters before matching and a scan stops at 200 files or 2 MB, but a pathological pattern can still stall, because JavaScript regular expressions backtrack.

### Engine functions
`listFiles`, `readFile`, `grepFiles` and `searchFiles` take `(providers, args, ctx)` and are what the operations call. A host with its own tenancy wraps them in its own operations.

### `staticFiles(scheme, tree)`
In-memory `FileProvider` over `Record<path, string | { url, mime, bytes }>`; the key is the path after `scheme://`. A string is a text file (Markdown files get a `description`), the object form is a binary file served by `url`.

### `FILES_INSTRUCTIONS` and `filesInstructions(prefix?)`
`filesInstructions(prefix)` is the one-paragraph app-level instruction naming `<prefix>list_files` and `<prefix>read_file`; `FILES_INSTRUCTIONS` is `filesInstructions()` with the bare names. Neither has a leading separator. `fileOperations` returns `"\n\n" + filesInstructions(prefix)` as `instructions`. A host that wraps the engine in its own operations includes one of them in its own `App` instructions.

### Link helpers
Pure, no I/O.

| Function | Returns |
|---|---|
| `resolveRef(base, rel)` | `rel` resolved against the directory of `base`, as a URL, in the form providers list it: `#fragment` removed, path percent-decoded (`a%20b.md` gives `a b.md`) |
| `extractRefs(markdown, baseUri)` | `{ raw, uri }[]` for relative and `scheme://` link and image targets (`raw` as written, `uri` from `resolveRef`); skips `http(s)` links, anchors and code |
| `absolutizeRefs(markdown, baseUri)` | the Markdown with those targets made absolute, still percent-encoded and with their `#fragment`, for hosts that render it; not for agent-facing text |
| `chunkMarkdown(text, { by: "heading" \| "lines", size? })` | `{ from, to, text }[]` line ranges that match what `read_file` pages by |
| `describeMarkdown(text)` | one line: the frontmatter `description`, else the first heading, else the first non-empty line |
| `parseFrontmatter(md)` | `{ fields, metadata, folded, body }`, or `null` without a `---` block |
