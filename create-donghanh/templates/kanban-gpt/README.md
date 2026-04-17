# Kanban GPT

A kanban board powered by [@donghanh](https://github.com/rezzahub/donghanh). Ships with three adapters sharing the same operations: GPT Store (GPT Actions), ChatGPT Apps SDK (MCP), and self-hosted chat.

## Setup

```bash
bun install
npx wrangler d1 create my-kanban-db
# Copy the database_id into wrangler.toml
bun run db:init
npx wrangler secret put BETTER_AUTH_SECRET
bun run dev
```

## Operations

| Operation | Type | Description |
|-----------|------|-------------|
| `list-boards` | query | List all boards |
| `board-detail` | query | Board with columns, cards, members |
| `create-board` | mutation | Create board with default columns |
| `add-card` | mutation | Add card to a column |
| `move-card` | mutation | Move card between columns |
| `add-member` | mutation | Add member to board |

## GPT Store setup

1. Create a GPT Action in the [ChatGPT GPT Store editor](https://chatgpt.com/gpts/editor)
2. Set the API server URL to your deployed worker URL
3. Configure OAuth:
   - Authorization URL: `https://your-worker.dev/oauth/authorize`
   - Token URL: `https://your-worker.dev/oauth/token`
   - Set client_id and client_secret
4. Add secrets to your worker:
   ```bash
   npx wrangler secret put GPT_OAUTH_CLIENT_ID
   npx wrangler secret put GPT_OAUTH_CLIENT_SECRET
   ```

## ChatGPT Apps SDK (MCP) setup

The worker exposes an MCP server at `/mcp` for use as a ChatGPT connector.

1. Update `donghanh.config.ts` with your deployed HTTPS URL and Better Auth issuer.
2. Build widgets:
   ```bash
   bun run widgets
   ```
   This regenerates `manifest/manifest.js` — the worker imports it at build time. A placeholder ships so the worker compiles before the first build.
3. Deploy:
   ```bash
   npx wrangler deploy
   ```
4. In ChatGPT: **Settings → Apps & Connectors → Advanced settings** → enable **Developer Mode**.
5. **Settings → Connectors → Create** → paste `https://your-worker.dev/mcp`.
6. Open a chat, click **+** → **More** → select the connector.

The `widgets/task-card.tsx` entry renders the default `DongHanhWidget` — customize it by editing that file and re-running `bun run widgets`.

## Deploy

```bash
bun run widgets     # build widget manifest first
npx wrangler deploy
```
