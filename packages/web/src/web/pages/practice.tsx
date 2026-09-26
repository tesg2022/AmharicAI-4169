import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  Check,
  Eye,
  Headphones,
  Keyboard,
  Layers,
  Mic,
  MicOff,
  Repeat,
  Search,
  Sparkles,
  Square,
} from "lucide-react";
import { useOutline, useVocabulary } from "../queries/content";
import { useSrsSummary } from "../queries/srs";
import { useScoreSpeech, useSpeakingPrompts } from "../queries/speaking";
import { useAdvanceSpeechSession, useStartSpeechSession } from "../queries/speech";
import { useSession } from "../hooks/use-session";
import { micSupported, recognizeBlob, startRecording, type Recorder } from "../lib/recognition";
import {
  Am,
  Card,
  Chip,
  EmptyState,
  Loading,
  ProgressBar,
  SpeakButton,
  TibebRule,
  Translit,
} from "../components/ui/kit";
import { ORIGIN, useSeo } from "../hooks/use-seo";

/**
 * Practice hub: the review deck, pronunciation drills and the word list.
 * Lesson quizzes are launched from the lesson itself, so they are not
 * duplicated here — this page is for the cross-lesson practice modes.
 */

/**
 * Described as a practice resource rather than as a graded assessment, and
 * deliberately silent on speech recognition: the recognizer ladder ends in a
 * typed self-check when no provider key is configured, which is the case here.
 */
const PRACTICE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "LearningResource",
  "@id": `${ORIGIN}/practice#resource`,
  name: "Amharic pronunciation practice and review drills",
  url: `${ORIGIN}/practice`,
  learningResourceType: "Practice exercise",
  educationalLevel: "Beginner",
  teaches: "Amharic pronunciation, vocabulary recall and reading the Fidel",
  inLanguage: ["en", "am"],
  isPartOf: { "@id": `${ORIGIN}/app#course` },
};

export default function PracticePage() {
  useSeo({
    title: "Amharic pronunciation practice — drills, flashcards and quizzes",
    description:
      "Practise Amharic out loud with a read, listen, repeat and speak loop, then hold the words with spaced-repetition flashcards and lesson quizzes.",
    path: "/practice",
    jsonLd: PRACTICE_JSON_LD,
  });

  const outline = useOutline();
  const { isSignedIn } = useSession();
  const srs = useSrsSummary(isSignedIn);

  const lessons = useMemo(
    () =>
      (outline.data?.units ?? []).flatMap((unit) =>
        unit.lessons.map((lesson) => ({ ...lesson, unitTitle: unit.titleEn })),
      ),
    [outline.data],
  );

  if (outline.isLoading) return <Loading label="Loading practice…" />;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex items-center gap-2 text-primary">
          <Sparkles className="size-5" />
          <span className="text-xs font-semibold uppercase tracking-wide">Practice</span>
        </div>
        <h1 className="text-3xl font-bold md:text-4xl">Drill what you have learnt</h1>
        <TibebRule className="max-w-44" />
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Three ways to practise Amharic, all drawing on the same course material: a pronunciation
          loop that walks one phrase from reading to speaking, a spaced-repetition deck that brings
          words back before you forget them, and the quiz at the end of each lesson.
        </p>
      </header>

      {/* Review deck */}
      <Card className="flex flex-wrap items-center gap-5">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Layers className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">Review deck</h2>
          <p className="text-sm text-muted-foreground">
            {isSignedIn
              ? srs.data?.total
                ? `${srs.data.due} due of ${srs.data.total} cards · ${srs.data.mature} mature`
                : "Empty — add a lesson's words from any lesson page."
              : "Sign in to build a spaced-repetition deck that syncs with your phone."}
          </p>
          {isSignedIn && srs.data?.total ? (
            <ProgressBar
              className="mt-2 max-w-sm"
              value={srs.data.total ? 1 - srs.data.due / srs.data.total : 0}
            />
          ) : null}
        </div>
        <Link
          to={isSignedIn ? "/flashcards" : "/sign-in"}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          {isSignedIn ? "Review now" : "Sign in"} <ArrowRight className="size-4" />
        </Link>
      </Card>

      <SpeakingPractice lessons={lessons} />

      <QuizLauncher lessons={lessons} />

      <WordList />

      {/* Explanatory content + the Practice → Dictionary link in the chain. */}
      <section className="space-y-4">
        <h2 className="font-display text-xl font-bold">
          How Amharic pronunciation practice works here
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="space-y-2">
            <h3 className="font-semibold">One phrase, five stages</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Each prompt withholds the next step until the one before it is done: read the Fidel,
              hear it, shadow it, then say it alone. Recording before listening only records a
              guess, so the microphone appears last.
            </p>
          </Card>
          <Card className="space-y-2">
            <h3 className="font-semibold">Scored against the target text</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Your take is compared with the written Amharic and scored on how far apart they are.
              When no speech recognizer is available — which is the case in this build — the same
              scorer runs on a typed self-check instead, so the score is still real.
            </p>
          </Card>
          <Card className="space-y-2">
            <h3 className="font-semibold">Review that spaces itself</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Words added from a lesson page enter the review deck and come back at widening
              intervals. Signing in keeps the schedule; without an account the drills still run,
              they just are not saved.
            </p>
          </Card>
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Practice only works on material you have already met, so if a prompt looks unfamiliar go
          back to the{" "}
          <Link to="/fidel" className="font-medium text-primary hover:underline">
            Amharic Fidel chart
          </Link>{" "}
          or the{" "}
          <Link to="/app" className="font-medium text-primary hover:underline">
            Amharic lessons
          </Link>{" "}
          first. To check a single word rather than drill it, search the{" "}
          <Link to="/dictionary" className="font-medium text-primary hover:underline">
            Amharic dictionary online
          </Link>
          , and see{" "}
          <Link to="/features" className="font-medium text-primary hover:underline">
            what is configured
          </Link>{" "}
          for the current status of audio and speech recognition.
        </p>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Speaking                                                            */
/* ------------------------------------------------------------------ */

type LessonRef = { id: string; titleEn: string; unitTitle: string };

const STAGES = ["read", "listen", "repeat", "speak", "feedback"] as const;
type Stage = (typeof STAGES)[number];

const STAGE_META: Record<
  Stage,
  { label: string; Icon: typeof Eye; hint: string }
> = {
  read: {
    label: "Read",
    Icon: Eye,
    hint: "Look at the Fidel. Sound it out yourself before you hear it.",
  },
  listen: {
    label: "Listen",
    Icon: Headphones,
    hint: "Play it at natural speed. Do not speak yet — just listen.",
  },
  repeat: {
    label: "Repeat",
    Icon: Repeat,
    hint: "Play it slowly and say it along with the voice, twice.",
  },
  speak: { label: "Speak", Icon: Mic, hint: "Now say it on your own and record the take." },
  feedback: {
    label: "Feedback",
    Icon: Sparkles,
    hint: "Compare what you said with the target.",
  },
};

/**
 * The READ → LISTEN → REPEAT → SPEAK → FEEDBACK loop.
 *
 * The stages are not decoration: each one withholds something until the step
 * before it is done. The audio control does not appear while the learner is
 * still reading the script, and the microphone does not appear until they have
 * heard the phrase and shadowed it — recording before listening only records a
 * guess. Past stages stay clickable so the phrase can be replayed without
 * losing the place in the loop.
 */
function SpeakingPractice({ lessons }: { lessons: LessonRef[] }) {
  const { isSignedIn } = useSession();
  const [lessonId, setLessonId] = useState("");
  const prompts = useSpeakingPrompts(lessonId);
  const score = useScoreSpeech();

  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>("read");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [scores, setScores] = useState<number[]>([]);
  const [result, setResult] = useState<{ score: number; feedback: string; xpAwarded: number } | null>(
    null,
  );
  /** Flips on when the mic cannot deliver a transcript, for any reason. */
  const [typedMode, setTypedMode] = useState(!micSupported());
  const recorder = useRef<Recorder | null>(null);

  const list = prompts.data ?? [];
  const prompt = list[index];
  const stageIndex = STAGES.indexOf(stage);

  // Session record. Anonymous learners still get the full loop — only the
  // persisted record needs an account, so every call here is best-effort and
  // never blocks the UI.
  const startSession = useStartSpeechSession();
  const advanceSession = useAdvanceSpeechSession();
  const sessionId = useRef<string | null>(null);
  const startMutate = useRef(startSession.mutate);
  startMutate.current = startSession.mutate;
  const advanceMutate = useRef(advanceSession.mutate);
  advanceMutate.current = advanceSession.mutate;

  useEffect(() => {
    setIndex(0);
    setStage("read");
    setResult(null);
    setTranscript("");
    setTyped("");
    setScores([]);
    setError(null);
    sessionId.current = null;
  }, [lessonId]);

  useEffect(() => {
    if (!isSignedIn || !lessonId || list.length === 0 || sessionId.current) return;
    startMutate.current(
      { lessonId, itemsTotal: list.length },
      {
        onSuccess: (data) => {
          sessionId.current = data.id;
        },
        onError: () => undefined,
      },
    );
  }, [isSignedIn, lessonId, list.length]);

  function record(
    next: Stage,
    opts?: { itemsCompleted?: number; scores?: number[]; completed?: boolean },
  ) {
    const id = sessionId.current;
    if (!id) return;
    const all = opts?.scores;
    const averageScore =
      all && all.length > 0
        ? Math.round((all.reduce((sum, n) => sum + n, 0) / all.length) * 100)
        : undefined;
    advanceMutate.current(
      {
        id,
        stage: next,
        itemsCompleted: opts?.itemsCompleted,
        averageScore,
        completed: opts?.completed ?? false,
      },
      { onError: () => undefined },
    );
  }

  function goStage(next: Stage) {
    setError(null);
    setStage(next);
    record(next);
  }

  function move(step: number) {
    recorder.current?.cancel();
    recorder.current = null;
    setListening(false);
    const next = Math.min(Math.max(index + step, 0), Math.max(list.length - 1, 0));
    setIndex(next);
    setResult(null);
    setTranscript("");
    setTyped("");
    setError(null);
    // Every phrase restarts the loop at READ — that is what makes it a loop.
    setStage("read");
    record("read", { itemsCompleted: next });
  }

  useEffect(() => () => recorder.current?.cancel(), []);

  function grade(said: string) {
    if (!prompt || !said.trim()) return;
    setTranscript(said);
    score.mutate(
      { targetText: prompt.amharic, transcript: said, lessonId },
      {
        onSuccess: (res) => {
          setResult(res);
          const nextScores = [...scores, res.score];
          setScores(nextScores);
          setStage("feedback");
          record("feedback", {
            itemsCompleted: index + 1,
            scores: nextScores,
            completed: index >= list.length - 1,
          });
        },
      },
    );
  }

  async function toggleRecord() {
    if (!prompt) return;

    if (listening) {
      const active = recorder.current;
      recorder.current = null;
      setListening(false);
      if (!active) return;

      setBusy(true);
      try {
        const outcome = await recognizeBlob(await active.stop(), prompt.amharic);
        if (outcome.ok) {
          grade(outcome.transcript);
          return;
        }
        setError(outcome.message);
        // The mic will not help on this browser or server — hand over the
        // typed self-check rather than leaving a dead button.
        if (outcome.reason === "no_recognizer" || outcome.reason === "no_mic") {
          setTypedMode(true);
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    setError(null);
    setResult(null);
    setTranscript("");
    try {
      recorder.current = await startRecording();
      setListening(true);
    } catch {
      setError("Microphone access was blocked — type what you said instead.");
      setTypedMode(true);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Mic className="size-5 text-primary" /> Speaking
        </h2>
        <select
          value={lessonId}
          onChange={(e) => setLessonId(e.target.value)}
          className="ml-auto rounded-full border border-border bg-card px-4 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">Choose a lesson…</option>
          {lessons.map((lesson) => (
            <option key={lesson.id} value={lesson.id}>
              {lesson.unitTitle} — {lesson.titleEn}
            </option>
          ))}
        </select>
      </div>

      {!lessonId ? (
        <Card className="text-sm text-muted-foreground">
          Pick a lesson to drill its phrases through the read → listen → repeat → speak → feedback
          loop. Your take is scored against the source phrase character by character — no model in
          the loop, so it is instant and consistent.
        </Card>
      ) : prompts.isLoading ? (
        <Loading />
      ) : !prompt ? (
        <Card className="text-sm text-muted-foreground">
          This lesson has no spoken phrases in the source material.
        </Card>
      ) : (
        <Card tone="script" className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Chip label={prompt.kind === "dialogue" ? "Dialogue line" : "Word"} />
            <span className="ml-auto text-xs text-muted-foreground">
              {index + 1} / {list.length}
            </span>
          </div>

          {/* Stage rail */}
          <div className="grid grid-cols-5 gap-1.5">
            {STAGES.map((s, i) => {
              const { label, Icon } = STAGE_META[s];
              const done = i < stageIndex;
              const active = i === stageIndex;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={i > stageIndex}
                  onClick={() => goStage(s)}
                  aria-current={active ? "step" : undefined}
                  className={`flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-semibold transition ${
                    active
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : done
                        ? "border-transparent text-muted-foreground hover:bg-muted"
                        : "border-transparent text-muted-foreground/40"
                  }`}
                >
                  {done ? <Check className="size-4" /> : <Icon className="size-4" />}
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-sm text-muted-foreground">{STAGE_META[stage].hint}</p>

          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1 space-y-1">
              <Am className="block text-3xl leading-snug text-primary">{prompt.amharic}</Am>
              {prompt.transliteration ? (
                <p>
                  <Translit>{prompt.transliteration}</Translit>
                </p>
              ) : null}
              {prompt.english && stage !== "read" ? (
                <p className="text-sm text-muted-foreground">{prompt.english}</p>
              ) : null}
            </div>
            {/* Withheld during READ on purpose — reading the Fidel unaided is
                the point of that stage. REPEAT plays at 0.7x so the learner
                can shadow it. */}
            {stage !== "read" ? (
              <SpeakButton
                amharic={prompt.amharic}
                transliteration={prompt.transliteration}
                mode={stage === "repeat" ? "slow" : "native"}
                kind="prompt"
                className="size-11"
              />
            ) : null}
          </div>

          <TibebRule className="max-w-32" />

          {stage === "read" || stage === "listen" || stage === "repeat" ? (
            <button
              type="button"
              onClick={() =>
                goStage(stage === "read" ? "listen" : stage === "listen" ? "repeat" : "speak")
              }
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              {stage === "read"
                ? "I can read it — play the audio"
                : stage === "listen"
                  ? "Heard it — let me shadow it"
                  : "I've practiced — record my take"}
              <ArrowRight className="size-4" />
            </button>
          ) : null}

          {stage === "speak" ? (
            !typedMode ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={busy || score.isPending}
                  onClick={() => void toggleRecord()}
                  className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
                    listening
                      ? "bg-destructive text-white"
                      : "bg-primary text-primary-foreground hover:opacity-90"
                  }`}
                >
                  {busy ? (
                    <>
                      <Sparkles className="size-4 animate-pulse" /> Sending your take…
                    </>
                  ) : listening ? (
                    <>
                      <Square className="size-4" /> Stop
                    </>
                  ) : (
                    <>
                      <Mic className="size-4" /> Record your take
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setTypedMode(true)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Type it instead
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MicOff className="size-3.5" />
                  Say the phrase aloud, then write it from memory — it is scored exactly the same way
                  as a recorded take.
                </p>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    aria-label="Type what you said"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") grade(typed);
                    }}
                    placeholder="Write the phrase from memory"
                    className="min-w-0 flex-1 rounded-xl border border-border bg-background px-4 py-2.5 text-[15px] outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => grade(typed)}
                    disabled={!typed.trim() || score.isPending}
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    <Keyboard className="size-4" /> Check
                  </button>
                </div>
                {micSupported() ? (
                  <button
                    type="button"
                    onClick={() => setTypedMode(false)}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Use the microphone instead
                  </button>
                ) : null}
              </div>
            )
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {stage === "feedback" && result ? (
            <div className="space-y-2 rounded-xl bg-card p-4">
              <div className="flex items-center gap-3">
                <span className="font-display text-3xl font-bold text-primary">
                  {Math.round(result.score * 100)}%
                </span>
                {result.xpAwarded ? (
                  <Chip label={`+${result.xpAwarded} XP`} className="bg-accent/20 text-accent-foreground" />
                ) : null}
              </div>
              <ProgressBar value={result.score} />
              <p className="text-sm text-muted-foreground">{result.feedback}</p>
              {transcript ? (
                <p className="text-xs text-muted-foreground">
                  Heard: <Am>{transcript}</Am>
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => goStage("listen")}
                  className="rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold hover:bg-muted"
                >
                  Hear it again
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setResult(null);
                    setTyped("");
                    setTranscript("");
                    goStage("speak");
                  }}
                  className="rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold hover:bg-muted"
                >
                  Try again
                </button>
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-2 border-t border-border/60 pt-3">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => move(-1)}
              className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-40"
            >
              Previous
            </button>
            {scores.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                {scores.length} scored · average{" "}
                {Math.round((scores.reduce((sum, n) => sum + n, 0) / scores.length) * 100)}%
              </span>
            ) : null}
            <button
              type="button"
              disabled={index + 1 >= list.length}
              onClick={() => move(1)}
              className="ml-auto inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              Next phrase <ArrowRight className="size-4" />
            </button>
          </div>
        </Card>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Quiz launcher                                                       */
/* ------------------------------------------------------------------ */

function QuizLauncher({ lessons }: { lessons: LessonRef[] }) {
  const [lessonId, setLessonId] = useState("");
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <Sparkles className="size-5 text-primary" /> Quick quiz
      </h2>
      <Card className="flex flex-wrap items-center gap-3">
        <select
          value={lessonId}
          onChange={(e) => setLessonId(e.target.value)}
          className="min-w-0 flex-1 rounded-full border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
        >
          <option value="">Choose a lesson…</option>
          {lessons.map((lesson) => (
            <option key={lesson.id} value={lesson.id}>
              {lesson.unitTitle} — {lesson.titleEn}
            </option>
          ))}
        </select>
        {lessonId ? (
          <Link
            to={`/quiz/${lessonId}`}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Start <ArrowRight className="size-4" />
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">Ten drills, shuffled fresh each run.</span>
        )}
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Word list                                                           */
/* ------------------------------------------------------------------ */

function WordList() {
  const vocabulary = useVocabulary();
  const [query, setQuery] = useState("");

  const words = useMemo(() => {
    const all = vocabulary.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 60);
    return all
      .filter(
        (w) =>
          w.amharic.includes(q) ||
          (w.transliteration ?? "").toLowerCase().includes(q) ||
          (w.english ?? "").toLowerCase().includes(q),
      )
      .slice(0, 60);
  }, [vocabulary.data, query]);

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <Search className="size-5 text-primary" /> Word list
      </h2>

      <label className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search words"
          placeholder="Search Amharic, transliteration or English"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </label>

      {vocabulary.isLoading ? (
        <Loading />
      ) : words.length ? (
        <Card className="grid gap-x-6 divide-y divide-border/70 p-0 sm:grid-cols-2 sm:divide-y-0">
          {words.map((word) => (
            <div key={word.id} className="flex items-center gap-3 border-b border-border/60 p-3.5">
              <div className="min-w-0 flex-1">
                <Am className="text-lg">{word.amharic}</Am>
                {word.transliteration ? (
                  <div className="text-xs">
                    <Translit>{word.transliteration}</Translit>
                  </div>
                ) : null}
                <p className="truncate text-sm text-muted-foreground">{word.english ?? "—"}</p>
              </div>
              <SpeakButton
                amharic={word.amharic}
                transliteration={word.transliteration}
                className="size-8"
              />
            </div>
          ))}
        </Card>
      ) : (
        <EmptyState icon={Search} title="No match" body={`Nothing found for “${query}”.`} />
      )}

      <p className="text-xs text-muted-foreground">
        Showing up to 60 words.
      </p>
    </section>
  );
}
