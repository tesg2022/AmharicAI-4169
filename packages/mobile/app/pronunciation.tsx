import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontSize, Radius } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { speakAmharic, type VoiceMode } from "@/lib/speech";
import {
  usePronunciationDrills,
  usePronunciationGuide,
  usePronunciationPairs,
} from "@/queries/pronunciation";
import {
  Am,
  Body,
  Card,
  Chip,
  ErrorState,
  Loading,
  ScreenHeader,
  SpeakButton,
  VoiceModeToggle,
  Title,
  Translit,
} from "@/components/ui";

/**
 * Amharic Pronunciation for English Speakers — ለእንግሊዝኛ ተናጋሪዎች የአማርኛ አነባበብ
 *
 * Built around one teaching point: "ጠ = ta" is wrong. ጠ, ቀ, ጰ, ጨ and ጸ are
 * ejectives — throat closed, released with a pop — and are separate consonants
 * from ተ, ከ, ፐ, ቸ and ሰ. Every ejective is shown beside its plain counterpart.
 */

type Sound = {
  id: string;
  fidel: string;
  family: string;
  roman: string;
  ipa: string;
  soundClass: string;
  label: string;
  englishApprox: string;
  warning: string | null;
  mouthPosition: string;
  contrastWith: string | null;
  examples: { amharic: string; transliteration: string; english: string }[];
};

const TABS = [
  { id: "sounds", label: "Sounds" },
  { id: "contrast", label: "Contrast" },
  { id: "pairs", label: "Pairs" },
  { id: "drills", label: "Repeat" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function Ipa({ value }: { value: string }) {
  const colors = useColors();
  return (
    <View
      style={{
        backgroundColor: colors.muted,
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
      }}
    >
      <Body size={FontSize.caption} color={colors.foreground}>
        /{value}/
      </Body>
    </View>
  );
}

function WarningNote({ text }: { text: string }) {
  const colors = useColors();
  return (
    <View
      style={{
        backgroundColor: colors.accent + "22",
        borderLeftWidth: 3,
        borderLeftColor: colors.warning,
        borderRadius: 8,
        padding: 10,
      }}
    >
      <Body size={FontSize.caption} color={colors.warning}>
        {text}
      </Body>
    </View>
  );
}

function SoundCard({ sound, mode }: { sound: Sound; mode: VoiceMode }) {
  const colors = useColors();
  const ejective = sound.soundClass === "ejective";

  return (
    <Card
      tone="script"
      style={{ gap: 12, borderColor: ejective ? colors.primary + "66" : colors.border }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 14 }}>
        <Am size={44} color={colors.primary}>
          {sound.fidel}
        </Am>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Title size={FontSize.h3}>{sound.roman}</Title>
            <Ipa value={sound.ipa} />
            {ejective ? (
              <Chip label="ejective" color={colors.primary} background={colors.primary + "22"} />
            ) : null}
          </View>
          <Body size={FontSize.caption} color={colors.mutedForeground}>
            {sound.label}
          </Body>
        </View>
        <SpeakButton amharic={sound.fidel} transliteration={sound.roman} mode={mode} kind="drill" refId={sound.id} />
      </View>

      <View style={{ gap: 6 }}>
        <Body size={FontSize.small}>
          <Body size={FontSize.small} bold>
            Sounds like:{" "}
          </Body>
          {sound.englishApprox}
        </Body>
        <Body size={FontSize.small} color={colors.mutedForeground}>
          <Body size={FontSize.small} bold color={colors.foreground}>
            Mouth &amp; throat:{" "}
          </Body>
          {sound.mouthPosition}
        </Body>
      </View>

      {sound.warning ? <WarningNote text={sound.warning} /> : null}

      <View style={{ gap: 8 }}>
        <Body size={FontSize.caption} color={colors.mutedForeground}>
          THE SEVEN ORDERS
        </Body>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {sound.family
            .split(/\s+/)
            .filter(Boolean)
            .map((char, i) => (
              <Pressable
                key={`${sound.id}-fam-${i}`}
                onPress={() => {
                  void speakAmharic(char, { mode, kind: "drill" });
                }}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: Radius.card,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  backgroundColor: colors.scriptSurface,
                }}
              >
                <Am size={20}>{char}</Am>
              </Pressable>
            ))}
        </View>
      </View>

      {sound.examples.length ? (
        <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
          <Body size={FontSize.caption} color={colors.mutedForeground}>
            EXAMPLE WORDS
          </Body>
          {sound.examples.map((ex, i) => (
            <View
              key={`${sound.id}-ex-${i}`}
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <SpeakButton amharic={ex.amharic} transliteration={ex.transliteration} size={32} />
              <View style={{ flex: 1 }}>
                <Am size={FontSize.body}>{ex.amharic}</Am>
                <Translit>{ex.transliteration}</Translit>
                <Body size={FontSize.caption} color={colors.mutedForeground}>
                  {ex.english}
                </Body>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

export default function PronunciationScreen() {
  const colors = useColors();
  const guide = usePronunciationGuide();
  const pairs = usePronunciationPairs();
  const drills = usePronunciationDrills();
  const [tab, setTab] = useState<TabId>("sounds");
  const [mode, setMode] = useState<VoiceMode>("native");

  const data = guide.data;
  const vowels = (data?.vowels ?? []) as Sound[];
  const plain = (data?.plain ?? []) as Sound[];
  const ejectives = (data?.ejectives ?? []) as Sound[];
  const other = (data?.other ?? []) as Sound[];
  const contrasts = (data?.contrasts ?? []) as { plain: Sound; ejective: Sound | null }[];

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScreenHeader
        title="Pronunciation for English speakers"
        amharic="ለእንግሊዝኛ ተናጋሪዎች የአማርኛ አነባበብ"
        subtitle="Vowel orders, ejectives, minimal pairs"
        back
      />

      {guide.isLoading ? (
        <Loading label="Loading the pronunciation guide…" />
      ) : guide.isError ? (
        <ErrorState message={guide.error?.message} onRetry={() => guide.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 56 }}
          showsVerticalScrollIndicator={false}
        >
          <Card tone="muted" style={{ gap: 8 }}>
            <Body size={FontSize.small} color={colors.mutedForeground}>
              Amharic is written in the Geʿez syllabary (ፊደል): each symbol is one consonant
              plus one of seven vowels. Most sounds map closely onto English — but ጠ, ቀ, ጰ,
              ጨ and ጸ are ejectives, made with the throat closed and released with a small
              pop. They are separate consonants, not accented versions of ተ, ከ, ፐ, ቸ, ሰ.
            </Body>
          </Card>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setTab(t.id)}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                    borderRadius: Radius.pill,
                    backgroundColor: active ? colors.primary : colors.muted,
                  }}
                >
                  <Body
                    size={FontSize.small}
                    bold
                    color={active ? colors.primaryForeground : colors.mutedForeground}
                  >
                    {t.label}
                  </Body>
                </Pressable>
              );
            })}
            <View style={{ marginLeft: "auto" }}>
              <VoiceModeToggle mode={mode} onChange={setMode} />
            </View>
          </View>

          {tab === "sounds" ? (
            <View style={{ gap: 20 }}>
              <View style={{ gap: 12 }}>
                <Title size={FontSize.h3}>The seven vowel orders</Title>
                {vowels.map((s) => (
                  <SoundCard key={s.id} sound={s} mode={mode} />
                ))}
              </View>
              <View style={{ gap: 12 }}>
                <Title size={FontSize.h3}>Ejective consonants</Title>
                {ejectives.map((s) => (
                  <SoundCard key={s.id} sound={s} mode={mode} />
                ))}
              </View>
              <View style={{ gap: 12 }}>
                <Title size={FontSize.h3}>Plain counterparts</Title>
                {plain.map((s) => (
                  <SoundCard key={s.id} sound={s} mode={mode} />
                ))}
              </View>
              {other.length ? (
                <View style={{ gap: 12 }}>
                  <Title size={FontSize.h3}>Other sounds to watch</Title>
                  {other.map((s) => (
                    <SoundCard key={s.id} sound={s} mode={mode} />
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {tab === "contrast" ? (
            <View style={{ gap: 12 }}>
              <Body size={FontSize.small} color={colors.mutedForeground}>
                Play the plain sound, then the ejective. The tongue is in the same place both
                times; only the closed throat and the popped release change.
              </Body>
              {contrasts.map(({ plain: p, ejective: e }) =>
                e ? (
                  <Card key={p.id} style={{ gap: 12 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <View style={{ flex: 1, alignItems: "center", gap: 4 }}>
                        <Am size={34}>{p.fidel}</Am>
                        <Body size={FontSize.caption} bold>
                          {p.roman}
                        </Body>
                        <Ipa value={p.ipa} />
                        <SpeakButton amharic={p.fidel} transliteration={p.roman} size={32} />
                        <Body size={FontSize.caption} color={colors.mutedForeground}>
                          plain
                        </Body>
                      </View>
                      <Body size={FontSize.caption} color={colors.mutedForeground}>
                        vs
                      </Body>
                      <View style={{ flex: 1, alignItems: "center", gap: 4 }}>
                        <Am size={34} color={colors.primary}>
                          {e.fidel}
                        </Am>
                        <Body size={FontSize.caption} bold>
                          {e.roman}
                        </Body>
                        <Ipa value={e.ipa} />
                        <SpeakButton amharic={e.fidel} transliteration={e.roman} size={32} />
                        <Body size={FontSize.caption} color={colors.mutedForeground}>
                          ejective
                        </Body>
                      </View>
                    </View>
                    {e.warning ? <WarningNote text={e.warning} /> : null}
                  </Card>
                ) : null,
              )}
            </View>
          ) : null}

          {tab === "pairs" ? (
            <View style={{ gap: 16 }}>
              {pairs.isLoading ? <Loading label="Loading exercises…" /> : null}

              <View style={{ gap: 12 }}>
                <Title size={FontSize.h3}>Minimal pairs</Title>
                <Body size={FontSize.small} color={colors.mutedForeground}>
                  Identical vowel, one consonant feature apart. Tap each side, then say both
                  yourself until the difference is automatic.
                </Body>
                {(pairs.data?.minimalPairs ?? []).map((pair) => (
                  <Card key={pair.id} style={{ gap: 12 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <Pressable
                        onPress={() => {
                          void speakAmharic(pair.plainText, { mode, kind: "drill" });
                        }}
                        style={{
                          flex: 1,
                          alignItems: "center",
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: Radius.card,
                          paddingVertical: 14,
                        }}
                      >
                        <Am size={30}>{pair.plainText}</Am>
                        <Translit>{pair.plainRoman}</Translit>
                      </Pressable>
                      <Body size={FontSize.caption} color={colors.mutedForeground}>
                        vs
                      </Body>
                      <Pressable
                        onPress={() => {
                          void speakAmharic(pair.ejectiveText, { mode, kind: "drill" });
                        }}
                        style={{
                          flex: 1,
                          alignItems: "center",
                          borderWidth: 1,
                          borderColor: colors.primary + "66",
                          backgroundColor: colors.primary + "0D",
                          borderRadius: Radius.card,
                          paddingVertical: 14,
                        }}
                      >
                        <Am size={30} color={colors.primary}>
                          {pair.ejectiveText}
                        </Am>
                        <Translit>{pair.ejectiveRoman}</Translit>
                      </Pressable>
                    </View>
                    <Body size={FontSize.caption} color={colors.mutedForeground}>
                      {pair.note}
                    </Body>
                  </Card>
                ))}
              </View>

              <View style={{ gap: 12 }}>
                <Title size={FontSize.h3}>Contrast examples in words</Title>
                <Body size={FontSize.small} color={colors.mutedForeground}>
                  Real words showing each sound word-initially. These are contrast examples,
                  not minimal pairs — the rest of the word differs too.
                </Body>
                {(pairs.data?.contrastExamples ?? []).map((pair) => (
                  <Card key={pair.id} style={{ gap: 10 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <SpeakButton amharic={pair.plainText} size={32} />
                      <View style={{ flex: 1 }}>
                        <Am size={FontSize.h3}>{pair.plainText}</Am>
                        <Translit>{pair.plainRoman}</Translit>
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <SpeakButton amharic={pair.ejectiveText} size={32} />
                      <View style={{ flex: 1 }}>
                        <Am size={FontSize.h3} color={colors.primary}>
                          {pair.ejectiveText}
                        </Am>
                        <Translit>{pair.ejectiveRoman}</Translit>
                      </View>
                    </View>
                    <Body size={FontSize.caption} color={colors.mutedForeground}>
                      {pair.note}
                    </Body>
                  </Card>
                ))}
              </View>
            </View>
          ) : null}

          {tab === "drills" ? (
            <View style={{ gap: 12 }}>
              {drills.isLoading ? <Loading label="Loading drills…" /> : null}
              <Body size={FontSize.small} color={colors.mutedForeground}>
                Listen, then repeat out loud. Where the device has no Amharic voice the
                transliteration is read instead and the app says so.
              </Body>
              {(drills.data ?? []).map((drill) => (
                <Card key={drill.id} style={{ gap: 10 }}>
                  <Title size={FontSize.h3}>{drill.title}</Title>
                  <Body size={FontSize.small} color={colors.mutedForeground}>
                    {drill.instructions}
                  </Body>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {drill.items.map((item, i) => (
                      <View
                        key={`${drill.id}-${i}`}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: Radius.card,
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          backgroundColor: colors.scriptSurface,
                        }}
                      >
                        <Am size={22}>{item}</Am>
                        <SpeakButton amharic={item} size={28} />
                      </View>
                    ))}
                  </View>
                </Card>
              ))}
            </View>
          ) : null}

          <Card tone="muted" style={{ gap: 6 }}>
            <Body size={FontSize.caption} color={colors.mutedForeground}>
              {`${vowels.length} vowel orders · ${ejectives.length} ejectives · ${
                pairs.data?.minimalPairs.length ?? 0
              } minimal pairs · ${drills.data?.length ?? 0} drills`}
            </Body>
          </Card>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
