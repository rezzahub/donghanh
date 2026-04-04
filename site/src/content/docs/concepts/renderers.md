---
title: Renderers
description: How the Brief is rendered per target.
---

The same `<Brief>` tree renders differently depending on the target. Each target has a renderer that walks the tree and produces output.

## ChatGPT Renderer

Used by `gptRoutes()` — produces JSON for the ChatGPT GPT Store.

| Primitive | Output |
|-----------|--------|
| `<Message>` | Concatenated into `nextSteps` string |
| `<Action>` | Entry in `suggestedActions[]` with encoded variables |
| `<Display>` | `display` field |
| `<Context>` | Included in response JSON |

```ts
import { renderForChatGpt } from "@donghanh/hono";

const result = renderForChatGpt(brief);
// { nextSteps: "...", suggestedActions: [...], display: "..." }
```

## LLM Renderer

Used by `chatRoutes()` — produces tool result text for OpenAI-compatible LLMs.

| Primitive | Output |
|-----------|--------|
| `<Message>` | Included in tool result text |
| `<Action>` | Serialized as "suggested actions" + sent as SSE metadata |
| `<Display>` | Formatted text in tool result |
| `<Context>` | Available to the LLM |

```ts
import { renderForLlm } from "@donghanh/hono";

const result = renderForLlm(brief);
// { text: "...", actions: [...], context: [...] }
```

## Custom Renderer

Implement the `Renderer<T>` interface to add new targets:

```ts
import type { Renderer } from "@donghanh/core";
import { renderNode } from "@donghanh/core";

const slackRenderer: Renderer<string> = {
  brief(node, children) { return children.join("\n"); },
  message(node) { return node.content; },
  action(node) { return `> ${node.label}`; },
  display(node) { return "```\n" + JSON.stringify(node.data, null, 2) + "\n```"; },
  context() { return ""; },
  form() { return ""; },
};

const slackMessage = renderNode(brief, slackRenderer);
```
