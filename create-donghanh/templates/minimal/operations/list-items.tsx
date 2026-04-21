/** @jsxImportSource @donghanh/core */
import { Action, Brief, Display, registerOperation } from "@donghanh/core";
import type { OperationProps } from "@donghanh/core";

interface Data {
  items: { id: number; name: string; created_at: string }[];
}

function ListItems({ data }: OperationProps<Data>) {
  const count = data.items.length;
  return (
    <Brief>
      {count === 0 ? "No items yet." : `You have ${count} item(s).`}
      <Display data={data.items} />
      <Action operation="add-item" label="Add an item" />
    </Brief>
  );
}

export default registerOperation(ListItems, {
  id: "list-items",
  type: "query",
  description: "List all items",
  instruction: "Call this to see all items.",
  input: {},
  responseKey: "listItems",
  // auth: "none" marks this op as callable anonymously. Your /public/query/list-items
  // route will serve it without a Bearer token — handy for ChatGPT Actions whose
  // OpenAPI security is per-path. Trade-off: the op cannot read a user-specific
  // context. Switch to "optional" if you want both (anon by default, richer when linked).
  auth: "none",
});
