import { Eye, EyeOff, Loader2 } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { authClient } from "../auth/client";
import { safeNext } from "../auth/next";
import { CursorFlag } from "../ui/CursorFlag";
import { Logo } from "../ui/Logo";

type Mode = "sign-in" | "sign-up";

const COPY = {
  "sign-in": {
    title: "Sign in to PairSpace",
    lead: "Welcome back. Your rooms are where you left them.",
    submit: "Sign in",
    switchText: "No account yet?",
    switchLink: "Create an account",
  },
  "sign-up": {
    title: "Create your account",
    lead: "Start rooms and invite anyone with a link. People you invite don't need an account.",
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
  "h-11 w-full rounded-lg border border-line bg-raised px-3.5 text-sm text-fg outline-none transition placeholder:text-faint focus:border-accent/60 focus:ring-2 focus:ring-accent/20";
const LABEL = "flex flex-col gap-1.5 text-[13px] font-medium text-fg";

function PasswordField({ mode }: { mode: Mode }) {
  const [shown, setShown] = useState(false);
  return (
    <label className={LABEL}>
      Password
      <span className="relative">
        <input
          name="password"
          type={shown ? "text" : "password"}
          required
          minLength={8}
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          placeholder={mode === "sign-up" ? "At least 8 characters" : undefined}
          className={`${FIELD} pr-11`}
        />
        <button
          type="button"
          onClick={() => setShown(!shown)}
          aria-label={shown ? "Hide password" : "Show password"}
          className="absolute top-1/2 right-1.5 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-faint transition hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
        >
          {shown ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </span>
    </label>
  );
}

// the right half: the product itself, people's cursors in shared code
function ProductPanel() {
  return (
    <aside className="relative hidden flex-col justify-center overflow-hidden border-l border-line bg-surface px-14 lg:flex">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_70%_20%,rgb(139_140_255/0.12),transparent)]"
      />
      <div className="relative max-w-md">
        <p className="font-display text-[2rem] leading-tight font-semibold tracking-[-0.03em]">
          Pair on code as if you were at the same desk.
        </p>
        <div className="mt-10 rounded-xl border border-line bg-canvas p-5 pt-7">
          <pre className="font-mono text-[13px] leading-7 text-muted">
            <span className="text-[#c792ea]">function</span>{" "}
            <span className="text-[#82aaff]">greet</span>(name) {"{"}
            {"\n"}
            {"  "}
            <span className="text-[#c792ea]">return</span>{" "}
            <span className="text-[#c3e88d]">
              `Hello, ${"{"}name{"}"}!`
            </span>
            <CursorFlag name="Grace" color="#34d399" />;{"\n"}
            {"}"}
            {"\n\n"}
            greet(<span className="text-[#c3e88d]">"everyone"</span>
            <CursorFlag name="Ada" color="#f472b6" />){"\n"}
          </pre>
        </div>
        <ul className="mt-10 space-y-3 text-sm text-muted">
          <li>Everyone's cursor, with their name on it</li>
          <li>Edits that survive a dropped connection</li>
          <li>Guests join with a link, no account needed</li>
        </ul>
      </div>
    </aside>
  );
}

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
  const firstField = useRef<HTMLInputElement>(null);
  useEffect(() => firstField.current?.focus(), []);
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
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col px-6 py-6 sm:px-12">
        <Link to="/" aria-label="PairSpace home" className="self-start">
          <Logo />
        </Link>

        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-14">
          <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-[-0.025em]">
            {copy.title}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{copy.lead}</p>

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
                className="mt-8 flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-line bg-raised text-sm font-medium text-fg transition hover:border-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <GitHubMark />
                Continue with GitHub
              </button>
              <div className="mt-6 flex items-center gap-3 text-xs text-faint">
                <span className="h-px flex-1 bg-line" />
                or
                <span className="h-px flex-1 bg-line" />
              </div>
            </>
          )}

          <form onSubmit={submit} className={`${github ? "mt-6" : "mt-8"} flex flex-col gap-4`}>
            {mode === "sign-up" && (
              <label className={LABEL}>
                Name
                <input
                  ref={firstField}
                  name="name"
                  required
                  maxLength={64}
                  autoComplete="name"
                  className={FIELD}
                />
              </label>
            )}
            <label className={LABEL}>
              Email
              <input
                ref={mode === "sign-in" ? firstField : undefined}
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                className={FIELD}
              />
            </label>
            <PasswordField mode={mode} />

            {error && (
              <p
                role="alert"
                className="rounded-lg bg-red-400/10 px-3 py-2.5 text-[13px] text-red-300"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-2 flex h-11 items-center justify-center gap-2 rounded-lg bg-accent text-sm font-semibold text-canvas transition hover:brightness-110 active:scale-[0.99] disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {busy && <Loader2 size={15} className="animate-spin" />}
              {copy.submit}
            </button>
          </form>

          <p className="mt-8 text-sm text-muted">
            {copy.switchText}{" "}
            <Link
              to={`${other}?next=${encodeURIComponent(next)}`}
              className="font-medium text-fg underline-offset-4 hover:underline"
            >
              {copy.switchLink}
            </Link>
          </p>
        </main>

        <p className="text-xs text-faint">© 2026 PairSpace</p>
      </div>
      <ProductPanel />
    </div>
  );
}
