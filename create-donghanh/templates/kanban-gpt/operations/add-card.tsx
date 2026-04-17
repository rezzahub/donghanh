/** @jsxImportSource @donghanh/core */
import { Action, Brief, Display, registerOperation } from "@donghanh/core";
import type { OperationProps } from "@donghanh/core";

interface Data { board: { id: string; name: string }; columns: { id: string; name: string; cards: { id: string; title: string }[] }[] }

function AddCard({ data }: OperationProps<Data>) {
  return (
    <Brief>
      Card added to {data.board.name}.
      <Display data={data.columns.map(col => ({ column: col.name, cards: col.cards.map(c => c.title) }))} />
      <Action operation="add-card" label="Add another card" variables={{ boardId: data.board.id }} />
      <Action operation="board-detail" label="View board" variables={{ boardId: data.board.id }} />
    </Brief>
  );
}

export default registerOperation(AddCard, {
  id: "add-card",
  type: "mutation",
  description: "Add a card to a column",
  instruction: "Adds a card to the specified column.",
  input: {
    type: "object",
    required: ["boardId", "columnId", "title"],
    properties: {
      boardId: { type: "string" },
      columnId: { type: "string", description: "Target column ID" },
      title: { type: "string", description: "Card title" },
    },
  },
  responseKey: "addCard",
  widget: "task-card",
});
