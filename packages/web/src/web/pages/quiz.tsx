import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, ArrowRight, Check, RotateCcw, X } from "lucide-react";
import { useQuiz, useSubmitAnswer, useUnitExam } from "../queries/practice";
import { useSession } from "../hooks/use-session";
import {
  Am,
  Card,
  Chip,
  ErrorState,
  Loading,
  ProgressBar,
  QaNote,
  TibebRule,
  isAmharic,
} from "../components/ui/kit";

/**
 * Quiz runner — one route for both question sources.
 *
 * `/quiz/:lessonId` runs the generated drills for a lesson; a `unit-` prefixed
 * id runs that unit's source assessment bank, whose questions are served
 * exactly as the manual wrote them (only units 5 and 6 have one).
 */

type Result = {
  isCorrect: boolean;
  correctOptionId: string | null;
  correctAnswer: string | string[] | null;
  explanation: string | null;
  sourcePage: number | null;
  xpAwarded: number;
};

export default function QuizPage() {
  const params = useParams<{ lessonId: string }>();
  const raw = params.lessonId ?? "";
  const isUnitExam = raw.startsWith("unit-");
  const unitId = isUnitExam ? raw.slice(5) : "";

  const quiz = useQuiz(isUnitExam ? "" : raw);
  const exam = useUnitExam(unitId);
  const source = isUnitExam ? exam : quiz;

  const submit = useSubmitAnswer();
  const { isSignedIn } = useSession();

  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [score, setScore] = useState({ correct: 0, answered: 0 });
  const [finished, setFinished] = useState(false);

  const questions = useMemo(() => source.data?.questions ?? [], [source.data]);
  const question = questions[index];

  const heading = isUnitExam
    ? (exam.data?.assessment.title ?? "Unit assessment")
    : (quiz.data?.lesson.titleEn ?? "Practice");

  function reset() {
    setIndex(0);
    setTyped("");
    setPicked(null);
    setResult(null);
    setScore({ correct: 0, answered: 0 });
    setFinished(false);
    void source.refetch();
  }

  function check() {
    if (!question || result || submit.isPending) return;
    const answer = picked
      ? (question.options.find((o) => o.id === picked)?.optionText ?? "")
      : typed.trim();
    if (!answer) return;

    submit.mutate(
      { questionId: question.id, answer, optionId: picked ?? undefined },
      {
        onSuccess: (res) => {
          setResult(res as Result);
          setScore((s) => ({
            correct: s.correct + (res.isCorrect ? 1 : 0),
            answered: s.answered + 1,
          }));
        },
      },
    );
  }

  function next() {
    if (index + 1 >= questions.length) {
      setFinished(true);
      return;
    }
    setIndex((i) => i + 1);
    setTyped("");
    setPicked(null);
    setResult(null);
  }

  if (source.isLoading) return <Loading label="Building your quiz…" />;

  if (source.isError)
    return (
      <div className="space-y-4">
        <BackLink isUnitExam={isUnitExam} lessonId={raw} />
        <ErrorState
          message={
            isUnitExam
              ? "This unit has no source assessment in the manual — practise the lessons instead."
              : source.error?.message
          }
          onRetry={isUnitExam ? undefined : () => source.refetch()}
        />
      </div>
    );

  if (!questions.length)
    return (
      <div className="space-y-4">
        <BackLink isUnitExam={isUnitExam} lessonId={raw} />
        <ErrorState message="No questions for this lesson yet." />
      </div>
    );

  if (finished) {
    const pct = score.answered ? Math.round((score.correct / score.answered) * 100) : 0;
    return (
      <div className="mx-auto max-w-lg space-y-5 py-6">
        <Card className="space-y-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {heading}
          </p>
          <p className="font-display text-6xl font-bold text-primary">{pct}%</p>
          <p className="text-sm text-muted-foreground">
            {score.correct} of {score.answered} correct
          </p>
          <ProgressBar value={score.answered ? score.correct / score.answered : 0} />
          <p className="text-sm">
            {pct >= 80 ? (
              <Am className="text-lg text-primary">በጣም ጥሩ!</Am>
            ) : (
              "Worth another pass — repetition is the whole game."
            )}
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              <RotateCcw className="size-4" /> Try again
            </button>
            <Link
              to={isUnitExam ? "/" : `/lesson/${raw}`}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-semibold hover:bg-muted"
            >
              Back to the lesson
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  if (!question) return <Loading />;

  const hasOptions = question.options.length > 0;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <BackLink isUnitExam={isUnitExam} lessonId={raw} />
        <span className="ml-auto text-sm text-muted-foreground">
          {index + 1} / {questions.length}
        </span>
      </div>

      <ProgressBar value={(index + (result ? 1 : 0)) / questions.length} />

      <Card className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Chip label={question.questionType.replace(/_/g, " ")} />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-semibold leading-snug">{question.questionText}</h1>
          {question.questionAm ? (
            <Am className="block text-2xl text-primary">{question.questionAm}</Am>
          ) : null}
        </div>

        <TibebRule className="max-w-32" />

        {hasOptions ? (
          <div className="grid gap-2">
            {question.options.map((option) => {
              const chosen = picked === option.id;
              const isRight = result?.correctOptionId === option.id;
              const isWrongPick = Boolean(result) && chosen && !result?.isCorrect;
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={Boolean(result)}
                  onClick={() => setPicked(option.id)}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
                    isRight
                      ? "border-success bg-success/10"
                      : isWrongPick
                        ? "border-destructive bg-destructive/10"
                        : chosen
                          ? "border-primary bg-primary/5"
                          : "border-border bg-background hover:border-primary/40"
                  } disabled:cursor-default`}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold uppercase">
                    {option.optionKey ?? "?"}
                  </span>
                  <span className="min-w-0 flex-1">
                    {isAmharic(option.optionText) ? (
                      <Am className="text-lg">{option.optionText}</Am>
                    ) : (
                      <span className="text-[15px]">{option.optionText}</span>
                    )}
                  </span>
                  {isRight ? <Check className="size-4 shrink-0 text-success" /> : null}
                  {isWrongPick ? <X className="size-4 shrink-0 text-destructive" /> : null}
                </button>
              );
            })}
          </div>
        ) : (
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label="Your answer"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (result) next();
              else check();
            }}
            disabled={Boolean(result)}
            placeholder="Type your answer"
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-[15px] outline-none focus:border-primary disabled:opacity-70"
          />
        )}

        {result ? (
          <div
            className={`space-y-2 rounded-xl border-l-[3px] p-4 ${
              result.isCorrect
                ? "border-success bg-success/10"
                : "border-destructive bg-destructive/10"
            }`}
          >
            <p className="flex items-center gap-2 font-semibold">
              {result.isCorrect ? (
                <>
                  <Check className="size-4 text-success" /> Correct
                  {result.xpAwarded ? (
                    <span className="text-sm font-medium text-muted-foreground">
                      +{result.xpAwarded} XP
                    </span>
                  ) : null}
                </>
              ) : (
                <>
                  <X className="size-4 text-destructive" /> Not quite
                </>
              )}
            </p>
            {!result.isCorrect && result.correctAnswer ? (
              <p className="text-sm">
                Answer:{" "}
                {(Array.isArray(result.correctAnswer)
                  ? result.correctAnswer
                  : [result.correctAnswer]
                ).map((a, i) => (
                  <span key={i}>
                    {i > 0 ? " · " : ""}
                    {isAmharic(String(a)) ? <Am className="text-lg">{String(a)}</Am> : String(a)}
                  </span>
                ))}
              </p>
            ) : null}
            {result.explanation ? (
              <p className="text-sm text-muted-foreground">{result.explanation}</p>
            ) : null}
          </div>
        ) : null}

        <QaNote flag={question.qaFlag} />

        <div className="flex items-center gap-3">
          {result ? (
            <button
              type="button"
              onClick={next}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              {index + 1 >= questions.length ? "See results" : "Next"}{" "}
              <ArrowRight className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={check}
              disabled={submit.isPending || (hasOptions ? !picked : !typed.trim())}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Check
            </button>
          )}
          {!isSignedIn ? (
            <span className="text-xs text-muted-foreground">
              Answers are graded but not saved while signed out.
            </span>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function BackLink({ isUnitExam, lessonId }: { isUnitExam: boolean; lessonId: string }) {
  return (
    <Link
      to={isUnitExam ? "/" : `/lesson/${lessonId}`}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> {isUnitExam ? "Course" : "Lesson"}
    </Link>
  );
}
