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

/** Sentinel used when a request runs without an authenticated user. */
const ANONYMOUS: string = "anonymous";

type AuthMode = "none" | "optional" | "required";

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

  // List operations (auth advertised per-op)
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

  /**
   * Resolve the userId to execute with, given the op's auth posture and the
   * inbound request. Returns either a string userId or a Response to short-circuit.
   */
  async function resolveUser(
    request: Request,
    authMode: AuthMode,
    public_: boolean,
  ): Promise<string | Response> {
    // auth: "none" — always anonymous, never call authenticate
    if (authMode === "none") return ANONYMOUS;

    // Public sub-router: be lenient — swallow errors, fall back to anonymous
    if (public_) {
      const result = await authenticate(request);
      if (isAuthError(result)) return ANONYMOUS;
      return result.userId;
    }

    // Default path: propagate auth error when required; swallow when optional
    const result = await authenticate(request);
    if (isAuthError(result)) {
      if (authMode === "optional") return ANONYMOUS;
      return result.error;
    }
    return result.userId;
  }

  // Execute query (default)
  app.get("/query/:operation", async (c) => {
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

    const authMode: AuthMode = op.operationConfig.auth ?? "required";
    const user = await resolveUser(c.req.raw, authMode, false);
    if (user instanceof Response) return user;

    return handleExecution(c.req.raw, user, operationId, () => {
      const url = new URL(c.req.url);
      return url.searchParams.get("$variables") ?? undefined;
    });
  });

  // Execute mutation (default)
  app.post("/mutate/:operation", async (c) => {
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

    const authMode: AuthMode = op.operationConfig.auth ?? "required";
    const user = await resolveUser(c.req.raw, authMode, false);
    if (user instanceof Response) return user;

    return handleExecution(c.req.raw, user, operationId, async () => {
      const body = await c.req.json();
      return body.$variables;
    });
  });

  // ---------- /public sub-paths ----------
  // OAS-friendly no-auth surface. Rejects ops whose auth posture is "required".

  const notFound404 = (body: { error: string }): Response =>
    new Response(JSON.stringify(body), {
      status: 404,
      headers: { "content-type": "application/json" },
    });

  app.get("/public/query/:operation", async (c) => {
    const operationId = c.req.param("operation");
    const op = registry.get(operationId);
    if (!op) {
      return notFound404({ error: "Operation not found or requires auth." });
    }
    const authMode: AuthMode = op.operationConfig.auth ?? "required";
    if (authMode === "required") {
      return notFound404({ error: "Operation not found or requires auth." });
    }
    if (op.operationConfig.type !== "query") {
      return jsonError(
        `"${operationId}" is a mutation. Use POST /public/mutate/${operationId} instead.`,
      );
    }

    const user = await resolveUser(c.req.raw, authMode, true);
    if (user instanceof Response) return user;

    return handleExecution(c.req.raw, user, operationId, () => {
      const url = new URL(c.req.url);
      return url.searchParams.get("$variables") ?? undefined;
    });
  });

  app.post("/public/mutate/:operation", async (c) => {
    const operationId = c.req.param("operation");
    const op = registry.get(operationId);
    if (!op) {
      return notFound404({ error: "Operation not found or requires auth." });
    }
    const authMode: AuthMode = op.operationConfig.auth ?? "required";
    if (authMode === "required") {
      return notFound404({ error: "Operation not found or requires auth." });
    }
    if (op.operationConfig.type !== "mutation") {
      return jsonError(
        `"${operationId}" is a query. Use GET /public/query/${operationId} instead.`,
      );
    }

    const user = await resolveUser(c.req.raw, authMode, true);
    if (user instanceof Response) return user;

    return handleExecution(c.req.raw, user, operationId, async () => {
      const body = await c.req.json();
      return body.$variables;
    });
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

    if (typeof rawVariables === "string") {
      try {
        variables = JSON.parse(rawVariables);
      } catch {
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

      const rendered = renderForChatGpt(brief, {
        encodeVariables,
        getOperationInput: (id) => {
          const detail = registry.detail(id);
          return detail?.input;
        },
      });

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

      if (enrichResponse) {
        await enrichResponse(result, {
          operationId,
          data,
          variables,
          userId,
          request,
        });
      }

      if (operationId === "start" && responseSchemas?.start) {
        result.responseSchema = responseSchemas.start;
      }

      result.operations = registry.list();

      return new Response(JSON.stringify(result), {
        headers: { "content-type": "application/json" },
      });
    } catch (err: any) {
      const message = err?.message ?? "Internal error";

      const errorResult: Record<string, unknown> = {
        errors: [{ message }],
      };

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
