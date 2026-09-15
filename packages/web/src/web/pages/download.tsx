import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { ArrowRight, Check, Globe, Mail, Smartphone } from "lucide-react";
import { useJoinWaitlist } from "../queries/waitlist";
import { useSeo } from "../hooks/use-seo";
import { Card, TibebRule } from "../components/ui/kit";

/**
 * Where the Android app is not.
 *
 * There is no Play listing and no APK, so this page does not carry a store
 * badge — a badge that does not open a store is a claim the product cannot
 * keep. It collects an email instead, and says exactly what that email will be
 * used for. The web app is offered as the thing that works today, because it
 * does.
 */

const WHY_WEB = [
  "Same account, same progress — nothing to migrate when the app arrives.",
  "Works in a phone browser today, not only on a desktop.",
  "Nothing to install, nothing to update.",
];

export default function DownloadPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const join = useJoinWaitlist();

  useSeo({
    title: "Get the app — Android is coming, the web app works today",
    description:
      "The AmharicAI Android app is not on Google Play yet. Leave your email to be told once it is listed, or start learning in your browser right now.",
    path: "/download",
  });

  const done = join.isSuccess;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError("That does not look like an email address.");
      return;
    }
    setError(null);
    join.mutate(
      { email: value, source: "download" },
      { onError: () => setError("Could not save that just now. Try again in a moment.") },
    );
  }

  return (
    <div className="space-y-12">
      <header className="max-w-3xl space-y-4">
        <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
          <Smartphone className="size-3.5" />
          Android — not on Google Play yet
        </span>
        <h1 className="font-display text-3xl font-bold leading-tight md:text-5xl">
          There is nothing to install yet
        </h1>
        <TibebRule className="max-w-56" />
        <p className="text-base leading-relaxed text-muted-foreground">
          The mobile app is built, but it has not been published to Google Play — so there is no
          store page, and we are not handing out an APK to sideload. Rather than put up a store
          badge that goes nowhere, here is the truth and a way to be told the day it changes.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-[1fr_1fr] md:items-start">
        {/* Waitlist */}
        <Card className="space-y-4">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Mail className="size-5" />
          </span>
          <div className="space-y-1.5">
            <h2 className="font-display text-xl font-bold">Tell me when it lands</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              One email, sent once, on the day the app is actually listed on Google Play. Not a
              newsletter, not shared with anyone, and you can ask us to erase the address at any
              time.
            </p>
          </div>

          {done ? (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/8 p-4 text-sm"
            >
              <Check className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="space-y-1">
                <p className="font-medium text-primary">
                  {join.data?.already ? "You were already on the list." : "You are on the list."}
                </p>
                <p className="text-muted-foreground">
                  Nothing else will arrive in the meantime. In the meantime, the course is open
                  in your browser.
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-3" noValidate>
              <label htmlFor="waitlist-email" className="block text-sm font-medium">
                Email address
              </label>
              <input
                id="waitlist-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="you@example.com"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "waitlist-error" : undefined}
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
              />
              {error ? (
                <p id="waitlist-error" role="alert" className="text-xs font-medium text-destructive">
                  {error}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={join.isPending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
              >
                {join.isPending ? "Adding you…" : "Notify me"}
                {join.isPending ? null : <ArrowRight className="size-4" />}
              </button>
              <p className="text-xs text-muted-foreground">
                By leaving your address you agree to the{" "}
                <Link to="/privacy" className="font-medium underline hover:text-foreground">
                  Privacy Policy
                </Link>
                .
              </p>
            </form>
          )}
        </Card>

        {/* The thing that works today */}
        <Card className="space-y-4">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Globe className="size-5" />
          </span>
          <div className="space-y-1.5">
            <h2 className="font-display text-xl font-bold">The web app is the whole product</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Not a cut-down preview of a mobile app — it is where the course lives. Open it in
              your phone's browser and it behaves like an app, minus the install.
            </p>
          </div>
          <ul className="space-y-2 text-sm">
            {WHY_WEB.map((line) => (
              <li key={line} className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                <span className="text-muted-foreground">{line}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link
              to="/sign-in"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Start free <ArrowRight className="size-4" />
            </Link>
            <Link
              to="/app"
              className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-semibold hover:bg-muted"
            >
              Browse the course
            </Link>
          </div>
        </Card>
      </div>

      <section className="space-y-3 rounded-2xl border border-border bg-muted/50 px-6 py-7">
        <h2 className="font-display text-lg font-bold">What about iPhone?</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          No iOS app is in progress and none is promised. Safari on an iPhone runs the web app
          today, and that is the honest answer rather than a date we would miss. The same
          notification list covers it if that changes.
        </p>
      </section>
    </div>
  );
}
