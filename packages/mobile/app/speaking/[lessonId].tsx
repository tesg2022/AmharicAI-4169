import { useCallback, useEffect, useRef, useState } from "react";
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
import { useLocalSearchParams } from "expo-router";
import { Fonts, FontSize, Radius } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useSession } from "@/hooks/use-session";
import { useAmharicRecognizer } from "@/lib/recognition";
import { useLesson } from "@/queries/content";
import { useScoreSpeech, useSpeakingPrompts } from "@/queries/speaking";
import { useAdvanceSpeechSession, useStartSpeechSession } from "@/queries/speech";
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
  ScreenHeader,
  SpeakButton,
  Title,
  Translit,
} from "@/components/ui";

/**
 * Pronunciation practice, run as the READ → LISTEN → REPEAT → SPEAK → FEEDBACK
 * loop.
 *
 * The stages are not decoration. Each one withholds something until the
 * learner has done the step before it: the audio button does not appear while
 * they are still reading the script, and the microphone does not appear until
 * they have heard the phrase and shadowed it. That ordering is the whole point
 * of the loop — recording before listening just records a guess.
 *
 * Prompts come from the lesson's dialogue lines and vocabulary, so every
 * target phrase is source material rather than invented.
 *
 * The learner records a take and the audio goes to the server for real am-ET
 * recognition. When no recognizer is configured, the mic is refused, or the
 * take comes back empty, the screen falls back to the typed self-check — which
 * runs through the exact same deterministic scorer, so the score means the
 * same thing either way.
 */

type Scored = {
  score: number;
  feedback: string;
  xpAwarded: number;
  transcript: string;
};

const STAGES = ["read", "listen", "repeat", "speak", "feedback"] as const;
type Stage = (typeof STAGES)[number];

const STAGE_META: Record<
  Stage,
  { label: string; icon: React.ComponentProps<typeof Ionicons>["name"]; hint: string }
> = {
  read: {
    label: "Read",
    icon: "eye-outline",
    hint: "Look at the Fidel. Sound out each syllable before you hear it.",
  },
  listen: {
    label: "Listen",
    icon: "headset-outline",
    hint: "Play it at natural speed. Do not speak yet — just listen.",
  },
  repeat: {
    label: "Repeat",
    icon: "sync-outline",
    hint: "Play it slowly and say it along with the voice, twice.",
  },
  speak: {
    label: "Speak",
    icon: "mic-outline",
    hint: "Now say it on your own and record the take.",
  },
  feedback: {
    label: "Feedback",
    icon: "sparkles-outline",
    hint: "Compare what you said with the target.",
  },
};

export default function SpeakingScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ lessonId: string }>();
  const lessonId = String(params.lessonId ?? "");
  const { isSignedIn } = useSession();

  const lesson = useLesson(lessonId);
  const prompts = useSpeakingPrompts(lessonId);
  const scorer = useScoreSpeech();

  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>("read");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Scored | null>(null);
  const [earned, setEarned] = useState(0);
  /** Every score so far this loop, so the session records a real average. */
  const [scores, setScores] = useState<number[]>([]);
  /** Flips on when the mic cannot deliver a transcript, for any reason. */
  const [typedMode, setTypedMode] = useState(false);

  const recognizer = useAmharicRecognizer();
  const cancelRef = useRef(recognizer.cancel);
  cancelRef.current = recognizer.cancel;

  const list = prompts.data ?? [];
  const current = list[index];

  // ── Session record ────────────────────────────────────────────────────────
  // Anonymous learners still get the full loop; only the persisted record
  // needs an account, so every session call is best-effort and never blocks
  // the UI.
  const startSession = useStartSpeechSession();
  const advanceSession = useAdvanceSpeechSession();
  const sessionIdRef = useRef<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!isSignedIn || startedRef.current || list.length === 0) return;
    startedRef.current = true;
    startSession.mutate(
      { lessonId: lessonId || null, itemsTotal: list.length },
      {
        onSuccess: (data) => {
          sessionIdRef.current = data.id;
        },
        // A missing session record must never break practice.
        onError: () => undefined,
      },
    );
  }, [isSignedIn, lessonId, list.length, startSession]);

  const advanceRef = useRef(advanceSession.mutate);
  advanceRef.current = advanceSession.mutate;

  const recordStage = useCallback(
    (next: Stage, opts?: { itemsCompleted?: number; scores?: number[]; completed?: boolean }) => {
      const id = sessionIdRef.current;
      if (!id) return;
      const all = opts?.scores;
      const average =
        all && all.length > 0
          ? Math.round((all.reduce((sum, n) => sum + n, 0) / all.length) * 100)
          : undefined;
      advanceRef.current(
        {
          id,
          stage: next,
          itemsCompleted: opts?.itemsCompleted,
          averageScore: average,
          completed: opts?.completed ?? false,
        },
        { onError: () => undefined },
      );
    },
    [],
  );

  // Release the mic if the screen unmounts mid-take.
  useEffect(() => () => void cancelRef.current(), []);

  const goStage = useCallback(
    (next: Stage) => {
      setError(null);
      setStage(next);
      recordStage(next);
    },
    [recordStage],
  );

  const grade = useCallback(
    (transcript: string) => {
      const target = current?.amharic;
      if (!target || !transcript.trim()) return;
      setError(null);
      scorer.mutate(
        { targetText: target, transcript: transcript.trim(), lessonId },
        {
          onSuccess: (data) => {
            setResult({
              score: data.score,
              feedback: data.feedback,
              xpAwarded: data.xpAwarded,
              transcript: transcript.trim(),
            });
            setEarned((xp) => xp + data.xpAwarded);
            const nextScores = [...scores, data.score];
            setScores(nextScores);
            setStage("feedback");
            recordStage("feedback", {
              itemsCompleted: index + 1,
              scores: nextScores,
              completed: index >= list.length - 1,
            });
          },
          onError: (err) => setError(err.message),
        },
      );
    },
    [current?.amharic, index, lessonId, list.length, recordStage, scorer, scores],
  );

  async function toggleRecord() {
    if (recognizer.recording) {
      const outcome = await recognizer.stopAndRecognize(current?.amharic);
      if (outcome.ok) {
        grade(outcome.transcript);
        return;
      }
      setError(outcome.message);
      // These three mean the mic will not help on this device or server, so
      // hand the learner the typed self-check rather than a dead button.
      if (
        outcome.reason === "no_recognizer" ||
        outcome.reason === "no_permission" ||
        outcome.reason === "unsupported"
      ) {
        setTypedMode(true);
      }
      return;
    }

    setError(null);
    setResult(null);
    const started = await recognizer.start();
    if (!started) {
      setError("Microphone access was blocked — type what you said instead.");
      setTypedMode(true);
    }
  }

  function move(step: number) {
    void recognizer.cancel();
    setResult(null);
    setTyped("");
    setError(null);
    const next = Math.min(Math.max(index + step, 0), Math.max(list.length - 1, 0));
    setIndex(next);
    // Every phrase restarts the loop at READ — that is what makes it a loop.
    setStage("read");
    recordStage("read", { itemsCompleted: next });
  }

  const header = (
    <ScreenHeader
      title="Speaking practice"
      amharic={lesson.data?.lesson.titleAm ?? null}
      subtitle={lesson.data?.lesson.titleEn ?? undefined}
      back
      right={earned > 0 ? <Chip label={`+${earned} XP`} icon="flash" color={colors.accentForeground} background={colors.accent} /> : undefined}
    />
  );

  if (prompts.isLoading) {
    return (
      <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <Loading label="Preparing phrases…" />
      </SafeAreaView>
    );
  }

  if (prompts.isError) {
    return (
      <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <ErrorState message={prompts.error?.message} onRetry={() => prompts.refetch()} />
      </SafeAreaView>
    );
  }

  if (!current) {
    return (
      <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <EmptyState
          icon="mic-off-outline"
          title="No phrases in this lesson"
          body="This lesson has no dialogue lines or vocabulary to speak yet. Try a lesson from Unit 2 onwards."
        />
      </SafeAreaView>
    );
  }

  const stageIndex = STAGES.indexOf(stage);
  const pct = result ? Math.max(0, Math.min(1, result.score)) : 0;
  const tone = !result
    ? colors.primary
    : pct >= 0.75
      ? colors.success
      : pct >= 0.45
        ? colors.warning
        : colors.destructive;

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.background }}>
      {header}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={12}
      >
        <ScrollView
          contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body size={FontSize.caption} color={colors.mutedForeground}>
                Phrase {index + 1} of {list.length}
              </Body>
              <Chip
                label={current.kind === "dialogue" ? "From a dialogue" : "Vocabulary"}
                icon={current.kind === "dialogue" ? "chatbubbles-outline" : "book-outline"}
              />
            </View>
            <ProgressBar value={(index + 1) / list.length} />
          </View>

          {/* Stage rail — the loop, made visible. Past stages stay tappable so
              a learner can hear the phrase again without losing their place. */}
          <View style={{ flexDirection: "row", gap: 6 }}>
            {STAGES.map((s, i) => {
              const done = i < stageIndex;
              const active = i === stageIndex;
              return (
                <Pressable
                  key={s}
                  disabled={i > stageIndex}
                  onPress={() => goStage(s)}
                  style={{
                    flex: 1,
                    alignItems: "center",
                    gap: 4,
                    paddingVertical: 8,
                    borderRadius: Radius.card,
                    backgroundColor: active ? colors.primary + "1A" : "transparent",
                    borderWidth: 1,
                    borderColor: active ? colors.primary + "44" : "transparent",
                    opacity: i > stageIndex ? 0.35 : 1,
                  }}
                >
                  <Ionicons
                    name={done ? "checkmark-circle" : STAGE_META[s].icon}
                    size={18}
                    color={done ? colors.success : active ? colors.primary : colors.mutedForeground}
                  />
                  <Body
                    size={FontSize.caption}
                    color={active ? colors.primary : colors.mutedForeground}
                    medium={active}
                  >
                    {STAGE_META[s].label}
                  </Body>
                </Pressable>
              );
            })}
          </View>

          <Body size={FontSize.small} color={colors.mutedForeground}>
            {STAGE_META[stage].hint}
          </Body>

          {/* Target phrase. The audio control is withheld during READ on
              purpose — reading the Fidel first is the point of that stage. */}
          <Card tone="script" style={{ gap: 12, alignItems: "center", paddingVertical: 28 }}>
            <Am size={FontSize.h1} bold style={{ textAlign: "center" }}>
              {current.amharic}
            </Am>
            {current.transliteration ? <Translit size={FontSize.body}>{current.transliteration}</Translit> : null}
            {current.english && stage !== "read" ? (
              <Body size={FontSize.small} color={colors.mutedForeground} style={{ textAlign: "center" }}>
                {current.english}
              </Body>
            ) : null}
            {stage !== "read" ? (
              <SpeakButton
                amharic={current.amharic}
                transliteration={current.transliteration}
                // REPEAT plays at 0.7x with wider pauses so the learner can
                // shadow it; every other stage hears the phrase as spoken.
                mode={stage === "repeat" ? "slow" : "native"}
                kind="prompt"
                size={52}
                onMissingVoice={(reason) => setError(reason)}
              />
            ) : null}
          </Card>

          {/* Stage advance */}
          {stage === "read" ? (
            <Button
              label="I can read it — play the audio"
              icon="headset-outline"
              full
              onPress={() => goStage("listen")}
            />
          ) : null}
          {stage === "listen" ? (
            <Button
              label="Heard it — let me shadow it"
              icon="sync-outline"
              full
              onPress={() => goStage("repeat")}
            />
          ) : null}
          {stage === "repeat" ? (
            <Button
              label="I've practiced — record my take"
              icon="mic-outline"
              full
              onPress={() => goStage("speak")}
            />
          ) : null}

          {/* Capture — only at SPEAK */}
          {stage === "speak" ? (
            !typedMode ? (
              <View style={{ alignItems: "center", gap: 10 }}>
                <Pressable
                  onPress={() => void toggleRecord()}
                  disabled={scorer.isPending || recognizer.busy}
                  style={({ pressed }) => ({
                    width: 92,
                    height: 92,
                    borderRadius: 46,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: recognizer.recording ? colors.destructive : colors.primary,
                    opacity: scorer.isPending || recognizer.busy ? 0.5 : pressed ? 0.85 : 1,
                    borderWidth: 6,
                    borderColor: (recognizer.recording ? colors.destructive : colors.primary) + "26",
                  })}
                >
                  <Ionicons
                    name={recognizer.recording ? "stop" : "mic"}
                    size={36}
                    color={recognizer.recording ? "#FFFFFF" : colors.primaryForeground}
                  />
                </Pressable>
                <Body size={FontSize.caption} color={colors.mutedForeground}>
                  {scorer.isPending
                    ? "Scoring…"
                    : recognizer.busy
                      ? "Sending your take…"
                      : recognizer.recording
                        ? "Recording — tap to stop"
                        : "Tap to record"}
                </Body>
                <Pressable onPress={() => setTypedMode(true)} hitSlop={8}>
                  <Body size={FontSize.caption} color={colors.primary}>
                    Type it instead
                  </Body>
                </Pressable>
              </View>
            ) : (
              <Card style={{ gap: 10 }}>
                <Body size={FontSize.small} medium>
                  Type what you said
                </Body>
                <Body size={FontSize.caption} color={colors.mutedForeground}>
                  Say the phrase aloud, then write it in Amharic script. It is scored exactly the same
                  way as a recorded take.
                </Body>
                <TextInput
                  value={typed}
                  onChangeText={setTyped}
                  placeholder="ሰላም"
                  placeholderTextColor={colors.mutedForeground}
                  style={{
                    fontFamily: Fonts.ethiopic,
                    fontSize: FontSize.body,
                    color: colors.foreground,
                    backgroundColor: colors.background,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: Radius.card,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                  }}
                />
                <Button
                  label="Check my pronunciation"
                  icon="checkmark-circle-outline"
                  full
                  loading={scorer.isPending}
                  disabled={!typed.trim()}
                  onPress={() => grade(typed)}
                />
                <Pressable onPress={() => setTypedMode(false)} hitSlop={8}>
                  <Body size={FontSize.caption} color={colors.primary}>
                    Use the microphone instead
                  </Body>
                </Pressable>
              </Card>
            )
          ) : null}

          {error ? (
            <Card tone="muted" style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.destructive} style={{ marginTop: 2 }} />
              <Body size={FontSize.small} color={colors.destructive} style={{ flex: 1 }}>
                {error}
              </Body>
            </Card>
          ) : null}

          {/* Score */}
          {stage === "feedback" && result ? (
            <Card style={{ gap: 12, borderColor: tone }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Title size={FontSize.h3} color={tone}>
                  {Math.round(pct * 100)}% match
                </Title>
                {result.xpAwarded > 0 ? (
                  <Chip
                    label={`+${result.xpAwarded} XP`}
                    icon="flash"
                    color={colors.accentForeground}
                    background={colors.accent}
                  />
                ) : null}
              </View>
              <ProgressBar value={pct} color={tone} height={10} />
              <Body size={FontSize.small}>{result.feedback}</Body>
              <View style={{ gap: 4 }}>
                <Body size={FontSize.caption} color={colors.mutedForeground}>
                  You said
                </Body>
                <Am size={FontSize.body}>{result.transcript}</Am>
              </View>
              <View style={{ gap: 4 }}>
                <Body size={FontSize.caption} color={colors.mutedForeground}>
                  Target
                </Body>
                <Am size={FontSize.body}>{current.amharic}</Am>
              </View>
              {!isSignedIn ? (
                <Body size={FontSize.caption} color={colors.mutedForeground}>
                  Sign in to save attempts and earn XP.
                </Body>
              ) : null}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Button
                  label="Hear it again"
                  variant="secondary"
                  icon="headset-outline"
                  style={{ flex: 1 }}
                  onPress={() => goStage("listen")}
                />
                <Button
                  label="Try again"
                  variant="secondary"
                  icon="refresh"
                  style={{ flex: 1 }}
                  onPress={() => {
                    setResult(null);
                    setTyped("");
                    goStage("speak");
                  }}
                />
              </View>
            </Card>
          ) : null}

          <View style={{ flexDirection: "row", gap: 12 }}>
            <Button
              label="Previous"
              variant="secondary"
              icon="chevron-back"
              style={{ flex: 1 }}
              disabled={index === 0}
              onPress={() => move(-1)}
            />
            <Button
              label="Next phrase"
              icon="chevron-forward"
              style={{ flex: 1 }}
              disabled={index >= list.length - 1}
              onPress={() => move(1)}
            />
          </View>

          {scores.length > 0 ? (
            <Body size={FontSize.caption} color={colors.mutedForeground} style={{ textAlign: "center" }}>
              {scores.length} phrase{scores.length === 1 ? "" : "s"} scored this session · average{" "}
              {Math.round((scores.reduce((sum, n) => sum + n, 0) / scores.length) * 100)}%
            </Body>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
