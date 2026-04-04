# @donghanh — Conversational UI Framework

default:
    @just --list

# ============ Development ============

lint:
    bun run lint

lint-fix:
    bun run lint:fix

test:
    bun test

# ============ Publish ============

# Publish all packages to npm
publish:
    cd packages/core && npm publish --access public
    cd packages/hono && npm publish --access public
    cd packages/react && npm publish --access public
    cd create-donghanh && npm publish --access public
