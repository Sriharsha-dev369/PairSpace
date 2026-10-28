import type { Awareness } from "y-protocols/awareness";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

// too-large: the server refused one of our changes as over its size limit, so we stopped retrying
export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "too-large";

export interface User {
  name: string;
  color: string;
}

export interface Person extends User {
  id: number; // unique per connected client, even if two guests share a name
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
  synced: Promise<void>; // resolves once the server's copy arrives; rejects if the room is refused
  status(): ConnectionStatus;
  subscribe(listener: () => void): () => void; // called when status, people or files may have changed
  people(): Person[];
  files(): RoomFile[];
  leave(): void;
}

const MESSAGE_TOO_BIG = 1009; // standard close code; every retry would re-send the same change

// y-websocket's default (not exported): 4400-4499 means the server refused us for good
const isPermanentRefusal = (code: number) => code >= 4400 && code < 4500;

interface JoinOptions {
  serverUrl: string;
  room: string;
  user: User;
}

export function joinRoom({ serverUrl, room, user }: JoinOptions): RoomSession {
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
  provider.on("status", notify);
  awareness.on("change", notify);
  let tooLarge = false;
  provider.on("closed", ({ code }) => {
    tooLarge = code === MESSAGE_TOO_BIG;
    notify();
  });

  const synced = new Promise<void>((resolve, reject) => {
    if (provider.synced) resolve();
    else provider.once("sync", () => resolve());
    // "closed" means the server refused us for good (e.g. a bad room name); it won't retry
    provider.once("closed", ({ reason }) =>
      reject(new Error(`the server refused this room: ${reason}`)),
    );
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
    people: () =>
      [...awareness.getStates().entries()]
        .filter(([, state]) => state.user)
        .map(([clientId, state]) => ({
          id: clientId,
          name: state.user.name,
          color: state.user.color,
          isMe: clientId === doc.clientID,
        })),
    status: () => {
      if (tooLarge) return "too-large";
      if (provider.wsconnected) return "connected";
      return provider.wsconnecting ? "connecting" : "disconnected";
    },
    files: () =>
      [...doc.getMap<Y.Map<unknown>>("files").entries()].map(([id, file]) => ({
        id,
        name: file.get("name") as string,
        content: file.get("content") as Y.Text,
      })),
    leave: () => provider.destroy(),
  };
}
