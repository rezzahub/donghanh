# Claude Code guidance for this repo

## Workspace

Bun monorepo. Workspaces: `packages/*` + `create-donghanh`.

## Just commands

Use `just` for common ops. Run `just --list` for full set.

**Per-package scripts:**
```
just core <script>          # → cd packages/core && bun run <script>
just hono <script>
just react <script>
just widget <script>
just widget-vite <script>
just create <script>        # → cd create-donghanh && bun run <script>
```

**Root:**
```
just lint            # biome + tsc
just lint-fix        # auto-format
just test            # bun test
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

All `@donghanh/*` packages share a major/minor (0.2.0 now). Bump together for breaking changes. Update `peerDependencies["@donghanh/core"]` in hono/react/widget to match.

## Testing

- `bun test` runs all `*.test.ts` in packages + `create-donghanh/templates/*` (excluding node_modules).
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
