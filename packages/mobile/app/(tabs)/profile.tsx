import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { FontSize, Radius } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useSession } from "@/hooks/use-session";
import { authClient, clearToken } from "@/lib/auth";
import { usePreview } from "@/lib/preview-plan";
import { useCourseStats } from "@/queries/content";
import {
  useActivity,
  useLeaderboard,
  useMyProgress,
  useUpdateSettings,
} from "@/queries/progress";
import {
  Am,
  Body,
  Button,
  Card,
  Chip,
  Loading,
  ProgressBar,
  SignInPrompt,
  TibebRule,
  Title,
} from "@/components/ui";
import { SpeechStatusCard } from "@/components/speech-status";

const GOAL_OPTIONS = [20, 50, 100, 200];

function ActivityChart({ data }: { data: { date: string; xp: number }[] }) {
  const colors = useColors();
  const recent = data.slice(-28);
  const max = Math.max(10, ...recent.map((d) => d.xp));

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3, height: 90 }}>
        {recent.map((day) => (
          <View
            key={day.date}
            style={{
              flex: 1,
              height: `${Math.max(4, (day.xp / max) * 100)}%`,
              borderRadius: 3,
              backgroundColor: day.xp > 0 ? colors.primary : colors.muted,
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Body size={FontSize.caption} color={colors.mutedForeground}>
          {recent[0]?.date.slice(5) ?? ""}
        </Body>
        <Body size={FontSize.caption} color={colors.mutedForeground}>
          today
        </Body>
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { user, isSignedIn, isPending } = useSession();
  const progress = useMyProgress(isSignedIn);
  const activity = useActivity(isSignedIn);
  const leaderboard = useLeaderboard(isSignedIn);
  const courseStats = useCourseStats();
  const updateSettings = useUpdateSettings();
  const { plan: previewPlan, locale, toggleLocale } = usePreview();
  const [signingOut, setSigningOut] = useState(false);

  const stats = progress.data?.stats;
  const todayXp = progress.data?.todayXp ?? 0;
  const goal = stats?.dailyGoalXp ?? 50;

  // NOTE: these come from the seeded Drizzle tables that power the legacy
  // drills, XP and review deck — NOT from course.generated.json, which is the
  // source-faithful 20-unit course shown on the Course tab. The numbers do not
  // match because they are two different content sets. Labelled as such below
  // rather than quietly showing whichever is larger.
  const totals = useMemo(
    () => [
      { label: "Units", value: courseStats.data?.units ?? "—" },
      { label: "Lessons", value: courseStats.data?.lessons ?? "—" },
      { label: "Words", value: courseStats.data?.words ?? "—" },
      { label: "Drills", value: courseStats.data?.practiceQuestions ?? "—" },
    ],
    [courseStats.data],
  );

  async function signOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
    } catch {
      // Even a failed server call should drop the local token.
    }
    await clearToken();
    queryClient.clear();
    setSigningOut(false);
    router.replace("/");
  }

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <Title size={FontSize.h1}>Profile</Title>

        {isPending ? (
          <Loading />
        ) : !isSignedIn ? (
          <Card>
            <SignInPrompt message="Your streak, XP, review deck and lesson mastery all sync once you sign in." />
          </Card>
        ) : (
          <>
            <Card style={{ gap: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 26,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: colors.primary,
                  }}
                >
                  <Title size={FontSize.h2} color={colors.primaryForeground}>
                    {(user?.name ?? user?.email ?? "?").slice(0, 1).toUpperCase()}
                  </Title>
                </View>
                <View style={{ flex: 1 }}>
                  <Title size={FontSize.h3}>{user?.name ?? "Learner"}</Title>
                  <Body size={FontSize.caption} color={colors.mutedForeground}>
                    {user?.email}
                  </Body>
                </View>
                {progress.data?.streakActiveToday ? (
                  <Chip
                    label="Active today"
                    icon="flame"
                    color={colors.accentForeground}
                    background={colors.accent}
                  />
                ) : null}
              </View>

              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                {[
                  { label: "XP", value: stats?.xp ?? 0 },
                  { label: "Streak", value: stats?.streakDays ?? 0 },
                  { label: "Best", value: stats?.longestStreak ?? 0 },
                ].map((item) => (
                  <View key={item.label} style={{ alignItems: "center", gap: 2 }}>
                    <Title size={FontSize.h2}>{item.value}</Title>
                    <Body size={FontSize.caption} color={colors.mutedForeground}>
                      {item.label}
                    </Body>
                  </View>
                ))}
              </View>

              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Body size={FontSize.caption} color={colors.mutedForeground} medium>
                    Today
                  </Body>
                  <Body size={FontSize.caption} medium>
                    {todayXp}/{goal} XP
                  </Body>
                </View>
                <ProgressBar value={goal ? todayXp / goal : 0} color={colors.accent} />
              </View>
            </Card>

            <Card style={{ gap: 10 }}>
              <Title size={FontSize.h3}>Daily goal</Title>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {GOAL_OPTIONS.map((option) => {
                  const active = option === goal;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => updateSettings.mutate({ dailyGoalXp: option })}
                      style={{
                        flex: 1,
                        paddingVertical: 10,
                        borderRadius: Radius.pill,
                        alignItems: "center",
                        backgroundColor: active ? colors.primary : colors.muted,
                        borderWidth: 1,
                        borderColor: active ? colors.primary : colors.border,
                      }}
                    >
                      <Body
                        size={FontSize.caption}
                        bold
                        color={active ? colors.primaryForeground : colors.mutedForeground}
                      >
                        {option} XP
                      </Body>
                    </Pressable>
                  );
                })}
              </View>
            </Card>

            <Card style={{ gap: 12 }}>
              <Title size={FontSize.h3}>Last 4 weeks</Title>
              {activity.isLoading ? (
                <Loading />
              ) : (
                <ActivityChart data={activity.data ?? []} />
              )}
            </Card>

            <Card style={{ gap: 12 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Title size={FontSize.h3}>Leaderboard</Title>
                {leaderboard.data?.me ? (
                  <Chip
                    label={`You: #${leaderboard.data.me.rank}`}
                    color={colors.primary}
                    background={colors.primary + "1A"}
                  />
                ) : null}
              </View>
              {leaderboard.isLoading ? (
                <Loading />
              ) : (
                (leaderboard.data?.top ?? []).slice(0, 10).map((row) => (
                  <View
                    key={row.userId}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      paddingVertical: 6,
                      paddingHorizontal: row.isMe ? 10 : 0,
                      borderRadius: 10,
                      backgroundColor: row.isMe ? colors.primary + "12" : "transparent",
                    }}
                  >
                    <Body
                      size={FontSize.small}
                      bold
                      color={row.rank <= 3 ? colors.accent : colors.mutedForeground}
                      style={{ width: 26 }}
                    >
                      {row.rank}
                    </Body>
                    <Body size={FontSize.small} medium style={{ flex: 1 }} numberOfLines={1}>
                      {row.displayName}
                    </Body>
                    {row.streakDays > 0 ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                        <Ionicons name="flame" size={12} color={colors.accent} />
                        <Body size={FontSize.caption} color={colors.mutedForeground}>
                          {row.streakDays}
                        </Body>
                      </View>
                    ) : null}
                    <Body size={FontSize.small} bold color={colors.primary}>
                      {row.xp}
                    </Body>
                  </View>
                ))
              )}
            </Card>
          </>
        )}

        {/* Plans and free-text translation. The plan shown is a preview switch
            on this device, not a subscription — this build has no accounts. */}
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Title size={FontSize.h3} style={{ flex: 1 }}>
              Plan
            </Title>
            <Chip label={`${previewPlan} · preview`} icon="eye-outline" color={colors.warning} />
          </View>
          <Body size={FontSize.caption} color={colors.mutedForeground}>
            Nothing can be purchased yet: there is no payment key and no account store to record a
            subscription against.
          </Body>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Button
              label="See plans"
              variant="secondary"
              icon="pricetags-outline"
              onPress={() => router.push("/pricing")}
            />
            <Button
              label="Translate"
              variant="secondary"
              icon="language-outline"
              onPress={() => router.push("/translate")}
            />
          </View>
          <Pressable onPress={toggleLocale}>
            <Body size={FontSize.caption} medium color={colors.primary}>
              UI language: {locale === "en" ? "English" : "አማርኛ"} — tap to switch
            </Body>
          </Pressable>
        </Card>

        {/* Whether the app can actually speak, and what is missing if not */}
        <SpeechStatusCard />

        <Card tone="script" style={{ gap: 10, alignItems: "center" }}>
          <Am size={FontSize.h3} bold color={colors.primary}>
            አማርኛ ለመማር ቀላል ዘዴዎች
          </Am>
          <TibebRule width={140} />
          <View style={{ flexDirection: "row", justifyContent: "space-around", width: "100%" }}>
            {totals.map((item) => (
              <View key={item.label} style={{ alignItems: "center" }}>
                <Title size={FontSize.h3}>{item.value}</Title>
                <Body size={FontSize.caption} color={colors.mutedForeground}>
                  {item.label}
                </Body>
              </View>
            ))}
          </View>
          <Body size={FontSize.caption} color={colors.mutedForeground} style={{ textAlign: "center" }}>
            Counted from the seeded practice set behind the signed-in drills and XP. It is a
            different, older content set from the source-faithful course on the Course tab, which
            has 20 units with 6 written. The two are not the same curriculum yet — trust the Course
            tab for what has actually been written from the textbook.
          </Body>
        </Card>

        {isSignedIn ? (
          <Button
            label="Sign out"
            variant="secondary"
            icon="log-out-outline"
            full
            loading={signingOut}
            onPress={signOut}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
