/** @jsxImportSource @donghanh/core */
import { Action, Brief, Display, registerOperation } from "@donghanh/core";
import type { OperationProps } from "@donghanh/core";

interface Column { id: string; name: string; cards: { id: string; title: string }[] }
interface Member { id: string; name: string }
interface Data { board: { id: string; name: string }; columns: Column[]; members: Member[] }

function BoardDetail({ data }: OperationProps<Data>) {
  const { board, columns, members } = data;
  return (
    <Brief>
      Board: {board.name} ({members.length} members)
      <Display data={columns.map(col => ({
        column: col.name,
        cards: col.cards.map(c => c.title),
      }))} />
      {columns.map(col => (
        <Action operation="add-card" label={`Add card to ${col.name}`} variables={{ boardId: board.id, columnId: col.id }} />
      ))}
      <Action operation="add-member" label="Add member" variables={{ boardId: board.id }} />
    </Brief>
  );
}

export default registerOperation(BoardDetail, {
  id: "board-detail",
  type: "query",
  description: "View board columns, cards, and members",
  instruction: "Shows the full board with all columns and cards.",
  input: {
    type: "object",
    required: ["boardId"],
    properties: { boardId: { type: "string" } },
  },
  responseKey: "boardDetail",
});
