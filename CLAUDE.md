# Claude Code guidance for this repo

## Workspace

pnpm monorepo. Workspaces: `packages/*`, `create-donghanh`, `site`.

## Just commands

Use `just` for common ops. Run `just --list` for full set.

**Per-package scripts:**
```
just core <script>          # → cd packages/core && pnpm run <script>
just hono <script>
just react <script>
just widget <script>
just widget-vite <script>
just create <script>        # → cd create-donghanh && pnpm run <script>
```

**Root:**
```
just lint            # biome + tsc
just lint-fix        # auto-format
just test            # vitest run
just test-templates  # scaffold + typecheck + test each template
```

**Site:**
```
just site-dev        # docs dev server
just site-build
just site-deploy
```

**CI:**
```
just ci              # list last 5 runs
just ci-watch        # watch latest
just ci-logs         # show failed
```

**Publish (requires npm 2FA OTP):**
```
just publish all <otp>                 # core, hono, react, widget, widget-vite, create-donghanh
just publish <core|hono|react|widget|widget-vite|create> <otp>
```

## Version bumping

`@donghanh/core`, `hono`, `react` and `config` share a major/minor (0.4.0 now); `widget`, `widget-vite` and `cli` version separately. Bump the shared ones together for breaking changes. Update `peerDependencies["@donghanh/core"]` in hono/react/widget to match.

## Testing

- `vitest run` runs all `*.test.ts(x)` in packages (`vitest.config.ts`; widget tests use happy-dom). Scaffolded templates still use Bun; `just test-template` runs them in a temp dir.
- Template integration tests: `just test-template kanban-gpt` or `just test-templates`.

## Lint / format

Biome. Auto-fix via `just lint-fix`. Do NOT suppress errors; fix them. Format is enforced by CI.

## Commit style

Conventional sentence commits. Example from history:
```
Fix kanban-gpt: Better Auth with D1/Drizzle working end-to-end
Bump create-donghanh to 0.3.1
```

## Feature plans

Multi-phase features tracked in `docs/features/*.md` with phase checklists. Current: `docs/features/apps-sdk.md`.

## Skill

Agent-facing documentation in `skills/donghanh/SKILL.md`. Publish via `npx skills add <owner>/<repo>`.
