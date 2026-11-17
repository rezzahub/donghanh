# Files (`@donghanh/core/files`)

A generic, paged, read-side file interface. An agent lists, reads and greps files addressed by URI (`scheme://path`) without ever pulling a whole file into context. `@donghanh/core/skills` is built on it: a skill is a folder in the file tree.

This page is for implementers: how to write a `FileProvider`, what the engine guarantees, and how to wire it. Skill authors want the guide [Skills and files](https://donghanh.dev/guides/skills-and-files).

```ts
import { fileOperations, staticFiles } from "@donghanh/core/files";
import type { FileProvider } from "@donghanh/core/files";
```

## What the agent gets

Four tools (names take the optional `prefix`):

| Tool | Input | Returns |
|---|---|---|
| `list_files` | `uri?`, `depth?`, `glob?`, `limit?`, `after?` | Entries with uri, size, line count and a one-line description; a `next` cursor to pass as `after`. No `uri` lists the roots. |
| `read_file` | `uri`, or `path` + `base`; one of `head`, `tail`, or `offset` + `limit` | One page of a text file with line numbers, or type, size and `url` for a binary file. |
| `grep_files` | `pattern`, `uri`, `glob?`, `ignoreCase?`, `context?`, `limit?` | Matching lines with `uri`, `line`, `text`, `before` and `after`. |
| `search_files` | `query`, `uri?`, `limit?` | Ranked hits `{ uri, version?, lines, snippet, score }`. Registered only when some provider implements `search`. |

`read_file` returns `{ uri, version?, mime, bytes, kind, text?, url?, lines: { from, to, total }, truncated?, lineCut?, next? }`. When more lines remain, `next` is `{ uri, offset, limit? }`, a ready-to-call argument set: the agent follows it and never computes an offset. `lineCut: true` means a line on the page was cut to the line-length cap, so `text` is not the file verbatim. An `offset` at or past the end returns empty text with `lines.total`, not an error. Line numbers are 1-based.

A relative `path` needs a `base`, the uri of the file that contains the link. Without it the call fails with a message that says what to pass:

```
Relative path "references/x.md" needs base — pass the uri of the file that links it (use_skill returns it).
```

An unknown uri says to call `list_files`.

### Caps

The engine enforces these (`FILE_LIMITS`); a provider cannot raise them.

| Limit | Value |
|---|---|
| Read default | first 200 lines, at most 16 KB (16,384 bytes) |
| Line length | 2,000 chars, then `…[line truncated]` |
| List | default 100, max 500 per page, `after` cursor |
| Grep | 50 matches, 2 lines of context, scans at most 200 files / 2 MB |
| Search | default 10, max 25 |
| Inline includes | 32 KB in total (`metadata.include` of a skill) |
| Skill manifest | 50 entries, then `N more` |

`grep_files` takes a JavaScript regular expression. Lines are cut to 2,000 characters before matching and a scan stops at 200 files or 2 MB, but a pathological pattern can still stall, because JavaScript regular expressions backtrack. Bound it in your provider if the pattern comes from an untrusted agent: give it a native `grep` that uses an engine with linear-time matching.

## The `FileProvider` contract

```ts
interface FileProvider {
  scheme: string; // "docs"
  roots?(ctx): Promise<FileEntry[]>;
  stat(uri, ctx): Promise<FileEntry | null>;
  list(uri, o: { depth: number; glob?: string; limit: number; after?: string }, ctx): Promise<{ entries: FileEntry[]; next?: string }>;
  read(uri, ctx): Promise<FileContent | null>;
  readLines?(uri, range: { from: number; to: number }, ctx): Promise<(FileContent & { totalLines: number }) | null>;
  grep?(args, ctx): Promise<GrepHit[]>;
  search?(query, o: { uri?: string; limit: number }, ctx): Promise<SearchHit[]>;
}
```

`FileEntry` is `{ uri, kind: "file" | "dir", bytes?, lines?, mime?, description?, version? }`; directory uris end with `/`. `FileContent` is `{ uri, version?, mime, bytes, text?, url?, totalLines? }`: `text` for a text file (the whole file), `url` for a binary one. `ctx` is `{ userId, request, intent? }`, the same as for skills.

Implementer rules:

- **Not found is not forbidden.** Return `null` for a file the caller cannot read, exactly as for a file that does not exist. Never signal "forbidden"; it leaks that the file exists. `stat`, `read` and `readLines` all follow this. Authorize in the provider, as the caller (`ctx.userId`).
- **Return whole text from `read`; the engine slices and caps.** Add `readLines` only when you can slice cheaply (a database range, an object store range request). It takes a 1-based inclusive range and must return `totalLines`, the file's line count, so `lines.total` and `next` are exact. Return `null` only for a missing file; for a range at or past the end return empty `text` and `totalLines`. A `readLines` result without a numeric `totalLines` is ignored and the engine calls `read` instead.
- **Page and cap; never return a whole large file from an operation.** If you wrap the engine in your own operations, or write an operation that reads files, go through `readFile` (or give the agent the file tools) so the caps and `next` apply. A tool result that is a 400 KB transcript fills the agent's context.
- **Binary files get a signed URL.** Return `url` (short-lived, signed) with `mime` and `bytes` and no `text`. The agent never receives bytes.
- **Fill `bytes`, `lines` and `description` when it is cheap**, so `list_files` lets the agent choose without reading. They are optional; omit them when one query cannot supply them. `describeMarkdown` makes the description.
- **Providers sharing a scheme are tried in order.** The first non-null result wins; a provider that throws is skipped (only its error name is logged). If no provider answered and at least one threw, the call fails with `File providers are unavailable (<scheme>); try again.` instead of "not found", so an outage never reads as a missing file. A uri whose scheme no provider has is not found.
- **`grep_files` is for exact strings and names; `search_files` is for concepts.** The engine supplies a default `grep` over `list` and `read`. Override `grep` only for speed.
- **`search` is a hook, not an index.** donghanh does not build one: it only sees tool calls, not your own writes, so it cannot keep an index fresh. If you provide `search`: stamp each hit with the `version` (revision) it was indexed at, and drop hits whose file has a newer version; filter results by the caller's access before returning them (an index that ignores access leaks files); and return `lines` as `[from, to]` so the agent's next call is `read_file` with `offset`. `chunkMarkdown` gives chunk line ranges that match what `read_file` pages by.

`staticFiles(scheme, tree)` is an in-memory provider over `Record<path, string | { url, mime, bytes }>`; the tree key is the path after `scheme://`. It is a test fixture and the right provider for files bundled with the app.

## Wiring

`fileOperations({ providers, prefix?, auth? })` returns `{ operations, wrap, instructions }`:

```ts
import { App, buildRegistry } from "@donghanh/core";
import { fileOperations, staticFiles } from "@donghanh/core/files";
import { mcpRoutes } from "@donghanh/hono";

const docs = staticFiles("docs", {
  "handbook/refunds.md": "# Refunds\n\nRefunds take 5 days.\n",
});
const files = fileOperations({ providers: [docs] });

const registry = buildRegistry(
  App({
    operations: { ...myOperations, ...files.operations },
    instructions: "You help with orders. Call start first.",
  }),
);

app.route(
  "/",
  mcpRoutes({
    registry,
    executor: files.wrap(myExecutor),
    authenticate,
    resource: "https://app.example.com",
    authorizationServers: ["https://auth.example.com"],
    instructionsSuffix: files.instructions,
  }),
);
```

1. Spread `files.operations` into `App`.
2. Wrap the executor with `files.wrap(executor)`. It routes the file operation ids to the engine and passes everything else through. With skills too, compose: `files.wrap(skills.wrap(executor))`.
3. Pass `instructionsSuffix: files.instructions` to `mcpRoutes`. `files.instructions` is ready to append: a blank line, then `filesInstructions(prefix)`, one paragraph telling the agent that skills and docs are file trees addressed by URI, that relative paths resolve against the document they appear in, and to start from `<prefix>list_files` with no uri. `mcpRoutes` appends the suffix only when the app has `instructions`; an app with none sends none. If you already pass a suffix, append to it: `instructionsSuffix: \`${mine}${files.instructions}\``.
4. If you use skills, give `fileOperations` the same `prefix` as `skillOperations`. The footer `use_skill` returns names `<prefix>read_file` and `<prefix>list_files`, so the ids must match. Tool instructions, include notices and the errors the file tools return name the prefixed tools as well.

`auth` sets the auth level of the generated operations, as for `skillOperations`.

A host with its own tenancy and authorization wraps the engine functions in its own operations instead. `listFiles`, `readFile`, `grepFiles` and `searchFiles` are plain functions: `readFile(providers, args, ctx)` and so on. Define your own `read_file` that authorizes the scope, then calls `readFile`. In that case there is no `files.instructions` to attach: include `FILES_INSTRUCTIONS` (the bare paragraph, no leading separator) in your own `App` instructions, or `filesInstructions(prefix)` when your tool names carry a prefix.

## Skills on top of files

`skillOperations({ providers, files })` takes the file providers. `use_skill` then returns the skill with its manifest, the files the skill lists in `metadata.include`, and a table of resolved links. See the [core reference](https://donghanh.dev/reference/core) for the result, and [Skills and files](https://donghanh.dev/guides/skills-and-files) for how skill authors use it.

## Helpers

All pure, no I/O.

- `resolveRef(base, rel)`: resolves `rel` against the directory of `base`, as a URL does; an `@version` on the base's last segment is dropped. The result is the uri in the form providers list it: the `#fragment` is removed and the path is percent-decoded, so `my%20notes.md#intro` resolves to `.../my notes.md` and `tài-liệu.md` stays `.../tài-liệu.md` (a path that does not decode stays encoded). `read_file` with `path` + `base` and `metadata.include` resolve the same way, so a provider sees the raw names it lists.
- `extractRefs(markdown, baseUri)`: `{ raw, uri }[]` for relative and `scheme://` link and image targets. Skips `http(s)` links, `#anchors` and code. `raw` is the target as written; `uri` comes from `resolveRef`.
- `absolutizeRefs(markdown, baseUri)`: a copy of the Markdown with those targets made absolute. Unlike `resolveRef`, targets stay percent-encoded and keep their `#fragment`, so the links remain valid Markdown. For hosts that render the Markdown to people. Never apply it to text the agent receives; the agent should see the links as written.
- `chunkMarkdown(text, { by: "heading" | "lines", size? })`: chunks with `{ from, to, text }` line ranges that match what `read_file` pages by. For indexers.
- `describeMarkdown(text)`: the frontmatter `description`, else the first `#` heading, else the first non-empty line, as one line of at most 160 characters.
- `parseFrontmatter(md)`: `{ fields, metadata, folded, body }` or `null` when there is no `---` block.
