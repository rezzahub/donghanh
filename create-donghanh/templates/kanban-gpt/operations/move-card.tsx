/** @jsxImportSource @donghanh/core */
import { Action, Brief, Display, registerOperation } from "@donghanh/core";
import type { OperationProps } from "@donghanh/core";

interface Data { board: { id: string; name: string }; columns: { id: string; name: string; cards: { id: string; title: string }[] }[] }

function MoveCard({ data }: OperationProps<Data>) {
  return (
    <Brief>
      Card moved.
      <Display data={data.columns.map(col => ({ column: col.name, cards: col.cards.map(c => c.title) }))} />
      <Action operation="board-detail" label="View board" variables={{ boardId: data.board.id }} />
    </Brief>
  );
}

export default registerOperation(MoveCard, {
  id: "move-card",
  type: "mutation",
  description: "Move a card to another column",
  instruction: "Moves a card from its current column to the target column.",
  input: {
    type: "object",
    required: ["cardId", "toColumnId"],
    properties: {
      cardId: { type: "string" },
      toColumnId: { type: "string", description: "Target column ID" },
    },
  },
  responseKey: "moveCard",
  widget: "task-card",
});
