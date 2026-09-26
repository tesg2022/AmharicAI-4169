import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  AudioLines,
  BadgeCheck,
  BookOpen,
  Flame,
  Globe,
  Library,
  LogIn,
  MessageCircle,
  Smartphone,
  Sparkles,
  Type,
  User,
} from "lucide-react";
import { useSession } from "../hooks/use-session";
import { useMyProgress } from "../queries/progress";
import { Am, Chip } from "./ui/kit";

interface NavItem {
  to: string;
  label: string;
  icon: typeof BookOpen;
  amharic?: boolean;
}

/** Shown once someone is inside the product. */
const APP_NAV: NavItem[] = [
  { to: "/app", label: "Course", icon: BookOpen },
  { to: "/fidel", label: "ፊደል", icon: Type, amharic: true },
  { to: "/pronunciation", label: "Pronunciation", icon: AudioLines },
  { to: "/practice", label: "Practice", icon: Sparkles },
  { to: "/dictionary", label: "Dictionary", icon: Library },
  { to: "/tutor", label: "AI Tutor", icon: MessageCircle },
  { to: "/progress", label: "Progress", icon: User },
  { to: "/subscription", label: "Plan", icon: BadgeCheck },
];

/** Shown on the public pages, where the job is to explain rather than to study. */
const MARKETING_NAV: NavItem[] = [
  { to: "/features", label: "Features", icon: Sparkles },
  { to: "/pricing", label: "Pricing", icon: BadgeCheck },
  { to: "/faq", label: "FAQ", icon: MessageCircle },
  { to: "/download", label: "Get the app", icon: Smartphone },
];

/**
 * The public pages. A visitor on one of these gets the marketing nav even when
 * signed in, because the alternative — a pricing page wearing the study nav —
 * reads as though they took a wrong turn inside the app.
 */
const MARKETING_ROUTES = new Set(["/", "/features", "/pricing", "/faq", "/download"]);

/** Legal pages sit in both worlds; the session decides which nav frames them. */
const SHARED_ROUTES = new Set(["/privacy", "/terms", "/about", "/contact"]);

const LEGAL_LINKS = [
  { to: "/features", label: "Features" },
  // In the footer as well as the study nav: the footer is on every page,
  // including the marketing pages that never show the study nav, so this is
  // the one internal link that reaches the dictionary from anywhere.
  { to: "/dictionary", label: "Amharic dictionary" },
  { to: "/pricing", label: "Pricing" },
  { to: "/faq", label: "FAQ" },
  { to: "/download", label: "Get the app" },
  { to: "/about", label: "About" },
  // Play requires the account-deletion path to be reachable on the web without
  // installing the app, so it lives in the footer of every page.
  { to: "/account", label: "Account & data" },
  { to: "/contact", label: "Contact" },
  { to: "/privacy", label: "Privacy Policy" },
  { to: "/terms", label: "Terms of Service" },
];

/** Mirrors OPERATOR.supportEmail in api/content/legal.ts — the source of truth. */
const SUPPORT_EMAIL = "admin@amharicai.org";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { isSignedIn, user } = useSession();
  const progress = useMyProgress(isSignedIn);

  const isMarketing =
    MARKETING_ROUTES.has(location) || (SHARED_ROUTES.has(location) && !isSignedIn);
  const NAV = isMarketing ? MARKETING_NAV : APP_NAV;
  const isActive = (to: string) => (to === "/" ? location === "/" : location.startsWith(to));

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
              const active = isActive(item.to);
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
            {isSignedIn && isMarketing ? (
              <Link
                to="/app"
                className="hidden rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 sm:inline-flex"
              >
                Open the course
              </Link>
            ) : null}
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
            const active = isActive(item.to);
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

      {/* The policy links are a Play requirement, not decoration: the privacy
          policy has to be reachable from inside the app, not only from the
          store listing. Keep them on every page. */}
      <footer className="mt-8 border-t border-border">
        <div className="mx-auto max-w-6xl px-5 pb-16 pt-6 text-xs text-muted-foreground">
          <nav aria-label="Site links" className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {LEGAL_LINKS.map((item) => (
              <Link key={item.to} to={item.to} className="font-medium hover:text-foreground">
                {item.label}
              </Link>
            ))}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium hover:text-foreground">
              {SUPPORT_EMAIL}
            </a>
          </nav>
          <p className="mt-4 leading-relaxed">
            Course content is kept verbatim as written — nothing is silently corrected.
          </p>
          <p className="mt-1.5">
            © {new Date().getFullYear()} AmharicAI · amharicai.org
          </p>
        </div>
      </footer>
    </div>
  );
}
