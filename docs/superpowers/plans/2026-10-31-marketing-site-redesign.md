# Marketing Site Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the terminal-themed donghanh.dev with a modern homepage and matching docs, mark GPT Store deprecated, and move the `minimal` template to `mcpRoutes`.

**Architecture:** Shared design tokens live in one CSS file. Starlight keeps serving the docs, restyled through `customCss`, Expressive Code settings and three small component overrides. The homepage is a plain Astro page outside Starlight, replacing `index.mdx`.

**Tech Stack:** Astro 6, Starlight 0.38, Expressive Code (bundled with Starlight), Hono, Bun, Biome.

**Spec:** `docs/superpowers/specs/2026-10-31-marketing-site-redesign-design.md`. Mockups: `docs/superpowers/specs/2026-10-31-marketing-site-redesign-mockups/` (`hero-directions.html` option A, `docs-style.html`).

## Global Constraints

- Tokens: bg `#0e0f11`, fg `#f3f3f4`, muted `#8a8e96`, dim `#5d6168`, lines `#1f2125`, card `#131416`, raised `#1b1d21`, accent `#4fd1a0`, docs body `#c9ccd2`.
- Geist for text, JetBrains Mono for code only. Headings weight 560 with tight negative letter spacing. Corners 6 to 12px. No glow.
- `#e8b46a` is for code strings only.
- No neon green, ASCII art, or monospace body text. No herdr words, logo, mascot or reference.
- No forms on the homepage. Never say a Brief is shown directly to users on every channel.
- GPT Store is marked deprecated, not removed. `gptRoutes` behaviour does not change.
- Existing docs URLs and `/llms.txt` keep working.
- Dark only.
- If `bun` is missing, run `export PATH="$HOME/.bun/bin:$PATH"` first.
- `site/` is not a workspace: run `cd site && bun install` once. Do not commit an unrelated reformat of the root `bun.lock`.
- Do not bump versions or publish.

## Review Focus

1. A phone at 390px: no horizontal scrolling on the homepage or docs, including long code lines and the install box. Pinned in Task 4, Step 6 and Task 3, Step 7.
2. Copy button where the clipboard is unavailable: no thrown error, and the command stays selectable. Pinned in Task 4, Step 6.
3. Docs search, which only works in a production build: searching "Brief" returns results. Pinned in Task 3, Step 7.
4. Existing docs URLs and `/llms.txt` after `index.mdx` is removed. Pinned in Task 4, Step 7.
5. A new scaffold following Quick Start: the documented curl commands work against `minimal`. Pinned in Task 1, Step 5.

---

### Task 1: Switch `minimal` to `mcpRoutes`

**Files:**
- Create: `create-donghanh/templates/minimal/worker.test.ts`
- Modify: `create-donghanh/templates/minimal/worker.ts`
- Modify: `create-donghanh/templates/minimal/README.md`
- Modify: `site/src/content/docs/guides/quickstart.md:30-42`

**Interfaces:**
- Produces: a `minimal` app exposing `POST /mcp`. Nothing later depends on it.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import app from "./worker";

test("lists operations as MCP tools", async () => {
  const res = await app.request(
    "/mcp",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    },
    { DB: {} },
  );
  expect(res.status).toBe(200);
  const { result } = await res.json();
  const names = result.tools.map((t: { name: string }) => t.name);
  expect(names).toContain("list-items");
  expect(names).toContain("add-item");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test create-donghanh/templates/minimal/worker.test.ts`
Expected: FAIL, with `/mcp` returning 404.

- [ ] **Step 3: Replace the route in `worker.ts`**

Import `mcpRoutes` instead of `gptRoutes`. Replace the `/api` mount with `app.route("/", mcpRoutes({ registry, executor, authenticate, resource: "https://example.com", authorizationServers: [] }))`, keeping the current `executor` and `authenticate` values. Add a short comment that `resource` should become the deployed URL. Change the `/` text to `donghanh app running. MCP endpoint: POST /mcp`.

- [ ] **Step 4: Run the tests**

Run: `bun test create-donghanh/templates/minimal`
Expected: PASS.

- [ ] **Step 5: Update the README and Quick Start, then try the commands**

Replace the "Try it" curl lines in the README, and lines 30 to 42 of `quickstart.md`, with MCP calls, keeping the surrounding prose:

```bash
curl -X POST localhost:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
curl -X POST localhost:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list-items","arguments":{}}}'
```

Scaffold into a temp folder with `just test-template minimal`. Then run the app with `bun run db:init && bun run dev` and run both commands.
Expected: `tools/list` shows both operations. `tools/call` returns a result, not an error.

- [ ] **Step 6: Commit**

```bash
git add create-donghanh/templates/minimal site/src/content/docs/guides/quickstart.md
git commit -m "Switch minimal template to mcpRoutes"
```

### Task 2: Mark GPT Store deprecated

**Files:**
- Modify: `packages/hono/src/gpt.ts:45`, `packages/hono/src/openapi.ts`, `packages/hono/package.json:4`, `packages/config/src/index.ts:35`
- Modify: `README.md`, `SKILL.md:21`, `skills/donghanh/SKILL.md`, `skills/donghanh-prompts/SKILL.md`
- Modify: `site/public/llms.txt`, `site/src/content/docs/reference/hono.md`, `site/src/content/docs/guides/introduction.md:12`, `site/src/content/docs/concepts/renderers.md:10`, `docs/features/apps-sdk.md:11`
- Modify: `create-donghanh/src/index.ts:12`, `create-donghanh/templates/kanban-gpt/README.md:27`, `create-donghanh/templates/kanban-gpt/worker.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the sentence below, used everywhere.

- [ ] **Step 1: Add the JSDoc**

Above `gptRoutes` in `gpt.ts`: `/** @deprecated GPT Store support is deprecated. Use mcpRoutes (Apps SDK) for new projects. */`. Keep any existing doc text.

- [ ] **Step 2: Update each mention**

Standard sentence: **GPT Store support is deprecated. Use Apps SDK (`mcpRoutes`) for new projects. `gptRoutes` keeps working.**

- Prose sections and headings (`hono.md`, `skills/donghanh/SKILL.md:133`, `skills/donghanh-prompts/SKILL.md:127`, README "Auth tiers", kanban README "GPT Store setup"): put the sentence directly under the heading. In `hono.md` use a Starlight `:::caution` aside.
- Table rows and one-line lists (`README.md:48,57`, `skills/donghanh/SKILL.md:12`, `introduction.md:12`, `apps-sdk.md:11`, `llms.txt:25`, `renderers.md:10`): add `(deprecated)` after the GPT Store name.
- `SKILL.md:21`: change the step to mount `mcpRoutes()`.
- `package.json` description, `create-donghanh/src/index.ts:12`, `packages/config/src/index.ts:35`, the `kanban-gpt/worker.ts` comment, and the `generateOpenApi` doc comment in `openapi.ts`: add "(deprecated)" or the sentence, whichever fits.

- [ ] **Step 3: Check nothing was missed**

Run: `grep -rnIE "GPT Store|Custom GPT|gptRoutes" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.superpowers --exclude-dir=.wrangler --exclude-dir=superpowers --exclude=bun.lock --exclude='*.test.ts'`
Expected: every section or table that presents GPT Store as an option has a notice. A repeated mention inside an already-marked section needs none. `site/src/content/docs/index.mdx` is replaced in Task 4.

- [ ] **Step 4: Verify**

Run: `just lint && just test`
Expected: PASS, with `gpt.test.ts` unchanged.

- [ ] **Step 5: Commit**

```bash
git add -A -- packages create-donghanh skills site/public site/src/content docs/features README.md SKILL.md
git commit -m "Mark GPT Store as deprecated"
```

### Task 3: Restyle the docs

**Files:**
- Create: `site/src/styles/tokens.css`, `site/src/styles/docs.css`, `site/src/styles/code-theme.json`
- Create: `site/src/components/starlight/EmptyThemeSelect.astro`, `site/src/components/starlight/PageTitle.astro`, `site/src/components/starlight/SocialIcons.astro`
- Delete: `site/src/styles/terminal.css`
- Modify: `site/astro.config.mjs`

**Interfaces:**
- Produces: `tokens.css` with CSS variables `--bg --fg --mute --dim --line --card --raised --accent --text`, and both font imports. Produces `code-theme.json`, a VS Code format theme named `donghanh`. Task 4 uses both.

- [ ] **Step 1: Create `tokens.css` and `code-theme.json`**

Use the Global Constraints values. Load Geist (`wght@100..900`) and JetBrains Mono the way `terminal.css` loads fonts today. In the theme, JSX tags and component names use `#4fd1a0`, strings `#e8b46a`, everything else `#d6d8dd`.

- [ ] **Step 2: Create `docs.css`**

Import `tokens.css`. Map the `--sl-*` variables to the tokens for `:root` and `[data-theme="light"]`, including `--sl-font`, `--sl-font-system-mono` and `--sl-color-text: var(--text)`. Match `docs-style.html`: title 38px, h2 23px, h3 16px, body 15px, neutral links with an underline so they stay visible, neutral inline code on `--raised`, selected sidebar item `--raised` with `--fg` text. Rounded card asides. Do not carry over the `border-radius: 0 !important` rule.

- [ ] **Step 3: Add the overrides**

- `EmptyThemeSelect.astro`: renders nothing.
- `PageTitle.astro`: renders Starlight's default title, followed by `Astro.locals.starlightRoute.entry.data.description` as a lead line when it exists.
- `SocialIcons.astro`: renders Concepts (`/concepts/primitives/`), Reference (`/reference/core/`), GitHub, and a white "Get started" pill (`/guides/quickstart/`).

- [ ] **Step 4: Update `astro.config.mjs`, delete `terminal.css`**

Set `title: "donghanh"` and `customCss: ["./src/styles/docs.css"]`. Set `components` to `ThemeSelect`, `PageTitle` and `SocialIcons` overrides. Set `expressiveCode` to use `code-theme.json` through `ExpressiveCodeTheme`, with `styleOverrides` for card background, `--line` border and 10px radius.

- [ ] **Step 5: Build**

Run: `cd site && bun install && cd .. && just site-build`
Expected: succeeds. `site/src/content/docs/index.mdx` may look unstyled until Task 4.

- [ ] **Step 6: Scan for leftovers**

Run: `grep -rnE "00ff88|00cc6a|terminal\.css|Geist Mono" site/src site/astro.config.mjs`
Expected: matches only in `index.mdx`, which Task 4 deletes.

- [ ] **Step 7: Check in a browser**

Run `cd site && bun run preview`. Compare `/concepts/primitives/` with `docs-style.html` at 1440px.
Expected: it matches. At 390px there is no sideways page scroll and the mobile menu opens. Searching "Brief" returns results. No theme switch appears.

- [ ] **Step 8: Commit**

```bash
git add site
git commit -m "Restyle docs to match the new site design"
```

### Task 4: Build the homepage

**Files:**
- Create: `site/src/pages/index.astro`, `site/src/styles/home.css`
- Create: `site/src/components/home/CopyCommand.astro`, `site/src/components/home/Hero.astro`, `site/src/components/home/Channels.astro`, `site/src/components/home/Packages.astro`, `site/src/components/home/Skills.astro`, `site/src/components/home/ClosingCta.astro`
- Delete: `site/src/content/docs/index.mdx`

**Interfaces:**
- Consumes: `tokens.css` variables, `code-theme.json`.
- Produces: `<CopyCommand command={string} />`, used by Hero and ClosingCta.

- [ ] **Step 1: `CopyCommand.astro`**

Renders `$`, the command in a selectable element, and a Copy button in the card style. On click, try `navigator.clipboard.writeText`, show "Copied" for 2 seconds, and on failure leave the text unchanged without throwing. Multiple instances must work.

- [ ] **Step 2: `Hero.astro`**

Exact copy:
- Headline: `Write your agent UI in JSX.` then, in `--mute`, `Ship it to every chat.`
- Line: `Describe what your agent can say and do once.` then, in `--fg`, `Run it in ChatGPT or your own app.`
- "Read the docs" pill to `/guides/introduction/`, and `<CopyCommand command="bunx create-donghanh my-app" />`.

Left panel titled `list-items.tsx`, showing the `ListItems` function from the mockup through Astro's `Code` component with `code-theme.json`. Right panel titled `In ChatGPT, with an Apps SDK widget`, static: user message `What's on my list?`, agent reply `You have 3 items.`, list `Book flights`, `Renew passport`, `Pack bags`, and an `Add an item` button. Panels sit side by side from 900px and stack below that.

- [ ] **Step 3: The sections below the hero**

Numbered like herdr's sections, each with a benefit heading. Write the wording, using only facts from the old `index.mdx`, which you delete in Step 5.
- `Channels.astro`: Apps SDK (`mcpRoutes` + `@donghanh/widget`), self-hosted (`chatRoutes` + `@donghanh/react`), then GPT Store (`gptRoutes`) last with a visible `Deprecated` label.
- `Packages.astro`: the six packages as a card grid.
- `Skills.astro`: the `donghanh` and `donghanh-prompts` skills and both `npx degit` commands.
- `ClosingCta.astro`: repeats the headline and `<CopyCommand>`.

- [ ] **Step 4: `index.astro` and `home.css`**

Plain page, not Starlight, with its own head: title `donghanh`, description `Build conversational interfaces with JSX.`, favicon `/favicon.svg`. Import `tokens.css`, then `home.css`. Top bar per the mockup: wordmark, Docs (`/guides/introduction/`), Concepts, Reference, GitHub, and the "Get started" pill to `/guides/quickstart/`. Footer with GitHub and docs links. h1 about 84px on desktop, scaling down to fit phones.

- [ ] **Step 5: Delete `index.mdx` and build**

Run: `just site-build`
Expected: succeeds with no duplicate route warning for `/`.

- [ ] **Step 6: Check in a browser**

Run `cd site && bun run preview`, then compare `/` with option A.
Expected: it matches at 1440px. At 390px, `document.documentElement.scrollWidth` equals the window width and the panels stack. Copy works. With `navigator.clipboard` set to `undefined`, clicking Copy logs no error.

- [ ] **Step 7: Check the links**

Fetch `/llms.txt`, `/guides/introduction/`, `/guides/quickstart/`, `/concepts/primitives/`, `/reference/core/` and `/reference/hono/`, plus every link on the homepage.
Expected: all return 200.

- [ ] **Step 8: Commit**

```bash
git add site
git commit -m "Add new homepage"
```

### Task 5: Final verification

**Files:** none expected.

- [ ] **Step 1: Run everything**

Run: `just lint && just test && just test-templates && just site-build`
Expected: all pass. Report any failure rather than suppressing it.

- [ ] **Step 2: Scan the built site**

Run: `grep -rlE "00ff88|herdr|█" site/dist`
Expected: no matches. Also confirm the homepage output contains `Deprecated`.

- [ ] **Step 3: Review the branch against the spec**

Check each spec section against `git diff main...HEAD`, then confirm `git status --short` shows no stray files, such as `.playwright-mcp/` or a reformatted root `bun.lock`.
