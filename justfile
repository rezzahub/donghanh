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

# Publish all packages to npm (usage: just publish 123456)
publish otp:
    cd packages/core && npm publish --access public --otp={{otp}}
    cd packages/hono && npm publish --access public --otp={{otp}}
    cd packages/react && npm publish --access public --otp={{otp}}
    cd create-donghanh && npm publish --access public --otp={{otp}}
