import type { ChatNode } from "./primitives";

type ComponentFn = (props: Record<string, unknown>) => ChatNode;

export function jsxDEV(
  type: ComponentFn,
  props: Record<string, unknown>,
): ChatNode {
  return type(props);
}

export { Fragment } from "./jsx-runtime";
