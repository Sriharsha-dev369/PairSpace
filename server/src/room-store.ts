import { asc, eq } from "drizzle-orm";
import * as Y from "yjs";
import { connect, DATABASE_URL } from "./db";
import { rooms, roomUpdates } from "./schema";
import type { RoomStore, StoredChange } from "./sync-server";

export interface HistoryEntry extends StoredChange {
  at: Date;
}

export interface PostgresRoomStore extends RoomStore {
  history(room: string): Promise<HistoryEntry[]>; // every change, oldest first (replay, M8)
  close(): Promise<void>;
}

export function openRoomStore(url = DATABASE_URL): PostgresRoomStore {
  const { db, pool } = connect(url);

  return {
    async load(room) {
      const rows = await db
        .select({ data: roomUpdates.data })
        .from(roomUpdates)
        .where(eq(roomUpdates.roomId, room))
        .orderBy(asc(roomUpdates.id));
      // Yjs changes apply in any order and more than once, so merging them all rebuilds the doc
      return rows.length === 0 ? null : Y.mergeUpdates(rows.map((r) => r.data));
    },

    async append(room, changes) {
      if (changes.length === 0) return;
      await db.transaction(async (tx) => {
        await tx.insert(rooms).values({ id: room }).onConflictDoNothing();
        await tx
          .insert(roomUpdates)
          .values(changes.map((c) => ({ roomId: room, data: c.update, author: c.author })));
      });
    },

    async history(room) {
      const rows = await db
        .select()
        .from(roomUpdates)
        .where(eq(roomUpdates.roomId, room))
        .orderBy(asc(roomUpdates.id));
      return rows.map((r) => ({ update: r.data, author: r.author, at: r.createdAt }));
    },

    close: () => pool.end(),
  };
}
