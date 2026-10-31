import {
  bigint,
  boolean,
  customType,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Postgres's binary type: Yjs changes are bytes (Drizzle has no built-in column for it)
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
  fromDriver: (value) => new Uint8Array(value),
});

export const rooms = pgTable("rooms", {
  id: text("id").primaryKey(), // the room name from its link
  // who created it; deleting the account deletes their rooms. Null for rooms from before owners
  ownerId: text("owner_id").references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("Untitled room"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastEditedAt: timestamp("last_edited_at", { withTimezone: true }).notNull().defaultNow(),
  // the whole document at one point, so loading needs only the changes after it
  snapshot: bytea("snapshot"),
  snapshotUpTo: bigint("snapshot_up_to", { mode: "number" }), // id of the last change it includes
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
    author: text("author"), // the name shown at the time; null for the server's own changes
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }), // members only
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("room_updates_room_id_id_idx").on(t.roomId, t.id)],
);

// ---------- accounts: Better Auth's tables (field names are what it expects) ----------

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// one row per signed-in browser: the cookie holds the token
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

// how a user signs in: "credential" (password hash here) or a provider like GitHub
export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    password: text("password"), // a slow one-way hash, never the password itself
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);

// one-time codes, e.g. for password reset links
export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

// ---------- sharing ----------

// a share link: whoever holds the code gets in with its role (until it's revoked, 5.3)
export const roomLinks = pgTable(
  "room_links",
  {
    code: text("code").primaryKey(), // the secret in /join/<code>: 128 random bits
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["editor", "viewer"] }).notNull(),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("room_links_room_id_idx").on(t.roomId)],
);

// signed-in people who joined a room through a link: the plain address works for them after
export const roomMembers = pgTable(
  "room_members",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["editor", "viewer"] }).notNull(),
    linkCode: text("link_code").references(() => roomLinks.code, { onDelete: "cascade" }), // how
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.roomId, t.userId] }),
    index("room_members_user_id_idx").on(t.userId),
  ],
);
