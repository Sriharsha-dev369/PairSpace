import type { Awareness } from "y-protocols/awareness";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface User {
  name: string;
  color: string;
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
  files(): RoomFile[];
  leave(): void;
}

interface JoinOptions {
  serverUrl: string;
  room: string;
  user: User;
}

export function joinRoom({ serverUrl, room }: JoinOptions): RoomSession {
  const doc = new Y.Doc();
  // no cross-tab BroadcastChannel: every edit goes through the server, where it can be observed
  const provider = new WebsocketProvider(serverUrl, room, doc, { disableBc: true });

  const synced = new Promise<void>((resolve) => {
    if (provider.synced) resolve();
    else provider.once("sync", () => resolve());
  });

  return {
    doc,
    awareness: provider.awareness,
    synced,
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
