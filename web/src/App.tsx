import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Toaster } from "sonner";
import { CrashPage } from "./pages/CrashPage";
import { pages } from "./pages/load";
import { Loading } from "./ui/FullScreen";

// sonner reads its colours from these variables (as shadcn/ui's wrapper does); ours match the app
const toastTheme = {
  "--normal-bg": "var(--color-raised)",
  "--normal-border": "var(--color-line)",
  "--normal-text": "var(--color-fg)",
  fontFamily: "var(--font-sans)",
} as CSSProperties;

// what the server said (the dashboard's room list), cached and refetched after changes
const queryClient = new QueryClient();

// a data router: it lets a page ask before you navigate away (a room with unsynced edits).
// Each page's code is downloaded when it's first visited, so the sign-in page never waits for
// the editor's. Any error below shows the crash page
const router = createBrowserRouter([
  {
    errorElement: <CrashPage />,
    HydrateFallback: Loading, // while the first page's code downloads
    children: [
      { path: "/", lazy: async () => ({ Component: (await pages.home()).HomePage }) },
      {
        path: "/sign-in",
        lazy: async () => {
          const { AuthPage } = await pages.auth();
          return { Component: () => <AuthPage mode="sign-in" /> };
        },
      },
      {
        path: "/sign-up",
        lazy: async () => {
          const { AuthPage } = await pages.auth();
          return { Component: () => <AuthPage mode="sign-up" /> };
        },
      },
      {
        path: "/r/:roomId",
        lazy: async () => ({ Component: (await pages.room()).RoomPage }),
      },
      {
        path: "/r/:roomId/replay",
        lazy: async () => ({ Component: (await pages.replay()).ReplayPage }),
      },
      {
        path: "/join/:code",
        lazy: async () => ({ Component: (await pages.join()).JoinPage }),
      },
      {
        path: "*",
        lazy: async () => ({ Component: (await pages.notFound()).NotFoundPage }),
      },
    ],
  },
]);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster theme="dark" position="bottom-right" style={toastTheme} />
    </QueryClientProvider>
  );
}
