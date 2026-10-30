import type { CSSProperties } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import { RoomPage } from "./pages/RoomPage";
import { newRoomId } from "./room/room-id";

// sonner reads its colours from these variables (as shadcn/ui's wrapper does); ours match the app
const toastTheme = {
  "--normal-bg": "var(--color-raised)",
  "--normal-border": "var(--color-line)",
  "--normal-text": "var(--color-fg)",
  fontFamily: "var(--font-sans)",
} as CSSProperties;

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to={`/r/${newRoomId()}`} replace />} />
        <Route path="/r/:roomId" element={<RoomPage />} />
      </Routes>
      <Toaster theme="dark" position="bottom-right" style={toastTheme} />
    </BrowserRouter>
  );
}
