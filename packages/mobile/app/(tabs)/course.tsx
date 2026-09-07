import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { FontSize, Radius } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { t } from "@/i18n/messages";
import { usePreview } from "@/lib/preview-plan";
import { useCourseMap, failureMessage } from "@/queries/catalog";
import {
  Am,
  Body,
  Card,
  Chip,
  ErrorState,
  Loading,
  ScreenHeader,
  Title,
} from "@/components/ui";

/**
 * The 20-unit course map.
 *
 * Units 1-6 carry real lessons from the source textbook. Units 7-20 are
 * advertised scope only and render as "not yet written" — deliberately NOT as
 * locked-behind-a-paywall, because selling them would be a lie. Access is
 * resolved server-side; this screen only renders the answer it is given.
 */

type UnitAccess = {
  allowed: boolean;
  reason: "ok" | "not_written" | "plan_required";
  required_plan?: string | undefined;
};

function PlanChip() {
  const colors = useColors();
  const { plan, locale } = usePreview();
  return (
    <Pressable
      onPress={() => router.push("/pricing")}
      accessibilityRole="button"
      // Spelled out, because "Plan: free preview" read as bare chip text does
      // not tell a screen-reader user that the word "preview" is the point.
      accessibilityLabel={`Current plan: ${plan}. This is a preview switch, not a subscription. Opens plans.`}
      hitSlop={8}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: Radius.pill,
          borderWidth: 1,
          borderColor: colors.borderStrong,
          backgroundColor: colors.card,
        }}
      >
        <Body size={FontSize.caption} medium color={colors.foreground}>
          {t(locale, "plan")}: {plan}
        </Body>
        <Body size={FontSize.caption} color={colors.warning}>
          {t(locale, "preview")}
        </Body>
      </View>
    </Pressable>
  );
}

function LocaleToggle() {
  const colors = useColors();
  const { locale, toggleLocale } = usePreview();
  return (
    <Pressable
      onPress={toggleLocale}
      accessibilityRole="button"
      accessibilityLabel={locale === "en" ? "Switch to Amharic" : "Switch to English"}
      hitSlop={8}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: colors.borderStrong,
          backgroundColor: colors.card,
        }}
      >
        <Am size={FontSize.caption} bold color={colors.primary}>
          {locale === "en" ? "አ" : "A"}
        </Am>
      </View>
    </Pressable>
  );
}

function UnitCard({
  unit,
}: {
  unit: {
    id: string;
    shell_unit: number;
    status: string;
    title_en: string;
    title_am: string;
    shell_title_en: string;
    description: string;
    key_phrase: { amharic: string; english: string } | null;
    access: UnitAccess;
    lessons: { id: string; label: string; title_am: string | null; blocks: number; flags: number }[];
  };
}) {
  const colors = useColors();
  const { locale } = usePreview();
  const notWritten = unit.status !== "written";
  const gated = !notWritten && !unit.access.allowed;

  return (
    <Card
      tone={notWritten ? "muted" : "card"}
      style={{
        gap: 10,
        borderStyle: notWritten ? "dashed" : "solid",
        opacity: notWritten ? 0.85 : 1,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: notWritten ? colors.muted : colors.primary,
            borderWidth: notWritten ? 1 : 0,
            borderColor: colors.border,
          }}
        >
          <Body
            size={FontSize.small}
            bold
            color={notWritten ? colors.mutedForeground : colors.primaryForeground}
          >
            {unit.shell_unit}
          </Body>
        </View>
        <View style={{ flex: 1 }}>
          <Title size={FontSize.h3} numberOfLines={2}>
            {notWritten ? unit.shell_title_en : unit.title_en}
          </Title>
          {unit.title_am ? (
            <Am size={FontSize.small} color={colors.primary}>
              {unit.title_am}
            </Am>
          ) : null}
        </View>
      </View>

      {unit.description ? (
        <Body size={FontSize.small} color={colors.mutedForeground}>
          {unit.description}
        </Body>
      ) : null}

      {unit.key_phrase ? (
        <View
          style={{
            backgroundColor: colors.scriptSurface,
            borderRadius: 10,
            padding: 10,
            gap: 2,
          }}
        >
          <Am size={FontSize.body}>{unit.key_phrase.amharic}</Am>
          <Body size={FontSize.caption} color={colors.mutedForeground}>
            {unit.key_phrase.english}
          </Body>
        </View>
      ) : null}

      {notWritten ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Chip label={t(locale, "notWritten")} icon="construct-outline" />
        </View>
      ) : gated ? (
        <View style={{ gap: 8 }}>
          <Chip
            label={t(locale, "planRequired")}
            icon="lock-closed-outline"
            color={colors.warning}
            background={colors.accent + "22"}
          />
          <Pressable
            onPress={() => router.push("/pricing")}
            accessibilityRole="button"
            accessibilityLabel={t(locale, "upgrade")}
            hitSlop={8}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Body size={FontSize.small} medium color={colors.primary}>
              {t(locale, "upgrade")} →
            </Body>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          {unit.lessons.map((lesson) => (
            <Pressable
              key={lesson.id}
              onPress={() => router.push(`/course/${lesson.id}`)}
              accessibilityRole="link"
              accessibilityLabel={`${t(locale, "lesson")}: ${lesson.label || lesson.title_am || lesson.id}`}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                minHeight: 44,
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 10,
                backgroundColor: pressed ? colors.muted : colors.background,
                borderWidth: 1,
                borderColor: colors.borderStrong,
              })}
            >
              <Ionicons name="document-text-outline" size={16} color={colors.primary} />
              <View style={{ flex: 1 }}>
                {/* Lessons whose source has no English title keep the Amharic
                    title — no English title is invented for them. */}
                {/[ሀ-፿]/.test(lesson.label) ? (
                  <Am size={FontSize.small} numberOfLines={2}>
                    {lesson.label}
                  </Am>
                ) : (
                  <Body size={FontSize.small} medium numberOfLines={2}>
                    {lesson.label}
                  </Body>
                )}
              </View>
              {lesson.flags > 0 ? (
                <Ionicons name="alert-circle-outline" size={15} color={colors.warning} />
              ) : null}
              <Ionicons name="chevron-forward" size={15} color={colors.mutedForeground} />
            </Pressable>
          ))}
        </View>
      )}
    </Card>
  );
}

export default function CourseScreen() {
  const colors = useColors();
  const { locale } = usePreview();
  const course = useCourseMap();

  const stats = course.data?.stats;
  const qa = course.data?.qa;

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScreenHeader
        title={t(locale, "course")}
        subtitle={t(locale, "courseSubtitle")}
        right={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <LocaleToggle />
            <PlanChip />
          </View>
        }
      />

      {course.isLoading ? (
        <Loading />
      ) : course.isError ? (
        <ErrorState message={failureMessage(course.error)} onRetry={() => course.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {stats ? (
            <Card tone="script" style={{ gap: 6 }}>
              <Body size={FontSize.small} medium>
                {stats["units_written"] ?? 0} of {stats["units_total"] ?? 0} units written ·{" "}
                {stats["lessons"] ?? 0} {t(locale, "lessons")}
              </Body>
              <Body size={FontSize.caption} color={colors.mutedForeground}>
                Units {(stats["units_written"] ?? 0) + 1}-{stats["units_total"] ?? 0} are advertised
                scope only: a title and a key phrase, with no lessons written yet.
              </Body>
              {qa ? (
                <Body size={FontSize.caption} color={colors.mutedForeground}>
                  {qa.errors} errors · {qa.warnings} warnings from the {t(locale, "qaWarnings")},
                  shown on the lessons they belong to.
                </Body>
              ) : null}
            </Card>
          ) : null}

          {/*
            Said out loud, because an interface with no progress numbers is
            easily read as "0% complete". Nothing is recorded at all: there is
            no account store in this build, so a completion, score or streak
            here could only be invented.
          */}
          <Card tone="muted" style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="information-circle-outline" size={16} color={colors.mutedForeground} />
              {locale === "am" ? (
                <Am size={FontSize.small} bold>
                  {t(locale, "progressNotTracked")}
                </Am>
              ) : (
                <Body size={FontSize.small} medium>
                  {t(locale, "progressNotTracked")}
                </Body>
              )}
            </View>
            {locale === "am" ? (
              <Am size={FontSize.caption} color={colors.mutedForeground}>
                {t(locale, "progressNotTrackedBody")}
              </Am>
            ) : (
              <Body size={FontSize.caption} color={colors.mutedForeground}>
                {t(locale, "progressNotTrackedBody")}
              </Body>
            )}
          </Card>

          {(course.data?.units ?? []).map((unit) => (
            <UnitCard key={unit.id} unit={unit as Parameters<typeof UnitCard>[0]["unit"]} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
