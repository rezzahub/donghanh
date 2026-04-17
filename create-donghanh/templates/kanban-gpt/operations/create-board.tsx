/** @jsxImportSource @donghanh/core */
import { Action, Brief, registerOperation } from "@donghanh/core";
import type { OperationProps } from "@donghanh/core";

interface Data { board: { id: string; name: string }; columns: { id: string; name: string }[] }

function CreateBoard({ data }: OperationProps<Data>) {
  return (
    <Brief>
      Board "{data.board.name}" created with columns: {data.columns.map(c => c.name).join(", ")}.
      <Action operation="add-card" label="Add first card" variables={{ boardId: data.board.id, columnId: data.columns[0]?.id }} />
      <Action operation="add-member" label="Invite someone" variables={{ boardId: data.board.id }} />
    </Brief>
  );
}

export default registerOperation(CreateBoard, {
  id: "create-board",
  type: "mutation",
  description: "Create a new board with default columns",
  instruction: "Creates a board with To Do, In Progress, Done columns.",
  input: {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string", description: "Board name" } },
  },
  responseKey: "createBoard",
  widget: "task-card",
});
