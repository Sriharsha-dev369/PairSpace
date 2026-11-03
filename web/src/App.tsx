import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Toaster } from "sonner";
import { AuthPage } from "./pages/AuthPage";
import { HomePage } from "./pages/HomePage";
import { JoinPage } from "./pages/JoinPage";
import { ReplayPage } from "./pages/ReplayPage";
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

// a data router: it lets a page ask before you navigate away (a room with unsynced edits)
const router = createBrowserRouter([
  { path: "/", element: <HomePage /> },
  { path: "/sign-in", element: <AuthPage mode="sign-in" /> },
  { path: "/sign-up", element: <AuthPage mode="sign-up" /> },
  { path: "/r/:roomId", element: <RoomPage /> },
  { path: "/r/:roomId/replay", element: <ReplayPage /> },
  { path: "/join/:code", element: <JoinPage /> },
]);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster theme="dark" position="bottom-right" style={toastTheme} />
    </QueryClientProvider>
  );
}
