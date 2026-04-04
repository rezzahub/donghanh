---
title: "@donghanh/react"
description: Headless React hooks for chat UI.
---

## Provider

```tsx
import { DongHanhProvider } from "@donghanh/react";
```

### `DongHanhProvider`

Wraps your app with chat state management.

```tsx
<DongHanhProvider config={{
  endpoint: "/api/chat",
  getAuthToken: () => session.token,
}}>
  {children}
</DongHanhProvider>
```

**Config:**
- `endpoint: string` — chat API URL
- `getAuthToken?: () => string` — returns auth token for requests

## Hooks

```tsx
import { useChat, useChatContext, useInitOperation, useDongHanhConfig } from "@donghanh/react";
```

### `useChat()`

Returns chat state from context.

```tsx
const { messages, isLoading, sendMessage, stop } = useChat();
```

### `useChatContext()`

Full context access:

```tsx
const {
  messages,        // ChatMessageItem[]
  isLoading,       // boolean
  initOperation,   // InitOperation | null
  sendMessage,     // (content: string, action?: ChatAction) => Promise<void>
  setInitOperation,// (op: InitOperation | null) => void
  stop,            // () => void
} = useChatContext();
```

### `useInitOperation(id, variables?)`

Sets the initial operation for the current route. Runs on mount, cleans up on unmount.

```tsx
// Dashboard: load user's groups on mount
useInitOperation("start");

// Group page: load balances for specific group
useInitOperation("group-balances", { groupId });
```

### `useDongHanhConfig()`

Access the provider config.

## Types

```tsx
import type { ChatAction, ChatMessageItem, InitOperation } from "@donghanh/react";
```

### `ChatAction`
- `operation: string`
- `label: string`
- `variables?: Record<string, unknown>`

### `ChatMessageItem`
- `id: string`
- `role: "user" | "assistant"`
- `content: string`
- `actions?: ChatAction[]`

### `InitOperation`
- `id: string`
- `variables?: Record<string, unknown>`
