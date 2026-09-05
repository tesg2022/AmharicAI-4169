import { useMemo, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Fonts, FontSize, Radius } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useSession } from "@/hooks/use-session";
import { useOutline, useVocabulary } from "@/queries/content";
import { useSrsSummary } from "@/queries/srs";
import {
  Am,
  Body,
  Card,
  Chip,
  Loading,
  SpeakButton,
  Title,
  Translit,
} from "@/components/ui";

/** Practice hub: flashcards, drills, the ፊደል chart and speaking. */

function ActionTile({
  icon,
  title,
  subtitle,
  badge,
  tint,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  badge?: string | null;
  tint: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 150,
        gap: 8,
        padding: 16,
        borderRadius: Radius.card,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: tint + "1A",
          }}
        >
          <Ionicons name={icon} size={19} color={tint} />
        </View>
        {badge ? <Chip label={badge} color={tint} background={tint + "1A"} /> : null}
      </View>
      <Title size={FontSize.h3}>{title}</Title>
      <Body size={FontSize.caption} color={colors.mutedForeground}>
        {subtitle}
      </Body>
    </Pressable>
  );
}

export default function PracticeScreen() {
  const colors = useColors();
  const { isSignedIn } = useSession();
  const outline = useOutline();
  const srs = useSrsSummary(isSignedIn);
  const vocabulary = useVocabulary();
  const [query, setQuery] = useState("");

  const dueCount = srs.data?.due ?? 0;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return (vocabulary.data ?? [])
      .filter(
        (w) =>
          w.amharic.toLowerCase().includes(q) ||
          (w.transliteration ?? "").toLowerCase().includes(q) ||
          (w.english ?? "").toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [query, vocabulary.data]);

  const firstLessonId = outline.data?.units?.[0]?.lessons?.[0]?.id;

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 16 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Title size={FontSize.h1}>Practice</Title>
          <Body size={FontSize.small} color={colors.mutedForeground}>
            Short sessions beat long ones. Pick one and go.
          </Body>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          <ActionTile
            icon="albums-outline"
            title="Flashcards"
            subtitle={
              isSignedIn
                ? dueCount > 0
                  ? "Cards are waiting for review"
                  : "Nothing due — add words from a lesson"
                : "Sign in to build your deck"
            }
            badge={isSignedIn && dueCount > 0 ? `${dueCount} due` : null}
            tint={colors.primary}
            onPress={() => router.push("/flashcards")}
          />
          <ActionTile
            icon="grid-outline"
            title="ፊደል chart"
            subtitle="All 238 syllables, tap to hear each one"
            tint={colors.sky}
            onPress={() => router.push("/fidel")}
          />
          <ActionTile
            icon="volume-high-outline"
            title="Pronunciation"
            subtitle="Ejectives, vowel orders and minimal pairs"
            tint={colors.primary}
            onPress={() => router.push("/pronunciation")}
          />
          <ActionTile
            icon="help-circle-outline"
            title="Quick quiz"
            subtitle="Drills built from the lesson you are on"
            tint={colors.accent}
            onPress={() => router.push(firstLessonId ? `/quiz/${firstLessonId}` : "/")}
          />
          <ActionTile
            icon="mic-outline"
            title="Speaking"
            subtitle="Say a phrase, get a pronunciation score"
            tint={colors.destructive}
            onPress={() => router.push(firstLessonId ? `/speaking/${firstLessonId}` : "/")}
          />
        </View>

        {isSignedIn && srs.data ? (
          <Card style={{ gap: 10 }}>
            <Body size={FontSize.small} medium>
              Your review deck
            </Body>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              {[
                { label: "Total", value: srs.data.total },
                { label: "Due", value: srs.data.due },
                { label: "Learning", value: srs.data.learning },
                { label: "Mature", value: srs.data.mature },
              ].map((stat) => (
                <View key={stat.label} style={{ alignItems: "center", gap: 2 }}>
                  <Title size={FontSize.h3}>{stat.value}</Title>
                  <Body size={FontSize.caption} color={colors.mutedForeground}>
                    {stat.label}
                  </Body>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        <View style={{ gap: 10 }}>
          <Title size={FontSize.h3}>Word lookup</Title>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 14,
              borderRadius: Radius.pill,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Ionicons name="search" size={17} color={colors.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search Amharic, transliteration or English"
              placeholderTextColor={colors.mutedForeground}
              style={{
                flex: 1,
                paddingVertical: 12,
                fontFamily: Fonts.body,
                fontSize: FontSize.small,
                color: colors.foreground,
              }}
            />
            {query ? (
              <Pressable onPress={() => setQuery("")} hitSlop={10}>
                <Ionicons name="close-circle" size={17} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>

          {vocabulary.isLoading ? (
            <Loading />
          ) : query && !results.length ? (
            <Body size={FontSize.small} color={colors.mutedForeground}>
              No word matches “{query}”.
            </Body>
          ) : (
            results.map((word) => (
              <Card key={word.id} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Am size={FontSize.h3} bold>
                    {word.amharic}
                  </Am>
                  {word.transliteration ? <Translit>{word.transliteration}</Translit> : null}
                  {word.english ? (
                    <Body size={FontSize.small} color={colors.mutedForeground}>
                      {word.english}
                    </Body>
                  ) : null}
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 2 }}>
                    {word.partOfSpeech ? <Chip label={word.partOfSpeech} /> : null}
                  </View>
                </View>
                <SpeakButton amharic={word.amharic} transliteration={word.transliteration} />
              </Card>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
