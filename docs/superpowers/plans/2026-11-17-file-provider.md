# File access for skills and docs — donghanh 0.5.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic, paged, read-side file interface to `@donghanh/core` and rebuild skills on it, shipping as a breaking 0.5.0 with no aliases.

**Architecture:** A new `@donghanh/core/files` module holds the `FileProvider` contract, pure engine functions (`listFiles`, `readFile`, `grepFiles`, `searchFiles`) that enforce all paging and caps, pure ref/markdown helpers, and `fileOperations` (donghanh operations over the engine). `skills.ts` loses its inline `files` record; `use_skill` gains a manifest, `metadata.include` files and a resolved `refs` table, all built through a `FileProvider`.

**Tech Stack:** TypeScript (ESM, extensionless relative imports), vitest, Biome, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-11-17-file-provider-design.md` (the mintube adoption section there is out of scope for this plan).

## Global Constraints

- Work in worktree `/home/cinoss/Code/donghanh-skill-file-tree`, branch `skill-file-tree`. Do not push, do not publish (publishing needs the user's npm OTP).
- Caps (spec table), exported as `FILE_LIMITS`: read default 200 lines and 16 KB (16384 bytes); line length 2,000 chars then `…[line truncated]`; list default 100, max 500; grep 50 matches, 2 lines of context, scans at most 200 files / 2 MB (2097152 bytes); search default 10, max 25; `metadata.include` inline total 32 KB (32768 bytes); `use_skill` manifest at most 50 entries.
- Line numbers are 1-based. Directory URIs end with `/`.
- A provider returns `null` for "not found" and for "not allowed"; the engine never says forbidden.
- Hard removal, no aliases or deprecation shims: `Skill.files` as a record and the old `staticSkills(key, files)` signature go.
- SKILL.md frontmatter top-level keys follow the Agent Skills spec; `metadata` is a string→string map (so `include` is a comma-separated string).
- Lint is `just lint` (biome + tsc), tests are `just test`. Do not suppress Biome errors.
- Shared version: `core`, `hono`, `react`, `config` all go to `0.5.0`.
- Commit messages: sentence case, no prefix (repo style), ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Markdown containing link-like text inside code fences or inline code, or malformed link syntax (`[x](`): `extractRefs` ignores code and never throws (Task 1).
- One enormous line (minified JSON): the read is capped, `next` is valid and the agent cannot page forever on the same line (Task 4).
- Empty file, no trailing newline, CRLF endings: line counts are right, no phantom last line (Task 4).
- Invalid or pathological regex in `grep_files`: a teaching error, the scan bounds hold, and lines are cut to 2,000 chars before matching (Task 5).
- A provider that throws on `roots`, `list` or `read`: other providers still answer and no thrown message leaks to the agent (Task 3).

---

### Task 1: Types, limits, export entry and ref helpers

**Files:**
- Create: `packages/core/src/files/types.ts`, `packages/core/src/files/limits.ts`, `packages/core/src/files/refs.ts`, `packages/core/src/files/index.ts`
- Test: `packages/core/src/files/refs.test.ts`
- Modify: `packages/core/package.json` (exports)

**Interfaces:**
- Produces (`types.ts`): `FileEntry { uri: string; kind: "file"|"dir"; bytes?: number; lines?: number; mime?: string; description?: string; version?: string }`; `FileContent { uri: string; version?: string; mime: string; bytes: number; text?: string; url?: string; totalLines?: number }`; `type FileContext = ExecutorContext`; `ListOptions { depth: number; glob?: string; limit: number; after?: string }`; `ListResult { entries: FileEntry[]; next?: string }`; `GrepArgs { uri: string; pattern: string; glob?: string; ignoreCase?: boolean; context: number; limit: number }`; `GrepHit { uri: string; line: number; text: string; before: string[]; after: string[] }`; `SearchHit { uri: string; version?: string; lines: [number, number]; snippet: string; score: number }`; `FileProvider { scheme: string; roots?(ctx): Promise<FileEntry[]>; stat(uri, ctx): Promise<FileEntry|null>; list(uri, o: ListOptions, ctx): Promise<ListResult>; read(uri, ctx): Promise<FileContent|null>; readLines?(uri, range: {from:number;to:number}, ctx): Promise<FileContent|null>; grep?(args: GrepArgs, ctx): Promise<GrepHit[]>; search?(query: string, o: {uri?: string; limit: number}, ctx): Promise<SearchHit[]> }`.
- Produces (`limits.ts`): `FILE_LIMITS` as const with keys `readLines, readBytes, lineChars, listDefault, listMax, grepMatches, grepContext, grepFiles, grepBytes, searchDefault, searchMax, includeBytes, manifestMax`, values from Global Constraints.
- Produces (`refs.ts`): `uriScheme(uri: string): string | null`; `resolveRef(base: string, rel: string): string`; `extractRefs(markdown: string, baseUri: string): { raw: string; uri: string }[]`; `absolutizeRefs(markdown: string, baseUri: string): string`.
- `index.ts` re-exports everything public from `files/`; later tasks append to it.

- [ ] **Step 1: Commit the spec and plan** — `git add docs/superpowers && git commit -m "Add file provider design and plan"` (with the trailer).
- [ ] **Step 2: Write `refs.test.ts`**, with these tests (exact values):
```ts
const SKILL = "mintube://niche/n10/skills/x/SKILL.md";
test("resolveRef resolves against the directory of base", () => {
  expect(resolveRef(SKILL, "references/y.md")).toBe("mintube://niche/n10/skills/x/references/y.md");
  expect(resolveRef(SKILL, "../../competitors/a.md")).toBe("mintube://niche/n10/competitors/a.md");
  expect(resolveRef("mintube://niche/n10/skills/x/", "y.md")).toBe("mintube://niche/n10/skills/x/y.md");
});
test("resolveRef leaves absolute refs alone and drops a base @version", () => {
  expect(resolveRef(SKILL, "mintube://team/t1/b.md")).toBe("mintube://team/t1/b.md");
  expect(resolveRef("mintube://canonical/skills/x/SKILL.md@1.2.0", "references/y.md")).toBe("mintube://canonical/skills/x/references/y.md");
});
test("resolveRef clamps ../ at the root instead of throwing", () => {
  expect(resolveRef("mintube://niche/n10/a.md", "../../../../x.md")).toMatch(/^mintube:\/\/niche\//);
});
test("extractRefs returns relative and scheme refs, skipping http, mailto and anchors", ...)
  // markdown with [a](references/x.md), ![i](img/p.png), [w](https://e.com), [h](#top), [m](mintube://team/t/b.md), [dup](references/x.md)
  // expect [{raw:"references/x.md",uri:".../references/x.md"},{raw:"img/p.png",...},{raw:"mintube://team/t/b.md",uri:"mintube://team/t/b.md"}] (deduped by raw, in order)
test("extractRefs ignores fenced code and inline code and never throws on malformed links", ...)
  // "```\n[x](a.md)\n```", "`[y](b.md)`", "[broken](" , "[a](b.md" -> []
test("absolutizeRefs rewrites only those targets and leaves all other text byte-identical", ...)
test("uriScheme", () => { expect(uriScheme("mintube://a/b")).toBe("mintube"); expect(uriScheme("references/x.md")).toBeNull(); });
```
- [ ] **Step 3: Run** `pnpm exec vitest run packages/core/src/files/refs.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement** the files above. `resolveRef` uses the WHATWG `URL` (`new URL(rel, base)`) and returns `href`; strip a trailing `@…` from the base's last segment before resolving; throw `Error("Invalid base uri …")` on an unparseable base. `extractRefs` and `absolutizeRefs` scan with one shared link regex over the markdown with code spans and fences masked out. Add `"./files": "./src/files/index.ts"` to `packages/core/package.json` exports.
- [ ] **Step 5: Run** the test file, then `just lint`. Expected: PASS, clean.
- [ ] **Step 6: Commit** — "Add file types, limits and ref helpers".

### Task 2: Frontmatter and markdown helpers

**Files:**
- Create: `packages/core/src/files/frontmatter.ts`, `packages/core/src/files/markdown.ts`
- Test: `packages/core/src/files/frontmatter.test.ts`, `packages/core/src/files/markdown.test.ts`
- Modify: `packages/core/src/files/index.ts`

**Interfaces:**
- Produces: `parseFrontmatter(md: string): { fields: Record<string,string>; metadata: Record<string,string>; folded: string[]; body: string } | null` (`null` when there is no leading `---` block; `fields` are top-level `key: value` lines with matching quotes stripped; `metadata` is the one-level indented block under `metadata:`; `folded` lists top-level keys written as `>`/`|` scalars or continued over indented lines).
- Produces: `describeMarkdown(text: string): string`; `chunkMarkdown(text: string, opts: { by: "heading" | "lines"; size?: number }): MarkdownChunk[]` with `MarkdownChunk = { from: number; to: number; text: string }` (1-based inclusive lines).

- [ ] **Step 1: Write tests**
  - `parseFrontmatter`: reads `name`/`description`; `metadata:\n  version: "1.0.0"\n  include: a.md, b.md` gives `metadata` `{ version: "1.0.0", include: "a.md, b.md" }`; `description: >-` puts `"description"` in `folded`; CRLF input parses; no frontmatter returns `null`.
  - `describeMarkdown`: frontmatter `description` wins; else first `# ` heading text; else first non-empty line; collapsed to one line and cut at 160 chars; empty text gives `""`.
  - `chunkMarkdown` by heading: splits at `#`–`######` lines outside code fences; text before the first heading is its own chunk; chunks are contiguous and cover every line (`chunks[0].from === 1`, each `from` is previous `to + 1`, last `to` is the line count); by lines uses `size` (default 40); empty text gives `[]`.
- [ ] **Step 2: Run** both test files. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the three functions (move the line-parsing behavior out of `skills.ts`'s `parseSkillMarkdown` into `parseFrontmatter`; Task 7 makes `skills.ts` use it).
- [ ] **Step 4: Run** both files and `just lint`. Expected: PASS, clean.
- [ ] **Step 5: Commit** — "Add frontmatter parsing and markdown helpers".

### Task 3: staticFiles and listFiles

**Files:**
- Create: `packages/core/src/files/glob.ts`, `packages/core/src/files/route.ts`, `packages/core/src/files/static.ts`, `packages/core/src/files/list.ts`
- Test: `packages/core/src/files/list.test.ts`
- Modify: `packages/core/src/files/index.ts`

**Interfaces:**
- Consumes: Task 1 types and `FILE_LIMITS`, `uriScheme`; Task 2 `describeMarkdown`.
- Produces: `globToRegExp(glob: string): RegExp` (`*` within a segment, `**` across segments, `?` one char; matched against the path relative to the listed folder).
- Produces: `firstFrom<T>(providers: FileProvider[], uri: string, fn: (p: FileProvider) => Promise<T | null>): Promise<T | null>` — tries providers whose `scheme` equals `uriScheme(uri)`, in order, returns the first non-null; a throwing provider is skipped (log only the error's name: `console.error("[files] provider <scheme> failed (<name>)")`).
- Produces: `StaticBinary = { url: string; mime: string; bytes: number }`; `staticFiles(scheme: string, tree: Record<string, string | StaticBinary>): FileProvider` — a tree key is the path after `scheme://`; `roots()` gives one dir entry per first path segment; `list` is sorted by uri, honours `depth`, `glob`, `limit` and `after` (the last uri of the previous page); entries carry `bytes`, `lines`, `mime` (by extension; default `text/plain`) and `description` (via `describeMarkdown` for `.md`).
- Produces: `listFiles(providers: FileProvider[], args: { uri?: string; depth?: number; glob?: string; limit?: number; after?: string }, ctx: FileContext): Promise<ListResult>` — no `uri` lists all providers' roots; defaults `depth` 1 and `limit` 100, `limit` clamped to 500; a missing uri throws `No file or folder at <uri>; call list_files with no uri to see the roots.`

- [ ] **Step 1: Write `list.test.ts`**
  - roots: two providers give the union of their roots; a provider whose `roots` throws is skipped and the thrown message text never appears in the result or in a thrown error (Review Focus 5); all providers failing throws `File providers are unavailable (<schemes>); try again.`
  - `list` depth 1 shows direct children, with dirs ending in `/`; depth 2 includes grandchildren; `glob: "**/*.md"` filters; 250 files with `limit: 100` gives `next`, and `after: next` continues without overlap; `limit: 9999` is clamped to 500.
  - entries carry `description` from a markdown heading, `lines`, and for a `StaticBinary` `kind: "file"` with `mime` and no `lines`.
  - unknown uri throws the not-found message; two providers sharing a scheme (different authorities) both answer in order.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/core/src/files/list.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Run** the test file and `just lint`. Expected: PASS, clean.
- [ ] **Step 5: Commit** — "Add static file provider and list engine".

### Task 4: readFile

**Files:**
- Create: `packages/core/src/files/read.ts`
- Test: `packages/core/src/files/read.test.ts`
- Modify: `packages/core/src/files/index.ts`

**Interfaces:**
- Consumes: Task 3 `staticFiles`, `firstFrom`; Task 1 `resolveRef`, `FILE_LIMITS`.
- Produces: `ReadResult { uri: string; version?: string; mime: string; bytes: number; kind: "text" | "binary"; url?: string; text?: string; lines?: { from: number; to: number; total: number }; truncated?: boolean; next?: { uri: string; offset: number; limit?: number } }`.
- Produces: `readFile(providers: FileProvider[], args: { uri?: string; path?: string; base?: string; head?: number; tail?: number; offset?: number; limit?: number }, ctx: FileContext): Promise<ReadResult>`.

Rules (spec): pass `uri`, or `path` with `base`, never both. `head`, `tail` and `offset`/`limit` are mutually exclusive. No selector means the first 200 lines. Output stops at 200 lines or 16 KB, whichever comes first; each line is cut at 2,000 chars with `…[line truncated]`. `next` is a valid argument set pointing at the first unread line, absent when everything was read. `tail: n` returns the last n lines that fit the caps (`lines.from` says where to read earlier). `offset` past the end returns `text: ""` with `lines.total` and no error. Binary returns `kind: "binary"` with `url`, never text. When a provider has `readLines` and the request is `head`/`offset`, use it instead of `read` (its `totalLines` fills `lines.total`).

- [ ] **Step 1: Write `read.test.ts`**
```ts
test("default read is the first 200 lines with a next offset", async () => {
  const r = await readFile([p], { uri: "t://f/big.md" }, ctx); // 500-line file
  expect(r.lines).toEqual({ from: 1, to: 200, total: 500 });
  expect(r.truncated).toBe(true);
  expect(r.next).toEqual({ uri: "t://f/big.md", offset: 201 });
});
```
  Also: `head: 5`; `tail: 3` gives `lines.from === total - 2`; `offset: 100, limit: 10`; `offset: 9999` gives `text === ""`, `lines.total === 500`, no throw; the 16 KB cap stops 100 lines of 400 chars early with `next.offset` at the first unread line; **one 50,000-char line** is cut to 2,000 chars plus the marker and `next.offset === 2`; **empty file** gives `lines.total === 0`, `text === ""`; **no trailing newline** keeps the last line and counts no extra one; **CRLF** counts lines correctly; `head` with `offset` throws; `uri` with `path` throws; `path` without `base` throws a message containing `needs base`; `path` with `base` resolves against the base's directory; binary entry returns `kind: "binary"` and `url`; missing file throws the not-found message; a provider with `readLines` is used for an `offset` request (assert via spy that `read` was not called).
- [ ] **Step 2: Run** `pnpm exec vitest run packages/core/src/files/read.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `readFile`. The teaching error for a relative path is exactly: `Relative path "<path>" needs base — pass the uri of the file that links it (use_skill returns it).`
- [ ] **Step 4: Run** the test file and `just lint`. Expected: PASS, clean.
- [ ] **Step 5: Commit** — "Add paged readFile engine".

### Task 5: grepFiles and searchFiles

**Files:**
- Create: `packages/core/src/files/grep.ts`, `packages/core/src/files/search.ts`
- Test: `packages/core/src/files/grep.test.ts`, `packages/core/src/files/search.test.ts`
- Modify: `packages/core/src/files/index.ts`

**Interfaces:**
- Consumes: Task 3 (`staticFiles`, `listFiles`, `firstFrom`, `globToRegExp`), Task 4 `readFile` rules for caps.
- Produces: `grepFiles(providers: FileProvider[], args: { pattern: string; uri: string; glob?: string; ignoreCase?: boolean; context?: number; limit?: number }, ctx: FileContext): Promise<{ hits: GrepHit[]; capped: boolean }>` — `uri` may be a file or a folder; defaults `context` 2 and `limit` 50 (both clamped to the caps); the default implementation walks `list` (depth unlimited) and `read`, skips binary, scans at most 200 files and 2 MB total, and cuts each line to 2,000 chars **before** matching; `capped` is true when the match limit or a scan bound stopped the walk; a provider's own `grep` is used when present.
- Produces: `searchFiles(providers: FileProvider[], args: { query: string; uri?: string; limit?: number }, ctx: FileContext): Promise<{ hits: SearchHit[] }>` — `limit` default 10, max 25; asks every provider that has `search`; throws `Search is not available for these files; use grep_files.` when none has it.

- [ ] **Step 1: Write tests**
  - grep: a match returns `before`/`after` of 2 lines; `ignoreCase`; `glob` filter; 60 matches with default limit gives 50 hits and `capped: true`; a tree of 300 small files gives `capped: true` and at most 200 files scanned; binary entries skipped; a provider-native `grep` is used when defined (spy); **invalid regex** (`"("`) throws a message starting `Invalid pattern`; a match that only exists past char 2,000 of a line is not found; a single file `uri` works.
  - search: results are cut to `limit` (default 10, `limit: 99` gives 25); no search-capable provider throws the message above; `uri` scoping is passed through to the provider.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement** both.
- [ ] **Step 4: Run** both files and `just lint`. Expected: PASS, clean.
- [ ] **Step 5: Commit** — "Add grep and search engines".

### Task 6: fileOperations and FILES_INSTRUCTIONS

**Files:**
- Create: `packages/core/src/brief.ts` (move `textBrief` out of `skills.ts`), `packages/core/src/files/operations.ts`
- Modify: `packages/core/src/skills.ts` (import `textBrief` from `./brief`), `packages/core/src/files/index.ts`
- Test: `packages/core/src/files/operations.test.ts`

**Interfaces:**
- Consumes: Tasks 3–5 engine functions; `registerOperation`, `Executor`, `OperationComponent` from `../types`.
- Produces: `fileOperations(opts: { providers: FileProvider[]; prefix?: string; auth?: "none" | "optional" | "required" }): { operations: Record<string, OperationComponent>; wrap(executor: Executor): Executor; instructions: string }`; `FILES_INSTRUCTIONS: string`.
- Operations (ids take `prefix`): `list_files`, `read_file`, `grep_files` (all `type: "query"`, `idempotent: true`), and `search_files` only when some provider implements `search`. Inputs mirror the engine args. Each `instruction` carries the spec text: what to pass, paged reads (first 200 lines by default), follow `next`, grep or search before reading a large file, relative paths need `base`. `wrap` follows the pattern of `skillOperations.wrap` (own ids handled, everything else falls through).
- Brief rendering: `read_file` prints each line as `<n>\t<text>`, then a footer line for truncation containing the `next` arguments; binary prints mime, bytes and the `url`; `list_files` prints `<uri>  <bytes>B  <lines> lines  <description>`; `grep_files` prints `<uri>:<line>: <text>` with context and a note when `capped`.
- `FILES_INSTRUCTIONS` is the one paragraph from the spec (file trees addressed by URI; relative paths resolve against the document they appear in; start from `list_files` with no uri). `instructions === FILES_INSTRUCTIONS`.

- [ ] **Step 1: Write `operations.test.ts`** (same `run`/`wrap` harness as `skills.test.ts`): ids honour `prefix`; `search_files` is absent without a searching provider and present with one; `auth` reaches each `operationConfig`; `read_file` on a 500-line file renders `1\t` as its first line, does not contain `201\t`, and its footer contains `offset`; a relative `path` without `base` rejects with `needs base`; `list_files` with no uri lists roots; `instructions` equals `FILES_INSTRUCTIONS` and contains `relative`; an unknown operation id goes to the fallback executor.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/core/src/files/operations.test.ts packages/core/src/skills.test.ts`. Expected: FAIL (operations missing).
- [ ] **Step 3: Implement** `fileOperations`; extract `textBrief` into `brief.ts` and import it in `skills.ts`.
- [ ] **Step 4: Run** both test files, `just lint`. Expected: PASS, clean.
- [ ] **Step 5: Commit** — "Add file operations and agent instructions".

### Task 7: Skill type, metadata parsing and staticSkills over a tree

**Files:**
- Modify: `packages/core/src/skills.ts`, `packages/core/src/skills.test.ts`

**Interfaces:**
- Consumes: Task 2 `parseFrontmatter`; Task 3 `staticFiles`; Task 1 types.
- Produces: `parseSkillMarkdown(md: string): { name: string; description: string; metadata: Record<string,string>; body: string }` (same errors as today, now built on `parseFrontmatter`).
- Produces: `Skill` with `files?: Record<string,string>` removed and these optional fields added: `uri?: string; files?: FileEntry[]; moreFiles?: number; included?: { path: string; text: string }[]; refs?: { raw: string; uri: string }[]; notice?: string`. `type SkillContext = FileContext`.
- Produces: `staticSkills(key: string, tree: Record<string, string>): SkillProvider & { files: FileProvider }` — skills are the `<slug>/SKILL.md` entries; every other entry is a file in that tree; the directory name must equal the frontmatter `name` (error mentions `directory`), and the name must match the existing slug rule (error mentions `slug`); skill `uri` is `skills://<key>/<slug>/SKILL.md`; `.files` is `staticFiles("skills", …)` keyed `<key>/<path>`.

- [ ] **Step 1: Update `skills.test.ts`**: `parseSkillMarkdown` expectations gain `metadata: {}` and a case reading `metadata:` entries; the `readOnly` helper builds `{ "<n>/SKILL.md": md(n) }`; the bad-slug test becomes `{ "bad/SKILL.md": md("Bad Name") }` throwing `/slug/`; add: directory/name mismatch throws `/directory/`; a non-SKILL file in the tree is not a skill but is listed by `.files.list("skills://k/x/")`; skill `uri` equals `skills://k/x/SKILL.md`.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/core/src/skills.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `skills.ts`; delete the inline `files` record and the old signature.
- [ ] **Step 4: Run** the file and `just lint`. Expected: PASS, clean (tsc proves no other user of `Skill.files` remains in the repo).
- [ ] **Step 5: Commit** — "Rebuild static skills on a file tree and remove inline files".

### Task 8: use_skill manifest, includes and refs

**Files:**
- Create: `packages/core/src/skill-files.ts`
- Modify: `packages/core/src/skills.ts` (`skillOperations` option and `use_skill` handler/brief), `packages/core/src/skills.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5 and Task 7.
- Produces (`skill-files.ts`): `attachSkillFiles(skill: Skill, files: FileProvider[], ctx: FileContext): Promise<Skill>` and `renderSkillBrief(skill: Skill, prefix: string): string`.
- `skillOperations` gains `files?: FileProvider[]`. Behavior of `use_skill` when `skill.uri` has a matching provider: `files` is the manifest of the skill's folder (files only, binary included and marked by `mime`, SKILL.md itself excluded, sorted by path, at most 50; the surplus count goes in `moreFiles`); `refs = extractRefs(markdown, uri)`; `included` holds the files named in `metadata.include` (comma-separated, trimmed, resolved with `resolveRef(uri, p)`), inline in order up to 32,768 bytes total — an include that is over the cap, missing, or binary is left manifest-only and adds a line to `notice`, never an error. With no matching provider, the result is as today (markdown only). `hash` stays the hash of SKILL.md.
- Brief: SKILL.md verbatim; each included file under `--- included: <path> ---`; then a footer with the skill `uri`, the manifest lines (`<path>  <bytes>B  <lines> lines  <description>`), `N more — <prefix>list_files { uri: <folder> }` when `moreFiles`, the refs table (`<raw> → <uri>`), the `notice` lines, and one line saying relative paths resolve against the file that contains them and files are read with `<prefix>read_file`.

- [ ] **Step 1: Add tests** (new `describe("use_skill files")`): manifest, `refs` and `uri` for a skill with `references/a.md` and a `[x](references/a.md)` link; `metadata.include: references/a.md, references/b.md` fills `included` and the brief contains `--- included: references/a.md ---`; a 30 KB first include plus a 5 KB second one: second is manifest-only and `notice` names it; missing include adds a notice and does not throw; binary include is skipped with a notice; 60 sibling files give 50 entries and `moreFiles === 10`; no `files` option gives markdown-only output; `data.hash` equals `skillHash(markdown)`; the footer names `<prefix>read_file` for a prefixed `skillOperations`.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/core/src/skills.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `attachSkillFiles`, `renderSkillBrief`, wire both into `use_skill` (data is the attached skill; brief is `renderSkillBrief`), and update the `use_skill` description/instruction to mention the manifest and `read_file`.
- [ ] **Step 4: Run** the file, `just lint`, `just test`. Expected: PASS, clean.
- [ ] **Step 5: Commit** — "Return a file manifest, includes and refs from use_skill".

### Task 9: Docs and agent skills

**Files:**
- Create: `docs/features/files.md`, `site/src/content/docs/guides/skills-and-files.md`
- Modify: `site/astro.config.mjs` (add the guide to the hand-listed `guides/` sidebar), `site/src/content/docs/reference/core.md`, `README.md` (line 78), `SKILL.md`, `skills/donghanh/SKILL.md`, `skills/donghanh-prompts/SKILL.md`

- [ ] **Step 1: Write `docs/features/files.md`** (implementers): the `FileProvider` contract; the tools and the caps table; the implementer rules (not-found-not-forbidden; page and cap, never return whole files; signed URL for binary; stamp hits with the revision they were indexed at and drop stale ones; filter any index by access; `grep_files` is for exact strings, `search_files` for concepts); how to wire `fileOperations` (`instructionsSuffix: files.instructions` for `mcpRoutes`); a host with its own tenancy wraps the engine functions in its own operations and includes `FILES_INSTRUCTIONS` in its instructions.
- [ ] **Step 2: Write the guide `skills-and-files.md`** (skill authors, linked as "Skills and files" in the `guides/` sidebar): a skill is a folder; link files with plain relative paths (`references/pricing.md`), resolved against the file that contains the link; list the files an agent must always have in `metadata.include` (comma-separated, 32 KB total) and leave the rest to be fetched; start each reference file with a heading or a `description` so `list_files` shows what it is; keep SKILL.md itself short; the agent fetches the rest with `read_file`, `grep_files`.
- [ ] **Step 3: Update `reference/core.md`** (`staticSkills(key, tree)`, the `SkillProvider` and `Skill` fields, the `use_skill` result, `skillOperations({ files })`, and a new Files section for the export, its tools and helpers) and the `README.md` line 78 sentence (add files next to skills).
- [ ] **Step 4: Update the agent skills**
  - `SKILL.md` and `skills/donghanh/SKILL.md`: a short Files section covering when to add `fileOperations`, passing `instructionsSuffix: files.instructions` to `mcpRoutes`, and a pointer to `docs/features/files.md`. In `skills/donghanh/SKILL.md` also add a Common pitfalls entry ("never return a whole large file from an operation: page it and cap it; use the file tools") and extend the frontmatter `description` so it triggers when the user wants to expose skills or files to the agent.
  - `skills/donghanh-prompts/SKILL.md`: in §5 (Response Brief) add the rule that a result carries the next call (`next`, a `refs` table, a manifest) so the model never builds paths or offsets; in §2 (`instruction`) add that a paged tool states its cap and what to do when truncated; add a short "Errors that teach" subsection (an error says what to pass instead, with the exact example from the spec); add matching rows to "Where does X go?" and one entry to "Common mistakes" (making the model construct arguments the server could hand it).
  - Leave `site/src/components/home/Skills.astro` unchanged.
- [ ] **Step 5: Verify** — `just lint` (the site build is `just site-build`; run it if the site installs offline, and say so if it cannot). Commit — "Document files and skill authoring".

### Task 10: Changelog and release prep

**Files:**
- Modify: `CHANGELOG.md`, `packages/{core,hono,react,config}/package.json`, `pnpm-lock.yaml`
- Modify (separate commit): `create-donghanh/package.json`, `create-donghanh/templates/*/package.json`

- [ ] **Step 1: Write the CHANGELOG entry** `## 0.5.0 (unreleased)` with Added (files module, tools, helpers, `metadata.include`, `refs`, manifest), Changed (`staticSkills(key, tree)`, `parseSkillMarkdown` returns `metadata`, `use_skill` output), Removed — breaking (`Skill.files` record; old `staticSkills(key, files)`).
- [ ] **Step 2: Bump** `core`, `hono`, `react`, `config` to `0.5.0`; set `peerDependencies["@donghanh/core"]` in `hono` and `react` to `^0.5.0`; run `pnpm install` to refresh `pnpm-lock.yaml`.
- [ ] **Step 3: Verify** — `just lint` and `just test`. Expected: clean, all pass. Commit — "Prepare 0.5.0".
- [ ] **Step 4: Templates (separate commit, hold back until 0.5.0 is published):** change `@donghanh/core|hono|config|react` ranges from `^0.4.0` to `^0.5.0` in `create-donghanh/templates/*/package.json`, bump `create-donghanh` to its next minor, and note it in the CHANGELOG. After the user publishes, run `just test-templates`; it cannot pass before then because the templates install from npm. Commit — "Point templates at 0.5.0".

---

**Handoff to the user, not an agent task:** publish with `just publish all <otp>` after review; mintube then adopts 0.5.0 under its own plan.
