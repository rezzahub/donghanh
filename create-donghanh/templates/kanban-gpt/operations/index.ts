import AddCard from "./add-card";
import AddMember from "./add-member";
import BoardDetail from "./board-detail";
import CreateBoard from "./create-board";
import ListBoards from "./list-boards";
import MoveCard from "./move-card";

export const operations = {
  "list-boards": ListBoards,
  "board-detail": BoardDetail,
  "create-board": CreateBoard,
  "add-card": AddCard,
  "move-card": MoveCard,
  "add-member": AddMember,
} as const;
