# Contributing to donghanh

Thanks for helping. donghanh is a small pnpm monorepo for building agent interfaces with JSX. This page covers how to get set up, what a good change looks like, and how releases work.

## Setup

Tool versions are pinned in `.tool-versions` (Node, pnpm and Bun); [mise](https://mise.jdx.dev) installs them for you. You also need [`just`](https://just.systems).

```bash
mise install
pnpm install
```

Everyday commands (run `just --list` for all of them):

```bash
just test        # vitest, all packages
just lint        # biome + tsc
just lint-fix    # auto-format, then tsc
```

To run one test file while you work: `pnpm exec vitest run packages/core/src/skills.test.ts`.

`just <package> <script>` runs a script from one package's `package.json` (`core`, `hono`, `react`, `widget`, `widget-vite`, `config`, `cli`; `just create` is `create-donghanh`).

## Layout

| Path | What lives there |
|---|---|
| `packages/core` | JSX runtime, operations, registry, executor, `@donghanh/core/files`, `@donghanh/core/skills` |
| `packages/hono` | Adapters: `mcpRoutes` (Apps SDK / MCP), `chatRoutes`, `gptRoutes` (deprecated) |
| `packages/react`, `packages/widget`, `packages/widget-vite` | Chat UI and widget tooling |
| `packages/config`, `packages/cli` | Shared config and the CLI |
| `create-donghanh` | The project scaffolder and its templates |
| `site` | The docs site (guides in `site/src/content/docs/guides`, reference in `.../reference`) |
| `docs/features` | Feature documents for implementers |
| `docs/superpowers` | Design specs and plans for larger changes |
| `SKILL.md`, `skills/` | Agent-facing skills that teach an agent to build with donghanh |

## Making a change

1. Branch from `main`.
2. Write the test first, watch it fail, then make it pass. Tests live next to the code as `*.test.ts(x)`.
3. Run `just lint` and `just test`. Biome errors must be fixed, never suppressed. Formatting is enforced in CI.
4. Update the docs that describe the behaviour you changed (see below).
5. Open a pull request against `main`.

CI runs `lint-test` and, per template, a scaffold, type-check and test of each `create-donghanh` template. The docs site is not linted or tested in CI.

### Commit messages

Short, imperative, sentence case, no prefix, for example `Add changelog and link it from the navbar`. Say what changed; put the why in the pull request.

### Pull requests

Say what the change is for and what a reviewer should look at first. Call out anything breaking, anything you could not verify locally, and anything that needs a release step afterwards.

## Documentation

Behaviour changes ship with docs in the same pull request:

- **`CHANGELOG.md`**: add to the next version's section (`## x.y.z (unreleased)`) under Added, Changed, Fixed, Removed or Deprecated. Mark breaking changes as breaking.
- **`site/src/content/docs/reference/`**: the API reference for the package you changed.
- **`site/src/content/docs/guides/`** and **`docs/features/`**: guides for authors and implementers.
- **`SKILL.md`, `skills/donghanh/SKILL.md`, `skills/donghanh-prompts/SKILL.md`**: update these when the way you build a donghanh app changes, since agents read them.

Check that every code sample compiles against the real API. The docs site needs a newer glibc than some machines have (the `workerd` dependency), so if `just site-build` fails locally, say so in the pull request instead of skipping it silently.

## Larger changes

For a new feature or anything breaking, open an issue first. Then write a short design in `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`: why it is needed, goals and non-goals, the approaches you considered and which one you chose. For multi-step work add a plan in `docs/superpowers/plans/`. The file-provider work (`docs/superpowers/specs/2026-11-17-file-provider-design.md`) is a worked example.

## Versioning

`@donghanh/core`, `hono`, `react` and `config` share a major and minor version; bump them together for breaking changes and keep the `peerDependencies["@donghanh/core"]` range in `hono` and `react` in step. A patch-level, additive change can release `core` alone. `widget`, `widget-vite` and `cli` version separately. While the major version is 0, a breaking change bumps the minor.

## Releasing (maintainers)

Publishing needs an npm account with two-factor authentication.

```bash
just publish <package> <otp>   # core, hono, react, widget, widget-vite, config, cli or create
just publish all <otp>         # everything, in dependency order
```

The recipe skips any version that is already published. Publish `core` before the packages that depend on it, and `create-donghanh` last. The registry can take several minutes to serve a new version everywhere: tarballs may return 404 for a while even though the publish succeeded, so check before re-running anything. Template dependency ranges move to the new version in a separate commit, once the packages it points at are live; `just test-templates` installs from npm and cannot pass before then.

## Reporting problems

Open an issue with what you expected, what happened, and the smallest example that shows it.

## License

donghanh is MIT licensed. By contributing you agree that your contribution is licensed the same way.
