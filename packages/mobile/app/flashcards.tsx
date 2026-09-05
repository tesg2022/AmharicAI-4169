import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { FontSize, Radius } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useSession } from "@/hooks/use-session";
import { useDueCards, useReviewCard, useSrsSummary } from "@/queries/srs";
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
  SignInPrompt,
  SpeakButton,
  Title,
  Translit,
} from "@/components/ui";

/**
 * Spaced-repetition review.
 *
 * The card shows the Amharic first — recognition before recall — and the four
 * grade buttons map onto the SM-2 qualities the API schedules with. The deck
 * is built by adding a lesson's words from the lesson screen, so an empty deck
 * points back there rather than dead-ending.
 */

const GRADES = [
  { grade: "again", label: "Again", hint: "10 min", icon: "refresh" },
  { grade: "hard", label: "Hard", hint: "shorter", icon: "trending-down" },
  { grade: "good", label: "Good", hint: "on track", icon: "checkmark" },
  { grade: "easy", label: "Easy", hint: "longer", icon: "flash" },
] as const;

export default function FlashcardsScreen() {
  const colors = useColors();
  const { isSignedIn, isPending } = useSession();

  const due = useDueCards(isSignedIn);
  const summary = useSrsSummary(isSignedIn);
  const review = useReviewCard();

  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [xp, setXp] = useState(0);

  const cards = due.data ?? [];

  // A refetched deck must not leave the pointer past the end of the new list.
  useEffect(() => {
    if (index >= cards.length && cards.length > 0) setIndex(0);
  }, [cards.length, index]);

  if (isPending) {
    return (
      <SafeAreaView
        edges={["top", "left", "right"]}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <Loading />
      </SafeAreaView>
    );
  }

  if (!isSignedIn) {
    return (
      <SafeAreaView
        edges={["top", "left", "right"]}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <ScreenHeader title="Flashcards" amharic="ቃላት" back />
        <SignInPrompt message="Your review deck and its schedule are tied to your account." />
      </SafeAreaView>
    );
  }

  if (due.isLoading) {
    return (
      <SafeAreaView
        edges={["top", "left", "right"]}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <ScreenHeader title="Flashcards" amharic="ቃላት" back />
        <Loading label="Loading your deck…" />
      </SafeAreaView>
    );
  }

  if (due.isError) {
    return (
      <SafeAreaView
        edges={["top", "left", "right"]}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <ScreenHeader title="Flashcards" amharic="ቃላት" back />
        <ErrorState message={due.error?.message} onRetry={() => due.refetch()} />
      </SafeAreaView>
    );
  }

  const finished = index >= cards.length || cards.length === 0;

  if (finished) {
    const total = summary.data?.total ?? 0;
    const nextDue = summary.data?.nextDueAt ? new Date(summary.data.nextDueAt) : null;

    return (
      <SafeAreaView
        edges={["top", "left", "right"]}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <ScreenHeader title="Flashcards" amharic="ቃላት" back />
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          {reviewed > 0 ? (
            <Card style={{ alignItems: "center", gap: 8, paddingVertical: 26 }}>
              <Ionicons name="checkmark-done-circle" size={42} color={colors.success} />
              <Title size={FontSize.h1}>Deck cleared</Title>
              <Body color={colors.mutedForeground}>
                {reviewed} card{reviewed === 1 ? "" : "s"} reviewed
              </Body>
              {xp > 0 ? <Chip label={`+${xp} XP`} icon="star" color={colors.accent} /> : null}
            </Card>
          ) : (
            <EmptyState
              icon="layers-outline"
              title={total ? "Nothing due right now" : "Your deck is empty"}
              body={
                total
                  ? nextDue
                    ? `Next card is due ${nextDue.toLocaleString()}.`
                    : "Come back later for the next batch."
                  : "Open a lesson and tap “Add words to my deck” to start building it."
              }
              action={
                <Button
                  label={total ? "Back to practice" : "Browse lessons"}
                  variant="secondary"
                  onPress={() => router.replace(total ? "/practice" : "/")}
                />
              }
            />
          )}

          {total ? (
            <Card style={{ gap: 10 }}>
              <Body medium>Deck</Body>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Chip label={`${total} cards`} icon="albums-outline" />
                <Chip label={`${summary.data?.learning ?? 0} learning`} icon="school-outline" />
                <Chip label={`${summary.data?.mature ?? 0} mature`} icon="ribbon-outline" />
              </View>
            </Card>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  const entry = cards[index]!;
  const word = entry.word;

  function grade(value: (typeof GRADES)[number]["grade"]) {
    if (review.isPending) return;
    review.mutate(
      { cardId: entry.card.id, grade: value },
      {
        onSuccess: () => {
          // Mirrors the API's award: a lapse is worth 1 XP, anything else 4.
          setXp((x) => x + (value === "again" ? 1 : 4));
          setReviewed((r) => r + 1);
          setRevealed(false);
          setIndex((i) => i + 1);
        },
      },
    );
  }

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScreenHeader
        title="Flashcards"
        amharic="ቃላት"
        subtitle={`${cards.length - index} due`}
        back
      />

      <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
        <ProgressBar value={index / cards.length} />
      </View>

      <View style={{ flex: 1, padding: 20, justifyContent: "center" }}>
        <Pressable onPress={() => setRevealed((r) => !r)}>
          <Card
            tone="script"
            style={{
              minHeight: 300,
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              paddingVertical: 32,
            }}
          >
            <Am size={44} bold>
              {word.amharic}
            </Am>

            <SpeakButton amharic={word.amharic} transliteration={word.transliteration} size={48} />

            {revealed ? (
              <View style={{ alignItems: "center", gap: 6, paddingHorizontal: 16 }}>
                {word.transliteration ? <Translit size={FontSize.h3}>{word.transliteration}</Translit> : null}
                {word.english ? (
                  <Title size={FontSize.h2} style={{ textAlign: "center" }}>
                    {word.english}
                  </Title>
                ) : null}
                {word.notes ? (
                  <Body
                    size={FontSize.small}
                    color={colors.mutedForeground}
                    style={{ textAlign: "center" }}
                  >
                    {word.notes}
                  </Body>
                ) : null}
                <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                  {word.partOfSpeech ? <Chip label={word.partOfSpeech} /> : null}
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="eye-outline" size={15} color={colors.mutedForeground} />
                <Body size={FontSize.small} color={colors.mutedForeground}>
                  Tap to reveal
                </Body>
              </View>
            )}
          </Card>
        </Pressable>
      </View>

      <View
        style={{
          padding: 20,
          paddingTop: 12,
          gap: 10,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        {revealed ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            {GRADES.map((g) => {
              const tint =
                g.grade === "again"
                  ? colors.destructive
                  : g.grade === "hard"
                    ? colors.warning
                    : g.grade === "good"
                      ? colors.primary
                      : colors.success;
              return (
                <Pressable
                  key={g.grade}
                  onPress={() => grade(g.grade)}
                  style={{
                    flex: 1,
                    alignItems: "center",
                    gap: 3,
                    paddingVertical: 12,
                    borderRadius: Radius.card,
                    borderWidth: 1.5,
                    borderColor: tint,
                    backgroundColor: tint + "12",
                    opacity: review.isPending ? 0.5 : 1,
                  }}
                >
                  <Ionicons name={g.icon} size={16} color={tint} />
                  <Body size={FontSize.small} medium color={tint}>
                    {g.label}
                  </Body>
                  <Body size={FontSize.caption} color={colors.mutedForeground}>
                    {g.hint}
                  </Body>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Button label="Reveal answer" icon="eye-outline" full onPress={() => setRevealed(true)} />
        )}
      </View>
    </SafeAreaView>
  );
}
