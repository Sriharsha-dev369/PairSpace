import { Loader2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
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

// GitHub's mark (Octicons, MIT): the standard face of a "sign in with GitHub" button
function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}

// whether the server has GitHub sign-in set up (it needs an OAuth App's id and secret)
function useGitHubSignIn() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/sign-in-methods")
      .then((response) => response.json())
      .then((methods: { github: boolean }) => active && setAvailable(methods.github))
      .catch(() => {}); // no button, and the form still works
    return () => {
      active = false;
    };
  }, []);
  return available;
}

const FIELD =
  "h-10 w-full rounded-lg border border-line bg-raised px-3 text-sm text-fg outline-none transition placeholder:text-faint focus:border-accent/60 focus:ring-2 focus:ring-accent/20";

export function AuthPage({ mode }: { mode: Mode }) {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const navigate = useNavigate();
  const github = useGitHubSignIn();
  // GitHub sends people back here with ?error= when they cancel or something fails
  const [error, setError] = useState<string | null>(
    params.get("error") ? "Signing in with GitHub didn't work. Please try again." : null,
  );
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

        {github && (
          <>
            <button
              type="button"
              onClick={() =>
                authClient.signIn.social({
                  provider: "github",
                  callbackURL: next,
                  errorCallbackURL: `/sign-in?next=${encodeURIComponent(next)}`,
                })
              }
              className="mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-line bg-raised text-sm font-medium text-fg transition hover:border-accent/40 hover:bg-raised/70"
            >
              <GitHubMark />
              Continue with GitHub
            </button>
            <div className="mt-6 flex items-center gap-3 text-[11px] uppercase tracking-wider text-faint">
              <span className="h-px flex-1 bg-line" />
              or
              <span className="h-px flex-1 bg-line" />
            </div>
          </>
        )}

        <form onSubmit={submit} className={`${github ? "mt-5" : "mt-6"} flex flex-col gap-4`}>
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
