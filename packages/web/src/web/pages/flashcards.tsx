import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Eye, Layers } from "lucide-react";
import { useDueCards, useReviewCard, useSrsSummary } from "../queries/srs";
import { ProtectedRoute } from "../components/protected-route";
import {
  Am,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Loading,
  ProgressBar,
  SpeakButton,
  TibebRule,
  Translit,
} from "../components/ui/kit";

/**
 * Spaced-repetition review.
 *
 * One card at a time: the Amharic side first, reveal the gloss, then grade it.
 * The four grades map onto SM-2 quality values on the server — the client only
 * ever names them.
 */

const GRADES = [
  { key: "again", label: "Again", hint: "10 min", className: "border-destructive/40 text-destructive hover:bg-destructive/10" },
  { key: "hard", label: "Hard", hint: "shorter", className: "border-warning/40 text-warning hover:bg-accent/15" },
  { key: "good", label: "Good", hint: "on track", className: "border-primary/40 text-primary hover:bg-primary/10" },
  { key: "easy", label: "Easy", hint: "longer", className: "border-success/40 text-success hover:bg-success/10" },
] as const;

export default function FlashcardsPage() {
  return (
    <ProtectedRoute message="Your review deck lives with your account, so it follows you between web and phone.">
      <Deck />
    </ProtectedRoute>
  );
}

function Deck() {
  const due = useDueCards();
  const summary = useSrsSummary();
  const review = useReviewCard();

  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(0);

  if (due.isLoading) return <Loading label="Shuffling your deck…" />;
  if (due.isError) return <ErrorState message={due.error?.message} onRetry={() => due.refetch()} />;

  const queue = due.data ?? [];
  const current = queue[0];

  if (!current) {
    const next = summary.data?.nextDueAt;
    return (
      <div className="mx-auto max-w-lg space-y-4 py-6">
        <Back />
        <EmptyState
          icon={Layers}
          title={done ? "Deck cleared" : "Nothing due right now"}
          body={
            done
              ? `You reviewed ${done} card${done === 1 ? "" : "s"}. ${
                  next ? `Next batch: ${new Date(next).toLocaleString()}.` : ""
                }`
              : summary.data?.total
                ? next
                  ? `Next card is due ${new Date(next).toLocaleString()}.`
                  : "Come back later."
                : "Open a lesson and add its words to start a deck."
          }
          action={
            <Link
              to="/"
              className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Browse lessons
            </Link>
          }
        />
        {summary.data ? <DeckStats summary={summary.data} /> : null}
      </div>
    );
  }

  const { card, word } = current;

  function grade(key: (typeof GRADES)[number]["key"]) {
    if (review.isPending) return;
    review.mutate(
      { cardId: card.id, grade: key },
      {
        onSuccess: () => {
          setRevealed(false);
          setDone((n) => n + 1);
        },
      },
    );
  }

  const total = queue.length + done;

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div className="flex items-center gap-3">
        <Back />
        <span className="ml-auto text-sm text-muted-foreground">
          {done} / {total} reviewed
        </span>
      </div>

      <ProgressBar value={total ? done / total : 0} />

      <Card tone="script" className="min-h-[300px] space-y-5 text-center">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Chip label={card.repetitions === 0 ? "New" : `Seen ${card.repetitions}×`} />
        </div>

        <div className="space-y-3 py-4">
          <Am className="block text-5xl leading-tight text-primary">{word.amharic}</Am>
          <div className="flex justify-center">
            <SpeakButton
              amharic={word.amharic}
              transliteration={word.transliteration}
              className="size-11"
            />
          </div>
        </div>

        <TibebRule className="mx-auto max-w-32" />

        {revealed ? (
          <div className="space-y-1.5">
            {word.transliteration ? (
              <p className="text-base">
                <Translit>{word.transliteration}</Translit>
              </p>
            ) : null}
            <p className="text-lg font-semibold">{word.english ?? "—"}</p>
            {word.notes ? <p className="text-sm text-muted-foreground">{word.notes}</p> : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-semibold hover:bg-muted"
          >
            <Eye className="size-4" /> Reveal
          </button>
        )}
      </Card>

      {revealed ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {GRADES.map((g) => (
            <button
              key={g.key}
              type="button"
              disabled={review.isPending}
              onClick={() => grade(g.key)}
              className={`rounded-xl border bg-card px-3 py-3 text-sm font-semibold transition disabled:opacity-50 ${g.className}`}
            >
              {g.label}
              <span className="block text-[11px] font-normal text-muted-foreground">{g.hint}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-center text-xs text-muted-foreground">
          Say it out loud before you reveal — recall beats recognition.
        </p>
      )}

      {summary.data ? <DeckStats summary={summary.data} /> : null}
    </div>
  );
}

function DeckStats({
  summary,
}: {
  summary: { total: number; due: number; learning: number; mature: number };
}) {
  return (
    <Card className="grid grid-cols-4 gap-2 text-center">
      {[
        { label: "Deck", value: summary.total },
        { label: "Due", value: summary.due },
        { label: "Learning", value: summary.learning },
        { label: "Mature", value: summary.mature },
      ].map((s) => (
        <div key={s.label}>
          <p className="font-display text-lg font-bold">{s.value}</p>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
        </div>
      ))}
    </Card>
  );
}

function Back() {
  return (
    <Link
      to="/practice"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> Practice
    </Link>
  );
}
