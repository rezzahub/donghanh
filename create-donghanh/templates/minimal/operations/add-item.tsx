/** @jsxImportSource @donghanh/core */
import { Action, Brief, Display, registerOperation } from "@donghanh/core";
import type { OperationProps } from "@donghanh/core";

interface Data {
  items: { id: number; name: string; created_at: string }[];
}

function AddItem({ data }: OperationProps<Data>) {
  return (
    <Brief>
      Item added! You now have {data.items.length} item(s).
      <Display data={data.items} />
      <Action operation="add-item" label="Add another" />
      <Action operation="list-items" label="View all" />
    </Brief>
  );
}

export default registerOperation(AddItem, {
  id: "add-item",
  type: "mutation",
  description: "Add a new item",
  instruction: "Add an item by name.",
  input: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", description: "Name of the item" },
    },
  },
  responseKey: "addItem",
});
