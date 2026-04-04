import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ── App tables ──

export const boards = sqliteTable("boards", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").default("(datetime('now'))"),
});

export const columns = sqliteTable("columns", {
  id: text("id").primaryKey(),
  boardId: text("board_id")
    .notNull()
    .references(() => boards.id),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
});

export const cards = sqliteTable("cards", {
  id: text("id").primaryKey(),
  columnId: text("column_id")
    .notNull()
    .references(() => columns.id),
  boardId: text("board_id")
    .notNull()
    .references(() => boards.id),
  title: text("title").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").default("(datetime('now'))"),
});

export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  boardId: text("board_id")
    .notNull()
    .references(() => boards.id),
  name: text("name").notNull(),
  userId: text("user_id"),
  addedAt: text("added_at").default("(datetime('now'))"),
});

// ── OAuth codes ──

export const oauthCodes = sqliteTable("oauth_codes", {
  code: text("code").primaryKey(),
  userId: text("user_id").notNull(),
  sessionToken: text("session_token").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
