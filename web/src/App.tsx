import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import { AuthPage } from "./pages/AuthPage";
import { HomePage } from "./pages/HomePage";
import { JoinPage } from "./pages/JoinPage";
import { RoomPage } from "./pages/RoomPage";

// sonner reads its colours from these variables (as shadcn/ui's wrapper does); ours match the app
const toastTheme = {
  "--normal-bg": "var(--color-raised)",
  "--normal-border": "var(--color-line)",
  "--normal-text": "var(--color-fg)",
  fontFamily: "var(--font-sans)",
} as CSSProperties;

// what the server said (the dashboard's room list), cached and refetched after changes
const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/sign-in" element={<AuthPage mode="sign-in" />} />
          <Route path="/sign-up" element={<AuthPage mode="sign-up" />} />
          <Route path="/r/:roomId" element={<RoomPage />} />
          <Route path="/join/:code" element={<JoinPage />} />
        </Routes>
        <Toaster theme="dark" position="bottom-right" style={toastTheme} />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
