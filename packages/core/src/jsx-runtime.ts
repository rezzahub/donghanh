import type { ChatNode } from "./primitives";

type ComponentFn = (props: Record<string, unknown>) => ChatNode;

export function jsx(
  type: ComponentFn,
  props: Record<string, unknown>,
): ChatNode {
  return type(props);
}

export function jsxs(
  type: ComponentFn,
  props: Record<string, unknown>,
): ChatNode {
  return type(props);
}

export function Fragment(props: {
  children?: ChatNode | ChatNode[];
}): ChatNode[] {
  if (!props.children) return [];
  return Array.isArray(props.children) ? props.children : [props.children];
}
