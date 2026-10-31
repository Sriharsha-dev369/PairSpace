import { Loader2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { authClient } from "../auth/client";
import { safeNext } from "../auth/next";
import { Card, FullScreen } from "../ui/FullScreen";
import { LogoMark } from "../ui/Logo";

type Mode = "sign-in" | "sign-up";

const COPY = {
  "sign-in": {
    title: "Sign in",
    lead: "Welcome back. Your rooms are where you left them.",
    submit: "Sign in",
    switchText: "No account yet?",
    switchLink: "Create an account",
  },
  "sign-up": {
    title: "Create an account",
    lead: "An account lets you start rooms. Invited people join without one.",
    submit: "Create account",
    switchText: "Already have an account?",
    switchLink: "Sign in",
  },
} as const;

// what to tell the person, from Better Auth's error
function messageFor(mode: Mode, error: { status: number; code?: string; message?: string }) {
  if (mode === "sign-in" && error.status === 401) return "Wrong email or password.";
  if (error.code?.startsWith("USER_ALREADY_EXISTS")) {
    return "An account with this email already exists. Sign in instead.";
  }
  if (error.code === "PASSWORD_TOO_SHORT") return "Use at least 8 characters for your password.";
  return error.message ?? "Something went wrong. Please try again.";
}

const FIELD =
  "h-10 w-full rounded-lg border border-line bg-raised px-3 text-sm text-fg outline-none transition placeholder:text-faint focus:border-accent/60 focus:ring-2 focus:ring-accent/20";

export function AuthPage({ mode }: { mode: Mode }) {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = COPY[mode];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setBusy(true);
    setError(null);
    const { error } =
      mode === "sign-up"
        ? await authClient.signUp.email({ name: String(form.get("name")).trim(), email, password })
        : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (error) setError(messageFor(mode, error));
    else navigate(next, { replace: true });
  }

  const other = mode === "sign-in" ? "/sign-up" : "/sign-in";
  return (
    <FullScreen>
      <LogoMark className="mb-6 h-10 w-10" />
      <Card>
        <h1 className="text-lg font-semibold tracking-tight">{copy.title}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{copy.lead}</p>

        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          {mode === "sign-up" && (
            <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
              Name
              <input name="name" required maxLength={64} autoComplete="name" className={FIELD} />
            </label>
          )}
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Email
            <input name="email" type="email" required autoComplete="email" className={FIELD} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Password
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
              placeholder={mode === "sign-up" ? "At least 8 characters" : undefined}
              className={FIELD}
            />
          </label>

          {error && (
            <p role="alert" className="rounded-lg bg-red-400/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 flex h-10 items-center justify-center gap-2 rounded-lg bg-accent text-sm font-semibold text-canvas transition hover:brightness-110 active:scale-[0.99] disabled:opacity-70"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            {copy.submit}
          </button>
        </form>
      </Card>
      <p className="mt-5 text-xs text-muted">
        {copy.switchText}{" "}
        <Link
          to={`${other}?next=${encodeURIComponent(next)}`}
          className="font-medium text-fg underline-offset-4 hover:underline"
        >
          {copy.switchLink}
        </Link>
      </p>
    </FullScreen>
  );
}
