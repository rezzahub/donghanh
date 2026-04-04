function uid() {
  return crypto.randomUUID().slice(0, 8);
}

export async function listBoards(db: D1Database, userId: string) {
  const { results } = await db
    .prepare(
      `SELECT b.*, COUNT(DISTINCT c.id) as card_count, COUNT(DISTINCT m.id) as member_count
       FROM boards b
       LEFT JOIN cards c ON c.board_id = b.id
       LEFT JOIN members m ON m.board_id = b.id
       GROUP BY b.id ORDER BY b.created_at DESC`,
    )
    .all();
  return { boards: results };
}

export async function boardDetail(db: D1Database, boardId: string) {
  const board = await db.prepare("SELECT * FROM boards WHERE id = ?").bind(boardId).first();
  if (!board) throw new Error("Board not found");

  const { results: columns } = await db
    .prepare("SELECT * FROM columns WHERE board_id = ? ORDER BY position")
    .bind(boardId)
    .all();

  const { results: cards } = await db
    .prepare("SELECT * FROM cards WHERE board_id = ? ORDER BY position")
    .bind(boardId)
    .all();

  const { results: members } = await db
    .prepare("SELECT * FROM members WHERE board_id = ? ORDER BY added_at")
    .bind(boardId)
    .all();

  // Group cards by column
  const columnMap = columns.map((col: any) => ({
    ...col,
    cards: cards.filter((c: any) => c.column_id === col.id),
  }));

  return { board, columns: columnMap, members };
}

export async function createBoard(db: D1Database, name: string, userId: string) {
  const id = uid();
  await db.prepare("INSERT INTO boards (id, name, created_by) VALUES (?, ?, ?)").bind(id, name, userId).run();
  // Default columns
  const cols = ["To Do", "In Progress", "Done"];
  for (let i = 0; i < cols.length; i++) {
    await db.prepare("INSERT INTO columns (id, board_id, name, position) VALUES (?, ?, ?, ?)").bind(uid(), id, cols[i], i).run();
  }
  // Add creator as member
  await db.prepare("INSERT INTO members (id, board_id, name, user_id) VALUES (?, ?, ?, ?)").bind(uid(), id, "You", userId).run();
  return boardDetail(db, id);
}

export async function addCard(db: D1Database, boardId: string, columnId: string, title: string) {
  const id = uid();
  const pos = await db.prepare("SELECT COUNT(*) as c FROM cards WHERE column_id = ?").bind(columnId).first<{ c: number }>();
  await db.prepare("INSERT INTO cards (id, column_id, board_id, title, position) VALUES (?, ?, ?, ?, ?)").bind(id, columnId, boardId, title, pos?.c ?? 0).run();
  return boardDetail(db, boardId);
}

export async function moveCard(db: D1Database, cardId: string, toColumnId: string) {
  const card = await db.prepare("SELECT board_id FROM cards WHERE id = ?").bind(cardId).first<{ board_id: string }>();
  if (!card) throw new Error("Card not found");
  const pos = await db.prepare("SELECT COUNT(*) as c FROM cards WHERE column_id = ?").bind(toColumnId).first<{ c: number }>();
  await db.prepare("UPDATE cards SET column_id = ?, position = ? WHERE id = ?").bind(toColumnId, pos?.c ?? 0, cardId).run();
  return boardDetail(db, card.board_id);
}

export async function addMember(db: D1Database, boardId: string, name: string) {
  const id = uid();
  await db.prepare("INSERT INTO members (id, board_id, name) VALUES (?, ?, ?)").bind(id, boardId, name).run();
  return boardDetail(db, boardId);
}
