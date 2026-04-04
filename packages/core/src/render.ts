import type {
  ActionNode,
  BriefNode,
  ChatNode,
  ContextNode,
  DisplayNode,
  FormNode,
  MessageNode,
} from "./primitives";

export interface Renderer<T> {
  brief(node: BriefNode, children: T[]): T;
  message(node: MessageNode): T;
  action(node: ActionNode): T;
  form(node: FormNode): T;
  display(node: DisplayNode): T;
  context(node: ContextNode): T;
}

export function renderNode<T>(node: ChatNode, renderer: Renderer<T>): T {
  switch (node.type) {
    case "brief": {
      const children = node.children.map((child) =>
        renderNode(child, renderer),
      );
      return renderer.brief(node, children);
    }
    case "message":
      return renderer.message(node);
    case "action":
      return renderer.action(node);
    case "form":
      return renderer.form(node);
    case "display":
      return renderer.display(node);
    case "context":
      return renderer.context(node);
  }
}
