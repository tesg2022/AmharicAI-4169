import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  AudioLines,
  BadgeCheck,
  BookOpen,
  Flame,
  Globe,
  LogIn,
  MessageCircle,
  Sparkles,
  Type,
  User,
} from "lucide-react";
import { useSession } from "../hooks/use-session";
import { useMyProgress } from "../queries/progress";
import { Am, Chip } from "./ui/kit";

const NAV = [
  { to: "/", label: "Course", icon: BookOpen },
  { to: "/fidel", label: "ፊደል", icon: Type, amharic: true },
  { to: "/pronunciation", label: "Pronunciation", icon: AudioLines },
  { to: "/practice", label: "Practice", icon: Sparkles },
  { to: "/tutor", label: "AI Tutor", icon: MessageCircle },
  { to: "/progress", label: "Progress", icon: User },
  { to: "/subscription", label: "Plan", icon: BadgeCheck },
];

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { isSignedIn, user } = useSession();
  const progress = useMyProgress(isSignedIn);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Globe className="size-5" />
            </span>
            <span className="leading-tight">
              <span className="block font-display text-base font-bold">AmharicAI</span>
              <span className="block text-[11px] text-muted-foreground">
                Learn Amharic · <Am>ፊደል</Am> · Speak · Read · Write
              </span>
            </span>
          </Link>

          <nav className="ml-auto hidden items-center gap-1 md:flex">
            {NAV.map((item) => {
              const active = item.to === "/" ? location === "/" : location.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`rounded-full px-3.5 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  } ${item.amharic ? "am" : ""}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3 md:ml-0">
            {isSignedIn ? (
              <>
                <Chip
                  label={`${progress.data?.stats.streakDays ?? 0}`}
                  icon={Flame}
                  className="bg-accent/20 text-accent-foreground"
                />
                <Chip label={`${progress.data?.stats.xp ?? 0} XP`} className="hidden sm:inline-flex" />
                <Link
                  to="/progress"
                  className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                  title={user?.name ?? "Profile"}
                >
                  {(user?.name ?? user?.email ?? "?").charAt(0).toUpperCase()}
                </Link>
              </>
            ) : (
              <Link
                to="/sign-in"
                className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                <LogIn className="size-4" />
                Sign in
              </Link>
            )}
          </div>
        </div>

        {/* Mobile nav */}
        <nav className="flex items-center gap-1 overflow-x-auto border-t border-border px-4 py-2 md:hidden">
          {NAV.map((item) => {
            const active = item.to === "/" ? location === "/" : location.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
                  active ? "bg-primary/10 text-primary" : "text-muted-foreground"
                } ${item.amharic ? "am" : ""}`}
              >
                <item.icon className="size-3.5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>

      <footer className="mx-auto max-w-6xl px-5 pb-16 pt-4 text-xs text-muted-foreground">
        Course content is kept verbatim as written — nothing is silently corrected.
      </footer>
    </div>
  );
}
