import type { ReactNode } from "react";
import { useState } from "react";
import {
  AlertCircle,
  CloudOff,
  Loader2,
  Repeat,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../lib/utils";
import {
  repeatAmharic,
  speakAmharic,
  type SpeechResult,
  type VoiceMode,
} from "../../lib/speech";

/**
 * AmharicAI web primitives — see `design.md` at the app root.
 * Every Amharic string renders through `Am` so it gets the Ethiopic face.
 */

export function Am({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span lang="am" title={title} className={cn("am", className)}>
      {children}
    </span>
  );
}

/** Latin transliteration — muted italic, never mistaken for the English gloss. */
export function Translit({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("italic text-muted-foreground", className)}>{children}</span>;
}

export function Card({
  children,
  className,
  tone = "card",
}: {
  children: ReactNode;
  className?: string;
  tone?: "card" | "script" | "muted";
}) {
  return (
    <div
      className={cn(
        "card-surface p-5",
        tone === "script" && "script-surface",
        tone === "muted" && "bg-muted",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Chip({
  label,
  icon: Icon,
  className,
}: {
  label: string;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      {Icon ? <Icon className="size-3" /> : null}
      {label}
    </span>
  );
}

/** QA flags from the source spec surface as amber notes — never silently fixed. */
export function QaNote({ flag }: { flag?: string | null }) {
  if (!flag) return null;
  const label =
    flag === "generated_from_source"
      ? "Practice drill generated from the source material"
      : flag.replace(/_/g, " ");
  return (
    <div className="flex items-start gap-2 rounded-lg border-l-[3px] border-warning bg-accent/15 p-2.5 text-xs text-warning">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      <span className="flex-1">{label}</span>
    </div>
  );
}

export function ProgressBar({
  value,
  className,
  barClassName,
}: {
  value: number;
  className?: string;
  barClassName?: string;
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn("h-full rounded-full bg-primary transition-[width] duration-500", barClassName)}
        style={{ width: `${pct * 100}%` }}
      />
    </div>
  );
}

/** Plays a phrase with browser TTS and says so honestly when no Amharic voice exists. */
/**
 * Plays a phrase in a real Amharic voice.
 *
 * `transliteration` is used only for the accessible label — it is never
 * spoken. Reading Latin letters with an English voice would teach an English
 * approximation of the word, which is exactly what this app should not do.
 * When no native voice is reachable the button says so instead of guessing.
 */
export function SpeakButton({
  amharic,
  transliteration,
  mode = "native",
  voice,
  kind,
  refId,
  className,
}: {
  amharic: string;
  transliteration?: string | null;
  mode?: VoiceMode;
  voice?: string | null;
  kind?: string;
  refId?: string | null;
  className?: string;
}) {
  const [state, setState] = useState<SpeechResult | null>(null);
  const [busy, setBusy] = useState(false);
  const silent = state?.source === "none";

  return (
    <button
      type="button"
      aria-label={`Play ${amharic}${transliteration ? ` (${transliteration})` : ""}`}
      title={silent ? state?.reason : mode === "slow" ? "Play slowly" : "Play"}
      onClick={async () => {
        setBusy(true);
        setState(await speakAmharic(amharic, { mode, voice, kind, refId }));
        setBusy(false);
      }}
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full border transition",
        silent
          ? "border-muted-foreground/25 bg-muted/40 text-muted-foreground"
          : "border-primary/25 bg-primary/10 text-primary hover:bg-primary/20",
        className,
      )}
    >
      {silent ? (
        <VolumeX className="size-4" />
      ) : (
        <Volume2 className={cn("size-4", busy && "animate-pulse")} />
      )}
    </button>
  );
}

/** Native / Slow switch. Slow is 0.7x with wider pauses, not a pitch-shifted clip. */
export function VoiceModeToggle({
  mode,
  onChange,
  className,
}: {
  mode: VoiceMode;
  onChange: (mode: VoiceMode) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-border/60 bg-card/60 p-0.5",
        className,
      )}
    >
      {(["native", "slow"] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition",
            mode === value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {value === "native" ? "Native" : "Slow"}
        </button>
      ))}
    </div>
  );
}

/** Plays the phrase three times with a gap — the "get it into your ear" drill. */
export function RepeatButton({
  amharic,
  mode = "native",
  times = 3,
  className,
}: {
  amharic: string;
  mode?: VoiceMode;
  times?: number;
  className?: string;
}) {
  const [running, setRunning] = useState(false);

  return (
    <button
      type="button"
      disabled={running}
      onClick={async () => {
        setRunning(true);
        await repeatAmharic(amharic, { mode, times });
        setRunning(false);
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-60",
        className,
      )}
    >
      <Repeat className={cn("size-3.5", running && "animate-spin")} />
      {running ? "Repeating…" : `Repeat ×${times}`}
    </button>
  );
}

export function TibebRule({ className }: { className?: string }) {
  return <div className={cn("tibeb-rule", className)} aria-hidden />;
}

export function Loading({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-16 text-muted-foreground">
      <Loader2 className="size-6 animate-spin text-primary" />
      {label ? <p className="text-sm">{label}</p> : null}
    </div>
  );
}

export function EmptyState({
  icon: Icon = AlertCircle,
  title,
  body,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 p-14 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-6" />
      </span>
      <h3 className="text-lg font-semibold">{title}</h3>
      {body ? <p className="max-w-md text-sm text-muted-foreground">{body}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={CloudOff}
      title="Could not load"
      body={message ?? "Check your connection and try again."}
      action={
        onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-muted"
          >
            Retry
          </button>
        ) : undefined
      }
    />
  );
}

/** Ethiopic script detection — drives whether a run gets the Ethiopic face. */
export function isAmharic(value: string): boolean {
  return /[ሀ-፿]/.test(value);
}

/** Renders mixed Amharic/Latin text, giving only the Ethiopic runs the script face. */
export function MixedText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/([ሀ-፿؀-ۿ\s]*[ሀ-፿]+[ሀ-፿\s]*)/g);
  return (
    <span className={className}>
      {parts.filter(Boolean).map((part, i) =>
        isAmharic(part) ? <Am key={i}>{part}</Am> : <span key={i}>{part}</span>,
      )}
    </span>
  );
}
