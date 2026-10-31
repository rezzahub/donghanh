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
curl -X POST localhost:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
curl -X POST localhost:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list-items","arguments":{}}}'
```

## Deploy

```bash
npx wrangler d1 create my-donghanh-app-db
# Copy the database_id into wrangler.toml
npx wrangler deploy
```

Then set `resource` in `worker.ts` to your deployed URL and deploy again. MCP clients check it against the URL they connect to.
