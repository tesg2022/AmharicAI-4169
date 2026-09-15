import { useState } from "react";
import { Link } from "wouter";
import { Check, Flame, LogOut, Medal, Target, TrendingUp, Trophy, Zap } from "lucide-react";
import {
  useActivity,
  useLeaderboard,
  useLessonProgress,
  useMyProgress,
  useUpdateSettings,
} from "../queries/progress";
import { useSrsSummary } from "../queries/srs";
import { useSession } from "../hooks/use-session";
import { authClient } from "../lib/auth";
import { ProtectedRoute } from "../components/protected-route";
import { SpeechStatusCard } from "../components/speech-status";
import { Am, Card, Chip, ErrorState, Loading, ProgressBar, TibebRule } from "../components/ui/kit";
import { useSeo } from "../hooks/use-seo";

/** Learner dashboard: streak, daily goal, XP history, lesson mastery, leaderboard. */

const GOALS = [20, 50, 100, 200];

export default function ProgressPage() {
  useSeo({
    title: "Your progress",
    description: "Your streak, XP and unit mastery.",
    noIndex: true,
  });

  return (
    <div className="space-y-8">
      <ProtectedRoute message="Your streak, XP and mastery only exist once you have an account.">
        <Dashboard />
      </ProtectedRoute>
      {/* Whether the app can actually speak, and what is missing if not. This
          sits outside the auth gate on purpose: it reports app configuration,
          not learner data, and anonymous learners can practise — so they are
          exactly the people who need the silence explained. */}
      <SpeechStatusCard />
    </div>
  );
}

function Dashboard() {
  const { user } = useSession();
  const progress = useMyProgress();
  const lessons = useLessonProgress();
  const activity = useActivity(true, 28);
  const leaderboard = useLeaderboard();
  const srs = useSrsSummary();
  const updateSettings = useUpdateSettings();
  const [signingOut, setSigningOut] = useState(false);

  if (progress.isLoading) return <Loading label="Loading your progress…" />;
  if (progress.isError)
    return <ErrorState message={progress.error?.message} onRetry={() => progress.refetch()} />;

  const stats = progress.data?.stats;
  const todayXp = progress.data?.todayXp ?? 0;
  const goal = stats?.dailyGoalXp ?? 50;
  const days = activity.data ?? [];
  const peak = Math.max(1, ...days.map((d) => d.xp));
  const completed = (lessons.data ?? []).filter(
    (row) => row.status === "mastered",
  ).length;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center gap-4">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 font-display text-xl font-bold text-primary">
          {(user?.name ?? user?.email ?? "?").charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold">{user?.name ?? "Learner"}</h1>
          <p className="truncate text-sm text-muted-foreground">{user?.email}</p>
          <TibebRule className="mt-2 max-w-32" />
        </div>
        <button
          type="button"
          disabled={signingOut}
          onClick={async () => {
            setSigningOut(true);
            await authClient.signOut();
            window.location.href = "/";
          }}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          <LogOut className="size-4" /> Sign out
        </button>
      </header>

      {/* Headline stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Flame className="size-4" />}
          label="Streak"
          value={`${stats?.streakDays ?? 0}`}
          note={
            progress.data?.streakActiveToday
              ? "Active today"
              : "Earn XP today to keep it alive"
          }
          accent
        />
        <StatCard
          icon={<Zap className="size-4" />}
          label="Total XP"
          value={`${stats?.xp ?? 0}`}
          note={`Longest streak ${stats?.longestStreak ?? 0} days`}
        />
        <StatCard
          icon={<Check className="size-4" />}
          label="Lessons done"
          value={`${completed}`}
          note="of 32 in the course"
        />
        <StatCard
          icon={<Medal className="size-4" />}
          label="Review deck"
          value={`${srs.data?.total ?? 0}`}
          note={`${srs.data?.due ?? 0} due now`}
        />
      </div>

      {/* Daily goal */}
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Target className="size-5 text-primary" /> Daily goal
          </h2>
          <span className="ml-auto text-sm text-muted-foreground">
            {todayXp} / {goal} XP today
          </span>
        </div>
        <ProgressBar value={goal ? todayXp / goal : 0} barClassName="bg-accent" />
        <div className="flex flex-wrap items-center gap-2">
          {GOALS.map((value) => (
            <button
              key={value}
              type="button"
              disabled={updateSettings.isPending}
              onClick={() => updateSettings.mutate({ dailyGoalXp: value })}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                goal === value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card hover:bg-muted"
              } disabled:opacity-50`}
            >
              {value} XP
            </button>
          ))}
        </div>
        {progress.data?.goalMet ? (
          <p className="text-sm text-success">
            <Am>ጎበዝ!</Am> Goal met — the streak is safe for today.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {goal - todayXp} XP to go.{" "}
            <Link to="/flashcards" className="font-semibold text-primary hover:underline">
              Review a few cards
            </Link>{" "}
            to close it out.
          </p>
        )}
      </Card>

      {/* Activity */}
      <Card className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <TrendingUp className="size-5 text-primary" /> Last 28 days
        </h2>
        {activity.isLoading ? (
          <Loading />
        ) : (
          <>
            <div className="flex h-32 items-end gap-1">
              {days.map((day) => (
                <div
                  key={day.date}
                  title={`${day.date}: ${day.xp} XP`}
                  className="group flex h-full flex-1 items-end"
                >
                  <div
                    className={`w-full rounded-t transition-all ${
                      day.xp ? "bg-primary group-hover:bg-accent" : "bg-muted"
                    }`}
                    style={{ height: `${Math.max(4, (day.xp / peak) * 100)}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>{days[0]?.date ?? ""}</span>
              <span>{days[days.length - 1]?.date ?? ""}</span>
            </div>
          </>
        )}
      </Card>

      {/* Lesson mastery */}
      {lessons.data?.length ? (
        <Card className="space-y-3">
          <h2 className="text-lg font-bold">Lesson mastery</h2>
          <div className="divide-y divide-border/70">
            {lessons.data
              .filter((row) => row.lesson)
              .sort((a, b) => (b.mastery ?? 0) - (a.mastery ?? 0))
              .slice(0, 12)
              .map((row) => (
                <div key={row.id} className="flex items-center gap-4 py-2.5">
                  <Link
                    to={`/lesson/${row.lessonId}`}
                    className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary"
                  >
                    {row.lesson?.titleEn}
                  </Link>
                  <div className="w-28 shrink-0">
                    <ProgressBar value={row.mastery ?? 0} />
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">
                    {Math.round((row.mastery ?? 0) * 100)}%
                  </span>
                </div>
              ))}
          </div>
        </Card>
      ) : null}

      {/* Leaderboard */}
      <Card className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Trophy className="size-5 text-accent" /> Leaderboard
        </h2>
        {leaderboard.isLoading ? (
          <Loading />
        ) : (
          <div className="divide-y divide-border/70">
            {(leaderboard.data?.top ?? []).map((row) => (
              <div
                key={row.userId}
                className={`flex items-center gap-3 py-2.5 ${row.isMe ? "font-semibold" : ""}`}
              >
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    row.rank <= 3 ? "bg-accent/25 text-accent-foreground" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {row.rank}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{row.displayName}</span>
                {row.streakDays ? (
                  <Chip label={`${row.streakDays}`} icon={Flame} className="hidden sm:inline-flex" />
                ) : null}
                <span className="shrink-0 text-sm">{row.xp} XP</span>
              </div>
            ))}
            {leaderboard.data?.me && !leaderboard.data.top.some((r) => r.isMe) ? (
              <div className="flex items-center gap-3 py-2.5 font-semibold">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {leaderboard.data.me.rank}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">You</span>
                <span className="shrink-0 text-sm">{leaderboard.data.me.xp} XP</span>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      {/* Recent XP */}
      {progress.data?.recentEvents.length ? (
        <Card className="space-y-2">
          <h2 className="text-lg font-bold">Recent XP</h2>
          <div className="divide-y divide-border/70">
            {progress.data.recentEvents.slice(0, 10).map((event) => (
              <div key={event.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {event.kind.replace(/_/g, " ")}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(event.createdAt).toLocaleDateString()}
                </span>
                <span className="w-14 shrink-0 text-right font-semibold text-primary">
                  +{event.amount}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  note,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note?: string;
  accent?: boolean;
}) {
  return (
    <Card className="space-y-1.5">
      <span
        className={`inline-flex size-8 items-center justify-center rounded-lg ${
          accent ? "bg-accent/20 text-accent-foreground" : "bg-primary/10 text-primary"
        }`}
      >
        {icon}
      </span>
      <p className="font-display text-3xl font-bold">{value}</p>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </Card>
  );
}
