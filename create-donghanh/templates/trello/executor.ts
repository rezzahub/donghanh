import type { Executor } from "@donghanh/core";
import * as queries from "./db";

export function createExecutor(db: D1Database): Executor {
  const ops: Record<string, (vars: Record<string, unknown>, userId: string) => Promise<unknown>> = {
    "list-boards": (_, userId) => queries.listBoards(db, userId),
    "board-detail": (v) => queries.boardDetail(db, v.boardId as string),
    "create-board": (v, userId) => queries.createBoard(db, v.name as string, userId),
    "add-card": (v) => queries.addCard(db, v.boardId as string, v.columnId as string, v.title as string),
    "move-card": (v) => queries.moveCard(db, v.cardId as string, v.toColumnId as string),
    "add-member": (v) => queries.addMember(db, v.boardId as string, v.name as string),
  };

  return async (operationId, variables, context) => {
    const op = ops[operationId];
    if (!op) throw new Error(`Unknown operation: ${operationId}`);
    return op(variables, context.userId);
  };
}
