import type { Registry } from "@donghanh/core";

export interface OpenApiInfo {
  title: string;
  description?: string;
  version: string;
}

export interface OpenApiServer {
  url: string;
  description?: string;
}

export interface GenerateOpenApiConfig {
  registry: Registry;
  info: OpenApiInfo;
  servers: OpenApiServer[];
  /** Mount path prefix, e.g. "/api/gpt". Omit trailing slash. Defaults to "". */
  basePath?: string;
  /** Name of the bearer security scheme. Defaults to "bearerAuth". */
  bearerSchemeName?: string;
  /** When true, adds an info note about the $variables encoding (default true). */
  describeVariables?: boolean;
  /**
   * When true, each path emits a `description` built from the op's
   * description + instruction. Default `false` — only `summary` is emitted,
   * which keeps the spec compact and sidesteps ChatGPT Actions' 300-char
   * description limit. Turn on when you want richer Action instructions in
   * the OAS. (For listing sibling operations, prefer `includeOperationsInDetail`
   * on `gptRoutes` — the GPT fetches `GET /operations/:name` to learn
   * available ops, a cleaner channel than inlining them into OAS.)
   */
  includeDescription?: boolean;
  /**
   * Max length for each path's OpenAPI `description` when emitted. ChatGPT
   * Actions rejects descriptions over 300 characters, so the default is 300.
   * No effect when `includeDescription` is false.
   */
  maxDescriptionLength?: number;
  /**
   * How to lay out paths:
   * - "parametric" (default) — single path with `{operation}` as a path param,
   *   matching gptRoutes' route shape (`/query/:operation`). 2–4 paths total
   *   regardless of registry size; the model picks the op by filling the
   *   `operation` param. Mirrors the existing REST shape and matches the
   *   convention most donghanh apps already use in their ChatGPT Action config.
   * - "per-op" — one OAS path per operation, e.g. `/query/start`,
   *   `/public/query/check-offer`. Each op gets its own summary + description,
   *   so ChatGPT Actions discovers them as separate actions. Larger spec;
   *   useful when you want each op to be a discrete ChatGPT Action.
   */
  pathStyle?: "parametric" | "per-op";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

type Sec = Array<Record<string, string[]>>;

type Operation = {
  operationId: string;
  summary: string;
  description?: string;
  security: Sec;
  parameters?: Array<Record<string, unknown>>;
  requestBody?: Record<string, unknown>;
  responses: Record<string, unknown>;
};

type PathItem = Partial<Record<"get" | "post", Operation>>;

/**
 * Generate an OpenAPI 3.1 spec from a donghanh registry. Emits per-operation
 * concrete paths so ChatGPT Actions can target each op independently.
 *
 * - `auth: "required"` (default) → path under `${basePath}/query/...` with bearerAuth
 * - `auth: "optional"` → two entries: the default path with bearerAuth AND `/public/...` with no security
 * - `auth: "none"` → single entry under `${basePath}/public/...` with no security
 */
export function generateOpenApi(config: GenerateOpenApiConfig): object {
  const {
    registry,
    info,
    servers,
    basePath = "",
    bearerSchemeName = "bearerAuth",
    describeVariables = true,
    includeDescription = false,
    maxDescriptionLength = 300,
    pathStyle = "parametric",
  } = config;

  const ops = registry.list();
  const paths: Record<string, PathItem> = {};

  const variablesParam = {
    name: "$variables",
    in: "query" as const,
    required: false,
    description: describeVariables
      ? "Variables encoded as JSON or TOON (one field per line), URI-encoded. See GET /operations/{name} for each op's input schema."
      : undefined,
    schema: { type: "string" },
  };

  const variablesBody = {
    required: false,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            $variables: {
              type: "string",
              description: describeVariables
                ? "Variables encoded as JSON string or TOON format."
                : undefined,
            },
          },
        },
      },
    },
  };

  const successResponse = {
    "200": {
      description: "Successful response.",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              data: { type: "object" },
              suggestedActions: {
                type: "array",
                items: { type: "object" },
              },
              nextSteps: { type: "string" },
              operations: {
                type: "array",
                items: { type: "object" },
              },
            },
          },
        },
      },
    },
    "400": {
      description: "Validation or execution error.",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              errors: {
                type: "array",
                items: {
                  type: "object",
                  properties: { message: { type: "string" } },
                },
              },
              operationDetail: { type: "object" },
            },
          },
        },
      },
    },
    "401": {
      description: "Unauthenticated. Only emitted on paths that require auth.",
    },
    "404": {
      description: "Operation not found (or requires auth on /public paths).",
    },
  };

  const emit = (
    path: string,
    method: "get" | "post",
    op: (typeof ops)[number],
    security: Sec,
  ) => {
    const detail = registry.detail(op.id);
    const entry: Operation = {
      operationId: `${method}_${op.id}`.replace(/[^A-Za-z0-9_]/g, "_"),
      summary: truncate(op.description, 120),
      security,
      responses: successResponse,
    };
    if (includeDescription) {
      const full = detail?.instruction
        ? `${op.description}\n\n${detail.instruction}`
        : op.description;
      entry.description = truncate(full, maxDescriptionLength);
    }
    if (method === "get") {
      entry.parameters = [variablesParam];
    } else {
      entry.requestBody = variablesBody;
    }
    (entry as Record<string, unknown>).tags = [op.type];

    let item = paths[path];
    if (!item) {
      item = {};
      paths[path] = item;
    }
    item[method] = entry;
  };

  const authedSec: Sec = [{ [bearerSchemeName]: [] }];
  const noSec: Sec = [];

  if (pathStyle === "parametric") {
    emitParametric(paths, basePath, authedSec, noSec, ops, {
      includeDescription,
      maxDescriptionLength,
      variablesParam,
      variablesBody,
      successResponse,
    });
  } else {
    for (const op of ops) {
      const method: "get" | "post" = op.type === "query" ? "get" : "post";
      const auth = op.auth ?? "required";

      const methodPath = op.type === "query" ? "query" : "mutate";
      const defaultPath = `${basePath}/${methodPath}/${op.id}`;
      const publicPath = `${basePath}/public/${methodPath}/${op.id}`;

      if (auth === "none") {
        emit(publicPath, method, op, noSec);
        continue;
      }
      if (auth === "required") {
        emit(defaultPath, method, op, authedSec);
        continue;
      }
      // optional → expose both
      emit(defaultPath, method, op, authedSec);
      emit(publicPath, method, op, noSec);
    }
  }

  return {
    openapi: "3.1.0",
    info,
    servers,
    paths,
    components: {
      schemas: {},
      securitySchemes: {
        [bearerSchemeName]: {
          type: "http",
          scheme: "bearer",
        },
      },
    },
  };
}

function emitParametric(
  paths: Record<string, PathItem>,
  basePath: string,
  authedSec: Sec,
  noSec: Sec,
  ops: ReturnType<Registry["list"]>,
  ctx: {
    includeDescription: boolean;
    maxDescriptionLength: number;
    variablesParam: Record<string, unknown>;
    variablesBody: Record<string, unknown>;
    successResponse: Record<string, unknown>;
  },
): void {
  const queryIds = ops.filter((o) => o.type === "query").map((o) => o.id);
  const mutationIds = ops.filter((o) => o.type === "mutation").map((o) => o.id);
  const authedQueryIds = ops
    .filter((o) => o.type === "query" && (o.auth ?? "required") !== "none")
    .map((o) => o.id);
  const authedMutationIds = ops
    .filter((o) => o.type === "mutation" && (o.auth ?? "required") !== "none")
    .map((o) => o.id);
  const publicQueryIds = ops
    .filter((o) => o.type === "query" && (o.auth ?? "required") !== "required")
    .map((o) => o.id);
  const publicMutationIds = ops
    .filter(
      (o) => o.type === "mutation" && (o.auth ?? "required") !== "required",
    )
    .map((o) => o.id);

  const opParam = (enumIds: string[]): Record<string, unknown> => ({
    name: "operation",
    in: "path",
    required: true,
    description: `Operation slug. One of: ${enumIds.join(", ")}.`,
    schema: { type: "string", enum: enumIds },
  });

  const make = (
    opName: string,
    summary: string,
    _method: "get" | "post",
    security: Sec,
    enumIds: string[],
    bodyBased: boolean,
    description: string,
  ): Operation => {
    const entry: Operation = {
      operationId: opName,
      summary: truncate(summary, 120),
      security,
      responses: ctx.successResponse as Record<string, unknown>,
      parameters: bodyBased
        ? [opParam(enumIds)]
        : [opParam(enumIds), ctx.variablesParam],
    };
    if (ctx.includeDescription) {
      entry.description = truncate(description, ctx.maxDescriptionLength);
    }
    if (bodyBased) entry.requestBody = ctx.variablesBody;
    return entry;
  };

  if (queryIds.length) {
    if (authedQueryIds.length) {
      paths[`${basePath}/query/{operation}`] = {
        get: make(
          "queryOperation",
          "Execute a query operation",
          "get",
          authedSec,
          authedQueryIds,
          false,
          "Execute a read-only query by name. Pass variables as a JSON or TOON string in $variables.",
        ),
      };
    }
    if (publicQueryIds.length) {
      paths[`${basePath}/public/query/{operation}`] = {
        get: make(
          "publicQueryOperation",
          "Execute a public query operation",
          "get",
          noSec,
          publicQueryIds,
          false,
          "Execute a public query by name — no authentication required.",
        ),
      };
    }
  }

  if (mutationIds.length) {
    if (authedMutationIds.length) {
      paths[`${basePath}/mutate/{operation}`] = {
        post: make(
          "mutateOperation",
          "Execute a mutation operation",
          "post",
          authedSec,
          authedMutationIds,
          true,
          "Execute a mutation by name. Pass variables in the JSON body's $variables field.",
        ),
      };
    }
    if (publicMutationIds.length) {
      paths[`${basePath}/public/mutate/{operation}`] = {
        post: make(
          "publicMutateOperation",
          "Execute a public mutation operation",
          "post",
          noSec,
          publicMutationIds,
          true,
          "Execute a public mutation by name — no authentication required.",
        ),
      };
    }
  }
}
