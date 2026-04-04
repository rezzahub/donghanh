# Kanban GPT

A kanban board powered by [@donghanh](https://github.com/rezzahub/donghanh) with GPT Store integration.

## Setup

```bash
bun install
npx wrangler d1 create my-kanban-db
# Copy the database_id into wrangler.toml
npx drizzle-kit push
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

## GPT Store Setup

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

## Deploy

```bash
npx wrangler deploy
```
