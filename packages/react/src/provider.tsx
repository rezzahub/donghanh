"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

// --- Config ---

export interface DongHanhConfig {
  endpoint: string;
  getAuthToken: () => string | Promise<string>;
}

const ConfigContext = createContext<DongHanhConfig | null>(null);

export function useDongHanhConfig(): DongHanhConfig {
  const ctx = useContext(ConfigContext);
  if (!ctx) {
    throw new Error("useDongHanhConfig must be used within DongHanhProvider");
  }
  return ctx;
}

// --- Chat types ---

export interface ChatAction {
  operation: string;
  label: string;
  variables?: Record<string, unknown>;
}

export interface ChatMessageItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: ChatAction[];
}

export interface InitOperation {
  id: string;
  variables?: Record<string, unknown>;
}

// --- Chat context ---

interface ChatContextValue {
  messages: ChatMessageItem[];
  isLoading: boolean;
  initOperation: InitOperation | null;
  sendMessage: (content: string, action?: ChatAction) => Promise<void>;
  setInitOperation: (op: InitOperation | null) => void;
  stop: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

let messageCounter = 0;

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error("useChatContext must be used within DongHanhProvider");
  }
  return ctx;
}

// --- SSE parser ---

function parseSSE(
  text: string,
  onEvent: (event: string, data: string) => void,
): string {
  const lines = text.split("\n");
  let remaining = "";
  let currentEvent = "";
  let currentData = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // If this is the last line and doesn't end with \n, it's incomplete
    if (i === lines.length - 1 && !text.endsWith("\n")) {
      remaining = line;
      break;
    }

    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      currentData = line.slice(6);
    } else if (line === "") {
      // Empty line = end of event
      if (currentEvent) {
        onEvent(currentEvent, currentData);
      }
      currentEvent = "";
      currentData = "";
    }
  }

  return remaining;
}

// --- Provider ---

export function DongHanhProvider(props: {
  config: DongHanhConfig;
  children: ReactNode;
}) {
  const { config } = props;
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [initOperation, setInitOperation] = useState<InitOperation | null>(
    null,
  );
  const abortRef = useRef<AbortController | null>(null);
  const initOpRef = useRef<InitOperation | null>(null);
  initOpRef.current = initOperation;

  const sendMessage = useCallback(
    async (content: string, action?: ChatAction) => {
      const userMsg: ChatMessageItem = {
        id: `msg-${++messageCounter}`,
        role: "user",
        content,
      };

      const updatedMessages = [...messages, userMsg];
      setMessages(updatedMessages);
      setIsLoading(true);

      const assistantId = `msg-${++messageCounter}`;

      // Add empty assistant message that we'll stream into
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "" },
      ]);

      try {
        const token = await config.getAuthToken();
        abortRef.current = new AbortController();

        const body: Record<string, unknown> = {
          messages: updatedMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        };

        if (updatedMessages.length === 1 && initOpRef.current) {
          body.initOperation = initOpRef.current;
        }

        // Send action details for direct execution
        if (action) {
          body.action = action;
        }

        const resp = await fetch(config.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
          signal: abortRef.current.signal,
        });

        if (!resp.ok) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: "Something went wrong. Please try again." }
                : m,
            ),
          );
          return;
        }

        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";
        let actions: ChatAction[] | undefined;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          buffer = parseSSE(buffer, (event, data) => {
            if (event === "text") {
              fullText += data;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: fullText } : m,
                ),
              );
            } else if (event === "actions") {
              try {
                actions = JSON.parse(data);
              } catch {
                // ignore
              }
            } else if (event === "done") {
              // Final update with actions
              if (actions) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, actions } : m,
                  ),
                );
              }
            }
          });
        }

        // If we never got any text, remove the empty assistant message
        if (!fullText) {
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        }
      } catch (err: unknown) {
        const error = err as { name?: string };
        if (error.name !== "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: "Connection error. Please try again." }
                : m,
            ),
          );
        }
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [messages, config],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const chatValue: ChatContextValue = {
    messages,
    isLoading,
    initOperation,
    sendMessage,
    setInitOperation,
    stop,
  };

  return (
    <ConfigContext.Provider value={config}>
      <ChatContext.Provider value={chatValue}>
        {props.children}
      </ChatContext.Provider>
    </ConfigContext.Provider>
  );
}
