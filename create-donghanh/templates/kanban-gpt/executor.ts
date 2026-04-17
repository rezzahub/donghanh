import type { Executor } from "@donghanh/core";
import * as queries from "./db/queries";

export const executor: Executor = async (operationId, variables, context) => {
  const v = variables as Record<string, string>;
  if (!context.userId) throw new Error("Unauthenticated");
  const userId = context.userId;

  switch (operationId) {
    case "list-boards":
      return queries.listBoards(userId);
    case "board-detail":
      return queries.boardDetail(v.boardId);
    case "create-board":
      return queries.createBoard(v.name, userId);
    case "add-card":
      return queries.addCard(v.boardId, v.columnId, v.title);
    case "move-card":
      return queries.moveCard(v.cardId, v.toColumnId);
    case "add-member":
      return queries.addMember(v.boardId, v.name);
    default:
      throw new Error(`Unknown operation: ${operationId}`);
  }
};
