import type {
  ActionNode,
  BriefNode,
  ChatNode,
  ContextNode,
  DisplayNode,
  FormNode,
  MessageNode,
  Renderer,
} from "@donghanh/core";
import { renderNode } from "@donghanh/core";

export interface LlmResult {
  text: string;
  actions: LlmAction[];
  context?: unknown[];
}

export interface LlmAction {
  operation: string;
  label: string;
  variables?: Record<string, unknown>;
}

interface Fragment {
  kind: "message" | "action" | "display" | "context";
  value: unknown;
}

const llmRenderer: Renderer<Fragment | Fragment[]> = {
  brief(_node: BriefNode, children: (Fragment | Fragment[])[]): Fragment[] {
    return children.flat();
  },

  message(node: MessageNode): Fragment {
    return { kind: "message", value: node.content };
  },

  action(node: ActionNode): Fragment {
    const action: LlmAction = {
      operation: node.operation,
      label: node.label,
      variables: node.variables,
    };
    return { kind: "action", value: action };
  },

  form(_node: FormNode): Fragment {
    return { kind: "context", value: null };
  },

  display(node: DisplayNode): Fragment {
    return { kind: "display", value: node.data };
  },

  context(node: ContextNode): Fragment {
    return { kind: "context", value: node.value };
  },
};

export function renderForLlm(brief: ChatNode): LlmResult {
  const fragments = renderNode(brief, llmRenderer) as Fragment | Fragment[];
  const flat = Array.isArray(fragments) ? fragments : [fragments];

  const messages: string[] = [];
  const actions: LlmAction[] = [];
  const displays: string[] = [];
  const contexts: unknown[] = [];

  for (const f of flat) {
    if (f.value == null) continue;
    switch (f.kind) {
      case "message":
        messages.push(f.value as string);
        break;
      case "action":
        actions.push(f.value as LlmAction);
        break;
      case "display":
        displays.push(
          typeof f.value === "string" ? f.value : JSON.stringify(f.value),
        );
        break;
      case "context":
        contexts.push(f.value);
        break;
    }
  }

  const parts: string[] = [];
  if (messages.length > 0) parts.push(messages.join("\n"));
  if (displays.length > 0) parts.push(displays.join("\n"));

  if (actions.length > 0) {
    const actionList = actions
      .map((a) => `- ${a.label} (${a.operation})`)
      .join("\n");
    parts.push(`Suggested actions:\n${actionList}`);
  }

  return {
    text: parts.join("\n\n"),
    actions,
    context: contexts.length > 0 ? contexts : undefined,
  };
}
