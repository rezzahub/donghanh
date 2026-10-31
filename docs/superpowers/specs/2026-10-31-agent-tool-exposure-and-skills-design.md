# Agent tool exposure, app instructions and skills: design

Date: 2026-10-31
Status: draft for review
Packages: `@donghanh/core`, `@donghanh/hono` (and `@donghanh/config`, `create-donghanh` templates, docs site)
First consumer: Leganox Idea (`leganox/leganox-idea`), which today patches several of these gaps in its own Worker (`worker/mcp/protocol.ts`).

Decisions are the owner's unless marked **(controller call)**.

## Intent

donghanh renders one registry of operations for several targets. Its MCP target (`mcpRoutes`) unrolls every operation into a tool and stops there. Real MCP hosts need more, and apps with many operations need a different shape:

1. **The method never reaches some hosts.** A donghanh app's cross-tool workflow ("call `start` first", "drafts stay drafts until kept", "ask before saving X") lives only in client-side skills or in each tool's `instruction`. ChatGPT has no skill upload for connectors, and MCP's `initialize.instructions` is the channel ChatGPT, Codex, Claude Code and Gemini CLI read, but donghanh never sends it.
2. **Protocol gaps break strict clients.** `initialize` always answers `protocolVersion: "2026-01-26"` (not an MCP spec version) whatever the client asked; `ping`, `resources/templates/list`, `prompts/list` and notifications other than `initialized`/`cancelled` get HTTP 404 "Method not found". On staging, ChatGPT authenticated and then failed tool discovery until the app patched this.
3. **Large registries hurt selection and approvals.** Claude's tool choice degrades past roughly 30 to 50 tools; VS Code caps a request at 128; Cursor is reported around 40. Aggregators (Composio, Zapier, Klavis) answer with a few discovery meta-tools; donghanh's own GPT Store adapter (`gptRoutes`) already has that shape (`/operations`, `/operations/:name`, `/query/:op`, `/mutate/:op`) but MCP doesn't.
4. **Guidance is static.** Apps want reusable, editable workflows (skills) that the model searches and loads on demand, as Composio does with `SEARCH_SKILLS` / `USE_SKILL` / `MANAGE_SKILL`.

## What hosts actually do (research, 2026-10-31; "unv." = unverified)

- **Approvals key on `readOnlyHint`.** ChatGPT treats only `readOnlyHint: true` as a read and adds explicit approval for `destructiveHint`; Claude runs read-only tools without asking and always asks for destructive ones; VS Code never asks for read-only tools; Codex's `writes` mode asks only for non-read-only tools. Hints are per tool, not per argument, so a generic tool that can write must be marked non-read-only and one "always allow" on it covers every write it can do. Claude's directory review rejects catch-all tools that mix reads and writes.
- **`instructions`:** used by ChatGPT and Codex (essentials in the first 512 characters), Claude Code (loaded at session start with tool search; truncated at 4,096 characters), Gemini CLI (appended to system instructions). Claude.ai chat and Cursor: undocumented (unv.).
- **A read-only tool is the only guidance channel every host runs without approval.**
- **Widgets (MCP Apps):** Claude web/desktop and ChatGPT support them; VS Code Insiders and Cursor beta (unv.); terminal clients don't. Widgets bind per tool (`_meta.ui.resourceUri`), so a widget operation must stay its own tool. ChatGPT withholds `toolInput` from a widget until an approval-gated call is approved.

## Goals

- Correct, tolerant MCP protocol handling in `mcpRoutes`, so consumers delete their patches.
- One app-level `instructions` playbook, used by every adapter.
- Richer per-operation facts (`title`, `idempotent`, `tags`, `meta`) and `outputSchema`, so hosts frame calls and approvals correctly.
- Per-endpoint **exposure**: unrolled tools (today), a discovery catalog, or a hybrid, configured where the endpoint is mounted.
- A **skills helper** that turns dynamic skill providers into ordinary operations.
- Next-step hints (`<Action>`) visible to the model, not only to widgets.

## Non-goals

- Code Mode (the model writing code against the API): experimental and it hides individual writes from per-call approval.
- Proxying remote MCP servers through a donghanh endpoint. A future aggregator may compose donghanh apps; that is not in this change.
- A single generic execute tool that mixes reads and writes.
- Packaging skills into client plugins (Claude plugin, ChatGPT/Codex plugin, Cursor rules). Possible later as a CLI step; out of this change.
- Changing `gptRoutes` beyond reading the shared `instructions` (it is deprecated with the GPT Store).

## Anti-goals (failure even if it works)

- An endpoint that can rename, re-describe or re-flag an operation. Facts live in the operation; endpoints only choose presentation.
- A catalog mode that makes a write look like a read to any host, or lets one approval cover destructive and routine writes alike.
- Skills listed in tool descriptions or `instructions` (they are dynamic; listing them goes stale and bloats the tool list).
- A breaking change for an app that upgrades without touching its config: default behavior stays today's unrolled tools, with the protocol fixes.

## Design

### 1. Facts in the operation, policy at the endpoint (owner's rule)

Operation `.tsx` (`registerOperation` config) states what an operation **is**. The endpoint states how operations are **surfaced**, and only through selectors over those facts. Nothing is declared twice:

| Where | What |
|---|---|
| Operation | `id`, `type`, `description`, `instruction`, `input`, `response`, `auth`, `scopes`, `destructive`, `external`, `widget`, and new: `title?`, `idempotent?`, `tags?: string[]`, `meta?: Record<string, unknown>` (copied into the tool's `_meta`, e.g. host-specific size hints), `appCallable?: boolean` (a widget calls it; section 6) |
| App | `App({ operations, instructions? })`: the playbook, one per app |
| Endpoint | `exposure` (below), an optional `instructionsSuffix`, plus today's transport options (resource, auth servers, scopes, widgets, serverInfo, `enrichResponse`) |
| Derived, never declared | Claude `anthropic/alwaysLoad` from endpoint `pin`; the catalog executor class from `type` + `destructive`; widget operations are always tools |

**`donghanh.config.ts` (controller call):** endpoints are declared in code where routes are mounted. `@donghanh/config` keeps what the CLI needs (operations glob, widget entries) and drops its `server` block, which duplicates `mcpRoutes` options. `chatRoutes` takes `systemPrompt` from `App.instructions` by default. Deprecate the `server` block for one minor version, then remove it.

### 2. App instructions

`App({ operations, instructions })`, a string (Markdown allowed).

- `mcpRoutes`: `initialize.result.instructions = instructions + (endpoint.instructionsSuffix ?? "")`. Warn at startup (not fail) above 4,096 characters, the Claude Code truncation point.
- `chatRoutes`: default `systemPrompt` (an explicit `systemPrompt` still wins).
- `gptRoutes`: included in the `/operations` listing.

Docs give the writing rule: essentials (what the app is, what to call first, the one or two rules that matter most) in the first 512 characters.

### 3. Protocol handling in `mcpRoutes`

Moves the Leganox Worker patch upstream (`leganox-idea/worker/mcp/protocol.ts` and its tests are the reference):

- `initialize`: answer the client's `protocolVersion` when it is in `SUPPORTED_PROTOCOL_VERSIONS` (`2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`), else the newest. Export the list.
- `ping` → `{ result: {} }`.
- `resources/templates/list` → `{ resourceTemplates: [] }`; `prompts/list` → `{ prompts: [] }`.
- Any `notifications/*` → 202, empty body.
- JSON-RPC errors (unknown method, unknown tool, unknown resource) → the same `-32601` body with HTTP 200, not 404.
- `path?: string` option (default `/mcp`), so one Hono app can mount several endpoints. **(controller call)** Endpoints of one app share one `resource` (token audience) and one protected-resource metadata document: they are views of the same API with the same tokens. `mcpRoutes` gets `metadata?: boolean` (default true); additional endpoints pass false. Per-endpoint audiences (RFC 9728 path-suffixed metadata) are out of scope until an app needs different tokens per endpoint.

### 4. Tool listing

- `title` from the operation (fallback: none, so hosts use `name`).
- `annotations`: `readOnlyHint` (query), `destructiveHint` (mutation with `destructive`), `openWorldHint` (`external`), and new `idempotentHint` (`idempotent`). Docs state the rule hosts apply: only `readOnlyHint: true` reads as safe; mark `destructive` only for delete, forget, revoke or overwrite.
- `outputSchema` must describe what `structuredContent` actually is, since strict hosts validate it **(controller call)**:
  - Default: the wrapper donghanh builds, `{ [responseKey]: <response schema>, actions?, display? }`, emitted only when the operation has a `response` schema (passed to `buildRegistry(appNode, responseSchemas)`; nothing generates them today, so most apps emit none).
  - An endpoint that rewrites `structuredContent` through `enrichResponse` supplies `outputSchema?: (op: OperationDetail, wrapped: object | undefined) => object | undefined` to return the real shape (Leganox: its envelope) or `undefined` to emit none. When `enrichResponse` is set and `outputSchema` isn't, none is emitted, so a rewrite can never fail host validation.
- `_meta`: operation `meta`, plus derived keys (`anthropic/alwaysLoad` for pinned tools, widget keys as today).

### 5. Next-step hints

`<Action operation label variables>` already renders into `structuredContent.actions` for widgets. Also append a compact "Next:" block to the model-visible text (`content[0].text`): one line per action, `label (operation_id)`. **(controller call)** Opt-out per endpoint with `actionsInText: false`, because an app that mirrors a JSON envelope in text (Leganox) may prefer to fold actions into its own envelope.

### 6. Exposure per endpoint (owner's decision: hybrid available, configured at the endpoint)

```ts
mcpRoutes({
  registry, executor, authenticate, resource, authorizationServers,
  exposure: {
    default: "tool" | "catalog",           // default "tool": today's behavior
    tools?: Selector,                      // these are always unrolled tools
    catalog?: Selector,                    // these go to the catalog
    pin?: string[],                        // always tools, alwaysLoad; ids validated at startup
  },
})

type Selector = { type?: "query" | "mutation"; tags?: string[]; ids?: string[]; widget?: boolean; destructive?: boolean };
```

Resolution per operation: widget operations → tool; `pin` → tool; matches `tools` → tool; matches `catalog` → catalog; else `default`. A selector field matches when every given field matches (AND); `tags` matches any listed tag. Unknown ids in `pin` or `ids` throw at startup.

**Catalog meta-tools** (generated only when at least one operation lands in the catalog):

| Tool | Hints | Input | Returns |
|---|---|---|---|
| `find_operations` | read-only | `{ query?, tags? }` | compact list `{ id, title, description, type, destructive, tags }` of catalog operations visible to the caller, keyword-matched on id, title, description and tags; the first result page also carries a one-line reminder to call `get_operation` before running |
| `get_operation` | read-only | `{ id }` | the operation detail: input schema, instruction, response schema, siblings (reuses `gptRoutes` detail building) |
| `run_read` | read-only | `{ id, variables }` | runs a catalog **query** |
| `run_write` | write, not destructive, closed-world unless a reachable operation is `external` | `{ id, variables, intent }` | runs a catalog non-destructive **mutation** |
| `run_destructive` | write, destructive | `{ id, variables, intent }` | runs a catalog destructive **mutation** |

- Each executor refuses an operation of another class (`run_read` on a mutation, `run_write` on a destructive one) with an actionable error naming the right tool.
- `intent` is one required sentence ("Keep 'Clinic SMS' and move it to Shortlisted"). It is shown in host approval dialogs (Composio pattern) and passed to the executor context; it is not stored by donghanh.
- A `run_*` tool is generated only if its class has catalog operations.
- Hybrid for Leganox: `exposure: { default: "tool", catalog: { type: "query" }, pin: ["start", "search_context"] }`: reads behind discovery (no approvals), writes as named tools (each approval names its action), the widget tool stays a tool.

**Calling catalog operations by name (controller call).** Widgets call operations through the host bridge by tool name, and some hosts only allow listed tools (Leganox's board widget calls `get_records`, `list_personas`, `get_persona`).
- A new operation fact `appCallable?: boolean` marks operations a widget calls. In catalog mode they are still listed, as **app-only** tools (`_meta.ui.visibility: ["app"]`, MCP Apps), hidden from the model's tool list but callable by the widget. In tool mode the fact changes nothing.
- `tools/call` by name also accepts catalog **queries** that aren't listed (read-only, so no approval is bypassed). Catalog **mutations** that aren't listed are refused by name (`-32601`, with a message pointing at `run_write` / `run_destructive`), so a write can't run under a different approval than its class.

**Auth on meta-tools (controller call).** `authenticate` yields only a user id, so:
- `find_operations` hides `auth: "required"` operations from anonymous callers; nothing finer (apps needing per-user visibility filter inside their executor).
- Each meta-tool's `securitySchemes` is the union over the catalog operations it can run: `noauth` if any is `none`/`optional`, `oauth2` (endpoint default scopes plus every listed operation scope) if any is `optional`/`required`.
- `run_*` applies the target operation's own `auth`, returning the same `mcp/www_authenticate` challenge as a direct call would.

### 7. Skills helper (owner: a helper, dynamic, providers read-only or read-write)

`@donghanh/core/skills` (**controller call**: a subpath export of core, not a new package):

```ts
interface SkillSummary { id: string; slug: string; name: string; description: string; hash: string; writableBy?: string }
interface Skill extends SkillSummary { markdown: string; files?: Record<string, string> }

interface SkillProvider {
  key: string;
  search(query: string, ctx: SkillContext): Promise<SkillSummary[]>;
  get(slug: string, ctx: SkillContext): Promise<Skill | null>;
  create?(input: { title: string; markdown: string }, ctx: SkillContext): Promise<Skill>;
  update?(id: string, input: { title: string; markdown: string }, ctx: SkillContext): Promise<Skill>;
  delete?(id: string, ctx: SkillContext): Promise<void>;
}
type SkillContext = { userId: string | null; request: Request };

function skillOperations(opts: { providers: SkillProvider[]; prefix?: string }): {
  operations: Record<string, OperationComponent>;
  wrap(executor: Executor): Executor; // routes skill operation ids to providers, everything else to `executor`
};
function staticSkills(key: string, files: Record<string, string>): SkillProvider; // read-only, from SKILL.md strings
```

**How skill operations run (controller call).** donghanh executes everything through the app's single `Executor`, so the helper returns `wrap(executor)`. The app chooses where it sits: Leganox puts its own gates (argument size cap, rate limits, envelope) **outside** the wrapped executor, `appGates(skills.wrap(appExecutor))`, so skill reads and writes pass the same gates as every operation. Generated operations use a plain `<Brief>` with one `<Message>`, `responseKey: "skill"` / `"skills"`, so `gptRoutes` and `chatRoutes` get skills too.

**Provider keys and write routing (controller call).** Every provider has a `key: string` (unique; startup error otherwise). Skill ids are namespaced `"<key>:<provider id>"` everywhere they leave the helper, so ids never collide and update/delete route by prefix. `SkillSummary.writableBy` names the provider key that can change it, if the caller may. `manage_skill` `create` takes an optional `target` (a writable provider key); without it, the first writable provider in the list is used. Search results list which keys are writable for the caller, so the model can name a target when the user says "save this for the team" vs "just for me".

- Generates ordinary operations, so endpoint exposure applies unchanged: `search_skills` (query `{ query, limit ≤ 10 }`), `use_skill` (query `{ slug }`, returns the Markdown with the instruction "keep it in context and follow it as guidance while using the normal tools"), and, **only if some provider implements a write method**, `manage_skill` (mutation, `{ create | update }`, exactly one, not destructive) and `delete_skill` (mutation, `{ id }`, destructive). Composio puts delete inside its manage tool; donghanh splits it **(controller call)** because hints are per tool, and one tool that can delete must be marked destructive for every call.
- Dynamic: providers are queried per request with the caller's context; what a caller sees and may change is the provider's decision (visibility and write permission per user or workspace are app concerns). New or edited skills appear on the next search; no tool-list change.
- Merge across providers: results concatenated in provider order, de-duplicated by slug, **first provider wins** **(controller call)**, so curated read-only skills listed first can't be shadowed.
- `SKILL.md` format: YAML frontmatter `name`, `description`, then Markdown (≤ 64 KB). Extra files pass through untouched in `files`.
- `hash` (content hash) lets an app record which version of a skill a piece of work ran under.
- `manage_skill` rules in its instruction, after Composio: only when the user explicitly asks; update needs the exact `id` from search or use; never fall back to create; pass the complete `SKILL.md`; never delete duplicates automatically.
- `instructions` and tool descriptions never enumerate skills; the app's playbook says "search skills before starting a kind of task".

### 8. Versioning

All additive except the `initialize` version answer and 404→200 error statuses (behavior changes clients rely on positively). Bump `@donghanh/core` and `@donghanh/hono` together to **0.4.0**, peer ranges updated (repo rule: packages share major/minor). `@donghanh/config` deprecates `server`.

## Acceptance

1. `initialize` echoes each supported version and answers an unknown one with the newest; `instructions` present when the app has them (+ endpoint suffix).
2. `ping`, empty template and prompt lists, 202 notifications, `-32601` with HTTP 200 for unknown method/tool/resource.
3. `tools/list` carries `title`, all four hints, `outputSchema` when a response schema exists, operation `meta` in `_meta`.
4. With no `exposure`, the tool list equals today's (plus the new fields). An app upgraded without config changes behaves as before apart from the protocol fixes.
5. Hybrid: catalog queries are absent from `tools/list`; `find_operations`, `get_operation`, `run_read` present; no `run_write`/`run_destructive` when no mutation is in the catalog; widget and pinned operations are tools with `anthropic/alwaysLoad` on pins.
6. Catalog executors refuse wrong-class operations with an error naming the right tool; `intent` is required on writes.
7. Unknown ids in `pin`/selectors throw at startup.
8. `skillOperations` with a read-only provider generates only `search_skills` and `use_skill`; with a writable one also `manage_skill` and `delete_skill` (destructive). First provider wins on slug collisions. A skill created mid-session is found by the next search.
9. Two `mcpRoutes` mounts with different `path` and `exposure` serve one registry; metadata mounted once.
10. `chatRoutes` uses `App.instructions` as default system prompt.
11. A catalog query is callable by name; an unlisted catalog mutation is refused by name with a pointer to its `run_*` tool; an `appCallable` operation in the catalog is listed with `_meta.ui.visibility: ["app"]`.
12. With `enrichResponse` and no `outputSchema` option, no `outputSchema` is emitted.
13. Skill ids are `<key>:<id>`; update/delete route by prefix; `create` honors `target`, else the first writable provider.
14. Leganox Idea, linked locally against the built packages, deletes `worker/mcp/protocol.ts` with its suite passing (verification only).

**Scope (controller call).** This change ends at publishing `@donghanh/core` and `@donghanh/hono` 0.4.0 (the owner runs `just publish`, which needs an npm OTP). Adopting it in Leganox (bump, delete `protocol.ts`, hybrid exposure, `appCallable` on the widget's queries, the envelope `outputSchema`, docs in that repo) is a task in the Leganox redesign plan, not here.

## Left to the builder

- Keyword matching in `find_operations` (simple case-insensitive token match is enough).
- Exact text of the generated tools' descriptions and instructions, within the rules above.
- Where `SUPPORTED_PROTOCOL_VERSIONS` lives and how it's exported.
- Docs site pages (reference for `mcpRoutes` exposure, `App.instructions`, skills; a guide "Many operations: hybrid exposure") and `create-donghanh` template updates.
