import type { LucideIcon } from "lucide-react";
import { Link, useLocation } from "react-router";
import { Card, FullScreen } from "./FullScreen";

// a dead end, with the way on: members back to their rooms, guests to sign in (and back here)
export function Notice({
  icon: Icon,
  title,
  body,
  isMember,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  isMember: boolean;
}) {
  const { pathname, search } = useLocation();
  return (
    <FullScreen>
      <Card>
        <div className="text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-red-400/10 text-red-300">
            <Icon size={20} />
          </span>
          <h1 className="mt-5 text-base font-semibold">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
          <Link
            to={isMember ? "/" : `/sign-in?next=${encodeURIComponent(pathname + search)}`}
            className="mt-6 inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-canvas transition hover:brightness-110"
          >
            {isMember ? "Back to your rooms" : "Sign in"}
          </Link>
        </div>
      </Card>
    </FullScreen>
  );
}
