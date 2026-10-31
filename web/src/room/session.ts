import type { Awareness } from "y-protocols/awareness";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

// reconnecting: we were connected and the provider is retrying on its own
// offline: the browser says there's no network, so we stopped trying until it's back
// too-large: the server refused one of our changes as over its size limit, so we stopped retrying
export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "too-large";

export interface User {
  id: string; // the same in every tab of one person: a member's user id, or a guest's stored id
  name: string;
  color: string;
}

export interface Person extends User {
  isMe: boolean;
}

export interface RoomFile {
  id: string;
  name: string;
  content: Y.Text;
}

export interface RoomSession {
  doc: Y.Doc;
  awareness: Awareness;
  synced: Promise<void>; // resolves once the server's copy arrives; rejects with RoomRefused
  status(): ConnectionStatus;
  unsyncedEdits(): boolean; // edits made while disconnected that haven't been sent yet
  subscribe(listener: () => void): () => void; // called when status, people or files may have changed
  people(): Person[];
  files(): RoomFile[];
  leave(): void;
}

// the server turned this room down for good; `code` says why
export class RoomRefused extends Error {
  readonly code: number; // 4404: doesn't exist (only members create rooms); 4400: invalid name

  constructor(code: number, reason: string) {
    super(`the server refused this room: ${reason}`);
    this.code = code;
  }
}

export const ROOM_NOT_FOUND = 4404;

const MESSAGE_TOO_BIG = 1009; // standard close code; every retry would re-send the same change

// y-websocket's default (not exported): 4400-4499 means the server refused us for good
const isPermanentRefusal = (code: number) => code >= 4400 && code < 4500;

interface JoinOptions {
  serverUrl: string;
  room: string;
  user: User;
  networkEvents?: EventTarget; // fires "online" and "offline": the browser's window, or a test's
}

export function joinRoom({
  serverUrl,
  room,
  user,
  networkEvents = typeof window === "undefined" ? undefined : window,
}: JoinOptions): RoomSession {
  const doc = new Y.Doc();
  // no cross-tab BroadcastChannel: every edit goes through the server, where it can be observed
  const provider = new WebsocketProvider(serverUrl, room, doc, {
    disableBc: true,
    shouldReconnect: ({ code }) => code !== MESSAGE_TOO_BIG && !isPermanentRefusal(code),
  });
  const { awareness } = provider;

  // colorLight is what CodeMirror's Yjs binding uses to tint this person's selections
  awareness.setLocalStateField("user", { ...user, colorLight: `${user.color}33` });

  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  let wasConnected = false;
  provider.on("status", ({ status }) => {
    if (status === "connected") wasConnected = true;
    notify();
  });
  awareness.on("change", notify);
  let tooLarge = false;
  provider.on("closed", ({ code }) => {
    tooLarge = code === MESSAGE_TOO_BIG;
    notify();
  });

  // edits made while disconnected exist only in this tab until the next sync sends them
  let unsynced = false;
  doc.on("update", (_update, origin) => {
    if (origin === provider || provider.wsconnected || unsynced) return;
    unsynced = true;
    notify();
  });
  provider.on("sync", (isSynced) => {
    if (!isSynced || !unsynced) return;
    // our server sends its step 1 first, so by now our reply carrying those edits has gone out
    unsynced = false;
    notify();
  });

  // a dead wifi can leave the socket looking open for 30s, so believe the browser instead
  let offline = false;
  const goOffline = () => {
    offline = true;
    provider.disconnect();
    notify();
  };
  const goOnline = () => {
    offline = false;
    provider.connect(); // now, rather than after the provider's backoff
    notify();
  };
  networkEvents?.addEventListener("offline", goOffline);
  networkEvents?.addEventListener("online", goOnline);

  const synced = new Promise<void>((resolve, reject) => {
    if (provider.synced) resolve();
    else provider.once("sync", () => resolve());
    // "closed" means the server refused us for good (e.g. a bad room name); it won't retry
    provider.once("closed", ({ code, reason }) => reject(new RoomRefused(code, reason)));
  });
  synced.catch(() => {}); // a caller that never awaits synced shouldn't see an unhandled rejection

  return {
    doc,
    awareness,
    synced,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // one entry per person, however many tabs they have open
    people: () => {
      const byPerson = new Map<string, Person>();
      for (const [clientId, state] of awareness.getStates()) {
        if (!state.user) continue;
        // a client without a person id (an older version) counts per tab
        const id = typeof state.user.id === "string" ? state.user.id : `tab-${clientId}`;
        if (byPerson.has(id)) continue;
        const { name, color } = state.user;
        byPerson.set(id, { id, name, color, isMe: id === user.id });
      }
      return [...byPerson.values()];
    },
    status: () => {
      if (tooLarge) return "too-large";
      if (offline) return "offline";
      if (provider.wsconnected) return "connected";
      // one steady state across retries: the provider says nothing when a retry fails
      return wasConnected ? "reconnecting" : "connecting";
    },
    unsyncedEdits: () => unsynced,
    files: () =>
      [...doc.getMap<Y.Map<unknown>>("files").entries()].map(([id, file]) => ({
        id,
        name: file.get("name") as string,
        content: file.get("content") as Y.Text,
      })),
    leave: () => {
      networkEvents?.removeEventListener("offline", goOffline);
      networkEvents?.removeEventListener("online", goOnline);
      provider.destroy();
    },
  };
}
