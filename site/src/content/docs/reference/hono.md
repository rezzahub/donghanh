---
title: "@donghanh/hono"
description: Hono routes for GPT Store and LLM chat.
---

## GPT Store Routes

```ts
import { gptRoutes } from "@donghanh/hono";
```

### `gptRoutes(config)`

Returns a Hono app with routes:

| Route | Method | Description |
|-------|--------|-------------|
| `/operations` | GET | List all operations |
| `/operations/:name` | GET | Operation detail (instruction, input schema) |
| `/query/:operation` | GET | Execute a query operation |
| `/mutate/:operation` | POST | Execute a mutation operation |

**Config:**
- `registry: Registry` — from `buildRegistry()`
- `executor: Executor` — data fetching function
- `authenticate: Authenticate` — returns `{ userId }` or error

## Chat Routes

```ts
import { chatRoutes } from "@donghanh/hono";
```

### `chatRoutes(config)`

Returns a Hono app with SSE streaming chat endpoint.

| Route | Method | Description |
|-------|--------|-------------|
| `/` | POST | LLM chat with tool use loop |

**Config:**
- `registry: Registry`
- `executor: Executor`
- `authenticate: Authenticate`
- `apiKey?: string` — LLM API key (e.g. OpenRouter)
- `model?: string` — LLM model (default: `google/gemini-2.5-flash`)
- `baseUrl?: string` — LLM API base URL (default: OpenRouter)
- `systemPrompt?: string` — system prompt for the LLM
- `enrichData?: (data, context) => Promise<void>` — mutate data before rendering

**SSE Events:**
- `text` — streamed content chunks
- `actions` — JSON array of suggested actions
- `done` — signal completion

## Renderers

```ts
import { renderForChatGpt, renderForLlm } from "@donghanh/hono";
```

### `renderForChatGpt(brief, opts?)`
Returns `ChatGptResult`: `{ nextSteps?, suggestedActions, display?, context? }`

### `renderForLlm(brief)`
Returns `LlmResult`: `{ text, actions, context? }`

## Middleware

```ts
import type { Authenticate } from "@donghanh/hono";
```

### `Authenticate`
```ts
type Authenticate = (request: Request) => Promise<{ userId: string } | { error: Response }>;
```
