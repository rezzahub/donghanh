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

# Publish all packages to npm (usage: just publish 123456)
publish otp:
    cd packages/core && npm publish --access public --otp={{otp}}
    cd packages/hono && npm publish --access public --otp={{otp}}
    cd packages/react && npm publish --access public --otp={{otp}}
    cd create-donghanh && npm publish --access public --otp={{otp}}
