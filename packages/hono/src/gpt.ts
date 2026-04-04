import type { Executor, Registry } from "@donghanh/core";
import { executeOperation } from "@donghanh/core";
import { Hono } from "hono";
import type { Authenticate } from "./middleware";
import { isAuthError } from "./middleware";
import { renderForChatGpt } from "./renderers/chatgpt";

export interface GptRoutesConfig {
  registry: Registry;
  executor: Executor;
  authenticate: Authenticate;
  encodeVariables?: (vars: Record<string, unknown>) => string;
  responseSchemas?: Record<string, object>;
  /** Hook to enrich the JSON response (e.g. inject display text) */
  enrichResponse?: (
    result: Record<string, unknown>,
    opts: {
      operationId: string;
      data: unknown;
      variables: Record<string, unknown>;
      userId: string;
      request: Request;
    },
  ) => Promise<void>;
}

function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ errors: [{ message }] }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function gptRoutes(config: GptRoutesConfig): Hono {
  const {
    registry,
    executor,
    authenticate,
    encodeVariables,
    responseSchemas,
    enrichResponse,
  } = config;

  const app = new Hono();

  // List operations
  app.get("/operations", (c) => {
    const url = new URL(c.req.url);
    const search = url.searchParams.get("search")?.toLowerCase();
    const typeFilter = url.searchParams.get("type");

    let operations = registry.list();

    if (typeFilter || search) {
      operations = operations.filter((op) => {
        if (typeFilter && op.type !== typeFilter) return false;
        if (search) {
          return (
            op.id.includes(search) ||
            op.description.toLowerCase().includes(search)
          );
        }
        return true;
      });
    }

    return c.json({ operations });
  });

  // Operation detail
  app.get("/operations/:name", (c) => {
    const name = c.req.param("name");
    const detail = registry.detail(name);

    if (!detail) {
      return c.json(
        {
          error: `Unknown operation "${name}". Call GET /api/gpt/operations to list available operations.`,
        },
        404,
      );
    }

    return c.json(detail);
  });

  // Execute query
  app.get("/query/:operation", async (c) => {
    const authResult = await authenticate(c.req.raw);
    if (isAuthError(authResult)) return authResult.error;

    const operationId = c.req.param("operation");
    const op = registry.get(operationId);

    if (!op) {
      return jsonError(
        `Unknown operation "${operationId}". Call GET /api/gpt/operations to discover available operations.`,
      );
    }
    if (op.operationConfig.type !== "query") {
      return jsonError(
        `"${operationId}" is a mutation. Use POST /api/gpt/mutate/${operationId} instead.`,
      );
    }

    return handleExecution(c.req.raw, authResult.userId, operationId, () => {
      const url = new URL(c.req.url);
      return url.searchParams.get("$variables") ?? undefined;
    });
  });

  // Execute mutation
  app.post("/mutate/:operation", async (c) => {
    const authResult = await authenticate(c.req.raw);
    if (isAuthError(authResult)) return authResult.error;

    const operationId = c.req.param("operation");
    const op = registry.get(operationId);

    if (!op) {
      return jsonError(
        `Unknown operation "${operationId}". Call GET /api/gpt/operations to discover available operations.`,
      );
    }
    if (op.operationConfig.type !== "mutation") {
      return jsonError(
        `"${operationId}" is a query. Use GET /api/gpt/query/${operationId} instead.`,
      );
    }

    return handleExecution(
      c.req.raw,
      authResult.userId,
      operationId,
      async () => {
        const body = await c.req.json();
        return body.$variables;
      },
    );
  });

  async function handleExecution(
    request: Request,
    userId: string,
    operationId: string,
    getVariables: () => string | undefined | Promise<string | undefined>,
  ): Promise<Response> {
    let rawVariables: string | undefined;
    try {
      rawVariables = await getVariables();
    } catch {
      return jsonError("Invalid request body");
    }

    let variables: Record<string, unknown> = {};
    if (typeof rawVariables === "string" && encodeVariables) {
      // Decode using the inverse - we expect TOON format
      // The app provides its own decode in the executor or via a decode option
      // For now, pass raw through and let the executor handle it
    }

    // We need a decode function. Let's accept raw variables as TOON or JSON.
    if (typeof rawVariables === "string") {
      try {
        // Try JSON first
        variables = JSON.parse(rawVariables);
      } catch {
        // Pass as-is, let the app's decode handle it
        // Store raw so executor can decode
        variables = { $raw: rawVariables };
      }
    }

    try {
      const { data, brief } = await executeOperation({
        registry,
        operationId,
        variables,
        executor,
        context: { userId, request },
      });

      // Render JSX tree through ChatGPT renderer
      const rendered = renderForChatGpt(brief, {
        encodeVariables,
        getOperationInput: (id) => {
          const detail = registry.detail(id);
          return detail?.input;
        },
      });

      // Build response
      const result: Record<string, unknown> = {
        data: {
          [registry.get(operationId)!.operationConfig.responseKey]: data,
        },
      };

      if (rendered.suggestedActions.length > 0) {
        result.suggestedActions = rendered.suggestedActions;
      }
      if (rendered.nextSteps) {
        result.nextSteps = rendered.nextSteps;
      }

      // Enrich response (inject display, etc)
      if (enrichResponse) {
        await enrichResponse(result, {
          operationId,
          data,
          variables,
          userId,
          request,
        });
      }

      // Include response schema for start
      if (operationId === "start" && responseSchemas?.start) {
        result.responseSchema = responseSchemas.start;
      }

      // Always include operations list
      result.operations = registry.list();

      return new Response(JSON.stringify(result), {
        headers: { "content-type": "application/json" },
      });
    } catch (err: any) {
      const message = err?.message ?? "Internal error";

      const errorResult: Record<string, unknown> = {
        errors: [{ message }],
      };

      // Include operation detail for self-correction
      const detail = registry.detail(operationId);
      if (detail) {
        errorResult.operationDetail = {
          instruction: detail.instruction,
          input: detail.input,
        };
      }

      return new Response(JSON.stringify(errorResult), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
  }

  return app;
}
