import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { FontSize } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { t } from "@/i18n/messages";
import { usePreview } from "@/lib/preview-plan";
import {
  failureMessage,
  failureReason,
  useCourseLesson,
} from "@/queries/catalog";
import {
  Am,
  Body,
  Button,
  Card,
  Chip,
  EmptyState,
  Loading,
  QaNote,
  ScreenHeader,
} from "@/components/ui";

/**
 * One lesson from the generated course.
 *
 * Blocks are rendered exactly as the generator produced them from the source
 * textbook — nothing here reshapes, translates or completes content. QA flags
 * travel with the lesson and are shown rather than quietly fixed.
 */

const AMHARIC = /[ሀ-፿]/;

/** Amharic strings must render through <Am> to get the Ethiopic face. */
function Line({
  children,
  size = FontSize.small,
  color,
  bold,
}: {
  children: string;
  size?: number;
  color?: string;
  bold?: boolean;
}) {
  if (AMHARIC.test(children)) {
    return (
      <Am size={size} color={color} bold={bold}>
        {children}
      </Am>
    );
  }
  return (
    <Body size={size} color={color} medium={bold}>
      {children}
    </Body>
  );
}

type Block = {
  id: string;
  kind: string;
  title: string;
  qa_flag: string | null;
  source_pages: number[];
  headers?: string[] | null | undefined;
  rows?: string[][] | undefined;
  items?: string[] | undefined;
  text?: string | undefined;
  lines?: { speaker: string | null; amharic: string; cells: string[] }[] | undefined;
};

function BlockView({ block }: { block: Block }) {
  const colors = useColors();

  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Line size={FontSize.h3} bold>
            {block.title || block.kind}
          </Line>
        </View>
        <Chip label={block.kind} />
      </View>

      {block.kind === "table" && block.rows ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}>
          {block.headers && block.headers.length > 0 ? (
            <View style={{ flexDirection: "row", backgroundColor: colors.muted }}>
              {block.headers.map((header, i) => (
                <View
                  key={`h-${i}`}
                  style={{
                    flex: 1,
                    padding: 8,
                    borderRightWidth: i < (block.headers?.length ?? 0) - 1 ? 1 : 0,
                    borderRightColor: colors.border,
                  }}
                >
                  <Line size={FontSize.caption} bold color={colors.mutedForeground}>
                    {header}
                  </Line>
                </View>
              ))}
            </View>
          ) : null}
          {block.rows.map((row, r) => (
            <View
              key={`r-${r}`}
              style={{
                flexDirection: "row",
                borderTopWidth: r === 0 && !block.headers?.length ? 0 : 1,
                borderTopColor: colors.border,
              }}
            >
              {row.map((cell, c) => (
                <View
                  key={`c-${c}`}
                  style={{
                    flex: 1,
                    padding: 8,
                    borderRightWidth: c < row.length - 1 ? 1 : 0,
                    borderRightColor: colors.border,
                  }}
                >
                  <Line size={FontSize.small}>{cell}</Line>
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null}

      {block.kind === "list" && block.items ? (
        <View style={{ gap: 6 }}>
          {block.items.map((item, i) => (
            <View key={`i-${i}`} style={{ flexDirection: "row", gap: 8 }}>
              <Body size={FontSize.small} color={colors.mutedForeground}>
                •
              </Body>
              <View style={{ flex: 1 }}>
                <Line>{item}</Line>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {block.kind === "note" && block.text ? <Line>{block.text}</Line> : null}

      {block.kind === "dialogue" && block.lines ? (
        <View style={{ gap: 8 }}>
          {block.lines.map((line, i) => (
            <View
              key={`d-${i}`}
              style={{ backgroundColor: colors.scriptSurface, borderRadius: 8, padding: 10, gap: 2 }}
            >
              {line.speaker ? (
                <Body size={FontSize.caption} medium color={colors.primary}>
                  {line.speaker}
                </Body>
              ) : null}
              <Am size={FontSize.body}>{line.amharic}</Am>
              {line.cells
                .filter((cell) => cell && cell !== line.amharic)
                .map((cell, c) => (
                  <Line key={`dc-${c}`} size={FontSize.caption} color={colors.mutedForeground}>
                    {cell}
                  </Line>
                ))}
            </View>
          ))}
        </View>
      ) : null}

      <QaNote flag={block.qa_flag} />

      {block.source_pages.length > 0 ? (
        <Body size={FontSize.caption} color={colors.mutedForeground}>
          {block.source_pages.length > 1 ? "pp." : "p."} {block.source_pages.join(", ")}
        </Body>
      ) : null}
    </Card>
  );
}

export default function CourseLessonScreen() {
  const colors = useColors();
  const { locale } = usePreview();
  const { lessonId } = useLocalSearchParams<{ lessonId: string }>();
  const query = useCourseLesson(lessonId ?? "");

  if (query.isLoading) {
    return (
      <SafeAreaView
        edges={["top", "left", "right"]}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <ScreenHeader title={t(locale, "lesson")} back />
        <Loading />
      </SafeAreaView>
    );
  }

  if (query.isError) {
    const reason = failureReason(query.error);
    return (
      <SafeAreaView
        edges={["top", "left", "right"]}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <ScreenHeader title={t(locale, "lesson")} back />
        {reason === "not_written" || reason === "lesson_not_found" ? (
          <EmptyState
            icon="construct-outline"
            title={t(locale, "notWritten")}
            body={t(locale, "notWrittenBody")}
            action={<Button label={t(locale, "course")} variant="secondary" onPress={() => router.replace("/course")} />}
          />
        ) : reason === "plan_required" ? (
          <EmptyState
            icon="lock-closed-outline"
            title={t(locale, "planRequired")}
            body={failureMessage(query.error)}
            action={<Button label={t(locale, "upgrade")} onPress={() => router.push("/pricing")} />}
          />
        ) : (
          <EmptyState
            icon="cloud-offline-outline"
            title="Could not load"
            body={failureMessage(query.error)}
            action={<Button label={t(locale, "retry")} variant="secondary" onPress={() => query.refetch()} />}
          />
        )}
      </SafeAreaView>
    );
  }

  const data = query.data;
  if (!data) return null;

  const { lesson, unit, position, prev, next, flags, provenance } = data;

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScreenHeader
        title={lesson.title_en ?? lesson.id}
        amharic={lesson.title_am}
        subtitle={`${t(locale, "unit")} ${unit.shell_unit} · ${position.order}/${position.total}`}
        back
      />

      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {unit.learning_objectives.length > 0 ? (
          <Card tone="script" style={{ gap: 6 }}>
            <Body size={FontSize.small} bold>
              {t(locale, "objectives")}
            </Body>
            {unit.learning_objectives.map((objective, i) => (
              <View key={`o-${i}`} style={{ flexDirection: "row", gap: 8 }}>
                <Ionicons name="checkmark" size={14} color={colors.primary} style={{ marginTop: 3 }} />
                <View style={{ flex: 1 }}>
                  <Line size={FontSize.small}>{objective}</Line>
                </View>
              </View>
            ))}
          </Card>
        ) : null}

        {flags.length > 0 ? (
          <View style={{ gap: 6 }}>
            {flags.map((flag) => (
              <QaNote key={`${flag.where}-${flag.code}`} flag={`${flag.code}: ${flag.detail}`} />
            ))}
          </View>
        ) : null}

        {lesson.blocks.map((block) => (
          <BlockView key={block.id} block={block as Block} />
        ))}

        {lesson.activities.length > 0 ? (
          <Card style={{ gap: 8 }}>
            <Body size={FontSize.small} bold>
              Activities in the source
            </Body>
            {lesson.activities.map((activity) => (
              <View
                key={activity.id}
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Ionicons name="ellipse-outline" size={13} color={colors.mutedForeground} />
                <View style={{ flex: 1 }}>
                  <Line size={FontSize.small}>{activity.title || activity.type}</Line>
                </View>
                {!activity.interactive ? <Chip label="reading only" /> : null}
              </View>
            ))}
          </Card>
        ) : null}

        <Card tone="muted" style={{ gap: 4 }}>
          <Body size={FontSize.caption} color={colors.mutedForeground}>
            {t(locale, "source")}: {provenance.source_title ?? provenance.source_file_id}
            {provenance.source_pages.length > 0
              ? ` · ${t(locale, "page")} ${provenance.source_pages.join(", ")}`
              : ""}
          </Body>
          <Body size={FontSize.caption} color={colors.mutedForeground}>
            {provenance.qa_policy}
          </Body>
        </Card>

        <View style={{ flexDirection: "row", gap: 10, justifyContent: "space-between" }}>
          {prev ? (
            <Button
              label={t(locale, "prev")}
              variant="secondary"
              icon="chevron-back"
              onPress={() => router.replace(`/course/${prev.id}`)}
            />
          ) : (
            <View />
          )}
          {next ? (
            <Button
              label={t(locale, "next")}
              onPress={() => router.replace(`/course/${next.id}`)}
            />
          ) : (
            <View />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
