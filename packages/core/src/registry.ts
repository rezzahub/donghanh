import type { AppNode } from "./primitives";
import type { OperationComponent } from "./types";

export interface CompactOperation {
  id: string;
  type: "query" | "mutation";
  description: string;
  auth?: "none" | "optional" | "required";
  title?: string;
  tags?: string[];
  destructive?: boolean;
}

export interface OperationDetail {
  id: string;
  type: "query" | "mutation";
  description: string;
  instruction: string;
  input: object;
  response?: object;
  auth?: "none" | "optional" | "required";
  scopes?: string[];
  destructive?: boolean;
  external?: boolean;
  widget?: string;
  title?: string;
  idempotent?: boolean;
  tags?: string[];
  meta?: Record<string, unknown>;
  appCallable?: boolean;
}

export interface Registry {
  instructions(): string | undefined;
  list(): CompactOperation[];
  detail(name: string): OperationDetail | null;
  get(name: string): OperationComponent | undefined;
}

export function buildRegistry(
  appNode: AppNode,
  responseSchemas?: Record<string, object>,
): Registry {
  const map = new Map<string, OperationComponent>();

  for (const ref of appNode.operations) {
    const op = ref.component as OperationComponent;
    const id = op.operationConfig.id;
    if (map.has(id)) throw new Error(`Duplicate operation id "${id}"`);
    map.set(id, op);
  }

  return {
    instructions(): string | undefined {
      return appNode.instructions;
    },

    list(): CompactOperation[] {
      return Array.from(map.values()).map((op) => {
        const entry: CompactOperation = {
          id: op.operationConfig.id,
          type: op.operationConfig.type,
          description: op.operationConfig.description,
        };
        const c = op.operationConfig;
        if (c.auth) entry.auth = c.auth;
        if (c.title !== undefined) entry.title = c.title;
        if (c.tags !== undefined) entry.tags = c.tags;
        if (c.destructive !== undefined) entry.destructive = c.destructive;
        return entry;
      });
    },

    detail(name: string): OperationDetail | null {
      const op = map.get(name);
      if (!op) return null;
      const config = op.operationConfig;
      return {
        id: config.id,
        type: config.type,
        description: config.description,
        instruction: config.instruction,
        input: config.input,
        response: responseSchemas?.[name],
        auth: config.auth,
        scopes: config.scopes,
        destructive: config.destructive,
        external: config.external,
        widget: config.widget,
        title: config.title,
        idempotent: config.idempotent,
        tags: config.tags,
        meta: config.meta,
        appCallable: config.appCallable,
      };
    },

    get(name: string): OperationComponent | undefined {
      return map.get(name);
    },
  };
}
