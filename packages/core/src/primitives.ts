// --- Node types ---

export interface BriefNode {
  type: "brief";
  children: ChatNode[];
}

export interface MessageNode {
  type: "message";
  content: string;
}

export interface ActionNode {
  type: "action";
  operation: string;
  label: string;
  variables?: Record<string, unknown>;
}

export interface FormNode {
  type: "form";
  fields: FieldDef[];
  operation: string;
}

export interface DisplayNode {
  type: "display";
  data: unknown;
}

export interface ContextNode {
  type: "context";
  value: unknown;
}

export interface AppNode {
  type: "app";
  operations: OperationRef[];
}

export interface FieldDef {
  name: string;
  type: string;
  label?: string;
  required?: boolean;
}

export interface OperationRef {
  component: OperationComponentAny;
}

export type ChatNode =
  | BriefNode
  | MessageNode
  | ActionNode
  | FormNode
  | DisplayNode
  | ContextNode;

// Minimal type for OperationComponent used in primitives (avoids circular dep)
interface OperationComponentAny {
  operationConfig: { id: string };
}

// --- Helpers ---

function flatChildren(children: Child | Child[]): (ChatNode | string)[] {
  if (children == null || typeof children === "boolean") return [];
  if (Array.isArray(children))
    return (children.flat(Infinity) as unknown[]).filter(
      (c): c is ChatNode | string => c != null && typeof c !== "boolean",
    );
  return [children];
}

function toNode(child: ChatNode | string): ChatNode {
  if (typeof child === "string") return { type: "message", content: child };
  return child;
}

// --- Component functions ---

type Child = ChatNode | ChatNode[] | string | boolean | undefined | null;

export function Brief(props: { children?: Child | Child[] }): BriefNode {
  const flat = flatChildren(props.children);
  return { type: "brief", children: flat.map(toNode) };
}

export function Message(props: { children?: string }): MessageNode {
  return { type: "message", content: props.children ?? "" };
}

export function Action(props: {
  operation: string;
  label: string;
  variables?: Record<string, unknown>;
}): ActionNode {
  return {
    type: "action",
    operation: props.operation,
    label: props.label,
    variables: props.variables,
  };
}

export function Form(props: {
  fields: FieldDef[];
  operation: string;
}): FormNode {
  return { type: "form", fields: props.fields, operation: props.operation };
}

export function Display(props: { data: unknown }): DisplayNode {
  return { type: "display", data: props.data };
}

export function Context(props: { value: unknown }): ContextNode {
  return { type: "context", value: props.value };
}

export function App(props: {
  operations: Record<string, OperationComponentAny>;
}): AppNode {
  const ops = Object.values(props.operations).map((component) => ({
    component,
  }));
  return { type: "app", operations: ops };
}
