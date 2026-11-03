import type { ConnectionStatus } from "./session";

// how each connection state shows: words, and a coloured dot
export const STATUS: Record<ConnectionStatus, { label: string; dot: string }> = {
  connected: { label: "Connected", dot: "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/60" },
  connecting: { label: "Connecting…", dot: "bg-amber-400 animate-pulse" },
  reconnecting: { label: "Reconnecting…", dot: "bg-amber-400 animate-pulse" },
  offline: { label: "Offline", dot: "bg-red-400" },
  "too-large": { label: "Change too large to sync", dot: "bg-red-400" },
  deleted: { label: "Room deleted", dot: "bg-red-400" },
  revoked: { label: "Access turned off", dot: "bg-red-400" },
};
