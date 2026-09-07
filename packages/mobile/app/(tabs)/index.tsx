import { useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { FontSize, Radius, shadow } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useSession } from "@/hooks/use-session";
import { useOutline } from "@/queries/content";
import { useLessonProgress, useMyProgress } from "@/queries/progress";
import {
  Am,
  Body,
  Card,
  Chip,
  ErrorState,
  Loading,
  ProgressBar,
  TibebRule,
  Title,
} from "@/components/ui";

/**
 * The learning path: units stacked vertically, lessons alternating left and
 * right of a spine so progress reads as a journey rather than a list.
 */

type LessonNode = {
  id: string;
  titleEn: string;
  titleAm: string | null;
  sourcePages: number[];
};

function StreakHeader() {
  const colors = useColors();
  const { isSignedIn } = useSession();
  const progress = useMyProgress(isSignedIn);

  const stats = progress.data?.stats;
  const todayXp = progress.data?.todayXp ?? 0;
  const goal = stats?.dailyGoalXp ?? 50;

  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16, gap: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View>
          <Title size={FontSize.hero}>AmharicAI</Title>
          <Am size={FontSize.small} color={colors.primary}>
            አማርኛ ለመማር ቀላል ዘዴዎች
          </Am>
        </View>
        <Pressable
          onPress={() => router.push(isSignedIn ? "/profile" : "/sign-in")}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.borderStrong,
          }}
        >
          <Ionicons
            name={isSignedIn ? "person" : "log-in-outline"}
            size={20}
            color={colors.primary}
          />
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <Card style={{ flex: 1, padding: 12, gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="flame" size={15} color={colors.accentInk} />
            <Body size={FontSize.caption} color={colors.mutedForeground} medium>
              Streak
            </Body>
          </View>
          <Title size={FontSize.h2}>{stats?.streakDays ?? 0}</Title>
        </Card>
        <Card style={{ flex: 1, padding: 12, gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="star" size={15} color={colors.accentInk} />
            <Body size={FontSize.caption} color={colors.mutedForeground} medium>
              Total XP
            </Body>
          </View>
          <Title size={FontSize.h2}>{stats?.xp ?? 0}</Title>
        </Card>
        <Card style={{ flex: 2, padding: 12, gap: 8, justifyContent: "center" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Body size={FontSize.caption} color={colors.mutedForeground} medium>
              Today's goal
            </Body>
            <Body size={FontSize.caption} medium>
              {todayXp}/{goal} XP
            </Body>
          </View>
          <ProgressBar value={goal ? todayXp / goal : 0} color={colors.accent} />
          {!isSignedIn ? (
            <Body size={FontSize.caption - 1} color={colors.mutedForeground}>
              Sign in to track this
            </Body>
          ) : null}
        </Card>
      </View>
    </View>
  );
}

function LessonBubble({
  lesson,
  index,
  mastery,
  status,
}: {
  lesson: LessonNode;
  index: number;
  mastery: number;
  status: string;
}) {
  const colors = useColors();
  const left = index % 2 === 0;
  const done = status === "mastered" || status === "completed";
  const started = status === "in_progress" || mastery > 0;

  const bubbleColor = done ? colors.primary : started ? colors.accent : colors.card;
  const iconColor = done
    ? colors.primaryForeground
    : started
      ? colors.accentForeground
      : colors.mutedForeground;

  return (
    <View
      style={{
        flexDirection: left ? "row" : "row-reverse",
        alignItems: "center",
        gap: 12,
        paddingVertical: 8,
      }}
    >
      <Pressable
        onPress={() => router.push(`/lesson/${lesson.id}`)}
        style={({ pressed }) => ({
          width: 58,
          height: 58,
          borderRadius: 29,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: bubbleColor,
          borderWidth: 2,
          borderColor: done ? colors.primary : started ? colors.accent : colors.border,
          opacity: pressed ? 0.8 : 1,
          ...shadow,
        })}
      >
        <Ionicons
          name={done ? "checkmark" : started ? "play" : "ellipse-outline"}
          size={22}
          color={iconColor}
        />
      </Pressable>

      <Pressable
        onPress={() => router.push(`/lesson/${lesson.id}`)}
        style={{ flex: 1, alignItems: left ? "flex-start" : "flex-end", gap: 2 }}
      >
        <Body size={FontSize.small} medium numberOfLines={2}>
          {lesson.titleEn}
        </Body>
        {lesson.titleAm ? (
          <Am size={FontSize.caption} color={colors.mutedForeground} numberOfLines={1}>
            {lesson.titleAm}
          </Am>
        ) : null}
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          {mastery > 0 ? (
            <Chip
              label={`${Math.round(mastery * 100)}%`}
              color={colors.primary}
              background={colors.primary + "1A"}
            />
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

export default function LearnScreen() {
  const colors = useColors();
  const { isSignedIn } = useSession();
  const outline = useOutline();
  const lessonProgress = useLessonProgress(isSignedIn);

  const progressByLesson = useMemo(() => {
    const map = new Map<string, { mastery: number; status: string }>();
    for (const row of lessonProgress.data ?? []) {
      if (row.lessonId) map.set(row.lessonId, { mastery: row.mastery, status: row.status });
    }
    return map;
  }, [lessonProgress.data]);

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <StreakHeader />

        {outline.isLoading ? (
          <Loading label="Loading your course…" />
        ) : outline.isError ? (
          <ErrorState message={outline.error?.message} onRetry={() => outline.refetch()} />
        ) : (
          (outline.data?.units ?? []).map((unit) => {
            const unitLessons = unit.lessons ?? [];
            const completed = unitLessons.filter(
              (l) => (progressByLesson.get(l.id)?.mastery ?? 0) > 0,
            ).length;

            return (
              <View key={unit.id} style={{ paddingHorizontal: 20, marginTop: 12 }}>
                <Card tone="script" style={{ gap: 10 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Body size={FontSize.caption} color={colors.primary} bold>
                        UNIT {unit.sortOrder}
                      </Body>
                      <Title size={FontSize.h3}>{unit.titleEn}</Title>
                      {unit.titleAm ? (
                        <Am size={FontSize.small} color={colors.mutedForeground}>
                          {unit.titleAm}
                        </Am>
                      ) : null}
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 6 }}>
                      <Body size={FontSize.caption} color={colors.mutedForeground}>
                        {completed}/{unitLessons.length} lessons
                      </Body>
                    </View>
                  </View>

                  {unit.objectives?.length ? (
                    <View style={{ gap: 4 }}>
                      {unit.objectives.slice(0, 3).map((objective, i) => (
                        <View key={i} style={{ flexDirection: "row", gap: 6 }}>
                          <Ionicons
                            name="ellipse"
                            size={6}
                            color={colors.primary}
                            style={{ marginTop: 7 }}
                          />
                          <Body
                            size={FontSize.caption}
                            color={colors.mutedForeground}
                            style={{ flex: 1 }}
                          >
                            {objective}
                          </Body>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  <ProgressBar
                    value={unitLessons.length ? completed / unitLessons.length : 0}
                  />
                </Card>

                <View style={{ alignItems: "center", paddingVertical: 10 }}>
                  <TibebRule width={120} />
                </View>

                <View style={{ position: "relative" }}>
                  {/* the spine the lesson bubbles alternate around */}
                  <View
                    style={{
                      position: "absolute",
                      left: 28,
                      top: 12,
                      bottom: 12,
                      width: 2,
                      backgroundColor: colors.border,
                    }}
                  />
                  {unitLessons.map((lesson, index) => {
                    const state = progressByLesson.get(lesson.id);
                    return (
                      <LessonBubble
                        key={lesson.id}
                        index={index}
                        lesson={lesson}
                        mastery={state?.mastery ?? 0}
                        status={state?.status ?? "not_started"}
                      />
                    );
                  })}
                </View>

                {unit.sortOrder >= 5 ? (
                  <Pressable
                    onPress={() => router.push(`/quiz/unit-${unit.id}`)}
                    style={{
                      marginTop: 8,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      padding: 14,
                      borderRadius: Radius.card,
                      borderWidth: 1,
                      borderStyle: "dashed",
                      borderColor: colors.primary + "66",
                      backgroundColor: colors.primary + "0D",
                    }}
                  >
                    <Ionicons name="ribbon-outline" size={20} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Body size={FontSize.small} medium>
                        Unit {unit.sortOrder} assessment
                      </Body>
                      <Body size={FontSize.caption} color={colors.mutedForeground}>
                        Questions exactly as written in the manual
                      </Body>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
                  </Pressable>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
