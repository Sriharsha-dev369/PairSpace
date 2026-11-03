import type { Awareness } from "y-protocols/awareness";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { NETWORKS, type Network, simulatedLink } from "../inspector/link";
import { type SyncProbe, watchSync } from "../inspector/probe";
import { listFiles, listTrash, type RoomFile, type TrashedFile } from "./files";

// reconnecting: we were connected and the provider is retrying on its own
// offline: the browser says there's no network, so we stopped trying until it's back
// too-large: the server refused one of our changes as over its size limit, so we stopped retrying
// deleted: the owner deleted the room while we were in it
// revoked: the owner turned off the link we came in through
export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "too-large"
  | "deleted"
  | "revoked";

export interface User {
  id: string; // the same in every tab of one person: a member's user id, or a guest's stored id
  name: string;
  color: string;
}

// how a person shows to everyone else: colorLight is what CodeMirror's Yjs binding tints their
// selections with
export const presence = <T extends { color: string }>(person: T) => ({
  ...person,
  colorLight: `${person.color}33`,
});

export interface Person extends User {
  isMe: boolean;
  fileId: string | null; // the file they have open
  network: Network; // a bad network they're simulating in the sync inspector, or "normal"
}

// the sync inspector's view of this session: measurements, and the network to simulate
export interface SessionSync extends Pick<SyncProbe, "stats" | "subscribe"> {
  network(): Network;
  setNetwork(network: Network): void;
}

export interface RoomSession {
  me: User;
  doc: Y.Doc;
  awareness: Awareness;
  synced: Promise<void>; // resolves once the server's copy arrives; rejects with RoomRefused
  status(): ConnectionStatus;
  unsyncedEdits(): boolean; // edits made while disconnected that haven't been sent yet
  subscribe(listener: () => void): () => void; // called when status, people or files may have changed
  people(): Person[];
  files(): RoomFile[]; // by name
  trash(): TrashedFile[]; // deleted files, newest first
  setOpenFile(id: string | null): void; // shows everyone which file I'm in
  sync: SessionSync;
  leave(): void;
}

// the person a tab's presence describes (null if it doesn't name one). Another browser wrote it,
// so only values the app knows are taken
function personIn(clientId: number, state: Record<string, unknown>, me: User): Person | null {
  const claimed = state.user as Partial<User> | undefined;
  if (!claimed) return null;
  // a client without a person id (an older version) counts per tab
  const id = typeof claimed.id === "string" ? claimed.id : `tab-${clientId}`;
  const fileId = typeof state.file === "string" ? state.file : null;
  const network = NETWORKS.find((known) => known === state.network) ?? "normal";
  return {
    id,
    name: claimed.name ?? "",
    color: claimed.color ?? "",
    isMe: id === me.id,
    fileId,
    network,
  };
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
export const NO_ACCESS = 4403;
const ROOM_DELETED = 4410;

const MESSAGE_TOO_BIG = 1009; // standard close code; every retry would re-send the same change

// y-websocket's default (not exported): 4400-4499 means the server refused us for good
const isPermanentRefusal = (code: number) => code >= 4400 && code < 4500;

interface JoinOptions {
  serverUrl: string;
  room: string;
  user: User;
  networkEvents?: EventTarget; // fires "online" and "offline": the browser's window, or a test's
  link?: string; // a share link's code: how someone without access of their own gets in
}

export function joinRoom({
  serverUrl,
  room,
  user,
  networkEvents = typeof window === "undefined" ? undefined : window,
  link,
}: JoinOptions): RoomSession {
  const doc = new Y.Doc();
  const simulated = simulatedLink(); // a normal network, until the sync inspector picks a bad one
  // no cross-tab BroadcastChannel: every edit goes through the server, where it can be observed
  const provider = new WebsocketProvider(serverUrl, room, doc, {
    WebSocketPolyfill: simulated.WebSocket,
    disableBc: true,
    params: link ? { link } : {}, // sent on every (re)connect: the server checks it each time
    shouldReconnect: ({ code }) => code !== MESSAGE_TOO_BIG && !isPermanentRefusal(code),
  });
  const { awareness } = provider;
  const probe = watchSync(provider);

  awareness.setLocalStateField("user", presence(user));

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
  // a file added, removed or renamed; not the text inside one, which changes on every keystroke
  doc.getMap("files").observeDeep((events) => {
    if (events.some((event) => !(event.target instanceof Y.Text))) notify();
  });
  let tooLarge = false;
  let deleted = false;
  let revoked = false;
  provider.on("closed", ({ code }) => {
    tooLarge = code === MESSAGE_TOO_BIG;
    deleted = code === ROOM_DELETED;
    revoked = code === NO_ACCESS && wasConnected; // before ever getting in, it's a refusal instead
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

  // a dead wifi can leave the socket looking open for 30s, so believe the browser instead. The
  // sync inspector's Offline works the same way; we're offline while either says so
  let browserOffline = false;
  let offline = false;
  const settle = () => {
    const now = browserOffline || simulated.network() === "offline";
    if (now) provider.disconnect();
    else if (offline) provider.connect(); // now, rather than after the provider's backoff
    offline = now;
    notify();
  };
  const goOffline = () => {
    browserOffline = true;
    settle();
  };
  const goOnline = () => {
    browserOffline = false;
    settle();
  };
  networkEvents?.addEventListener("offline", goOffline);
  networkEvents?.addEventListener("online", goOnline);
  simulated.subscribe(() => {
    awareness.setLocalStateField("network", simulated.network()); // others see it on my chip
    settle();
  });

  const synced = new Promise<void>((resolve, reject) => {
    if (provider.synced) resolve();
    else provider.once("sync", () => resolve());
    // "closed" means the server refused us for good (e.g. a bad room name); it won't retry
    provider.once("closed", ({ code, reason }) => reject(new RoomRefused(code, reason)));
  });
  synced.catch(() => {}); // a caller that never awaits synced shouldn't see an unhandled rejection

  return {
    me: user,
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
        const person = personIn(clientId, state, user);
        if (person && !byPerson.has(person.id)) byPerson.set(person.id, person);
      }
      return [...byPerson.values()];
    },
    status: () => {
      if (deleted) return "deleted";
      if (revoked) return "revoked";
      if (tooLarge) return "too-large";
      if (offline) return "offline";
      if (provider.wsconnected) return "connected";
      // one steady state across retries: the provider says nothing when a retry fails
      return wasConnected ? "reconnecting" : "connecting";
    },
    unsyncedEdits: () => unsynced,
    files: () => listFiles(doc),
    trash: () => listTrash(doc),
    setOpenFile: (id) => awareness.setLocalStateField("file", id),
    sync: {
      stats: probe.stats,
      subscribe: (listener) => {
        const stopProbe = probe.subscribe(listener);
        const stopLink = simulated.subscribe(listener);
        return () => {
          stopProbe();
          stopLink();
        };
      },
      network: simulated.network,
      setNetwork: simulated.set,
    },
    leave: () => {
      probe.stop();
      simulated.stop();
      networkEvents?.removeEventListener("offline", goOffline);
      networkEvents?.removeEventListener("online", goOnline);
      provider.destroy();
    },
  };
}
