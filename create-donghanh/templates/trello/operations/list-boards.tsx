/** @jsxImportSource @donghanh/core */
import { Action, Brief, Display, registerOperation } from "@donghanh/core";
import type { OperationProps } from "@donghanh/core";

interface Board { id: string; name: string; card_count: number; member_count: number }
interface Data { boards: Board[] }

function ListBoards({ data }: OperationProps<Data>) {
  if (data.boards.length === 0) {
    return (
      <Brief>
        No boards yet.
        <Action operation="create-board" label="Create your first board" />
      </Brief>
    );
  }
  return (
    <Brief>
      You have {data.boards.length} board(s).
      <Display data={data.boards.map(b => `${b.name} (${b.card_count} cards, ${b.member_count} members)`)} />
      {data.boards.map(b => (
        <Action key={b.id} operation="board-detail" label={`View ${b.name}`} variables={{ boardId: b.id }} />
      ))}
      <Action operation="create-board" label="Create new board" />
    </Brief>
  );
}

export default registerOperation(ListBoards, {
  id: "list-boards",
  type: "query",
  description: "List all boards",
  instruction: "Call this first to see available boards.",
  input: {},
  responseKey: "listBoards",
});
