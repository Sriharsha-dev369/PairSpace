import { bigint, customType, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Postgres's binary type: Yjs changes are bytes (Drizzle has no built-in column for it)
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
  fromDriver: (value) => new Uint8Array(value),
});

export const rooms = pgTable("rooms", {
  id: text("id").primaryKey(), // the room name from its link
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// every change ever made, never edited or deleted: replay (M8) is built on it
export const roomUpdates = pgTable(
  "room_updates",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    data: bytea("data").notNull(),
    author: text("author"), // who made it, by display name; null for the server's own (M4: user id)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("room_updates_room_id_id_idx").on(t.roomId, t.id)],
);
