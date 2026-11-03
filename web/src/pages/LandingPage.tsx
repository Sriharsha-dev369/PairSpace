import { Link2 } from "lucide-react";
import { lazy, type ReactNode, Suspense, useEffect } from "react";
import { Link } from "react-router";
import { CursorFlag } from "../ui/CursorFlag";
import { Logo } from "../ui/Logo";
import { usePageTitle } from "../ui/usePageTitle";
import { warm } from "./load";

const SOURCE_URL = "https://github.com/Sriharsha-dev369/PairSpace";

const PRIMARY =
  "inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-canvas transition hover:brightness-110 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const SECONDARY =
  "inline-flex h-10 items-center rounded-lg border border-line px-4 text-sm font-medium text-fg transition hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const NAV_LINK =
  "rounded-md px-2.5 py-1.5 text-sm text-muted transition hover:text-fg focus-visible:outline-2 focus-visible:outline-accent";

// the public face of PairSpace: what it is, the product working, and the ways in
// the demo is the real editor, the page's largest download: the words above it don't wait for it
const LiveDemo = lazy(async () => ({ default: (await import("../landing/LiveDemo")).LiveDemo }));

// where the demo will be, the same size, so nothing below it jumps when it arrives
function DemoFrame() {
  return <div className="h-[350px] rounded-2xl border border-line bg-canvas" />;
}

export function LandingPage() {
  usePageTitle(null);
  useEffect(() => warm("auth"), []);
  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgb(139_140_255/0.10),transparent)]">
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/80 backdrop-blur">
        <nav className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-5">
          <Link to="/" aria-label="PairSpace home" className="mr-4">
            <Logo />
          </Link>
          <a href="#features" className={`${NAV_LINK} hidden sm:inline-flex`}>
            Features
          </a>
          <a href="#how-it-works" className={`${NAV_LINK} hidden sm:inline-flex`}>
            How it works
          </a>
          <span className="ml-auto" />
          <Link to="/sign-in" className={NAV_LINK}>
            Sign in
          </Link>
          <Link to="/sign-up" className={`${PRIMARY} h-9`}>
            Start a room
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-5 pt-20 pb-16 sm:pt-28">
          <h1 className="max-w-3xl font-display text-[2.75rem] leading-[1.02] font-semibold tracking-[-0.025em] sm:text-7xl">
            Share a link. Code together, live.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
            PairSpace is a code editor in your browser that several people use at once. You see each
            other's cursors and edits as they happen, and nothing is lost when the Wi-Fi drops.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link to="/sign-up" className={PRIMARY}>
              Start a room
            </Link>
            <Link to="/sign-in" className={SECONDARY}>
              Sign in
            </Link>
            <span className="text-sm text-faint">People you invite don't need an account.</span>
          </div>
          <div className="mt-16">
            <Suspense fallback={<DemoFrame />}>
              <LiveDemo />
            </Suspense>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
          <h2 className="max-w-2xl font-display text-3xl leading-tight font-semibold tracking-[-0.02em] sm:text-4xl">
            Made for working on the same code at the same time
          </h2>
          <div className="mt-12 grid gap-x-10 gap-y-14 sm:grid-cols-2">
            <Feature
              title="See who's where"
              body="Every cursor carries its owner's name and colour, and the file list shows who is in which file."
            >
              <pre className="font-mono text-[13px] leading-7 text-muted">
                <span className="text-[#c792ea]">const</span> total = items.reduce(
                <CursorFlag name="Ada" color="#f472b6" />
                {"\n"}
                {"  "}(sum, item) =&gt; sum + item.price
                <CursorFlag name="Linus" color="#60a5fa" />, 0){"\n"}
              </pre>
            </Feature>
            <Feature
              title="Keeps going on bad Wi-Fi"
              body="Lose your connection and keep typing. Your edits wait in the tab and merge with everyone else's the moment you're back."
            >
              <ol className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <Status dot="bg-red-400">Offline</Status>
                <Status dot="bg-amber-400">Reconnecting…</Status>
                <Status dot="bg-emerald-400">Connected</Status>
              </ol>
            </Feature>
            <Feature
              title="Invite with a link"
              body="Send an edit link, or a view-only one, and they're in with no account needed. Turn a link off and everyone who used it is out."
            >
              <div className="flex max-w-sm gap-2">
                <span className="flex h-9 min-w-0 flex-1 items-center rounded-lg border border-line bg-raised px-3 font-mono text-xs text-muted">
                  /join/F3RW4i3yBJq9…
                </span>
                <span className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-canvas">
                  <Link2 size={14} strokeWidth={2.5} />
                  Copy link
                </span>
              </div>
            </Feature>
            <Feature
              title="Saved as you type"
              body="Every change is saved with who made it and when, so closing a tab or restarting the server loses nothing."
            >
              <ul className="max-w-sm divide-y divide-line text-xs">
                <Change who="Ada" color="#f472b6" when="just now" />
                <Change who="Grace" color="#34d399" when="2 minutes ago" />
                <Change who="You" color="#60a5fa" when="5 minutes ago" />
              </ul>
            </Feature>
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
          <h2 className="font-display text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
            How it works
          </h2>
          <ol className="mt-12 grid gap-10 md:grid-cols-3">
            <Step n={1} title="Start a room">
              Sign in and start a room from your dashboard. It opens with a file ready to edit.
            </Step>
            <Step n={2} title="Share the link">
              Copy the room's link and send it to whoever you're working with.
            </Step>
            <Step n={3} title="Code together">
              Everyone edits at once, in one file or across several, and Run shows the output to
              everyone. Every change merges and is saved.
            </Step>
          </ol>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="font-display text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
            On the way
          </h2>
          <p className="mt-3 max-w-xl text-muted">
            PairSpace is young. These are being built next.
          </p>
          <ul className="mt-10 grid gap-x-10 gap-y-6 sm:grid-cols-2">
            <Upcoming title="Replay a session">
              Scrub through how the code was written, keystroke by keystroke, in each person's
              colour.
            </Upcoming>
            <Upcoming title="Watch the network">
              A live panel with latency and pending changes, and a switch that makes the network bad
              on purpose, to watch everyone stay in sync anyway.
            </Upcoming>
          </ul>
        </section>

        <section className="mx-auto max-w-6xl px-5 pt-10 pb-24">
          <div className="rounded-3xl border border-line bg-surface px-8 py-14 sm:px-14">
            <h2 className="max-w-xl font-display text-3xl leading-tight font-semibold tracking-[-0.02em] sm:text-4xl">
              Your first room is one click away.
            </h2>
            <p className="mt-3 max-w-lg text-muted">
              Create an account, start a room, and send the link to someone you code with.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/sign-up" className={PRIMARY}>
                Start a room
              </Link>
              <Link to="/sign-in" className={SECONDARY}>
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center">
          <div>
            <Logo />
            <p className="mt-2 text-sm text-faint">
              A shared code editor for pairing in real time.
            </p>
          </div>
          <div className="flex gap-5 text-sm text-muted sm:ml-auto">
            <Link to="/sign-in" className="hover:text-fg">
              Sign in
            </Link>
            <Link to="/sign-up" className="hover:text-fg">
              Create account
            </Link>
            <a href={SOURCE_URL} className="hover:text-fg">
              Source on GitHub
            </a>
          </div>
        </div>
        <p className="mx-auto max-w-6xl px-5 pb-10 text-xs text-faint">© 2026 PairSpace</p>
      </footer>
    </div>
  );
}

// a feature: a small piece of the real interface, then what it does for you
function Feature({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <div>
      <div className="flex min-h-28 items-center rounded-xl bg-surface px-6 py-6">{children}</div>
      <h3 className="mt-5 text-base font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}

function Status({ dot, children }: { dot: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2 rounded-full border border-line bg-raised px-3 py-1.5">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {children}
    </li>
  );
}

function Change({ who, color, when }: { who: string; color: string; when: string }) {
  return (
    <li className="flex items-center gap-2.5 py-2">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="font-medium text-fg">{who}</span>
      <span className="text-muted">edited main.js</span>
      <span className="ml-auto text-faint">{when}</span>
    </li>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li>
      <span className="grid h-8 w-8 place-items-center rounded-full border border-line font-display text-sm font-semibold text-accent">
        {n}
      </span>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{children}</p>
    </li>
  );
}

function Upcoming({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="border-l-2 border-line pl-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">{children}</p>
    </li>
  );
}
