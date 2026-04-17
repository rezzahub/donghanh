---
name: donghanh-prompts
description: Write system prompts, operation descriptions, and tool metadata that drive good model behavior in donghanh apps. Use when authoring OperationConfig.description/instruction, chatRoutes.systemPrompt, or Apps SDK widget descriptions.
---

# donghanh-prompts

Guide for crafting the text that steers the model in a donghanh app.

## Core principle

**Keep the static system prompt minimal.** Push steering into three dynamic surfaces:

1. **Operation `instruction`** — per-op guidance, read when the model considers calling.
2. **Response `Brief`** (especially `Message` + `Action` nodes) — next-turn steering sent with each tool result.
3. **`start`/init operation** — a dynamic extension of the system prompt injected at session init.

The static `systemPrompt` sets identity and a couple of non-negotiable rules. Everything else lives where it's *re-read every turn* — operation metadata and response text. This keeps behavior accurate as the app evolves without system-prompt churn.

## When to use

- Writing `OperationConfig.description` or `instruction`
- Writing `chatRoutes({ systemPrompt })`
- Writing `_meta["openai/widgetDescription"]` for Apps SDK widgets
- Tuning metadata after low tool-selection accuracy in ChatGPT

## The six text surfaces in donghanh

```ts
registerOperation(Component, {
  description: "...",    // 1 — tool selection trigger (model sees in tools/list)
  instruction: "...",    // 2 — call-time guidance (do most per-op work here)
});

chatRoutes({
  systemPrompt: "..."    // 3a — self-hosted chat: ONE sentence
});

// 3b — GPT Store Custom GPT Instructions (pasted into ChatGPT GPT config)
//   Stored as public/gpt-prompt.md; teaches REST API usage.

// 4 — start/init operation: dynamic system prompt extension
<DongHanhProvider /> with useInitOperation("start")
// chatRoutes runs start on first turn, appends its data + Brief text to the
// system message: `${systemPrompt}\n\nUser context:\n${data}\n\n${brief.text}`

// 5 — Response Brief (Message + Action nodes), shipped with every tool result
<Brief>
  Next, pick a board to view.      {/* Message → nextSteps steers next turn */}
  <Action operation="..." />       {/* Action → suggestedActions + UI buttons */}
</Brief>

// 6 — openai/widgetDescription (Apps SDK widget resource)
```

Each has a different reader and a different purpose.

## 1. `description` — tool selection trigger

Read by: the model deciding which tool to call.

**Rules:**
- Start with a **verb** describing the action: "List all boards", "Create a new task", not "Boards" or "A board creator".
- Name the domain object clearly: "Move a card between columns on a Kanban board", not "Move it".
- Keep to one line. The model scans dozens of tools; verbosity hurts.
- Avoid implementation details ("queries the DB via Drizzle"). Describe user intent.

**Good:**
```ts
description: "List all boards the user has access to"
description: "Move a card from one column to another on a board"
description: "Create a new board with an optional description"
```

**Bad:**
```ts
description: "boards"                          // no verb
description: "This endpoint returns all..."   // endpoint-speak
description: "Gets stuff from the database"   // implementation leak
```

## 2. `instruction` — call-time guidance

Read by: the model after it picked the tool but before calling. In MCP, appended to `description` in the tool descriptor.

**Rules:**
- Disambiguate from similar ops: `"Use for settling debts AND for 1-on-1 debts. For shared expenses with splits, use add-expense instead."`
- Spell out *data* prerequisites: `"Pass the returned version to mutations for optimistic locking."`
- State required side tasks: `"Always include tags. Confirm before calling."`
- Describe what the response gives you back: `"Response includes updated balances."`
- Error recovery: `"On error, data may not be up to date — re-query balances and retry."`
- Keep to 1-3 sentences. Detailed schema lives in `input`.

**Real examples:**
```ts
// start op
instruction:
  "Always call this first. Returns profile, groups with balances/debts/spending, suggestedActions, and nextSteps guidance."

// simple query
instruction: "Pass the returned version to mutations for optimistic locking."

// ambiguous mutation — heavy on disambiguation + behavior
instruction:
  "Use for settling debts (e.g. 'pay Dũng 200k') AND for recording 1-on-1 debts/loans (e.g. 'I owe X 200k'). For shared expenses with splits, use add-expense instead. Always include tags. Confirm before calling. Response includes updated balances. On error, data may not be up to date — re-query balances and retry."
```

## 3a. `chatRoutes.systemPrompt` — one sentence

Read by: your own LLM as the system message in `chatRoutes` (self-hosted chat).

Because your server controls the loop, the system prompt does almost no work. One sentence:

```ts
systemPrompt:
  "You are <Name>, a <role>. <One-line purpose>. Use tools when needed. Be concise."
```

Role identity + purpose + use-tools rule + tone. Every other concern goes elsewhere:

- Per-op guidance → `instruction`
- Dynamic context (user name, workspace, role, locale) → `start`
- Per-turn behavior rules → response Brief `Message` text

**If this prompt grows beyond three sentences, you're overusing it.**

## 3b. GPT Store Custom GPT instructions — longer, protocol-level

Read by: a ChatGPT Custom GPT configured in the GPT Store UI.

Different audience than 3a. The Custom GPT runs inside ChatGPT and has no native knowledge of your REST API. You paste instructions into the "Instructions" field of the GPT builder. Convention: keep this as `public/gpt-prompt.md` in your repo and paste it in.

This prompt teaches the GPT *how to use* `gptRoutes`:

- Call `start` first (or whichever init op).
- Read `nextSteps` and `suggestedActions` from every response.
- Call `getOperationDetail` before using an operation it hasn't seen.
- On error, read `operationDetail.input` + `instruction` and retry.
- How to encode variables (e.g. TOON format, if you use one).
- Which operations are queries (GET) vs mutations (POST).

```
You are <Name>, a <role>. <Purpose>.

## How to use the API
1. Call GET /api/gpt/query/start first.
2. Read nextSteps — tells you what to do next.
3. Use suggestedActions — they have pre-filled variables ready.
4. Before calling an operation you haven't used, call getOperationDetail.
5. If an error includes operationDetail, fix and retry.

## Queries vs Mutations
- Queries: GET /api/gpt/query/{op}
- Mutations: POST /api/gpt/mutate/{op}
```

**Do not list specific operation names or examples.** The operations list endpoint + per-op `description` + `getOperationDetail` already teach ChatGPT what's available and how to call each op. Hard-coding "call `check-offer` with url=..." here means every operation rename or new op becomes a prompt edit. Let the protocol carry it.

This surface doesn't exist for Apps SDK (MCP) — ChatGPT's MCP client handles protocol natively, and metadata on tools drives everything.

## 4. `start` — dynamic system prompt extension

Client calls `useInitOperation("start")`. `chatRoutes` runs `start` on the first turn, takes its returned `data` + rendered `Brief` text, and appends them to the system message:

```
${systemPrompt}

User context:
${JSON.stringify(data)}

${renderedBrief}
```

**This is where most of your steering lives.** Because `start` re-runs every session:
- You can update behavior without touching `systemPrompt`.
- Dynamic values (user locale, intent, timezone, role) flow in.
- Your rule list is versioned with the operation component, not pasted into a prompt field.

Design `start` as a **status briefing + rule list**:

- **Conditional dynamic guidance** — respond in user's locale; act on user intent immediately.
- **Global behavior rules** — confirmation-before-mutation, ID conventions, formatting, what to hide from users, "never fabricate data".
- **Pre-rendered content hints** — if you enrich responses with a `display` field, tell the model how to use it ("use as suggested wording, adapt tone but keep amounts/names accurate").
- **Entry-point `Action`s** — concrete first things the user might do.

**Example (real pattern):**
```tsx
function Start({ data }: OperationProps<StartData>) {
  const { user } = data;
  const lines: string[] = [];

  if (user.locale && user.locale !== "en") {
    lines.push(`Respond in ${user.locale} language.`);
  }
  if (user.intent) {
    lines.push(`User intent: "${user.intent}" — act on this immediately, skip the greeting.`);
  }
  lines.push(
    "Before any mutation, show a confirmation summary and wait for approval.",
    "Display amounts in human-readable format (e.g. 150,000 VND).",
    `Use the user's timezone (${user.tz}) when displaying dates.`,
    "Use memberId (not userId) to identify participants in all operations.",
    "version is internal — never mention it to users, just pass it to mutations.",
    "Never fabricate data — always call the API.",
    "display contains pre-rendered text in user's language. Use as suggested wording — adapt tone, but keep amounts/names/who-owes-whom accurate.",
  );

  return (
    <Brief>
      {lines.join(" ")}
      {/* Then: dynamic Display + Action nodes based on data */}
    </Brief>
  );
}
```

Note: rules live as plain sentences concatenated with spaces. The model reads them as guidance in the system message.

## 5. Response Brief — per-turn steering

Every tool result includes a rendered `Brief`. Its `Message` text is literal instruction the model reads after each call. Its `Action` labels surface both in UI buttons and as model-visible option text.

**Typical Message content (real patterns):**
- Pass-through values the model must reuse: `` `Use version=${data.version} for the next mutation on this group.` ``
- Conditional behavior: `"If debts exist, ask if user wants to settle."`
- How to narrate server-enriched fields: `"display contains pre-rendered text — use as suggested wording, adapt tone, keep amounts/names accurate."`
- Mode disambiguation: `"Debts are in simplified mode — to see exact pairwise debts, the owner can switch to standard mode via update-group."`
- Error recovery hints: `"On error, data may not be up to date — re-query balances and retry."`

**Action patterns:**
- Pre-fill all variables the next call will need (including the latest `version` for optimistic locking).
- Label in imperative, user-first phrasing with data interpolation: `` `Pay ${debt.toName} ${debt.amount} ${currency}` ``.
- Filter dynamically — only show actions that make sense for *this* user and *this* state.

Because this text ships with every tool response, you can evolve behavior by shipping new operation components — no prompt edits, no deploys beyond your normal release.

## 6. Widget description (Apps SDK)

Read by: ChatGPT when narrating widget output, to avoid redundant text.

Set `_meta["openai/widgetDescription"]` on the widget resource:

```ts
"openai/widgetDescription": "Interactive Kanban board with draggable cards."
```

**Rules:**
- Describe what the **widget visually shows**, not what the tool does.
- One sentence. The model uses it to avoid repeating "Here is your Kanban board" when the widget already shows one.

## Apps SDK specifics

Since ChatGPT discovers tools by metadata similarity to user prompts:

- Include **verbs and nouns the user would actually say**: "tasks" not "items", "Jira" not "issue tracker" (if that's the product).
- Test with your [golden prompts](https://developers.openai.com/apps-sdk/plan/use-case): at least 5 direct ("show my boards"), 5 indirect ("what am I working on?"), and 5 negative prompts that should NOT trigger your app.
- If discovery is noisy, tighten `description` to exclude ambiguous cases.

## Iteration loop

1. Ship with best-guess text.
2. Watch tool-call accuracy (did the model pick your op at the right time?).
3. For misses: check if `description` matches user phrasing. Rewrite.
4. For false positives: narrow `description` with domain qualifier.
5. For wrong-argument calls: beef up `instruction` with input constraints.
6. For stale behavior ("it keeps suggesting deleted stuff"): update `start`'s Brief, not the system prompt.
7. For per-turn nudges: add/refine `Message` text in the response Brief.

**If you find yourself editing `systemPrompt` frequently, move that content into `start` or response Brief.**

## Where does X go?

| Concern | Where |
|---|---|
| "You are Tán Đồng." | `chatRoutes.systemPrompt` |
| "Use tools when needed. Be concise." | `chatRoutes.systemPrompt` |
| "Call `GET /api/gpt/query/start` first." | GPT Store Custom GPT Instructions |
| "How to encode variables as TOON." | GPT Store Custom GPT Instructions |
| "Use this to record a settlement, not an expense." | `instruction` on op |
| "Pass version back for optimistic locking." | `instruction` and/or response `Message` |
| "Respond in user's locale." | `start` Brief (conditional on `data.user.locale`) |
| "Before any mutation, confirm first." | `start` Brief (global rule) |
| "User has 3 pending invites." | `start` Brief + `Action` |
| "Use version=${data.version} next." | Response Brief `Message` (dynamic) |
| "If debts exist, ask to settle." | Response Brief `Message` |
| Suggested next actions with pre-filled args | Response Brief `Action` nodes |
| Imperative user-first button labels | `Action` `label` prop |

## Common mistakes

- Stuffing per-op guidance into `systemPrompt` — move to `instruction`.
- Putting dynamic user data in `systemPrompt` — use `start`.
- Repeating the operation ID as description: `description: "list-boards"`.
- Writing for humans with emoji flair — the model doesn't need it.
- Forgetting that `instruction` is concatenated with `description` in MCP — don't repeat.
- Treating `Message` as user-facing copy. It's model narration that *becomes* user-facing after the model rewrites it.
- Putting secrets or internal identifiers in any of these fields — they all go to the model.
