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
  instructions?: string;
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

function flatChildren(children: Child | Child[]): (ChatNode | Text)[] {
  if (children == null || typeof children === "boolean") return [];
  if (Array.isArray(children))
    return (children.flat(Infinity) as unknown[]).filter(
      (c): c is ChatNode | Text => c != null && typeof c !== "boolean",
    );
  return [children];
}

function isText(child: ChatNode | Text): child is Text {
  return typeof child === "string" || typeof child === "number";
}

/** Adjacent text becomes one message, so `{n} items` reads as a sentence. */
function toNodes(children: (ChatNode | Text)[]): ChatNode[] {
  const nodes: ChatNode[] = [];
  let text: string | null = null;
  for (const child of children) {
    if (isText(child)) {
      text = (text ?? "") + child;
      continue;
    }
    if (text !== null) nodes.push({ type: "message", content: text });
    text = null;
    nodes.push(child);
  }
  if (text !== null) nodes.push({ type: "message", content: text });
  return nodes;
}

// --- Component functions ---

type Text = string | number;
type Child = ChatNode | ChatNode[] | Text | boolean | undefined | null;

export function Brief(props: { children?: Child | Child[] }): BriefNode {
  return { type: "brief", children: toNodes(flatChildren(props.children)) };
}

export function Message(props: { children?: Text | Text[] }): MessageNode {
  return { type: "message", content: [props.children ?? ""].flat().join("") };
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
  instructions?: string;
}): AppNode {
  const ops = Object.values(props.operations).map((component) => ({
    component,
  }));
  const node: AppNode = { type: "app", operations: ops };
  if (props.instructions !== undefined) node.instructions = props.instructions;
  return node;
}
