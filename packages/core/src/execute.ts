import type { ChatNode } from "./primitives";
import type { Registry } from "./registry";
import type { Executor, ExecutorContext } from "./types";

export interface ExecuteResult {
  data: unknown;
  brief: ChatNode;
}

export async function executeOperation(opts: {
  registry: Registry;
  operationId: string;
  variables: Record<string, unknown>;
  executor: Executor;
  context: ExecutorContext;
}): Promise<ExecuteResult> {
  const { registry, operationId, variables, executor, context } = opts;

  const operation = registry.get(operationId);
  if (!operation) {
    throw new Error(
      `Unknown operation "${operationId}". Call GET /api/gpt/operations to discover available operations.`,
    );
  }

  const data = await executor(operationId, variables, context);
  const brief = operation({ data, variables });

  return { data, brief };
}
