import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { FontSize, Radius } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useSession } from "@/hooks/use-session";
import { useLesson } from "@/queries/content";
import { useCompleteLesson } from "@/queries/practice";
import { useAddLessonToDeck } from "@/queries/srs";
import {
  Am,
  Body,
  Button,
  Card,
  Chip,
  ErrorState,
  Loading,
  QaNote,
  ScreenHeader,
  SpeakButton,
  TibebRule,
  Title,
  Translit,
} from "@/components/ui";
import { SourceValue, humanize } from "@/components/source-value";
import { DialoguePlayer } from "@/components/dialogue-player";

/**
 * The lesson reader.
 *
 * Everything the source spec carries for a lesson is rendered here: the
 * dedicated tables (vocabulary, grammar, verb paradigms, dialogues,
 * activities) plus every remaining block kept verbatim in `lesson_sections`.
 * Unknown section types are never skipped — they fall through to a labelled
 * key/value block.
 */

function Section({
  title,
  icon,
  children,
  tone,
}: {
  title: string;
  icon?: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
  tone?: "card" | "script" | "muted";
}) {
  const colors = useColors();
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {icon ? <Ionicons name={icon} size={16} color={colors.primary} /> : null}
        <Title size={FontSize.h3} style={{ flexShrink: 1 }}>
          {title}
        </Title>
      </View>
      <Card tone={tone}>{children}</Card>
    </View>
  );
}

function VocabRow({
  amharic,
  transliteration,
  english,
  partOfSpeech,
  notes,
  last,
}: {
  amharic: string;
  transliteration: string | null;
  english: string | null;
  partOfSpeech: string | null;
  notes: string | null;
  last: boolean;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 10,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Am size={FontSize.h3}>{amharic}</Am>
        {transliteration ? <Translit>{transliteration}</Translit> : null}
        {english ? (
          <Body size={FontSize.small} color={colors.mutedForeground}>
            {english}
          </Body>
        ) : null}
        {notes ? (
          <Body size={FontSize.caption} color={colors.mutedForeground}>
            {notes}
          </Body>
        ) : null}
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
          {partOfSpeech ? <Chip label={partOfSpeech} /> : null}
        </View>
      </View>
      <SpeakButton amharic={amharic} transliteration={transliteration} />
    </View>
  );
}

export default function LessonScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const lessonId = String(id ?? "");
  const lesson = useLesson(lessonId);
  const { isSignedIn } = useSession();

  const addToDeck = useAddLessonToDeck();
  const complete = useCompleteLesson();
  const [notice, setNotice] = useState<string | null>(null);

  if (lesson.isLoading) {
    return (
      <SafeAreaView
        edges={["top", "left", "right"]}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <Loading label="Loading lesson…" />
      </SafeAreaView>
    );
  }

  if (lesson.isError || !lesson.data) {
    return (
      <SafeAreaView
        edges={["top", "left", "right"]}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <ScreenHeader title="Lesson" back />
        <ErrorState message={lesson.error?.message} onRetry={() => lesson.refetch()} />
      </SafeAreaView>
    );
  }

  const data = lesson.data;
  const wordCount = data.vocabulary.length;

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScreenHeader
        title={data.lesson.titleEn}
        amharic={data.lesson.titleAm}
        subtitle={data.unit ? data.unit.titleEn : null}
        back
        right={
          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: Radius.pill,
              backgroundColor: colors.scriptSurface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Body size={FontSize.caption} medium color={colors.primary}>
              {data.lesson.code}
            </Body>
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 22, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {wordCount ? <Chip label={`${wordCount} words`} icon="book-outline" /> : null}
          {data.dialogues.length ? (
            <Chip label={`${data.dialogues.length} dialogue`} icon="chatbubbles-outline" />
          ) : null}
        </View>

        {notice ? (
          <Card tone="muted">
            <Body size={FontSize.small}>{notice}</Body>
          </Card>
        ) : null}

        {/* ---------------------------------------------------- vocabulary */}
        {data.vocabulary.length ? (
          <Section title="Vocabulary" icon="book-outline">
            {data.vocabulary.map((word, i) => (
              <VocabRow
                key={word.id}
                amharic={word.amharic}
                transliteration={word.transliteration}
                english={word.english}
                partOfSpeech={word.partOfSpeech}
                notes={word.notes}
                last={i === data.vocabulary.length - 1}
              />
            ))}
          </Section>
        ) : null}

        {/* ------------------------------------------------------- grammar */}
        {data.grammar.map((concept) => (
          <Section
            key={concept.id}
            title={concept.nameEn}
            icon="construct-outline"
          >
            <View style={{ gap: 10 }}>
              {concept.nameAm ? <Am size={FontSize.h3}>{concept.nameAm}</Am> : null}
              {concept.ruleText ? <Body size={FontSize.small}>{concept.ruleText}</Body> : null}
              {concept.examples?.length ? <SourceValue value={concept.examples} /> : null}
              <QaNote flag={concept.qaFlag} />
            </View>
          </Section>
        ))}

        {/* --------------------------------------------------------- verbs */}
        {data.verbs.length ? (
          <Section title="Verbs" icon="git-branch-outline">
            <View style={{ gap: 18 }}>
              {data.verbs.map((verb) => (
                <View key={verb.id} style={{ gap: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      {verb.infinitive ? <Am size={FontSize.h3}>{verb.infinitive}</Am> : null}
                      <Body size={FontSize.small} color={colors.mutedForeground}>
                        {[verb.stem, verb.englishMeaning].filter(Boolean).join(" · ") || "—"}
                      </Body>
                      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                        {verb.root ? <Chip label={`root ${verb.root}`} /> : null}
                        {verb.verbType ? <Chip label={verb.verbType} /> : null}
                      </View>
                    </View>
                    {verb.infinitive ? (
                      <SpeakButton amharic={verb.infinitive} transliteration={verb.stem} />
                    ) : null}
                  </View>

                  {verb.conjugations.length ? (
                    <View
                      style={{
                        borderRadius: Radius.card,
                        borderWidth: 1,
                        borderColor: colors.border,
                        backgroundColor: colors.scriptSurface,
                        overflow: "hidden",
                      }}
                    >
                      {verb.conjugations.map((c, i) => (
                        <View
                          key={c.id}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 10,
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                            borderBottomWidth: i === verb.conjugations.length - 1 ? 0 : 1,
                            borderBottomColor: colors.border,
                          }}
                        >
                          <View style={{ width: 74 }}>
                            <Am size={FontSize.small}>{c.pronoun}</Am>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Am size={FontSize.body}>{c.form}</Am>
                            {c.transliteration ? <Translit>{c.transliteration}</Translit> : null}
                          </View>
                          <SpeakButton
                            amharic={c.form}
                            transliteration={c.transliteration}
                            size={30}
                          />
                        </View>
                      ))}
                    </View>
                  ) : null}
                  <QaNote flag={verb.qaFlag} />
                </View>
              ))}
            </View>
          </Section>
        ) : null}

        {/* ----------------------------------------------------- dialogues */}
        {data.dialogues.map((dialogue) => (
          <Section
            key={dialogue.id}
            title={dialogue.title}
            icon="chatbubbles-outline"
            tone="script"
          >
            <DialoguePlayer dialogueId={dialogue.id} lines={dialogue.lines} />
          </Section>
        ))}

        {/* ---------------------------------- everything else, source-faithful */}
        {data.sections.map((section) => {
          const body = section.body as { key?: string; value?: unknown };
          const value = body?.value;
          if (value === null || value === undefined) return null;
          if (Array.isArray(value) && !value.length) return null;

          return (
            <Section
              key={section.id}
              title={section.title ?? humanize(body?.key ?? section.sectionType)}
              icon="document-text-outline"
            >
              <SourceValue value={value} />
            </Section>
          );
        })}

        {/* ---------------------------------------------------- activities */}
        {data.activities.length ? (
          <Section title="Activities" icon="clipboard-outline" tone="muted">
            <View style={{ gap: 14 }}>
              {data.activities.map((activity) => (
                <View key={activity.id} style={{ gap: 6 }}>
                  <Body medium>{activity.title}</Body>
                  {activity.instructions ? (
                    <Body size={FontSize.small} color={colors.mutedForeground}>
                      {activity.instructions}
                    </Body>
                  ) : null}
                  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                    <Chip label={activity.activityType.replace(/_/g, " ")} />
                  </View>
                </View>
              ))}
            </View>
          </Section>
        ) : null}

        <View style={{ alignItems: "center", paddingVertical: 6 }}>
          <TibebRule width={160} />
        </View>

        {/* -------------------------------------------------------- footer */}
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button
              label="Practice"
              icon="school-outline"
              onPress={() => router.push(`/quiz/${lessonId}`)}
              style={{ flex: 1 }}
            />
            <Button
              label="Speak"
              icon="mic-outline"
              variant="sky"
              onPress={() => router.push(`/speaking/${lessonId}`)}
              style={{ flex: 1 }}
            />
          </View>

          {wordCount ? (
            <Button
              label={isSignedIn ? "Add words to my deck" : "Sign in to save words"}
              icon="layers-outline"
              variant="secondary"
              full
              loading={addToDeck.isPending}
              onPress={() => {
                if (!isSignedIn) {
                  router.push("/sign-in");
                  return;
                }
                addToDeck.mutate(
                  { lessonId },
                  {
                    onSuccess: (result) =>
                      setNotice(
                        result.added
                          ? `Added ${result.added} of ${result.lessonWords} words to your review deck.`
                          : "Every word from this lesson is already in your deck.",
                      ),
                    onError: (error) => setNotice(error.message),
                  },
                )
              }}
            />
          ) : null}

          <Button
            label={complete.isSuccess ? "Lesson completed" : "Mark lesson complete"}
            icon={complete.isSuccess ? "checkmark-circle" : "checkmark-circle-outline"}
            variant="accent"
            full
            loading={complete.isPending}
            disabled={complete.isSuccess}
            onPress={() => {
              if (!isSignedIn) {
                router.push("/sign-in");
                return;
              }
              complete.mutate(
                { lessonId },
                {
                  onSuccess: () => setNotice("Nice — lesson marked complete, +15 XP."),
                  onError: (error) => setNotice(error.message),
                },
              );
            }}
          />

          <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
            {data.prevLessonId ? (
              <Pressable
                onPress={() => router.replace(`/lesson/${data.prevLessonId}`)}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  paddingVertical: 12,
                  borderRadius: Radius.pill,
                  borderWidth: 1,
                  borderColor: colors.borderStrong,
                }}
              >
                <Ionicons name="arrow-back" size={15} color={colors.mutedForeground} />
                <Body size={FontSize.small} color={colors.mutedForeground}>
                  Previous
                </Body>
              </Pressable>
            ) : null}
            {data.nextLessonId ? (
              <Pressable
                onPress={() => router.replace(`/lesson/${data.nextLessonId}`)}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  paddingVertical: 12,
                  borderRadius: Radius.pill,
                  borderWidth: 1,
                  borderColor: colors.borderStrong,
                  backgroundColor: colors.card,
                }}
              >
                <Body size={FontSize.small} medium>
                  Next lesson
                </Body>
                <Ionicons name="arrow-forward" size={15} color={colors.foreground} />
              </Pressable>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
