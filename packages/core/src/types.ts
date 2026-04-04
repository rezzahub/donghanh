import type { ChatNode } from "./primitives";

export interface OperationProps<T = any> {
  data: T;
  variables: Record<string, unknown>;
}

export interface OperationConfig {
  id: string;
  type: "query" | "mutation";
  description: string;
  instruction: string;
  input: object;
  responseKey: string;
}

export interface OperationComponent<T = any> {
  (props: OperationProps<T>): ChatNode;
  operationConfig: OperationConfig;
}

export function registerOperation<T = any>(
  component: (props: OperationProps<T>) => ChatNode,
  config: OperationConfig,
): OperationComponent<T> {
  const op = component as OperationComponent<T>;
  op.operationConfig = config;
  return op;
}

export type Executor = (
  operationId: string,
  variables: Record<string, unknown>,
  context: ExecutorContext,
) => Promise<unknown>;

export interface ExecutorContext {
  userId: string;
  request: Request;
}
