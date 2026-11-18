# File access for skills and docs — design (2026-11-17)

Status: draft for approval. The first plan covers donghanh 0.5.0 only. The mintube adoption below is a follow-up with its own plan, written once 0.5.0 is released; its open questions (the doc migration, and runs in flight when the old tools are removed) are parked until then.

## Why

A skill is not one file: it bundles references, templates and scripts that its SKILL.md points to with relative paths. Today donghanh's `Skill` carries `files?: Record<string, string>` (inline, text only, no paths, no paging), and mintube returns sibling files inline or as signed URLs with `use_skill`. An agent that loads a skill cannot read one of its files on demand, cannot look inside a large file without pulling all of it into context, and cannot follow a relative link in a doc.

The same gap exists outside skills. Mintube keeps niche, team and channel docs (research, transcripts, strategy) that agents need to browse, search and read in pieces. Skill files in mintube are already docs under `skills/<slug>/`. So the right primitive is a file system, and a skill is a folder in it.

## Goals

1. A generic, read-side file interface in donghanh: list, read (paged), grep, and an optional ranked search hook, over URIs.
2. Relative links in any doc resolve the same way everywhere (against the directory of the file that contains the link), with helpers hosts and agents can rely on.
3. Reads never flood context: every read is paged with hard caps and tells the agent how to continue.
4. `use_skill` returns the skill, its file manifest, the files the skill says to include, and a table of resolved refs. Other files are fetched by tool call.
5. Guidance for the agent travels with the interface (tool instructions, result shape, error messages), and guidance for implementers ships in the docs.
6. Follow-up, after the donghanh release: mintube adopts it with `mintube://` URIs over its doc trees and canonical skills, three file tools, and the old method-doc surfaces removed.

## Non-goals

- Write tools (`write_file`, `edit_file`, `delete_file`). The interface leaves room for them; mintube keeps `edit_doc` and `save_doc`. Moving `get_doc` and `list_docs` onto the file tools is a later slice.
- Building an index or semantic search. donghanh defines the hook and result contract only.
- MCP resources.
- The `canonical/` directory move, `@range` version pinning and the single `search` catalog from `2026-11-17-canonical-layout-refs-versioning-design.md`. This slice does not depend on them and does not block them.
- Web Markdown renderer mapping of `mintube://` links (`absolutizeRefs` exists for it; wiring it is a follow-up).

## Anti-goals

- A skill file that cannot be read without loading the whole file into context.
- Rewriting the markdown an agent receives, so an edited skill round-trips with its links still relative.
- A second set of tools that does for skills what the file tools do for docs.
- Any alias or "deprecated" shim for what this replaces.

## Constraints

- donghanh runs on Workers, Bun and Node: no embedding or index dependency, pure helpers, no filesystem access.
- donghanh only sees tool calls, not the host's own writes, so it cannot keep an index fresh.
- Access is the provider's decision. A file the caller cannot read is reported as not found, never as forbidden.
- Agent Skills spec: SKILL.md frontmatter allows `name`, `description`, `license`, `compatibility`, `metadata` (string to string map) and `allowed-tools` at the top level.
- donghanh `core`, `hono`, `react` and `config` share a major and minor, so all four go to 0.5.0 together, with `peerDependencies` updated. Publishing needs the user's npm OTP, so the release step is the user's; mintube can build against the workspace copy until then and pins 0.5.0 after.
- Mintube Worker tests need Docker on this host (glibc), run as in the existing workerd test setup.

## Approaches

- **A. Skill-scoped file tools** (`read_skill_file`, `grep_skill_files` taking a slug and path). Smallest change. But niche and team docs need their own tools, and skills stay special.
- **B. Generic file engine with providers per URI scheme; a skill is a folder.** One set of tools for skills and docs, relative links work identically everywhere, and a search hook can be added without another break. Larger than A, but mintube's skill files are already docs, so its provider is the doc tree either way. **Chosen.**
- **C. MCP resources.** Rejected: client support is uneven, and the decision was fetch by tool call.
- **Inline all files into `use_skill`.** Rejected: it fills context. Only files the skill names in `metadata.include` come inline.

Search: **hook only** was chosen over building semantic search in this slice (it needs chunking, embeddings, freshness by revision and access-filtered results, and overlaps the `search` op planned in mintube's amendment).

## Design

### Package layout

New export `@donghanh/core/files`: types, the engine functions, helpers, and `fileOperations`. `@donghanh/core/skills` is rebuilt on top of it.

### FileProvider

```ts
interface FileEntry {
  uri: string;                 // directories end with "/"
  kind: "file" | "dir";
  bytes?: number;
  lines?: number;              // text only
  mime?: string;
  description?: string;        // one line; see describeMarkdown
  version?: string;            // or revision; opaque to donghanh
}

interface FileContent {
  uri: string;
  version?: string;
  mime: string;
  text?: string;               // text files: the whole file
  url?: string;                // binary files: signed URL, no bytes
  bytes: number;
}

interface FileProvider {
  scheme: string;              // "mintube"
  roots?(ctx): Promise<FileEntry[]>;
  stat(uri, ctx): Promise<FileEntry | null>;
  list(uri, o: { depth: number; glob?: string; limit: number; after?: string }, ctx):
    Promise<{ entries: FileEntry[]; next?: string }>;
  read(uri, ctx): Promise<FileContent | null>;
  readLines?(uri, range: { from: number; to: number }, ctx): Promise<FileContent | null>;
  grep?(args, ctx): Promise<GrepHit[]>;      // optional native override
  search?(query: string, o: { uri?: string; limit: number }, ctx): Promise<SearchHit[]>;
}
```

`null` means not found, and also means not allowed. The provider returns whole text from `read`; donghanh does the slicing and the caps. A provider that can slice cheaply adds `readLines`. donghanh supplies a default `grep` over `list` and `read`; a provider overrides it only for speed.

### Engine and caps

Plain functions (`listFiles`, `readFile`, `grepFiles`, `searchFiles`) so a host with its own tenancy and authorization, like mintube, can wrap them in its own operations. `fileOperations({ providers, prefix?, auth? })` wraps the same functions as donghanh operations for other hosts, in the style of `skillOperations`.

| Limit | Value |
|---|---|
| Read default | first 200 lines, at most 16 KB |
| Line length | 2,000 chars, then `…[line truncated]` |
| List | default 100, max 500 per page, `after` cursor |
| Grep | 50 matches, 2 lines of context, scans at most 200 files / 2 MB |
| Search | default 10, max 25 |

Line numbers are 1-based.

### Tools

Names take the optional `prefix`, as skill operations do.

- **`list_files`** `{ uri?, depth?, glob?, limit?, after? }`. No `uri` returns the mounts the caller can see. Entries carry path, bytes, lines and description, so the agent can choose without reading.
- **`read_file`** `{ uri? | path + base, head? | tail? | offset + limit }`. Text comes back as `{ uri, version, lines: { from, to, total }, text, truncated, next }`, rendered with line numbers in the text brief. `next` is a ready-to-call argument set. Binary returns metadata and `url`, never bytes. Argument rules (my call): pass `uri`, or `path` with `base`, never both (error). `head`, `tail` and `offset`/`limit` are mutually exclusive (error). `tail: n` returns the last n lines that fit the caps, and the result's `lines.from` tells the agent where to read earlier. `offset` past the end returns empty text with `lines.total` and a note, not an error. `next` is always a valid argument set.
- **`grep_files`** `{ pattern, uri, glob?, ignoreCase?, context?, limit? }` returns `{ uri, line, text, before, after }` hits, with a note when capped.
- **`search_files`** `{ query, uri?, limit? }`. Registered only if some provider implements `search`. Hits are `{ uri, version, lines: [from, to], snippet, score }`, so the next call is `read_file` with `offset`. donghanh does not interpret the query and has no mode flag.

### Refs and helpers

All pure, no I/O.

- **`resolveRef(base, rel)`**: URL rule. `rel` resolves against the directory of `base`; `.` and `..` are normalised; an absolute `scheme://` ref is returned as is. A `@version` suffix is not carried over; the host decides what version a resolved ref gets.
- **`extractRefs(markdown, baseUri)`** returns `{ raw, uri }[]` for relative and `scheme://` link and image targets. It skips `http(s)` links and `#anchors`.
- **`absolutizeRefs(markdown, baseUri)`** returns a copy with those targets absolute. For hosts that render (mintube's web renderer). Never used on agent-facing text.
- **`chunkMarkdown(text, { by: "heading" | "lines", size? })`** returns chunks with `{ from, to }` line ranges that match what `read_file` pages by. For host indexers.
- **`describeMarkdown(text)`** returns the frontmatter `description`, else the first heading, else the first non-empty line, trimmed to one line.

### Skills on top of files

- `Skill` loses `files?: Record<string, string>`. It gains `uri` (of its SKILL.md, optional for providers with no file tree), `files: FileEntry[]` (manifest of the whole folder), `included: { path, text }[]`, `refs: { raw, uri }[]`.
- `skillOperations` takes `files?: FileProvider[]`. `use_skill` builds the manifest with the provider whose scheme matches `skill.uri`; no match means an empty manifest.
- `parseSkillMarkdown` also returns `metadata: Record<string, string>`, read from the indented one-level `metadata:` block of the frontmatter.
- **`metadata.include`**: comma-separated relative paths (string-valued, as the Agent Skills spec requires), resolved against the SKILL.md directory and required to stay inside it (an include that resolves outside the skill folder is not read and adds a `notice`). Included files come inline, in order, up to 32 KB in total. Anything over the cap, missing or binary falls back to manifest-only, with a `notice`. It is never an error.
- `hash` stays the hash of SKILL.md only.
- `staticSkills(key, tree)` takes `Record<path, string>`; skills are the `<slug>/SKILL.md` entries and everything else in the tree is a file. One call gives the `SkillProvider` and the in-memory `FileProvider` over the same tree (`staticFiles` is also exported, as a test fixture). The skill uri is `<scheme>://<key>/<slug>/SKILL.md`.

The manifest lists files only, not directories, binary files included (marked as such), sorted by path, at most 50 entries (my call). Over that, the footer ends with `N more — list_files { uri: <skill folder> }`. `list_files` is the paged way to see the rest.

`use_skill` brief text: SKILL.md verbatim; each included file under `--- included: <path> ---`; then a footer with the skill uri, the manifest (path, size, lines, description), the refs table, and one line: relative paths resolve against the file that contains them; read with `read_file`. Exact wording is the builder's.

### Telling the agent

1. **Tool instructions.** Each file tool's `instruction` says what to pass, that reads are paged (default first 200 lines), to follow `next`, to grep or search before reading a large file, and that relative paths need a `base`.
2. **App-level paragraph.** When any `FileProvider` is registered, the app `instructions` gain one paragraph: skills and docs are file trees addressed by URI; relative paths resolve against the document they appear in; start from `list_files` with no uri. donghanh also exports the paragraph as the constant `FILES_INSTRUCTIONS`, so a host that wraps the engine in its own operations, as mintube does, includes it in its own instructions (my call).
3. **Result shape.** `refs`, `uri`, `next` and the manifest mean the agent never builds a path or an offset itself.
4. **Errors that teach.** A relative path without `base` fails with: `Relative path "references/x.md" needs base — pass the uri of the file that links it (use_skill returns it).` An unknown uri says to call `list_files`.
5. **Implementer docs.** `docs/features/files.md`, plus the donghanh `SKILL.md` and `skills/donghanh`: the provider contract; not-found-not-forbidden; page and cap rather than return whole files; signed URL for binary; stamp hits with the revision they were indexed at and drop stale ones; filter any index by access; `grep_files` is for exact strings and `search_files` for concepts.

### Removed, no aliases (donghanh 0.5.0)

`Skill.files` as a record, and the old `staticSkills(key, files)` signature. CHANGELOG lists both under a breaking Changed entry. `create-donghanh` templates and the site docs are updated to match; the templates' `@donghanh/*` range moves to `^0.5.0` with the release.

## Mintube adoption (follow-up, separate plan)

Not part of the first plan. Written down now so the donghanh interface is shaped by its real consumer.

mintube is on `@donghanh/core` 0.4.1 and uses only `parseSkillMarkdown` from it. It has its own `use_skill`, `get_doc`, `list_docs`, `get_method_doc`, `list_method_docs`. There is no `mintube://` scheme in the code yet.

- **Provider** `mintube`, in a new `apps/api/src/files/`. URIs follow the 2026-11-17 design grammar: `mintube://{canonical|team|niche|channel}/{id|slug|current}/<path>`.
  - **Doc trees.** Team, niche and channel mount the doc trees by path. Docs and `doc_files` share one path namespace per scope, as they do in `docSkillFiles` today; on a collision the `doc_file` wins (today's behavior). `doc_files` are binary entries served through `signFileUrl`. `bytes`, `lines` and `description` are filled when one query can supply them and are omitted otherwise (they are optional), so `list_files` stays cheap.
  - **Canonical.** `mintube://canonical/skills/<slug>/<path>` (SKILL.md and its files, with no `/files/` segment, unlike the earlier grammar, since the file tree is the interface now) and `mintube://canonical/knowledge/<name>.md` for the `system/` docs `get_method_doc` serves today. Paths carry the file extension (my call).
  - **`current`.** `niche/current` needs `nicheId`, `channel/current` needs `channelId`, `team/current` needs `teamId`. A missing one fails with a message naming the argument to pass. Each kind reads only its own argument, so `niche/current` with only `teamId` set fails the same way.
  - **Authorization and roots.** A uri is authorized as its scope at viewer level, reusing what `get_doc` and `list_docs` do (`authorizeSkillScope` for skill scopes). Anything the caller cannot see is not found. `roots` returns `canonical`, the team and teams the caller belongs to, and the niche and channel named by the request's arguments.
  - **Versions.** A uri carrying `@…` is served only where a snapshot exists: a pinned canonical skill, whose `use_skill` result returns file uris with its pin and reads from that snapshot, so a pinned run reads the files it was pinned to. Doc skills keep today's limit: files have no revisions, so a pinned doc skill reads current sibling files. An `@` suffix the provider cannot serve is not found, with a message saying so. `version` in results is the doc revision, informational.
- **Three mintube operations**, `read_file`, `list_files`, `grep_files`, defined with `defineOperation` and zod like the others, with scope authorization and optional `teamId`, `nicheId`, `channelId`, over the donghanh engine. No `search_files` yet.
- **`use_skill`** returns `uri`, the manifest, `included`, and `refs` (replacing `methodDocs`), plus the existing stale-override notice. Pinned doc skills keep today's behavior: the revision's markdown with the current sibling files (files have no revisions).
- **Removed, hard:** `get_method_doc`, `list_method_docs`, `methodDocs`, and the legacy path mapping and `CANONICAL_PATHS_NOTE`. `get_ref` and the deprecated-alias list from the 2026-11-17 amendment are not built.
- **Order:** (1) provider, ops and `use_skill`; (2) rewrite canonical skills that cite `get_method_doc` or repo paths (`find-niche` is one) to `read_file` and `mintube://canonical/knowledge/...`; (3) the doc migration in that design (dry-run diff, operator approves, writes new revisions), so team and niche skill docs stop using legacy paths; (4) remove the old surfaces. Step 4 does not run before step 3 is approved and applied.
- **Docs:** `write-skill` and the amendment in the 2026-11-17 spec get a note that `read_file` replaces `get_ref` and the method-doc tools.

## Testing

donghanh: vitest (`just test`, with `just lint` for biome and tsc), with `staticFiles` fixtures. Cover the caps (read, line length, grep scan limits), `next` hints and `tail`/`offset` edges, `resolveRef`, `extractRefs`, `absolutizeRefs`, `chunkMarkdown`, `describeMarkdown`, the `metadata` parsing, `include` fallbacks (over cap, missing, binary), manifest cap, not-found-not-forbidden, and the teaching errors. Mintube: the existing op test style, plus the Docker setup for Worker tests; cover `current` resolution, scope authorization, binary entries and the pinned canonical read.

## Left to the builder

- Exact text of the `use_skill` footer and of the line-numbered read rendering.
- Whether `fileOperations` returns the app-level paragraph for the host to attach, or hono attaches it.
- The context type shared by files and skills (`SkillContext` and a file context have the same fields).
- Regex safety in the default grep (bounds are in the caps table).
- Mintube: the canonical knowledge mount's source until the `canonical/` layout lands; how `@version` is parsed in a uri; cursor format for `list_files`.

## Amendment (2026-11-18): Skill.folder and host exports

A skill's folder was always the directory of its uri, which fits a `SKILL.md` file but not a host where the skill doc is itself the folder node (mintube: `.../skills/write-song` holds `.../write-song/references/a.md`).
`Skill` gains an optional `folder`; the manifest, `metadata.include` (and its containment check), refs, and the footer's relative paths and `base` use it. Unset, output is unchanged.
`attachSkillFiles` and `renderSkillBrief` are exported from `@donghanh/core/skills` for hosts with their own `use_skill`.
Additive, shipped as 0.5.1.
