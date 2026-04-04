import type { Executor, Registry } from "@donghanh/core";
import { executeOperation } from "@donghanh/core";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Authenticate } from "./middleware";
import { isAuthError } from "./middleware";
import { renderForLlm } from "./renderers/llm";

export interface ChatRoutesConfig {
  registry: Registry;
  executor: Executor;
  authenticate: Authenticate;
  /** System prompt for the LLM */
  systemPrompt?: string;
  /** Hook to enrich data after operation execution (e.g. inject formatted balances) */
  enrichData?: (
    data: unknown,
    context: {
      operationId: string;
      variables: Record<string, unknown>;
      userId: string;
    },
  ) => Promise<void>;
  /** LLM model identifier (e.g. "anthropic/claude-sonnet-4") */
  model?: string;
  /** OpenRouter API key */
  apiKey?: string;
  /** Base URL for OpenAI-compatible API (default: OpenRouter) */
  baseUrl?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  actions?: Array<{
    operation: string;
    label: string;
    variables?: Record<string, unknown>;
  }>;
}

interface ChatAction {
  operation: string;
  label: string;
  variables?: Record<string, unknown>;
}

// OpenAI-compatible types
interface OaiTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

interface OaiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OaiToolCall[];
  tool_call_id?: string;
}

interface OaiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OaiChoice {
  message: {
    role: "assistant";
    content?: string | null;
    tool_calls?: OaiToolCall[];
  };
  finish_reason: string;
}

interface OaiResponse {
  choices: OaiChoice[];
}

interface OaiStreamChunk {
  choices: Array<{
    delta: { content?: string | null };
    finish_reason: string | null;
  }>;
}

export function chatRoutes(config: ChatRoutesConfig): Hono {
  const { registry, executor, authenticate } = config;
  const baseUrl = config.baseUrl ?? "https://openrouter.ai/api/v1";

  const app = new Hono();

  app.post("/", async (c) => {
    const authResult = await authenticate(c.req.raw);
    if (isAuthError(authResult)) return authResult.error;

    const body = await c.req.json();
    const messages: ChatMessage[] = body.messages ?? [];
    const initOperation:
      | { id: string; variables?: Record<string, unknown> }
      | undefined = body.initOperation;
    const action: ChatAction | undefined = body.action;

    const operations = registry.list();
    const tools: OaiTool[] = operations.map((op) => {
      const detail = registry.detail(op.id);
      return {
        type: "function" as const,
        function: {
          name: op.id,
          description: `${op.description}. ${detail?.instruction ?? ""}`.trim(),
          parameters: detail?.input ?? { type: "object", properties: {} },
        },
      };
    });

    const model = config.model ?? "google/gemini-2.5-flash";
    const systemPrompt =
      config.systemPrompt ??
      "You are a helpful assistant. Use the tools to help the user.";

    // Init operation context
    let initContext = "";
    if (initOperation && messages.length <= 1) {
      try {
        const initVars = initOperation.variables ?? {};
        const { data, brief } = await executeOperation({
          registry,
          operationId: initOperation.id,
          variables: initVars,
          executor,
          context: { userId: authResult.userId, request: c.req.raw },
        });
        if (config.enrichData) {
          await config.enrichData(data, {
            operationId: initOperation.id,
            variables: initVars,
            userId: authResult.userId,
          });
        }
        const rendered = renderForLlm(brief);
        initContext = `\n\nUser context:\n${JSON.stringify(data)}\n\n${rendered.text}`;
      } catch {
        // continue without context
      }
    }

    const llmMessages: OaiMessage[] = [
      { role: "system", content: systemPrompt + initContext },
      ...messages.map(
        (m): OaiMessage => ({ role: m.role, content: m.content }),
      ),
    ];

    let currentActions: ChatMessage["actions"] = [];

    // If user clicked an action button, execute the operation directly
    // and inject the result as a synthetic tool call for the LLM to explain
    if (action) {
      const toolCallId = `action-${Date.now()}`;

      try {
        const variables = action.variables ?? {};
        const { data, brief } = await executeOperation({
          registry,
          operationId: action.operation,
          variables,
          executor,
          context: { userId: authResult.userId, request: c.req.raw },
        });

        if (config.enrichData) {
          await config.enrichData(data, {
            operationId: action.operation,
            variables,
            userId: authResult.userId,
          });
        }

        const rendered = renderForLlm(brief);
        currentActions = rendered.actions.map((a) => ({
          operation: a.operation,
          label: a.label,
          variables: a.variables,
        }));

        const resultContent = `Data: ${JSON.stringify(data)}\n\n${rendered.text}`;

        // Inject as if the LLM called the tool itself
        llmMessages.push({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: toolCallId,
              type: "function",
              function: {
                name: action.operation,
                arguments: JSON.stringify(variables),
              },
            },
          ],
        });
        llmMessages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: resultContent,
        });
      } catch (err: unknown) {
        const error = err as { message?: string };
        llmMessages.push({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: toolCallId,
              type: "function",
              function: {
                name: action.operation,
                arguments: JSON.stringify(action.variables ?? {}),
              },
            },
          ],
        });
        llmMessages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: `Error: ${error?.message ?? "Unknown error"}`,
        });
      }

      // Stream the LLM's explanation of the result
      return streamSSE(c, async (stream) => {
        try {
          for await (const chunk of streamLlmCall(
            baseUrl,
            config.apiKey!,
            model,
            llmMessages,
            tools,
          )) {
            await stream.writeSSE({ event: "text", data: chunk });
          }
        } catch {
          await stream.writeSSE({
            event: "text",
            data: "Something went wrong generating the response.",
          });
        }
        if (currentActions && currentActions.length > 0) {
          await stream.writeSSE({
            event: "actions",
            data: JSON.stringify(currentActions),
          });
        }
        await stream.writeSSE({ event: "done", data: "" });
      });
    }

    // Normal flow: LLM decides what tools to call
    // Tool use loop — non-streaming
    let llmResponse = await callLlm(
      baseUrl,
      config.apiKey!,
      model,
      llmMessages,
      tools,
    );

    while (llmResponse.choices[0]?.finish_reason === "tool_calls") {
      const choice = llmResponse.choices[0];
      const toolCalls = choice.message.tool_calls ?? [];

      llmMessages.push({
        role: "assistant",
        content: choice.message.content,
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        const resultContent = await executeToolCall(
          toolCall,
          registry,
          executor,
          config,
          authResult.userId,
          c.req.raw,
        );
        currentActions = resultContent.actions;

        llmMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: resultContent.text,
        });
      }

      llmResponse = await callLlm(
        baseUrl,
        config.apiKey!,
        model,
        llmMessages,
        tools,
      );
    }

    // Final response — stream it
    const hadToolCalls = llmMessages.length > messages.length + 1;

    if (hadToolCalls) {
      // Tool loop done — stream the LLM's final explanation
      return streamSSE(c, async (stream) => {
        try {
          for await (const chunk of streamLlmCall(
            baseUrl,
            config.apiKey!,
            model,
            llmMessages,
            tools,
          )) {
            await stream.writeSSE({ event: "text", data: chunk });
          }
        } catch {
          await stream.writeSSE({
            event: "text",
            data: "Something went wrong generating the response.",
          });
        }
        if (currentActions && currentActions.length > 0) {
          await stream.writeSSE({
            event: "actions",
            data: JSON.stringify(currentActions),
          });
        }
        await stream.writeSSE({ event: "done", data: "" });
      });
    }

    // No tool calls — stream the response we already have, or re-request streaming
    const existingText = llmResponse.choices[0]?.message.content;
    return streamSSE(c, async (stream) => {
      if (existingText) {
        await stream.writeSSE({ event: "text", data: existingText });
      }
      await stream.writeSSE({ event: "done", data: "" });
    });
  });

  return app;
}

// --- Helpers ---

async function executeToolCall(
  toolCall: OaiToolCall,
  registry: Registry,
  executor: Executor,
  config: ChatRoutesConfig,
  userId: string,
  request: Request,
): Promise<{ text: string; actions: ChatMessage["actions"] }> {
  try {
    const variables = JSON.parse(toolCall.function.arguments) as Record<
      string,
      unknown
    >;

    const { data, brief } = await executeOperation({
      registry,
      operationId: toolCall.function.name,
      variables,
      executor,
      context: { userId, request },
    });

    if (config.enrichData) {
      await config.enrichData(data, {
        operationId: toolCall.function.name,
        variables,
        userId,
      });
    }

    const rendered = renderForLlm(brief);
    return {
      text: `Data: ${JSON.stringify(data)}\n\n${rendered.text}`,
      actions: rendered.actions.map((a) => ({
        operation: a.operation,
        label: a.label,
        variables: a.variables,
      })),
    };
  } catch (err: unknown) {
    const error = err as { message?: string };
    return {
      text: `Error: ${error?.message ?? "Unknown error"}`,
      actions: [],
    };
  }
}

async function callLlm(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: OaiMessage[],
  tools: OaiTool[],
): Promise<OaiResponse> {
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, tools, max_tokens: 4096 }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM API error (${resp.status}): ${text}`);
  }

  return resp.json();
}

async function* streamLlmCall(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: OaiMessage[],
  tools: OaiTool[],
): AsyncGenerator<string> {
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      tools,
      max_tokens: 4096,
      stream: true,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM API error (${resp.status}): ${text}`);
  }

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") return;

      try {
        const chunk: OaiStreamChunk = JSON.parse(data);
        const content = chunk.choices[0]?.delta?.content;
        if (content) yield content;
      } catch {
        // skip malformed chunks
      }
    }
  }
}
