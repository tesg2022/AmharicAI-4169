import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Fonts, FontSize, Radius } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useSession } from "@/hooks/use-session";
import { useQuiz, useSubmitAnswer, useUnitExam } from "@/queries/practice";
import {
  Am,
  Body,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Loading,
  ProgressBar,
  QaNote,
  ScreenHeader,
  Title,
} from "@/components/ui";
import { isAmharic } from "@/components/source-value";

/**
 * One quiz runner for both question sources.
 *
 * A `unit-` prefixed param means the source assessment bank for that unit
 * (questions kept exactly as written); anything else is a lesson drill set
 * generated from the source material. Keeping them on one route avoids a
 * second near-identical screen — the only difference is where the questions
 * come from and how they are labelled.
 */

type Option = { id: string; optionKey: string | null; optionText: string };
type Question = {
  id: string;
  lessonId: string | null;
  questionType: string;
  questionText: string;
  questionAm: string | null;
  sourcePage: number | null;
  qaFlag: string | null;
  options: Option[];
};

type Graded = {
  isCorrect: boolean;
  correctOptionId: string | null;
  correctAnswer: unknown;
  explanation: string | null;
  sourcePage: number | null;
  xpAwarded: number;
};

function answerLabel(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.map((v) => String(v)).join(" / ");
  return String(value);
}

function QuestionPrompt({ question }: { question: Question }) {
  const colors = useColors();
  return (
    <View style={{ gap: 8 }}>
      {isAmharic(question.questionText) ? (
        <Am size={FontSize.h2}>{question.questionText}</Am>
      ) : (
        <Title size={FontSize.h2}>{question.questionText}</Title>
      )}
      {question.questionAm ? (
        <Am size={FontSize.h3} color={colors.primary}>
          {question.questionAm}
        </Am>
      ) : null}
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        <Chip label={question.questionType.replace(/_/g, " ")} />
      </View>
    </View>
  );
}

function OptionRow({
  option,
  selected,
  graded,
  correctOptionId,
  onPress,
}: {
  option: Option;
  selected: boolean;
  graded: Graded | null;
  correctOptionId: string | null;
  onPress: () => void;
}) {
  const colors = useColors();
  const isCorrectOption = graded ? correctOptionId === option.id : false;
  const isWrongPick = graded ? selected && !isCorrectOption : false;

  const borderColor = isCorrectOption
    ? colors.success
    : isWrongPick
      ? colors.destructive
      : selected
        ? colors.primary
        : colors.border;
  const background = isCorrectOption
    ? colors.success + "1A"
    : isWrongPick
      ? colors.destructive + "1A"
      : selected
        ? colors.primary + "12"
        : colors.card;

  return (
    <Pressable
      onPress={graded ? undefined : onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 14,
        borderRadius: Radius.card,
        borderWidth: 1.5,
        borderColor,
        backgroundColor: background,
      }}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1.5,
          borderColor,
        }}
      >
        <Body size={FontSize.caption} medium color={colors.mutedForeground}>
          {option.optionKey ?? ""}
        </Body>
      </View>
      <View style={{ flex: 1 }}>
        {isAmharic(option.optionText) ? (
          <Am size={FontSize.h3}>{option.optionText}</Am>
        ) : (
          <Body>{option.optionText}</Body>
        )}
      </View>
      {isCorrectOption ? (
        <Ionicons name="checkmark-circle" size={20} color={colors.success} />
      ) : isWrongPick ? (
        <Ionicons name="close-circle" size={20} color={colors.destructive} />
      ) : null}
    </Pressable>
  );
}

export default function QuizScreen() {
  const colors = useColors();
  const { lessonId } = useLocalSearchParams<{ lessonId: string }>();
  const param = String(lessonId ?? "");
  const isUnitExam = param.startsWith("unit-");
  const unitId = isUnitExam ? param.slice("unit-".length) : "";

  const { isSignedIn } = useSession();
  const quiz = useQuiz(isUnitExam ? "" : param);
  const exam = useUnitExam(unitId);
  const source = isUnitExam ? exam : quiz;

  const submit = useSubmitAnswer();

  const [index, setIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [graded, setGraded] = useState<Graded | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [xp, setXp] = useState(0);
  const [finished, setFinished] = useState(false);

  const questions = useMemo<Question[]>(() => {
    const data = source.data as { questions?: Question[] } | undefined;
    return data?.questions ?? [];
  }, [source.data]);

  const heading = isUnitExam
    ? ((exam.data?.assessment.title as string | undefined) ?? "Unit assessment")
    : ((quiz.data?.lesson.titleEn as string | undefined) ?? "Practice");

  function reset() {
    setIndex(0);
    setSelectedId(null);
    setTyped("");
    setGraded(null);
    setCorrectCount(0);
    setXp(0);
    setFinished(false);
  }

  if (source.isLoading) {
    return (
      <SafeAreaView
        edges={["top", "left", "right"]}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <ScreenHeader title="Practice" back />
        <Loading label="Building your set…" />
      </SafeAreaView>
    );
  }

  if (source.isError) {
    return (
      <SafeAreaView
        edges={["top", "left", "right"]}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <ScreenHeader title="Practice" back />
        <ErrorState message={source.error?.message} onRetry={() => source.refetch()} />
      </SafeAreaView>
    );
  }

  if (!questions.length) {
    return (
      <SafeAreaView
        edges={["top", "left", "right"]}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <ScreenHeader title={heading} back />
        <EmptyState
          icon="help-circle-outline"
          title="No questions here yet"
          body="This lesson has no drillable material in the source manual. Try another lesson, or review its vocabulary instead."
          action={<Button label="Back to lesson" variant="secondary" onPress={() => router.back()} />}
        />
      </SafeAreaView>
    );
  }

  /* ------------------------------------------------------------- summary */
  if (finished) {
    const pct = Math.round((correctCount / questions.length) * 100);
    return (
      <SafeAreaView
        edges={["top", "left", "right"]}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <ScreenHeader title="Results" back />
        <ScrollView contentContainerStyle={{ padding: 20, gap: 18 }}>
          <Card style={{ alignItems: "center", gap: 10, paddingVertical: 28 }}>
            <Ionicons
              name={pct >= 80 ? "trophy" : pct >= 50 ? "ribbon-outline" : "refresh-circle-outline"}
              size={44}
              color={pct >= 80 ? colors.accent : colors.primary}
            />
            <Title size={FontSize.hero}>{pct}%</Title>
            <Body color={colors.mutedForeground}>
              {correctCount} of {questions.length} correct
            </Body>
            {xp > 0 ? <Chip label={`+${xp} XP`} icon="star" color={colors.accent} /> : null}
            {!isSignedIn ? (
              <Body size={FontSize.caption} color={colors.mutedForeground}>
                Sign in to keep this score and earn XP.
              </Body>
            ) : null}
          </Card>

          <Button label="Try again" icon="refresh" full onPress={reset} />
          <Button
            label="Back"
            variant="secondary"
            full
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  /* ------------------------------------------------------------ question */
  const question = questions[index]!;
  const hasOptions = question.options.length > 0;
  const canSubmit = hasOptions ? Boolean(selectedId) : typed.trim().length > 0;

  function onSubmit() {
    if (!canSubmit || submit.isPending) return;
    const chosen = question.options.find((o) => o.id === selectedId);
    submit.mutate(
      {
        questionId: question.id,
        answer: hasOptions ? (chosen?.optionText ?? "") : typed.trim(),
        ...(hasOptions && selectedId ? { optionId: selectedId } : {}),
      },
      {
        onSuccess: (result) => {
          setGraded(result as Graded);
          if (result.isCorrect) setCorrectCount((c) => c + 1);
          setXp((x) => x + (result.xpAwarded ?? 0));
        },
      },
    );
  }

  function onNext() {
    if (index + 1 >= questions.length) {
      setFinished(true);
      return;
    }
    setIndex((i) => i + 1);
    setSelectedId(null);
    setTyped("");
    setGraded(null);
  }

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScreenHeader
        title={heading}
        subtitle={isUnitExam ? "Source assessment — questions as written" : "Practice drill"}
        back
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <View style={{ paddingHorizontal: 20, paddingTop: 14, gap: 6 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Body size={FontSize.caption} color={colors.mutedForeground} medium>
              Question {index + 1} of {questions.length}
            </Body>
            <Body size={FontSize.caption} color={colors.accent} medium>
              {xp} XP
            </Body>
          </View>
          <ProgressBar value={(index + (graded ? 1 : 0)) / questions.length} />
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <QuestionPrompt question={question} />

          {hasOptions ? (
            <View style={{ gap: 10 }}>
              {question.options.map((option) => (
                <OptionRow
                  key={option.id}
                  option={option}
                  selected={selectedId === option.id}
                  graded={graded}
                  correctOptionId={graded?.correctOptionId ?? null}
                  onPress={() => setSelectedId(option.id)}
                />
              ))}
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              <Body size={FontSize.small} color={colors.mutedForeground}>
                Type your answer
              </Body>
              <TextInput
                value={typed}
                onChangeText={setTyped}
                editable={!graded}
                placeholder="Your answer…"
                placeholderTextColor={colors.mutedForeground}
                multiline
                style={{
                  minHeight: 54,
                  borderWidth: 1.5,
                  borderColor: graded
                    ? graded.isCorrect
                      ? colors.success
                      : colors.destructive
                    : colors.border,
                  borderRadius: Radius.card,
                  backgroundColor: colors.card,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  color: colors.foreground,
                  fontFamily: Fonts.ethiopic,
                  fontSize: FontSize.body,
                }}
              />
            </View>
          )}

          {graded ? (
            <Card tone="muted" style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons
                  name={graded.isCorrect ? "checkmark-circle" : "close-circle"}
                  size={20}
                  color={graded.isCorrect ? colors.success : colors.destructive}
                />
                <Body medium color={graded.isCorrect ? colors.success : colors.destructive}>
                  {graded.isCorrect ? "Correct" : "Not quite"}
                </Body>
                {graded.xpAwarded ? (
                  <Chip label={`+${graded.xpAwarded} XP`} icon="star" color={colors.accent} />
                ) : null}
              </View>

              {!graded.isCorrect ? (
                <View style={{ gap: 2 }}>
                  <Body size={FontSize.caption} color={colors.mutedForeground} medium>
                    ANSWER
                  </Body>
                  {isAmharic(answerLabel(graded.correctAnswer)) ? (
                    <Am size={FontSize.h3}>{answerLabel(graded.correctAnswer)}</Am>
                  ) : (
                    <Body>{answerLabel(graded.correctAnswer)}</Body>
                  )}
                </View>
              ) : null}

              {graded.explanation ? (
                <Body size={FontSize.small} color={colors.mutedForeground}>
                  {graded.explanation}
                </Body>
              ) : null}

              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              </View>
              <QaNote flag={question.qaFlag} />
            </Card>
          ) : null}
        </ScrollView>

        <View
          style={{
            padding: 20,
            paddingTop: 12,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.background,
          }}
        >
          {graded ? (
            <Button
              label={index + 1 >= questions.length ? "See results" : "Next question"}
              icon="arrow-forward"
              full
              onPress={onNext}
            />
          ) : (
            <Button
              label="Check answer"
              full
              disabled={!canSubmit}
              loading={submit.isPending}
              onPress={onSubmit}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
