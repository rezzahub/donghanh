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

export interface ChatGptResult {
  nextSteps?: string;
  suggestedActions: SuggestedAction[];
  display?: string;
  context?: unknown[];
}

export interface SuggestedAction {
  id: string;
  type: string;
  description: string;
  variables?: Record<string, unknown>;
  $variables?: string;
  input?: object;
}

interface Fragment {
  kind: "message" | "action" | "display" | "context";
  value: unknown;
}

const chatGptRenderer: Renderer<Fragment | Fragment[]> = {
  brief(_node: BriefNode, children: (Fragment | Fragment[])[]): Fragment[] {
    return children.flat();
  },

  message(node: MessageNode): Fragment {
    return { kind: "message", value: node.content };
  },

  action(node: ActionNode): Fragment {
    const action: SuggestedAction = {
      id: node.operation,
      type: "action",
      description: node.label,
      variables: node.variables,
    };
    return { kind: "action", value: action };
  },

  form(_node: FormNode): Fragment {
    // Forms are exposed via operation detail, not in response
    return { kind: "context", value: null };
  },

  display(node: DisplayNode): Fragment {
    return { kind: "display", value: node.data };
  },

  context(node: ContextNode): Fragment {
    return { kind: "context", value: node.value };
  },
};

export function renderForChatGpt(
  brief: ChatNode,
  opts?: {
    encodeVariables?: (vars: Record<string, unknown>) => string;
    getOperationInput?: (id: string) => object | undefined;
  },
): ChatGptResult {
  const fragments = renderNode(brief, chatGptRenderer) as Fragment | Fragment[];
  const flat = Array.isArray(fragments) ? fragments : [fragments];

  const messages: string[] = [];
  const actions: SuggestedAction[] = [];
  const displays: unknown[] = [];
  const contexts: unknown[] = [];

  for (const f of flat) {
    if (f.value == null) continue;
    switch (f.kind) {
      case "message":
        messages.push(f.value as string);
        break;
      case "action": {
        const action = f.value as SuggestedAction;
        if (action.variables && opts?.encodeVariables) {
          action.$variables = opts.encodeVariables(action.variables);
        }
        if (opts?.getOperationInput) {
          action.input = opts.getOperationInput(action.id) ?? {};
        }
        actions.push(action);
        break;
      }
      case "display":
        displays.push(f.value);
        break;
      case "context":
        contexts.push(f.value);
        break;
    }
  }

  const result: ChatGptResult = {
    suggestedActions: actions,
  };

  if (messages.length > 0) {
    result.nextSteps = messages.join(" ");
  }

  if (displays.length === 1) {
    result.display = displays[0] as string;
  } else if (displays.length > 1) {
    result.display = displays as any;
  }

  if (contexts.length > 0) {
    result.context = contexts;
  }

  return result;
}
