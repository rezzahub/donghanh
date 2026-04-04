# Minimal donghanh App

A hello-world [@donghanh](https://github.com/rezzahub/donghanh) app with 2 operations and D1 SQLite.

## Setup

```bash
bun install
bun run db:init
bun run dev
```

## Try it

```bash
curl localhost:8787/api/operations
curl localhost:8787/api/query/list-items
```

## Deploy

```bash
npx wrangler d1 create my-donghanh-app-db
# Copy the database_id into wrangler.toml
npx wrangler deploy
```
