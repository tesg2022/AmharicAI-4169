import { useState } from "react";
import { Link, useLocation } from "wouter";
import { AlertCircle, ArrowRight, Eye, EyeOff, Globe } from "lucide-react";
import { authClient } from "../lib/auth";
import { Am, Card, TibebRule } from "../components/ui/kit";

/**
 * Sign-in / sign-up.
 *
 * Two paths onto the same session: the managed Google broker and plain
 * email/password. Lessons and the ፊደል chart stay readable while signed out —
 * an account only buys progress, streaks and the review deck.
 */

export default function SignInPage() {
  const [, navigate] = useLocation();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function google() {
    setError(null);
    setBusy("google");
    try {
      const result = await authClient.managedAuth.signIn({ provider: "google" });
      // AUTH_SESSION_DISMISSED just means the popup was closed — not a failure.
      if (result.error && result.error.code !== "AUTH_SESSION_DISMISSED") {
        setError(result.error.message ?? "Google sign-in failed.");
      } else if (!result.error) {
        navigate("/");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setBusy(null);
    }
  }

  async function withEmail(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (mode === "signup" && password.length < 8) {
      setError("Passwords need at least 8 characters.");
      return;
    }

    setBusy("email");
    const result =
      mode === "signin"
        ? await authClient.signIn.email({ email: email.trim(), password })
        : await authClient.signUp.email({
            email: email.trim(),
            password,
            name: name.trim() || email.trim().split("@")[0]!,
          });
    setBusy(null);

    if (result.error) {
      setError(result.error.message ?? "Something went wrong. Try again.");
      return;
    }
    navigate("/");
  }

  const inputClass =
    "w-full rounded-xl border border-border bg-background px-4 py-2.5 text-[15px] outline-none transition focus:border-primary";

  return (
    <div className="mx-auto max-w-md space-y-6 py-4">
      <header className="space-y-3">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Globe className="size-6" />
        </span>
        <h1 className="font-display text-3xl font-bold">AmharicAI</h1>
        <Am className="block text-lg text-primary">እንኳን ደህና መጡ</Am>
        <TibebRule className="max-w-36" />
        <p className="text-sm text-muted-foreground">
          {mode === "signin"
            ? "Sign in to keep your streak, XP and review deck across web and phone."
            : "Create an account to save your progress from the first lesson."}
        </p>
      </header>

      <button
        type="button"
        onClick={google}
        disabled={busy !== null}
        className="flex w-full items-center justify-center gap-3 rounded-full border border-border bg-card px-5 py-3 text-sm font-semibold transition hover:bg-muted disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
          <path
            fill="#4285F4"
            d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.6-5.2 3.6-8.8Z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z"
          />
          <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1Z" />
          <path
            fill="#EA4335"
            d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z"
          />
        </svg>
        {busy === "google" ? "Opening Google…" : "Continue with Google"}
      </button>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or with email</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <Card>
        <form onSubmit={withEmail} className="space-y-3">
          {mode === "signup" ? (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Name"
                placeholder="Your name"
                autoComplete="name"
                className={inputClass}
              />
            </label>
          ) : null}

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              className={inputClass}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Password</span>
            <span className="relative block">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-label="Password"
                type={showPassword ? "text" : "password"}
                placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                className={`${inputClass} pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </span>
          </label>

          {error ? (
            <p className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy !== null}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {busy === "email"
              ? "Working…"
              : mode === "signin"
                ? "Sign in"
                : "Create account"}
            <ArrowRight className="size-4" />
          </button>
        </form>
      </Card>

      <button
        type="button"
        onClick={() => {
          setMode((m) => (m === "signin" ? "signup" : "signin"));
          setError(null);
        }}
        className="mx-auto block text-sm font-medium text-primary hover:underline"
      >
        {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>

      <p className="text-center text-xs text-muted-foreground">
        You can keep reading{" "}
        <Link to="/" className="font-medium hover:underline">
          lessons
        </Link>{" "}
        and the{" "}
        <Link to="/fidel" className="font-medium hover:underline">
          <Am>ፊደል</Am> chart
        </Link>{" "}
        without an account.
      </p>
    </div>
  );
}
