import { useMemo, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Fonts, FontSize, Radius } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useFidel } from "@/queries/content";
import { speakAmharic } from "@/lib/speech";
import {
  Am,
  Body,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Loading,
  ScreenHeader,
  TibebRule,
  Title,
  Translit,
} from "@/components/ui";

/**
 * ፊደል browser — the full syllabary, one row per base consonant and seven
 * columns for the orders. Unit 1 of the course teaches exactly this, so the
 * chart is a first-class screen rather than a lesson appendix.
 *
 * Only the twelve letters the source explicitly categorises carry a category
 * label; the rest deliberately show none instead of an invented one.
 */

export default function FidelScreen() {
  const colors = useColors();
  const fidel = useFidel();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{
    character: string;
    transliteration: string;
    romanBase: string;
  } | null>(null);

  const groups = useMemo(() => {
    const all = fidel.data?.groups ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (g) =>
        g.romanBase.toLowerCase().includes(q) ||
        g.baseChar.includes(q) ||
        (g.category ?? "").toLowerCase().includes(q) ||
        g.letters.some(
          (l) => l.character.includes(q) || l.transliteration.toLowerCase().includes(q),
        ),
    );
  }, [fidel.data, query]);

  const orders = fidel.data?.orders ?? [];

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScreenHeader
        title="Fidel chart"
        amharic="ፊደል"
        subtitle="34 base letters × 7 orders"
        back
      />

      {fidel.isLoading ? (
        <Loading label="Loading the syllabary…" />
      ) : fidel.isError ? (
        <ErrorState message={fidel.error?.message} onRetry={() => fidel.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 14,
              borderRadius: Radius.pill,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
            }}
          >
            <Ionicons name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search a letter or sound…"
              placeholderTextColor={colors.mutedForeground}
              style={{
                flex: 1,
                paddingVertical: 12,
                color: colors.foreground,
                fontFamily: Fonts.ethiopic,
                fontSize: FontSize.small,
              }}
            />
            {query ? (
              <Pressable onPress={() => setQuery("")} hitSlop={10}>
                <Ionicons name="close-circle" size={16} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>

          {selected ? (
            <Card tone="script" style={{ alignItems: "center", gap: 6, paddingVertical: 20 }}>
              <Am size={56} bold>
                {selected.character}
              </Am>
              <Translit size={FontSize.h3}>{selected.transliteration}</Translit>
              <Body size={FontSize.caption} color={colors.mutedForeground}>
                base {selected.romanBase}
              </Body>
            </Card>
          ) : (
            <Body size={FontSize.small} color={colors.mutedForeground}>
              Tap any letter to hear it. Each row is one consonant; the seven columns are its
              vowel orders.
            </Body>
          )}

          {/* order header */}
          <View style={{ flexDirection: "row", gap: 6, paddingLeft: 54 }}>
            {orders.map((order) => (
              <View key={order} style={{ flex: 1, alignItems: "center" }}>
                <Body size={FontSize.caption} medium color={colors.mutedForeground}>
                  {order}
                </Body>
              </View>
            ))}
          </View>

          {groups.length === 0 ? (
            <EmptyState
              icon="search-outline"
              title="No match"
              body="No letter or sound matches that search."
            />
          ) : (
            groups.map((group) => (
              <View key={group.baseOrder} style={{ gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Body size={FontSize.caption} medium color={colors.mutedForeground}>
                    {group.romanBase}
                  </Body>
                  {group.category ? <Chip label={group.category.replace(/_/g, " ")} /> : null}
                </View>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <View
                    style={{
                      width: 48,
                      alignItems: "center",
                      justifyContent: "center",
                      paddingVertical: 8,
                      borderRadius: Radius.card,
                      backgroundColor: colors.primary + "14",
                      borderWidth: 1,
                      borderColor: colors.primary + "33",
                    }}
                  >
                    <Am size={FontSize.h3} bold color={colors.primary}>
                      {group.baseChar}
                    </Am>
                  </View>

                  {group.letters.map((letter) => {
                    const isSelected = selected?.character === letter.character;
                    return (
                      <Pressable
                        key={letter.id}
                        onPress={() => {
                          setSelected({
                            character: letter.character,
                            transliteration: letter.transliteration,
                            romanBase: group.romanBase,
                          });
                          void speakAmharic(letter.character, { kind: "drill" });
                        }}
                        style={{
                          flex: 1,
                          alignItems: "center",
                          paddingVertical: 8,
                          borderRadius: Radius.card,
                          borderWidth: 1,
                          borderColor: isSelected ? colors.primary : colors.border,
                          backgroundColor: isSelected ? colors.primary + "14" : colors.card,
                        }}
                      >
                        <Am size={FontSize.h3}>{letter.character}</Am>
                        <Translit size={FontSize.caption - 1}>{letter.transliteration}</Translit>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))
          )}

          <View style={{ alignItems: "center", paddingTop: 8, gap: 8 }}>
            <TibebRule width={160} />
            <Title size={FontSize.caption} color={colors.mutedForeground}>
              {(fidel.data?.groups.length ?? 0) * (orders.length || 0)} letters
            </Title>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
