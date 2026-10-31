import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import * as Y from "yjs";
import { connect, DATABASE_URL } from "./db";
import { rooms, roomUpdates } from "./schema";
import type { RoomStore, StoredChange } from "./sync-server";

export interface HistoryEntry extends StoredChange {
  at: Date;
}

export interface RoomSummary {
  id: string;
  title: string;
  createdAt: Date;
  lastEditedAt: Date;
}

export interface PostgresRoomStore extends RoomStore {
  // `state`: the room's first content, saved as its first change
  createRoom(
    id: string,
    room: { ownerId: string | null; title: string; state?: Uint8Array },
  ): Promise<void>;
  listRooms(ownerId: string): Promise<RoomSummary[]>; // most recently edited first
  renameRoom(id: string, ownerId: string, title: string): Promise<boolean>; // false: not theirs
  deleteRoom(id: string, ownerId: string): Promise<boolean>; // with its history; false: not theirs
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

    // never creates the room: a write still in flight when a room is deleted must fail, not
    // bring the room back
    async append(room, changes) {
      return db.transaction(async (tx) => {
        await tx.update(rooms).set({ lastEditedAt: sql`now()` }).where(eq(rooms.id, room));
        const written = await tx
          .insert(roomUpdates)
          .values(
            changes.map((c) => ({
              roomId: room,
              data: c.update,
              author: c.author,
              authorId: c.authorId,
            })),
          )
          .returning({ id: roomUpdates.id });
        return Math.max(...written.map((row) => row.id));
      });
    },

    async snapshot(room, state, upTo) {
      await db.update(rooms).set({ snapshot: state, snapshotUpTo: upTo }).where(eq(rooms.id, room));
    },

    async createRoom(id, { ownerId, title, state }) {
      await db.transaction(async (tx) => {
        await tx.insert(rooms).values({ id, ownerId, title });
        if (state) {
          await tx
            .insert(roomUpdates)
            .values({ roomId: id, data: state, author: null, authorId: null });
        }
      });
    },

    async listRooms(ownerId) {
      return db
        .select({
          id: rooms.id,
          title: rooms.title,
          createdAt: rooms.createdAt,
          lastEditedAt: rooms.lastEditedAt,
        })
        .from(rooms)
        .where(eq(rooms.ownerId, ownerId))
        .orderBy(desc(rooms.lastEditedAt), desc(rooms.createdAt));
    },

    async renameRoom(id, ownerId, title) {
      const renamed = await db
        .update(rooms)
        .set({ title })
        .where(and(eq(rooms.id, id), eq(rooms.ownerId, ownerId)))
        .returning({ id: rooms.id });
      return renamed.length > 0;
    },

    async deleteRoom(id, ownerId) {
      // its changes go with it (room_updates.room_id cascades)
      const deleted = await db
        .delete(rooms)
        .where(and(eq(rooms.id, id), eq(rooms.ownerId, ownerId)))
        .returning({ id: rooms.id });
      return deleted.length > 0;
    },

    async history(room) {
      const rows = await db
        .select()
        .from(roomUpdates)
        .where(eq(roomUpdates.roomId, room))
        .orderBy(asc(roomUpdates.id));
      return rows.map((r) => ({
        update: r.data,
        author: r.author,
        authorId: r.authorId,
        at: r.createdAt,
      }));
    },

    close: () => pool.end(),
  };
}
