# Marketing site redesign

Date: 2026-10-31
Status: awaiting approval

## Intent

The current site at donghanh.dev reads as a terminal theme: ASCII logo, monospace everywhere, neon green, square corners. The owner wants a modern dev tool site, with herdr.dev as the reference. What makes herdr feel modern is restraint and a clear story, so that is what we are borrowing, not its content or branding.

## Goals

- A new custom homepage that shows what donghanh does in one look.
- Docs restyled to match, so the homepage and docs feel like one site.
- All new homepage copy describes features that work today. Existing docs that overstate `<Form>` (`concepts/primitives.md`, `reference/widget.md`, `llms.txt`) are not corrected here; that belongs with the parked inline actions work.

## Non-goals

- Changing `packages/*` or `create-donghanh` behaviour. The only code changes are the deprecation notices and the `minimal` template switch described below.
- Editing the text of docs pages, other than the GPT Store deprecation notices.
- Removing GPT Store support. It is marked deprecated, and `gptRoutes` keeps working.
- A light theme. The site stays dark only, as it is today.
- Replacing Starlight.

## Anti-goals

- Copying herdr's words, logo, ram mascot or amber accent. Layout and feel only.
- Showing forms or inline inputs on the site. See "Parked" below.
- Claiming that a Brief is shown directly to users on every channel. A Brief is written for the agent. Only an Apps SDK widget draws it directly; on GPT Store and self-hosted chat the agent replies in its own words.
- Neon green, ASCII art or monospace body text surviving anywhere.

## Constraints

- Astro 6 + Starlight 0.38 in `site/`, static output, deployed to Cloudflare via `just site-deploy`.
- Run through `just`. `just lint` and `just test` must stay green.
- `site/public/llms.txt` and existing docs URLs must keep working.

## Visual system (decided)

Shared by homepage and docs, taken from the approved mockups:

| Token | Value |
|---|---|
| Background | `#0e0f11` |
| Foreground | `#f3f3f4` |
| Muted text | `#8a8e96` |
| Dim text | `#5d6168` |
| Lines | `#1f2125` |
| Card | `#131416` |
| Raised | `#1b1d21` |
| Accent | `#4fd1a0` (soft green) |
| Docs body text | `#c9ccd2` |

- Geist for all text, JetBrains Mono for code only.
- Headings are weight 560 with tight negative letter spacing.
- Small rounded corners (6 to 12px). The primary button is a white pill.
- Thin 1px lines instead of heavy borders. No glow effects.

## Homepage (decided: direction A, "Code becomes conversation")

Custom Astro page replacing `site/src/content/docs/index.mdx`.

Reference mockups: `2026-10-31-marketing-site-redesign-mockups/hero-directions.html` (option A) and `docs-style.html`. Where the two disagree with this document, this document wins.

**Top bar:** as in the mockup: donghanh wordmark, Docs, Concepts, Reference, GitHub, and a white "Get started" pill linking to Quick Start. "Read the docs" links to Introduction.

**Hero:**
- Two-tone headline: "Write your agent UI in JSX." in white, "Ship it to every chat." in grey.
- Supporting line: "Describe what your agent can say and do once. Run it in ChatGPT or your own app."
- "Read the docs" pill and a `bunx create-donghanh my-app` box with a working Copy button.
- Below that, two panels side by side: the `ListItems` JSX example on the left, and the result on the right. The right panel is static HTML, not a live demo, and is labelled "In ChatGPT, with an Apps SDK widget". It depicts that real channel: the user's message, the agent's reply in its own words, then the widget's list and button. The example's `data.items` are plain strings, so the widget would really draw them as a list.

**Sections below the hero**, in herdr's numbered story style with a benefit in each heading. Content comes from the current homepage and docs:
1. Same operations, every channel: Apps SDK and self-hosted lead. GPT Store appears last, visibly labelled deprecated.
2. The packages (replaces the current table with something more visual).
3. AI coding skills, including the install commands from the current homepage.
4. Closing call to action repeating the headline and install box.

**Footer:** GitHub and docs links.

The site is unaffiliated with herdr and carries no reference to it.

## Docs (decided)

- Keep Starlight. Replace `site/src/styles/terminal.css` with a new stylesheet using the tokens above. Search, sidebar and "On this page" keep working.
- Same top bar feel as the homepage.
- Calmer than the homepage: page title 38px, body text `#c9ccd2`.
- Green only for code highlights and small accents. Links, inline code and the selected sidebar item use neutral colours.
- Remove the light/dark switch, since dark is forced anyway.
- Code blocks and callouts follow the approved mockup: rounded card, thin line, small title bar. Syntax colours: green `#4fd1a0` for tags and `#e8b46a` for strings, which is a code colour only, not an accent.
- Each page shows its `description` as a lead line under the title, as in the mockup. The breadcrumb in the mockup is dropped, so only the title needs a Starlight override.

## GPT Store deprecation (decided)

The owner asked to mark GPT Store as deprecated everywhere. This means marking, not removing.

- **Code:** add `@deprecated` JSDoc to `gptRoutes` in `packages/hono/src/gpt.ts`, pointing to `mcpRoutes`. No runtime warnings. Mentions in `packages/hono/src/openapi.ts`, `packages/hono/package.json` and `packages/config/src/index.ts` get the same note where they describe GPT Store to a reader.
- **Docs and agent-facing text:** add a deprecation notice wherever GPT Store is presented as an option: `README.md`, `SKILL.md`, `skills/donghanh/SKILL.md`, `skills/donghanh-prompts/SKILL.md`, `site/public/llms.txt`, `site/src/content/docs/reference/hono.md`, `guides/introduction.md`, `concepts/renderers.md`, `docs/features/apps-sdk.md`.
- **Scaffolding:** note it in `create-donghanh/src/index.ts` and `templates/kanban-gpt/README.md`.
- **`minimal` template (owner decision):** switch `create-donghanh/templates/minimal/worker.ts` from `gptRoutes` to `mcpRoutes`, so `bunx create-donghanh my-app` never starts anyone on a deprecated API. Update anything else in that template that depends on the old routes. `just test-template minimal` must pass.
- **Tests:** `packages/hono/src/gpt.test.ts` stays as is, since the feature still works.

Uncommitted edits on `main` touch `README.md`, `skills/donghanh/SKILL.md`, `guides/apps-sdk.md`, `guides/introduction.md` and `reference/hono.md`. Commit those before this branch merges, and expect small conflicts in the files that overlap.

## Left to the builder

- Exact section layouts and wording below the hero, within the rules above.
- Which Starlight component overrides to use.
- How fonts are loaded.
- Mobile layout. It must work well on phones; the side-by-side panels stack.
- Whether to delete leftover starter files such as `site/src/assets/houston.webp` and the starter `site/README.md`.

## Calls made without the owner (check these)

- The headline and supporting line are my draft, carried over from the mockups.
- The soft green `#4fd1a0` replaces the neon. It keeps donghanh's green identity rather than adopting herdr's amber.
- The right hero panel is labelled "In ChatGPT, with an Apps SDK widget".
- Existing docs that overstate `<Form>` stay uncorrected for now.
- The docs breadcrumb is dropped; the lead line stays.
- The owner never named a single main action for visitors. The design assumes it is getting started: read the docs or run the install command.

## Parked: inline actions

Not part of this project. Worth its own design later.

`<Form>` does not reach the screen today: both `@donghanh/hono` renderers discard it, and `structuredContent.form` is never filled in. The idea discussed is that a form is an inline `<Action>`. `variables` holds what is known, the operation's `input` schema defines what is missing, and each channel collects the gap its own way: inline inputs in a widget, a question from the agent elsewhere. Open points are live dropdown options, when to show inputs inline, and removing the exported `<Form>`. Once shipped, it would make a strong homepage demo.
