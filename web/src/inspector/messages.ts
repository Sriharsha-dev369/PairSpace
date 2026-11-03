// What crosses the connection, for the sync inspector's message log: each message's kind, read
// from its first bytes (the y-websocket protocol, plus our pings), and its size.

import * as decoding from "lib0/decoding";

export type MessageKind =
  | "handshake-1" // sync step 1: "here's what I have" (a state vector)
  | "handshake-2" // sync step 2: "here's what you're missing"
  | "change" // one edit, sent as it happens
  | "presence" // names, colours, cursors (awareness)
  | "keepalive" // the server's "still here": presence that lists nobody
  | "ping"
  | "pong"
  | "other";

export interface Message {
  id: number; // its place in the log: 0 for the first
  at: number; // ms since 1970
  way: "out" | "in";
  kind: MessageKind;
  bytes: number;
  number?: number; // a ping's or pong's
}

export interface MessageLog {
  recent: Message[]; // oldest first
  sent: { count: number; bytes: number }; // every message, not just the recent ones
  received: { count: number; bytes: number };
}

const SYNC_KINDS: MessageKind[] = ["handshake-1", "handshake-2", "change"]; // by sync subtype 0-2
const KEEPALIVE = [1, 1, 0]; // presence (1), one byte of update, listing 0 people

function read(bytes: Uint8Array): Pick<Message, "kind" | "number"> {
  try {
    const decoder = decoding.createDecoder(bytes);
    switch (decoding.readVarUint(decoder)) {
      case 0:
        return { kind: SYNC_KINDS[decoding.readVarUint(decoder)] ?? "other" };
      case 1:
        return {
          kind:
            bytes.length === 3 && KEEPALIVE.every((b, i) => bytes[i] === b)
              ? "keepalive"
              : "presence",
        };
      case 100:
        return { kind: "ping", number: decoding.readVarUint(decoder) };
      case 101:
        return { kind: "pong", number: decoding.readVarUint(decoder) };
    }
  } catch {} // too short to say: "other"
  return { kind: "other" };
}

const LIMIT = 50;

export function messageLog(now = () => performance.timeOrigin + performance.now()) {
  let recent: Message[] = [];
  let next = 0;
  const sent = { count: 0, bytes: 0 };
  const received = { count: 0, bytes: 0 };
  const listeners = new Set<() => void>();

  return {
    record(way: Message["way"], data: unknown) {
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : ArrayBuffer.isView(data)
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : new Uint8Array();
      const total = way === "out" ? sent : received;
      total.count++;
      total.bytes += bytes.length;
      recent = [
        ...recent.slice(-(LIMIT - 1)),
        { id: next++, at: now(), way, bytes: bytes.length, ...read(bytes) },
      ];
      for (const listener of listeners) listener();
    },
    snapshot: (): MessageLog => ({ recent, sent: { ...sent }, received: { ...received } }),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
