import type { Awareness } from "y-protocols/awareness";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface User {
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
  synced: Promise<void>; // resolves once the server's copy of the room has been received
  status(): ConnectionStatus;
  people(): Person[];
  files(): RoomFile[];
  leave(): void;
}

interface JoinOptions {
  serverUrl: string;
  room: string;
  user: User;
}

export function joinRoom({ serverUrl, room, user }: JoinOptions): RoomSession {
  const doc = new Y.Doc();
  // no cross-tab BroadcastChannel: every edit goes through the server, where it can be observed
  const provider = new WebsocketProvider(serverUrl, room, doc, { disableBc: true });
  const { awareness } = provider;

  // colorLight is what CodeMirror's Yjs binding uses to tint this person's selections
  awareness.setLocalStateField("user", { ...user, colorLight: `${user.color}33` });

  const synced = new Promise<void>((resolve) => {
    if (provider.synced) resolve();
    else provider.once("sync", () => resolve());
  });

  return {
    doc,
    awareness,
    synced,
    people: () =>
      [...awareness.getStates().entries()]
        .filter(([, state]) => state.user)
        .map(([clientId, state]) => ({
          name: state.user.name,
          color: state.user.color,
          isMe: clientId === doc.clientID,
        })),
    status: () => {
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
