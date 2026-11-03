import { and, asc, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import * as Y from "yjs";
import { connect, DATABASE_URL, type Database } from "./db";
import { newLinkCode } from "./room-id";
import { roomLinks, roomMembers, rooms, roomUpdates, users } from "./schema";
import type { Role, RoomStore, StoredChange } from "./sync-server";

export interface HistoryEntry extends StoredChange {
  at: Date;
}

export type LinkRole = Exclude<Role, "owner">;

export interface RoomSummary {
  id: string;
  title: string;
  role: Role; // mine: owner, or what I joined it as
  createdAt: Date;
  lastEditedAt: Date;
}

// owner: the owner's name ("Alice invited you"); null for rooms from before owners. via: the share
// link this access depends on (turning it off ends the access); null if none
export type Access =
  | { title: string; owner: string | null; role: Role; via: string | null }
  | "no-room"
  | "no-access";

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
  // the room's active links; null if it isn't the owner's room
  listLinks(id: string, ownerId: string): Promise<{ code: string; role: LinkRole }[] | null>;
  // turns a link off, and removes the members it let in; false if it isn't the owner's room
  revokeLink(id: string, ownerId: string, code: string): Promise<boolean>;
  close(): Promise<void>;
}

const ownedBy = (id: string, ownerId: string) => and(eq(rooms.id, id), eq(rooms.ownerId, ownerId));

// whether `id` is a room owned by `ownerId` (in a transaction too: it has the same select)
async function owns(db: Pick<Database, "select">, id: string, ownerId: string) {
  return (await db.select({ id: rooms.id }).from(rooms).where(ownedBy(id, ownerId))).length > 0;
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

  // the access a membership gives: it depends on the link it came through, if any
  const membership = (id: string, userId: string) =>
    db
      .select({ role: roomMembers.role, via: roomMembers.linkCode })
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, id), eq(roomMembers.userId, userId)));

  // the access an active link for this room gives
  const linkAccess = async (id: string, code: string) =>
    (await db.select({ role: roomLinks.role }).from(roomLinks).where(activeLink(code, id))).map(
      ({ role }) => ({ role, via: code }),
    );

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
        .where(ownedBy(id, ownerId))
        .returning({ id: rooms.id });
      return renamed.length > 0;
    },

    async deleteRoom(id, ownerId) {
      // its changes go with it (room_updates.room_id cascades)
      const deleted = await db
        .delete(rooms)
        .where(ownedBy(id, ownerId))
        .returning({ id: rooms.id });
      return deleted.length > 0;
    },

    async shareLink(id, ownerId, role) {
      if (!(await owns(db, id, ownerId))) return null;
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
        .select({ title: rooms.title, ownerId: rooms.ownerId, owner: users.name })
        .from(rooms)
        .leftJoin(users, eq(users.id, rooms.ownerId))
        .where(eq(rooms.id, id));
      if (!room) return "no-room";
      const { title, owner } = room;
      if (room.ownerId === null) return { title, owner, role: "editor", via: null }; // before owners: open
      if (userId !== null && room.ownerId === userId) {
        return { title, owner, role: "owner", via: null };
      }
      const grants = [
        ...(userId === null ? [] : await membership(id, userId)),
        ...(linkCode === null ? [] : await linkAccess(id, linkCode)),
      ];
      // the strongest grant wins: editing over viewing
      const best = grants.find((g) => g.role === "editor") ?? grants[0];
      return best ? { title, owner, ...best } : "no-access";
    },

    async listLinks(id, ownerId) {
      if (!(await owns(db, id, ownerId))) return null;
      return db
        .select({ code: roomLinks.code, role: roomLinks.role })
        .from(roomLinks)
        .where(and(eq(roomLinks.roomId, id), isNull(roomLinks.revokedAt)))
        .orderBy(asc(roomLinks.createdAt));
    },

    async revokeLink(id, ownerId, code) {
      return db.transaction(async (tx) => {
        if (!(await owns(tx, id, ownerId))) return false;
        await tx
          .update(roomLinks)
          .set({ revokedAt: sql`now()` })
          .where(and(eq(roomLinks.code, code), eq(roomLinks.roomId, id)));
        await tx
          .delete(roomMembers)
          .where(and(eq(roomMembers.roomId, id), eq(roomMembers.linkCode, code)));
        return true;
      });
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
