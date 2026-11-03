import type { LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { useSignInHere } from "../auth/next";
import { Card, FullScreen } from "./FullScreen";
import { usePageTitle } from "./usePageTitle";

const WAY_ON =
  "mt-6 inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-canvas transition hover:brightness-110";

// a dead end, with the way on: members back to their rooms, guests to sign in (and back here),
// unless the page gives its own (a link, or a button such as Reload)
export function Notice({
  icon: Icon,
  title,
  body,
  isMember,
  way,
  pageTitle = title,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  isMember: boolean;
  way?: { to: string; label: string } | { onClick: () => void; label: string };
  pageTitle?: string; // the tab's, when the heading is too long or too chatty for it
}) {
  const signIn = useSignInHere();
  usePageTitle(pageTitle);
  const on =
    way ?? (isMember ? { to: "/", label: "Back to your rooms" } : { to: signIn, label: "Sign in" });
  return (
    <FullScreen>
      <Card>
        <div className="text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-red-400/10 text-red-300">
            <Icon size={20} />
          </span>
          <h1 className="mt-5 text-base font-semibold">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
          {"to" in on ? (
            <Link to={on.to} className={WAY_ON}>
              {on.label}
            </Link>
          ) : (
            <button type="button" onClick={on.onClick} className={WAY_ON}>
              {on.label}
            </button>
          )}
        </div>
      </Card>
    </FullScreen>
  );
}
