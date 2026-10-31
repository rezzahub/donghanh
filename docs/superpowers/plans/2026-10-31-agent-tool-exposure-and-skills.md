# Agent Tool Exposure, App Instructions and Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `mcpRoutes` protocol-correct, give apps one `instructions` playbook and richer operation facts, add per-endpoint exposure (tool / catalog / hybrid), and ship a dynamic skills helper.

**Architecture:** Operation facts live in `@donghanh/core` (`OperationConfig`, registry). `@donghanh/hono`'s `mcpRoutes` reads them and applies endpoint policy: a pure exposure resolver (`exposure.ts`) decides tool vs catalog per operation, and a catalog module (`catalog.ts`) generates and dispatches the discovery meta-tools. Skills are a core subpath helper that returns ordinary operations plus an executor wrapper.

**Tech Stack:** Bun workspaces, TypeScript, Hono, `bun test`, Biome (2-space indent, double quotes), `just`.

**Spec:** `docs/superpowers/specs/2026-10-31-agent-tool-exposure-and-skills-design.md` (read it first; section numbers below refer to it).

## Global Constraints

- With no `exposure` option, `tools/list` is today's list plus the new fields; nothing else about an app changes except the protocol fixes (spec Anti-goals, Acceptance 4).
- Facts in the operation, policy at the endpoint: no endpoint option may rename, re-describe or re-flag an operation (spec §1).
- `SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]`, newest first.
- Instructions warning threshold: 4,096 characters (warn, never fail).
- Skill Markdown cap: 65,536 characters; `search_skills` `limit` 1–10, default 5.
- Skill ids leave the helper as `"<provider key>:<provider id>"`.
- Reserved tool names (startup error if an app operation uses one while it is generated): `find_operations`, `get_operation`, `run_read`, `run_write`, `run_destructive`.
- Version: `@donghanh/core` and `@donghanh/hono` → `0.4.0`, hono's peer `@donghanh/core` → `^0.4.0`. Publishing (`just publish … <otp>`) is the owner's step, not a task.
- Biome must pass with no suppressions (`just lint`); repo CLAUDE.md: "Do NOT suppress errors; fix them."
- Do not touch the owner's uncommitted edits in `README.md`, `site/src/content/docs/guides/*.md`, `site/src/content/docs/reference/hono.md`, `skills/donghanh/SKILL.md` until Task 9, and then only add to them.

## Review Focus

1. An app operation whose id equals a generated meta-tool name (`run_read`, `search_skills`): expect a startup error naming the operation, not a silently shadowed tool. Test in Task 5 (meta-tools) and Task 7 (skills).
2. `pin` naming an operation that a `catalog` selector also matches: pin wins (listed tool with `alwaysLoad`). Test in Task 5.
3. `run_read` / `run_write` called with an unknown id: an `isError` result telling the model to call `find_operations`, not a thrown 500. Test in Task 6.
4. One skill provider throwing during `search`: the other providers' results still come back; the failure is logged without the query. Test in Task 7.
5. A client that sends `initialize` with no `params` at all: answered with the newest version, not a crash. Test in Task 2.

---

### Task 1: Core facts — app instructions, operation facts, executor intent

**Files:**
- Modify: `packages/core/src/primitives.ts` (`App`, `AppNode`), `packages/core/src/types.ts` (`OperationConfig`, `ExecutorContext`), `packages/core/src/registry.ts`
- Test: `packages/core/src/registry.test.ts` (create)

**Interfaces:**
- Produces:
  - `App(props: { operations: Record<string, OperationComponentAny>; instructions?: string }): AppNode` — `AppNode.instructions?: string`
  - `OperationConfig` gains `title?: string; idempotent?: boolean; tags?: string[]; meta?: Record<string, unknown>; appCallable?: boolean`
  - `ExecutorContext` gains `intent?: string`
  - `CompactOperation` gains `title?`, `tags?`, `destructive?`; `OperationDetail` gains `title?`, `idempotent?`, `tags?`, `meta?`, `appCallable?`
  - `Registry.instructions(): string | undefined`

- [ ] **Step 1: Write the failing tests** (`registry.test.ts`, `bun:test`, reuse the `makeOp` shape from `packages/hono/src/mcp.test.ts`):

```ts
test("instructions come from App", () => {
  const reg = buildRegistry(App({ operations: {}, instructions: "Call start first." }));
  expect(reg.instructions()).toBe("Call start first.");
  expect(buildRegistry(App({ operations: {} })).instructions()).toBeUndefined();
});
test("buildRegistry throws on two operations with the same id", () => {   // Review Focus 1
  expect(() => buildRegistry(App({ operations: { a: makeOp("x"), b: makeOp("x") } }))).toThrow(/x/);
});
test("detail and list carry the new facts", () => {
  const op = makeOp("keep", { type: "mutation", title: "Keep", idempotent: true, tags: ["board"],
    meta: { "anthropic/maxResultSizeChars": 1000 }, appCallable: true, destructive: false });
  const reg = buildRegistry(App({ operations: { op } }));
  expect(reg.detail("keep")).toMatchObject({ title: "Keep", idempotent: true, tags: ["board"],
    meta: { "anthropic/maxResultSizeChars": 1000 }, appCallable: true });
  expect(reg.list()[0]).toMatchObject({ id: "keep", title: "Keep", tags: ["board"], destructive: false });
});
```

- [ ] **Step 2: Run** `bun test packages/core` — Expected: FAIL (`instructions is not a function`).
- [ ] **Step 3: Implement** the fields above; `list()` omits undefined optional keys as it does today for `auth`.
- [ ] **Step 4: Run** `bun test packages/core && just lint` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): app instructions, operation title/idempotent/tags/meta/appCallable, executor intent`

### Task 2: `mcpRoutes` protocol handling and instructions

**Files:**
- Create: `packages/hono/src/protocol.ts` (`SUPPORTED_PROTOCOL_VERSIONS`, `negotiateProtocolVersion`)
- Modify: `packages/hono/src/mcp.ts`, `packages/hono/src/index.ts` (export both)
- Test: `packages/hono/src/mcp.test.ts`

**Interfaces:**
- Consumes: `Registry.instructions()` (Task 1)
- Produces:
  - `negotiateProtocolVersion(requested: unknown): string`
  - `McpRoutesConfig` gains `path?: string` (default `"/mcp"`), `metadata?: boolean` (default `true`, mounts `/.well-known/oauth-protected-resource`), `instructionsSuffix?: string`

- [ ] **Step 1: Write the failing tests** (port the cases from Leganox `test/mcp/mcp.test.ts` "protocol" block, through `app.request`):

```ts
test("initialize echoes each supported version", async () => {
  for (const v of ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]) {
    const { result } = await rpc(app, "initialize", { protocolVersion: v });
    expect(result.protocolVersion).toBe(v);
  }
});
test("initialize answers unknown or missing versions with the newest", async () => {
  expect((await rpc(app, "initialize", { protocolVersion: "2099-01-01" })).result.protocolVersion).toBe("2025-11-25");
  expect((await rpc(app, "initialize")).result.protocolVersion).toBe("2025-11-25"); // Review Focus 5
});
test("initialize carries app instructions plus the endpoint suffix", async () => {
  const reg = buildRegistry(App({ operations: {}, instructions: "Play." }));
  const a = mcpRoutes({ ...baseConfig, registry: reg, instructionsSuffix: " Use find_operations." });
  expect((await rpc(a, "initialize")).result.instructions).toBe("Play. Use find_operations.");
});
test("no instructions key when the app has none", ...);           // `"instructions" in result` is false
test("warns once at startup above 4096 characters", ...);          // spy console.warn; mcpRoutes() with 4097 chars → 1 call
test("ping answers an empty result", ...);                         // { jsonrpc:"2.0", id:1, result:{} }
test("templates and prompts list empty", ...);                     // result.resourceTemplates == [], result.prompts == []
test("any notification is 202 with an empty body", ...);           // notifications/initialized, notifications/roots/list_changed
test("unknown method, tool and resource are -32601 with HTTP 200", ...); // status 200, error.code -32601 for each
test("path mounts the endpoint elsewhere; metadata:false skips the metadata route", ...);
```

- [ ] **Step 2: Run** `bun test packages/hono/src/mcp.test.ts` — Expected: FAIL on the new cases (version is `2026-01-26`, 404s).
- [ ] **Step 3: Implement**: `negotiateProtocolVersion` in `protocol.ts`; in `mcp.ts` replace `MCP_PROTOCOL_VERSION` with the negotiated value, add `instructions` (only when defined), handle `ping` / the two list methods / `notifications/*` before the switch's default, change every `-32601` response's status to 200, route on `path`, guard the metadata route with `metadata`. Update the existing initialize test's expected version.
- [ ] **Step 4: Run** `bun test packages/hono && just lint` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(hono): negotiate MCP protocol version, ping, notifications, 200 errors; app instructions`

### Task 3: Tool listing — title, hints, `outputSchema`, `_meta`

**Files:**
- Modify: `packages/hono/src/mcp.ts` (`annotationsFor`, tools/list)
- Test: `packages/hono/src/mcp.test.ts`

**Interfaces:**
- Consumes: Task 1 facts
- Produces: `McpRoutesConfig.outputSchema?: (op: OperationDetail, wrapped: object | undefined) => object | undefined`

- [ ] **Step 1: Write the failing tests**:

```ts
test("tools carry title, idempotentHint and operation meta", async () => {
  const op = makeOp("keep", { type: "mutation", title: "Keep candidate", idempotent: true, meta: { "x/y": 1 } });
  const tool = (await rpc(mcpRoutes({ ...baseConfig, registry: makeApp({ op }) }), "tools/list")).result.tools[0];
  expect(tool.title).toBe("Keep candidate");
  expect(tool.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true });
  expect(tool._meta).toMatchObject({ "x/y": 1 });
});
test("outputSchema wraps the response schema under responseKey", async () => {
  const reg = buildRegistry(App({ operations: { op } }), { op: { type: "object", properties: { n: { type: "number" } } } });
  const tool = (await rpc(mcpRoutes({ ...baseConfig, registry: reg }), "tools/list")).result.tools[0];
  expect(tool.outputSchema).toEqual({ type: "object", properties: { op: { type: "object", properties: { n: { type: "number" } } },
    actions: { type: "array" }, display: {} }, required: ["op"] });
});
test("no outputSchema when enrichResponse is set without an outputSchema option", ...);
test("the outputSchema option replaces or removes the schema", ...); // returns custom object → used; returns undefined → absent
test("no outputSchema without a response schema", ...);
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**: `idempotentHint: detail.idempotent ?? false` for every tool; merge `detail.meta` into `tool._meta` before widget keys; outputSchema rule exactly as the tests state.
- [ ] **Step 4: Run** `bun test packages/hono && just lint` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(hono): tool title, idempotentHint, outputSchema and per-operation _meta`

### Task 4: Next-step hints in model-visible text

**Files:**
- Modify: `packages/hono/src/mcp.ts` (tools/call text)
- Test: `packages/hono/src/mcp.test.ts`

**Interfaces:**
- Produces: `McpRoutesConfig.actionsInText?: boolean` (default `true`)

- [ ] **Step 1: Write the failing tests**:

```ts
test("actions are appended to the text as a Next block", async () => {
  const op = makeOp("list", {}, () => Brief({ children: [Message({ children: "3 items." }),
    Action({ operation: "add_item", label: "Add an item" })] }));
  const { result } = await rpc(mcpRoutes({ ...baseConfig, registry: makeApp({ op, add_item: makeOp("add_item") }) }),
    "tools/call", { name: "list", arguments: {} });
  expect(result.content[0].text).toBe("3 items.\n\nNext:\n- Add an item (add_item)");
  expect(result.structuredContent.actions).toHaveLength(1);
});
test("actionsInText:false keeps the text unchanged", ...); // text === "3 items."
test("no Next block when there are no actions", ...);
```

- [ ] **Step 2–4:** run (FAIL), implement, run `bun test packages/hono && just lint` (PASS).
- [ ] **Step 5: Commit** `feat(hono): show next-step actions in tool result text`

### Task 5: Exposure resolution and the tool list

**Files:**
- Create: `packages/hono/src/exposure.ts`
- Modify: `packages/hono/src/mcp.ts` (tools/list, tools/call by name), `packages/hono/src/index.ts` (export types)
- Test: `packages/hono/src/exposure.test.ts` (pure), `packages/hono/src/mcp.test.ts` (wired)

**Interfaces:**
- Produces:

```ts
export type Selector = { type?: "query" | "mutation"; tags?: string[]; ids?: string[]; widget?: boolean; destructive?: boolean };
export interface ExposureConfig { default?: "tool" | "catalog"; tools?: Selector; catalog?: Selector; pin?: string[] }
export type Placement = "tool" | "catalog";
export interface ResolvedExposure {
  placement: Map<string, Placement>;   // every operation id
  pinned: Set<string>;
  appOnly: Set<string>;                // catalog-placed operations with appCallable: listed with visibility ["app"]
  catalogIds(): string[];
}
export function resolveExposure(registry: Registry, exposure: ExposureConfig | undefined): ResolvedExposure; // throws on unknown ids
```

  `McpRoutesConfig.exposure?: ExposureConfig`.

- [ ] **Step 1: Write the failing tests** (`exposure.test.ts`):

```ts
test("no exposure: every operation is a tool", ...);
test("order: widget > pin > tools > catalog > default", () => {
  // ops: w (widget:"board", query), p (query), q (query), m (mutation, tags:["x"])
  const r = resolveExposure(reg, { default: "tool", catalog: { type: "query" }, tools: { tags: ["x"] }, pin: ["p"] });
  expect(r.placement.get("w")).toBe("tool");
  expect(r.placement.get("p")).toBe("tool");      // Review Focus 2: pin beats catalog selector
  expect(r.placement.get("q")).toBe("catalog");
  expect(r.placement.get("m")).toBe("tool");
});
test("selector fields AND together; tags match any", ...);
test("two mounts with different path and exposure serve one registry", ...); // spec Acceptance 9: /mcp lists q, /mcp/catalog lists find_operations instead
test("unknown ids in pin or selectors throw naming the id", () => {
  expect(() => resolveExposure(reg, { pin: ["nope"] })).toThrow(/nope/);
});
test("appCallable catalog operations are app-only", ...);
```

  `mcp.test.ts`:

```ts
test("hybrid: catalog queries leave tools/list; pins get alwaysLoad; app-only get visibility", async () => {
  const names = tools.map((t) => t.name);
  expect(names).not.toContain("q");
  expect(tools.find((t) => t.name === "p")._meta["anthropic/alwaysLoad"]).toBe(true);
  expect(tools.find((t) => t.name === "a")._meta.ui.visibility).toEqual(["app"]); // a: query, appCallable
});
test("a catalog query is callable by name", ...);              // tools/call { name: "q" } → structuredContent
test("an unlisted catalog mutation is refused by name with a pointer", async () => {
  const { result, error } = await rpc(app, "tools/call", { name: "m2", arguments: {} }); // m2: catalog mutation
  expect(error.code).toBe(-32601);
  expect(error.message).toMatch(/run_write/);
});
```

- [ ] **Step 2: Run** `bun test packages/hono` — Expected: FAIL.
- [ ] **Step 3: Implement** `resolveExposure` (pure) and wire it in `mcpRoutes` at construction (throws propagate at startup). In tools/list, skip catalog-placed ids except `appOnly` (listed with `_meta.ui.visibility: ["app"]`); add `anthropic/alwaysLoad: true` for `pinned`. In tools/call by name, refuse catalog mutations that aren't `appOnly`, naming `run_destructive` when `destructive` else `run_write`.
- [ ] **Step 4: Run** `bun test packages/hono && just lint` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(hono): per-endpoint exposure (tool/catalog/hybrid) with pins and app-only tools`

### Task 6: Catalog meta-tools

**Files:**
- Create: `packages/hono/src/catalog.ts`
- Modify: `packages/hono/src/mcp.ts` (list and dispatch meta-tools)
- Test: `packages/hono/src/catalog.test.ts` (through `mcpRoutes`)

**Interfaces:**
- Consumes: `ResolvedExposure` (Task 5), `ExecutorContext.intent` (Task 1)
- Produces:

```ts
export const META_TOOL_NAMES = ["find_operations", "get_operation", "run_read", "run_write", "run_destructive"] as const;
export function catalogTools(registry: Registry, exposure: ResolvedExposure, defaultScopes: string[]): McpTool[]; // only those that apply
export function isMetaTool(name: string): boolean;
```

  Dispatch lives in `mcp.ts` tools/call: a meta-tool name resolves the target operation, applies **its** auth exactly as a direct call (same `mcp/www_authenticate` challenge), and executes with `context.intent` set for writes.

- [ ] **Step 1: Write the failing tests**:

```ts
test("only applicable meta-tools are listed", ...);
  // catalog = queries only → find_operations, get_operation, run_read; no run_write/run_destructive
test("meta-tool hints", ...);
  // find/get/run_read readOnlyHint true; run_write destructiveHint false openWorldHint false; run_destructive destructiveHint true
test("securitySchemes is the union over the class's operations", ...);
  // catalog query with auth "none" + one "required" with scopes ["s"] → run_read schemes include noauth and oauth2 with "s"
test("find_operations hides required operations from anonymous callers", ...);
  // authenticate → { error } ; result lists only auth none/optional ops
test("find_operations matches id, title, description and tags case-insensitively", ...);
test("get_operation returns input, instruction, response and siblings", ...);
test("run_read runs a catalog query", ...);
test("run_* refuse the wrong class and name the right tool", ...);
  // run_read on a mutation → isError, text /run_write/; run_write on a destructive → /run_destructive/
test("run_write requires intent and passes it to the executor", ...);
  // missing intent → isError; with intent → executor received ctx.intent === "Keep it"
test("run_read with an unknown id points to find_operations", ...);      // Review Focus 3
test("an app operation named like a generated meta-tool throws at startup", ...); // Review Focus 1
test("run_* applies the target operation's auth challenge", ...);
```

- [ ] **Step 2: Run** `bun test packages/hono/src/catalog.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `catalog.ts` (listing, input schemas: `find_operations {query?: string, tags?: string[]}`, `get_operation {id}`, `run_read {id, variables}`, `run_write|run_destructive {id, variables, intent: string (minLength 1)}`) and the dispatch in `mcp.ts`. Reuse the detail shape `gptRoutes` returns for `get_operation` (detail plus `operations` siblings filtered to the catalog).
- [ ] **Step 4: Run** `bun test packages/hono && just lint` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(hono): catalog meta-tools find/get/run_read/run_write/run_destructive`

### Task 7: Skills helper

**Files:**
- Create: `packages/core/src/skills.ts`, `packages/core/src/skills.test.ts`
- Modify: `packages/core/package.json` (`exports["./skills"] = "./src/skills.ts"`)

**Interfaces:**
- Produces (exact types from spec §7, with `key` on providers and `writableBy` on summaries):

```ts
export interface SkillProvider { key: string; search(q, ctx); get(slug, ctx); create?; update?; delete? }
export function parseSkillMarkdown(md: string): { name: string; description: string; body: string };   // throws on missing frontmatter fields
export function staticSkills(key: string, files: Record<string, string>): SkillProvider;               // slug = frontmatter `name`, must match /^[a-z0-9]+(?:-[a-z0-9]+)*$/ (throws otherwise); id = slug
export function skillOperations(opts: { providers: SkillProvider[]; prefix?: string }): {
  operations: Record<string, OperationComponent>;   // search_skills, use_skill, [manage_skill, delete_skill]
  wrap(executor: Executor): Executor;
};
```

- [ ] **Step 1: Write the failing tests**:

```ts
test("read-only providers generate only search_skills and use_skill", ...);
test("a writable provider adds manage_skill (not destructive) and delete_skill (destructive)", ...);
test("search merges providers in order; first wins on slug; ids are key:id", ...);
test("search limit defaults to 5 and caps at 10", ...);
test("use_skill returns the markdown and its hash", ...);
test("create goes to target when given, else the first writable provider", ...);
test("update and delete route by id prefix; an unknown prefix is an error", ...);
test("a skill created mid-session is found by the next search", ...);
test("one provider throwing in search doesn't hide the others", ...);     // Review Focus 4: also console.error called without the query text
test("markdown over 65536 characters is rejected on create", ...);
test("wrap routes skill ids to providers and others to the app executor", ...);
test("prefix namespaces the generated operation ids", ...);                // prefix "idea_" → idea_search_skills
test("spreading skill operations over an app operation of the same id throws", ...); // Review Focus 1: App({ operations: { ...ops, ...skills.operations } }) where ops has search_skills → buildRegistry throws (Task 1)
test("parseSkillMarkdown requires name and description frontmatter", ...);
```

- [ ] **Step 2: Run** `bun test packages/core/src/skills.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**. Generated operations use `<Brief>` with one `<Message>` (the summary line or the Markdown) and `responseKey` `"skills"` / `"skill"`; instructions follow spec §7 (`use_skill`: "keep it in context and follow it as guidance while using the normal tools"; `manage_skill`: only on explicit request, exact id, never fall back to create, full SKILL.md, never delete duplicates). `hash` = SHA-256 hex (Web Crypto) of the Markdown, first 12 chars. Frontmatter parsing: a minimal `---` block with `key: value` lines; no YAML dependency.
- [ ] **Step 4: Run** `bun test packages/core && just lint` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): dynamic skills helper (providers, search/use/manage/delete operations, executor wrap)`

### Task 8: Instructions in `chatRoutes` and `gptRoutes`; deprecate `config.server`

**Files:**
- Modify: `packages/hono/src/chat.ts`, `packages/hono/src/gpt.ts`, `packages/config/src/index.ts`
- Test: `packages/hono/src/gpt.test.ts`, `packages/hono/src/chat.test.ts` (create)

**Interfaces:**
- Produces: `resolveSystemPrompt(config: { systemPrompt?: string }, registry: Registry): string` exported from `chat.ts` (explicit `systemPrompt` > `registry.instructions()` > today's default string)

- [ ] **Step 1: Write the failing tests**:

```ts
test("resolveSystemPrompt prefers explicit, then app instructions, then the default", ...);
test("GET /operations includes app instructions when present", async () => {
  expect(await (await app.request("/operations")).json()).toMatchObject({ instructions: "Play.", operations: expect.any(Array) });
});
```

- [ ] **Step 2–4:** run (FAIL), implement (chat uses `resolveSystemPrompt`; gpt adds `instructions` only when defined; `ServerConfig` gets a `/** @deprecated Pass these to mcpRoutes/chatRoutes; App({ instructions }) replaces systemPrompt. Removed in 0.5. */` JSDoc), run `bun test && just lint` (PASS).
- [ ] **Step 5: Commit** `feat(hono): app instructions in chatRoutes and gptRoutes; deprecate config.server`

### Task 9: Docs, templates, version bump

**Files:**
- Modify: `packages/core/package.json`, `packages/hono/package.json` (`0.4.0`, peer `^0.4.0`), `site/src/content/docs/reference/{core,hono,config}.md`, `site/src/content/docs/guides/` (create `many-operations.md`), `README.md` (adaptor table row notes), `create-donghanh/templates/*` (`App({ instructions })` example in kanban-gpt), `CLAUDE.md` (`0.2.0 now` → `0.4.0 now`)

- [ ] **Step 1:** Reference docs: `App.instructions` (writing rule: essentials in the first 512 characters, ≤ 4,096 total), new operation facts, `mcpRoutes` options (`path`, `metadata`, `instructionsSuffix`, `outputSchema`, `actionsInText`, `exposure`), the meta-tools table, `@donghanh/core/skills`.
- [ ] **Step 2:** Guide `many-operations.md`: when to use hybrid, the Leganox-style example `{ default: "tool", catalog: { type: "query" }, pin: ["start"] }`, why writes stay tools (per-tool approvals), `appCallable` for widget-called reads.
- [ ] **Step 3:** Bump versions; run `just test && just lint && just test-templates` — Expected: all PASS.
- [ ] **Step 4: Commit** `chore: 0.4.0 — docs, templates, version bump`

### Task 10: Verify against Leganox Idea (no commits there)

**Files:** none in this repo; a throwaway worktree of `/Users/cinoss/Code/leganox/leganox-idea`.

- [ ] **Step 1:** `git -C /Users/cinoss/Code/leganox/leganox-idea worktree add /tmp/leganox-verify main` (or the scratchpad), then in it point `@donghanh/core` and `@donghanh/hono` at the local packages (`pnpm add file:/Users/cinoss/Code/rezzahub/donghanh/packages/core file:…/packages/hono` or `pnpm link`).
- [ ] **Step 2:** Delete `worker/mcp/protocol.ts`, change `worker/index.ts` back to `getMcpApp(c.env).fetch(c.req.raw)`, remove the `serveMcp` import; keep Leganox's protocol tests.
- [ ] **Step 3:** Run `pnpm exec vitest run test/mcp` — Expected: all PASS (the protocol tests now pass against the library). Then the full suite.
- [ ] **Step 4:** Record the result in this plan's ledger; remove the worktree (`git worktree remove`). Do not commit or push in Leganox.
