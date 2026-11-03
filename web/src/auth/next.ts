import { useLocation } from "react-router";

// `next` comes from the URL, which anyone can craft: follow only a path on this site
export function safeNext(next: string | null): string {
  if (!next?.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}

// the sign-in page, coming back to this page afterwards (search keeps a share link's code)
export function useSignInHere(): string {
  const { pathname, search } = useLocation();
  return `/sign-in?next=${encodeURIComponent(pathname + search)}`;
}
