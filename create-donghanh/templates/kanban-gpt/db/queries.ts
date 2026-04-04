import { eq, sql } from "drizzle-orm";
import { db } from ".";
import { boards, cards, columns, members } from "./schema";

function uid() {
  return crypto.randomUUID().slice(0, 8);
}

export async function listBoards(userId: string) {
  const rows = await db
    .select({
      id: boards.id,
      name: boards.name,
      createdAt: boards.createdAt,
      cardCount: sql<number>`(SELECT COUNT(*) FROM cards WHERE cards.board_id = boards.id)`,
      memberCount: sql<number>`(SELECT COUNT(*) FROM members WHERE members.board_id = boards.id)`,
    })
    .from(boards)
    .innerJoin(members, eq(members.boardId, boards.id))
    .where(eq(members.userId, userId))
    .groupBy(boards.id);
  return { boards: rows };
}

export async function boardDetail(boardId: string) {
  const board = await db
    .select()
    .from(boards)
    .where(eq(boards.id, boardId))
    .get();
  if (!board) throw new Error("Board not found");

  const cols = await db
    .select()
    .from(columns)
    .where(eq(columns.boardId, boardId))
    .orderBy(columns.position);

  const allCards = await db
    .select()
    .from(cards)
    .where(eq(cards.boardId, boardId))
    .orderBy(cards.position);

  const mems = await db
    .select()
    .from(members)
    .where(eq(members.boardId, boardId));

  const columnData = cols.map((col) => ({
    ...col,
    cards: allCards.filter((c) => c.columnId === col.id),
  }));

  return { board, columns: columnData, members: mems };
}

export async function createBoard(name: string, userId: string) {
  const id = uid();
  await db.insert(boards).values({ id, name, createdBy: userId });

  const defaultCols = ["To Do", "In Progress", "Done"];
  for (let i = 0; i < defaultCols.length; i++) {
    await db
      .insert(columns)
      .values({ id: uid(), boardId: id, name: defaultCols[i], position: i });
  }

  await db
    .insert(members)
    .values({ id: uid(), boardId: id, name: "You", userId });

  return boardDetail(id);
}

export async function addCard(
  boardId: string,
  columnId: string,
  title: string,
) {
  const id = uid();
  const count = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(cards)
    .where(eq(cards.columnId, columnId))
    .get();
  await db
    .insert(cards)
    .values({ id, columnId, boardId, title, position: count?.c ?? 0 });
  return boardDetail(boardId);
}

export async function moveCard(cardId: string, toColumnId: string) {
  const card = await db
    .select()
    .from(cards)
    .where(eq(cards.id, cardId))
    .get();
  if (!card) throw new Error("Card not found");

  const count = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(cards)
    .where(eq(cards.columnId, toColumnId))
    .get();

  await db
    .update(cards)
    .set({ columnId: toColumnId, position: count?.c ?? 0 })
    .where(eq(cards.id, cardId));

  return boardDetail(card.boardId);
}

export async function addMember(boardId: string, name: string) {
  const id = uid();
  await db.insert(members).values({ id, boardId, name });
  return boardDetail(boardId);
}
