import type { OperationDetail, Registry } from "@donghanh/core";
import type { ResolvedExposure } from "./exposure";

export const META_TOOL_NAMES = [
  "find_operations",
  "get_operation",
  "run_read",
  "run_write",
  "run_destructive",
] as const;

export type MetaToolName = (typeof META_TOOL_NAMES)[number];

export type SecurityScheme =
  | { type: "noauth" }
  | { type: "oauth2"; scopes: string[] };

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    openWorldHint: boolean;
    idempotentHint: boolean;
  };
  securitySchemes: SecurityScheme[];
}

export function isMetaTool(name: string): name is MetaToolName {
  return (META_TOOL_NAMES as readonly string[]).includes(name);
}

export function securitySchemesFor(
  detail: OperationDetail | null,
  defaultScopes: string[],
): SecurityScheme[] {
  const auth = detail?.auth ?? "required";
  const scopes = detail?.scopes ?? defaultScopes;
  if (auth === "none") return [{ type: "noauth" }];
  if (auth === "optional")
    return [{ type: "noauth" }, { type: "oauth2", scopes }];
  return [{ type: "oauth2", scopes }];
}

/** Which `run_*` tool runs an operation. */
export function runToolFor(detail: OperationDetail): MetaToolName {
  if (detail.type === "query") return "run_read";
  return detail.destructive ? "run_destructive" : "run_write";
}

export const RUN_CLASS: Record<string, string> = {
  run_read: "query",
  run_write: "mutation",
  run_destructive: "destructive mutation",
};

function unionSchemes(
  details: OperationDetail[],
  defaultScopes: string[],
): SecurityScheme[] {
  let noauth = false;
  const scopes = new Set<string>();
  let oauth = false;
  for (const d of details) {
    for (const s of securitySchemesFor(d, defaultScopes)) {
      if (s.type === "noauth") noauth = true;
      else {
        oauth = true;
        for (const sc of s.scopes) scopes.add(sc);
      }
    }
  }
  return [
    ...(noauth ? [{ type: "noauth" as const }] : []),
    ...(oauth ? [{ type: "oauth2" as const, scopes: [...scopes] }] : []),
  ];
}

const READ_HINTS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
};

const WRITE_HINTS = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: false,
};

const idProp = { type: "string", description: "Operation id." };
const variablesProp = {
  type: "object",
  description: "Arguments for the operation, as described by get_operation.",
};
const intentProp = {
  type: "string",
  minLength: 1,
  description:
    "One sentence saying what this call does for the user. Shown in approval dialogs.",
};

/** Meta-tools that apply to this endpoint's catalog (none when the catalog is empty). */
export function catalogTools(
  registry: Registry,
  exposure: ResolvedExposure,
  defaultScopes: string[],
): McpTool[] {
  const details = exposure
    .catalogIds()
    .map((id) => registry.detail(id))
    .filter((d): d is OperationDetail => d !== null);
  if (details.length === 0) return [];

  const forClass = (name: MetaToolName) =>
    details.filter((d) => runToolFor(d) === name);
  const tools: McpTool[] = [
    {
      name: "find_operations",
      title: "Find operations",
      description:
        "Search the operations available through this endpoint by id, title, description or tag. Returns a compact list.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keywords to match." },
          tags: { type: "array", items: { type: "string" } },
        },
      },
      annotations: READ_HINTS,
      securitySchemes: unionSchemes(details, defaultScopes),
    },
    {
      name: "get_operation",
      title: "Get operation",
      description:
        "Get an operation's input schema, instruction and response schema. Call this before running an operation.",
      inputSchema: {
        type: "object",
        properties: { id: idProp },
        required: ["id"],
      },
      annotations: READ_HINTS,
      securitySchemes: unionSchemes(details, defaultScopes),
    },
  ];

  const runs: [MetaToolName, string, string, object, object][] = [
    [
      "run_read",
      "Run read operation",
      "Run a read-only (query) operation found with find_operations.",
      READ_HINTS,
      {
        type: "object",
        properties: { id: idProp, variables: variablesProp },
        required: ["id", "variables"],
      },
    ],
    [
      "run_write",
      "Run write operation",
      "Run a non-destructive write (mutation) operation found with find_operations.",
      WRITE_HINTS,
      {
        type: "object",
        properties: {
          id: idProp,
          variables: variablesProp,
          intent: intentProp,
        },
        required: ["id", "variables", "intent"],
      },
    ],
    [
      "run_destructive",
      "Run destructive operation",
      "Run a destructive write (delete, forget, revoke or overwrite) operation found with find_operations.",
      { ...WRITE_HINTS, destructiveHint: true },
      {
        type: "object",
        properties: {
          id: idProp,
          variables: variablesProp,
          intent: intentProp,
        },
        required: ["id", "variables", "intent"],
      },
    ],
  ];
  for (const [name, title, description, annotations, inputSchema] of runs) {
    const subset = forClass(name);
    if (subset.length === 0) continue;
    tools.push({
      name,
      title,
      description,
      inputSchema,
      annotations: annotations as McpTool["annotations"],
      securitySchemes: unionSchemes(subset, defaultScopes),
    });
  }
  return tools;
}
