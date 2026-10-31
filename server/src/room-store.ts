import { and, asc, eq, gt } from "drizzle-orm";
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
      const [saved] = await db
        .select({ snapshot: rooms.snapshot, upTo: rooms.snapshotUpTo })
        .from(rooms)
        .where(eq(rooms.id, room));
      if (!saved) return null;
      const later = await db
        .select({ data: roomUpdates.data })
        .from(roomUpdates)
        .where(and(eq(roomUpdates.roomId, room), gt(roomUpdates.id, saved.upTo ?? 0)))
        .orderBy(asc(roomUpdates.id));
      const parts = later.map((r) => r.data);
      if (saved.snapshot) parts.unshift(saved.snapshot);
      // Yjs changes apply in any order and more than once, so merging them rebuilds the doc
      return { state: Y.mergeUpdates(parts), replayed: later.length };
    },

    async append(room, changes) {
      return db.transaction(async (tx) => {
        await tx.insert(rooms).values({ id: room }).onConflictDoNothing();
        const written = await tx
          .insert(roomUpdates)
          .values(changes.map((c) => ({ roomId: room, data: c.update, author: c.author })))
          .returning({ id: roomUpdates.id });
        return Math.max(...written.map((row) => row.id));
      });
    },

    async snapshot(room, state, upTo) {
      await db.update(rooms).set({ snapshot: state, snapshotUpTo: upTo }).where(eq(rooms.id, room));
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
