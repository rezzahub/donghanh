import type { AppNode } from "./primitives";
import type { OperationComponent } from "./types";

export interface CompactOperation {
  id: string;
  type: "query" | "mutation";
  description: string;
}

export interface OperationDetail {
  id: string;
  type: "query" | "mutation";
  description: string;
  instruction: string;
  input: object;
  response?: object;
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
      return Array.from(map.values()).map((op) => ({
        id: op.operationConfig.id,
        type: op.operationConfig.type,
        description: op.operationConfig.description,
      }));
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
      };
    },

    get(name: string): OperationComponent | undefined {
      return map.get(name);
    },
  };
}
