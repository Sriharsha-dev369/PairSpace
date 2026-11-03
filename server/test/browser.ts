// What a browser does against the real app (startApp): sign up, then send its session cookie
// with every request and WebSocket. Shared by the test files that run the whole app.

import { WebSocket } from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import type { App } from "../src/app";

export const WEB_ORIGIN = "http://localhost:5173";

// the cookies a response set, as the browser sends them back
export const cookiesFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

export interface Member {
  id: string;
  cookie: string; // what the browser sends back after signing up
}

// a new member, signed up through the accounts API with a fresh email
export async function signUp(app: App, name = "Alice"): Promise<Member> {
  const response = await fetch(`http://localhost:${app.port}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({
      name,
      email: `${crypto.randomUUID()}@example.com`,
      password: "correct horse battery",
    }),
  });
  const { user } = await response.json();
  return { id: user.id, cookie: cookiesFrom(response) };
}

// who's connecting: a member's cookie and/or a share link's code
interface Visitor {
  cookie?: string;
  link?: string;
}

// a Yjs client in the room, as the browser runs it; the caller destroys it
export function openRoom(app: App, room: string, { cookie, link }: Visitor): WebsocketProvider {
  // browsers send cookies with the WebSocket request by themselves; in Node we add them
  class BrowserWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: cookie ? { cookie } : {} });
    }
  }
  return new WebsocketProvider(`ws://localhost:${app.port}`, room, new Y.Doc(), {
    disableBc: true,
    maxBackoffTime: 100,
    WebSocketPolyfill: BrowserWebSocket as unknown as typeof globalThis.WebSocket,
    params: link ? { link } : {},
  });
}

// a plain connection: `admitted` once the server starts talking, `closed` with its close code
export function connect(app: App, room: string, { cookie, link }: Visitor = {}) {
  const query = link ? `?link=${encodeURIComponent(link)}` : "";
  const socket = new WebSocket(`ws://localhost:${app.port}/${room}${query}`, {
    headers: cookie ? { cookie } : {},
  });
  return {
    socket,
    admitted: new Promise((resolve) => socket.once("message", resolve)),
    closed: new Promise<number>((resolve) => socket.on("close", (code) => resolve(code))),
  };
}
