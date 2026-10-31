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
  /** Auth requirement for this op. Default "required". */
  auth?: "none" | "optional" | "required";
  /** OAuth scopes required when auth is "required" or "optional". */
  scopes?: string[];
  /** True if this mutation deletes or irreversibly overwrites user data. */
  destructive?: boolean;
  /** True if this op writes to arbitrary external targets (default false for bounded ops). */
  external?: boolean;
  /** Widget name (matches a key in mcpRoutes `widgets` map). Omit for data-only ops. */
  widget?: string;
  /** Human-readable title for tool listings. */
  title?: string;
  /** True if repeating the call with the same input has no further effect. */
  idempotent?: boolean;
  /** Free-form grouping tags. */
  tags?: string[];
  /** Extra protocol metadata passed through to tool listings. */
  meta?: Record<string, unknown>;
  /** True if the app UI may call this op directly. */
  appCallable?: boolean;
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
  /** Authenticated user id, or null for anonymous tools (OperationConfig.auth === "none"). */
  userId: string | null;
  request: Request;
  /** Caller-stated reason for the call, when provided. */
  intent?: string;
}
