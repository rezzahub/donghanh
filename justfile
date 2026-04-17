# @donghanh — Conversational UI Framework

default:
    @just --list

# Attach or create tmux session "splitbee"
tmux:
    tmux new-session -A -s splitbee

# ============ Development ============

# Run a script in a workspace package (e.g. `just core build`, `just hono test`)
core *args:
    cd packages/core && bun run {{args}}
hono *args:
    cd packages/hono && bun run {{args}}
react *args:
    cd packages/react && bun run {{args}}
widget *args:
    cd packages/widget && bun run {{args}}
widget-vite *args:
    cd packages/widget-vite && bun run {{args}}
create *args:
    cd create-donghanh && bun run {{args}}

lint:
    bun run lint

lint-fix:
    bun run lint:fix

test:
    bun test

# Test a template by scaffolding, installing, type-checking, and running tests
test-template template:
    #!/usr/bin/env bash
    set -euo pipefail
    dir=$(mktemp -d)
    echo "Scaffolding {{template}} → $dir"
    cp -r create-donghanh/templates/{{template}}/* "$dir/"
    cd "$dir"
    bun install
    echo "=== Type check ==="
    bunx tsc --noEmit
    echo "=== Tests ==="
    if find . -not -path '*/node_modules/*' -name '*.test.ts' | grep -q .; then
      bun test
    else
      echo "No test files, skipping"
    fi
    echo "✓ {{template}} passed"
    rm -rf "$dir"

# Test all templates
test-templates:
    just test-template minimal
    just test-template kanban-gpt

# View latest CI run
ci:
    gh run list --repo rezzahub/donghanh --workflow=ci.yml --limit=5

# Watch latest CI run
ci-watch:
    gh run watch $(gh run list --repo rezzahub/donghanh --workflow=ci.yml --limit=1 --json databaseId -q '.[0].databaseId') --repo rezzahub/donghanh --exit-status

# View failed CI logs
ci-logs:
    gh run view $(gh run list --repo rezzahub/donghanh --workflow=ci.yml --limit=1 --json databaseId -q '.[0].databaseId') --repo rezzahub/donghanh --log-failed

# ============ Publish ============

# ============ Site ============

# Start docs site dev server
site-dev:
    cd site && bun run dev

# Build docs site
site-build:
    cd site && bun run build

# Deploy docs site to Cloudflare
site-deploy:
    cd site && bun run deploy

# ============ Publish ============

# Publish packages to npm (usage: just publish all <otp> | just publish hono <otp>)
publish target otp:
    #!/usr/bin/env bash
    set -euo pipefail
    publish_pkg() {
      echo "Publishing $1..."
      cd "$1" && npm publish --access public --otp={{otp}} && cd - > /dev/null || true
    }
    if [ "{{target}}" = "all" ]; then
      publish_pkg packages/core
      publish_pkg packages/hono
      publish_pkg packages/react
      publish_pkg packages/widget
      publish_pkg packages/widget-vite
      cd create-donghanh && bun run build && cd ..
      publish_pkg create-donghanh
    else
      case "{{target}}" in
        core) publish_pkg packages/core ;;
        hono) publish_pkg packages/hono ;;
        react) publish_pkg packages/react ;;
        widget) publish_pkg packages/widget ;;
        widget-vite) publish_pkg packages/widget-vite ;;
        create) cd create-donghanh && bun run build && cd .. && publish_pkg create-donghanh ;;
        *) echo "Unknown target: {{target}}. Use: all, core, hono, react, widget, widget-vite, create" && exit 1 ;;
      esac
    fi
