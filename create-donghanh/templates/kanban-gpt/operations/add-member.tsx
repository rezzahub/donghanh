/** @jsxImportSource @donghanh/core */
import { Action, Brief, Display, registerOperation } from "@donghanh/core";
import type { OperationProps } from "@donghanh/core";

interface Data { board: { id: string; name: string }; members: { id: string; name: string }[] }

function AddMember({ data }: OperationProps<Data>) {
  return (
    <Brief>
      Member added to {data.board.name}. Now {data.members.length} member(s).
      <Display data={data.members.map(m => m.name)} />
      <Action operation="add-member" label="Add another member" variables={{ boardId: data.board.id }} />
      <Action operation="board-detail" label="View board" variables={{ boardId: data.board.id }} />
    </Brief>
  );
}

export default registerOperation(AddMember, {
  id: "add-member",
  type: "mutation",
  description: "Add a member to a board",
  instruction: "Adds a member by name to the board.",
  input: {
    type: "object",
    required: ["boardId", "name"],
    properties: {
      boardId: { type: "string" },
      name: { type: "string", description: "Member name" },
    },
  },
  responseKey: "addMember",
});
