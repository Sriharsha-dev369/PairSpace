import { and, asc, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import * as Y from "yjs";
import { connect, DATABASE_URL } from "./db";
import { newLinkCode } from "./room-id";
import { roomLinks, roomMembers, rooms, roomUpdates } from "./schema";
import type { RoomStore, StoredChange } from "./sync-server";

export interface HistoryEntry extends StoredChange {
  at: Date;
}

export type LinkRole = "editor" | "viewer";
export type Role = "owner" | LinkRole;

export interface RoomSummary {
  id: string;
  title: string;
  role: Role; // mine: owner, or what I joined it as
  createdAt: Date;
  lastEditedAt: Date;
}

export type Access = { title: string; role: Role } | "no-room" | "no-access";

export interface PostgresRoomStore extends RoomStore {
  // `state`: the room's first content, saved as its first change
  createRoom(
    id: string,
    room: { ownerId: string | null; title: string; state?: Uint8Array },
  ): Promise<void>;
  listRooms(userId: string): Promise<RoomSummary[]>; // mine and shared with me, latest edit first
  renameRoom(id: string, ownerId: string, title: string): Promise<boolean>; // false: not theirs
  deleteRoom(id: string, ownerId: string): Promise<boolean>; // with its history; false: not theirs
  history(room: string): Promise<HistoryEntry[]>; // every change, oldest first (replay, M8)
  // the room's active link for `role`, made if there's none; null if it isn't the owner's room
  shareLink(id: string, ownerId: string, role: LinkRole): Promise<string | null>;
  findLink(code: string): Promise<{ roomId: string; title: string; role: LinkRole } | null>;
  // who may enter: the owner, a member, a holder of an active link for this room
  access(id: string, who: { userId: string | null; linkCode: string | null }): Promise<Access>;
  addMember(id: string, userId: string, role: LinkRole, linkCode: string | null): Promise<void>;
  close(): Promise<void>;
}

// an active (not revoked) link with this code, for this room if given
const activeLink = (code: string, roomId?: string) =>
  and(
    eq(roomLinks.code, code),
    isNull(roomLinks.revokedAt),
    roomId === undefined ? undefined : eq(roomLinks.roomId, roomId),
  );

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

    async listRooms(userId) {
      return db
        .select({
          id: rooms.id,
          title: rooms.title,
          role: sql<Role>`case when ${rooms.ownerId} = ${userId} then 'owner' else ${roomMembers.role} end`,
          createdAt: rooms.createdAt,
          lastEditedAt: rooms.lastEditedAt,
        })
        .from(rooms)
        .leftJoin(
          roomMembers,
          and(eq(roomMembers.roomId, rooms.id), eq(roomMembers.userId, userId)),
        )
        .where(or(eq(rooms.ownerId, userId), eq(roomMembers.userId, userId)))
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

    async shareLink(id, ownerId, role) {
      const [room] = await db
        .select({ id: rooms.id })
        .from(rooms)
        .where(and(eq(rooms.id, id), eq(rooms.ownerId, ownerId)));
      if (!room) return null;
      const [existing] = await db
        .select({ code: roomLinks.code })
        .from(roomLinks)
        .where(
          and(eq(roomLinks.roomId, id), eq(roomLinks.role, role), isNull(roomLinks.revokedAt)),
        );
      if (existing) return existing.code;
      const code = newLinkCode();
      await db.insert(roomLinks).values({ code, roomId: id, role });
      return code;
    },

    async findLink(code) {
      const [link] = await db
        .select({ roomId: roomLinks.roomId, title: rooms.title, role: roomLinks.role })
        .from(roomLinks)
        .innerJoin(rooms, eq(rooms.id, roomLinks.roomId))
        .where(activeLink(code));
      return link ?? null;
    },

    async access(id, { userId, linkCode }) {
      const [room] = await db
        .select({ title: rooms.title, ownerId: rooms.ownerId })
        .from(rooms)
        .where(eq(rooms.id, id));
      if (!room) return "no-room";
      const { title } = room;
      if (room.ownerId === null) return { title, role: "editor" }; // from before owners: open
      if (userId !== null && room.ownerId === userId) return { title, role: "owner" };
      const roles: LinkRole[] = [];
      if (userId !== null) {
        const [member] = await db
          .select({ role: roomMembers.role })
          .from(roomMembers)
          .where(and(eq(roomMembers.roomId, id), eq(roomMembers.userId, userId)));
        if (member) roles.push(member.role);
      }
      if (linkCode !== null) {
        const [link] = await db
          .select({ role: roomLinks.role })
          .from(roomLinks)
          .where(activeLink(linkCode, id));
        if (link) roles.push(link.role);
      }
      if (roles.includes("editor")) return { title, role: "editor" };
      if (roles.includes("viewer")) return { title, role: "viewer" };
      return "no-access";
    },

    async addMember(id, userId, role, linkCode) {
      await db
        .insert(roomMembers)
        .values({ roomId: id, userId, role, linkCode })
        .onConflictDoUpdate({
          target: [roomMembers.roomId, roomMembers.userId],
          set: { role, linkCode },
        });
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
