import type { AppNode } from "./primitives";
import type { OperationComponent } from "./types";

export interface CompactOperation {
  id: string;
  type: "query" | "mutation";
  description: string;
  auth?: "none" | "optional" | "required";
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
}

export interface Registry {
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
    map.set(op.operationConfig.id, op);
  }

  return {
    list(): CompactOperation[] {
      return Array.from(map.values()).map((op) => {
        const entry: CompactOperation = {
          id: op.operationConfig.id,
          type: op.operationConfig.type,
          description: op.operationConfig.description,
        };
        if (op.operationConfig.auth) entry.auth = op.operationConfig.auth;
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
      };
    },

    get(name: string): OperationComponent | undefined {
      return map.get(name);
    },
  };
}
