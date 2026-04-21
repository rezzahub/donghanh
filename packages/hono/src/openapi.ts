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
   * When true, append a "Other operations" section listing sibling op ids +
   * descriptions to each path's OpenAPI `description`. Helps ChatGPT Actions
   * learn the full surface from any single path. Default false.
   */
  includeSiblingsInDescription?: boolean;
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
    includeSiblingsInDescription = false,
  } = config;

  const ops = registry.list();

  const siblingsBlock = includeSiblingsInDescription
    ? `\n\nOther operations:\n${ops
        .map(
          (o) =>
            `- \`${o.id}\` (${o.type}, auth: ${o.auth ?? "required"}) — ${o.description}`,
        )
        .join("\n")}`
    : "";
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
    const pascal = op.id
      .split(/[-_]/)
      .map((s) => (s ? s[0].toUpperCase() + s.slice(1) : ""))
      .join("");
    const entry: Operation = {
      operationId: `${method}_${op.id}`.replace(/[^A-Za-z0-9_]/g, "_"),
      summary: op.description,
      description:
        (detail?.instruction
          ? `${op.description}\n\n${detail.instruction}`
          : op.description) + siblingsBlock,
      security,
      responses: successResponse,
    };
    if (method === "get") {
      entry.parameters = [variablesParam];
    } else {
      entry.requestBody = variablesBody;
    }
    // Tag by op type to help OpenAPI UIs group them.
    (entry as Record<string, unknown>).tags = [op.type];
    // Hint: unused `pascal` to keep id stable if we later switch to camelCase.
    void pascal;

    let item = paths[path];
    if (!item) {
      item = {};
      paths[path] = item;
    }
    item[method] = entry;
  };

  const authedSec: Sec = [{ [bearerSchemeName]: [] }];
  const noSec: Sec = [];

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

  return {
    openapi: "3.1.0",
    info,
    servers,
    paths,
    components: {
      securitySchemes: {
        [bearerSchemeName]: {
          type: "http",
          scheme: "bearer",
        },
      },
    },
  };
}
