"use client";

import { useEffect, useRef } from "react";
import type { InitOperation } from "./provider";
import { useChatContext } from "./provider";

export function useChat() {
  const { messages, isLoading, sendMessage, stop } = useChatContext();
  return { messages, isLoading, sendMessage, stop };
}

export function useInitOperation(
  id: string,
  variables?: Record<string, unknown>,
) {
  const { setInitOperation } = useChatContext();
  const varsRef = useRef(variables);
  varsRef.current = variables;

  useEffect(() => {
    const op: InitOperation = { id, variables: varsRef.current };
    setInitOperation(op);
    return () => setInitOperation(null);
  }, [id, setInitOperation]);
}
