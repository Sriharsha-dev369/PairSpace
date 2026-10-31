// `next` comes from the URL, which anyone can craft: follow only a path on this site
export function safeNext(next: string | null): string {
  if (!next?.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}
