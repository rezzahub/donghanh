import ListItems from "./list-items";
import AddItem from "./add-item";

export const operations = {
  "list-items": ListItems,
  "add-item": AddItem,
} as const;
