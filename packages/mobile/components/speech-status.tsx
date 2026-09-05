import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FontSize, Radius } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useSpeechStatus } from "@/queries/speech";
import { Body, Card, Chip, Title } from "@/components/ui";

/**
 * An honest report on the native Amharic voice.
 *
 * This app refuses to read Amharic with an English voice, so with no provider
 * key configured it simply stays silent. That silence would look like a bug
 * unless the app says plainly what is missing — this panel names the exact
 * environment variables to supply, and never implies audio works when it does
 * not.
 */
export function SpeechStatusCard() {
  const colors = useColors();
  const status = useSpeechStatus();

  if (status.isLoading || !status.data) return null;

  const { nativeAudioAvailable, active, recognizer, providers, cache } = status.data;
  // Speaker and listener are genuinely different providers: our own LoRA voice
  // speaks but does not listen, so recognition falls through to the first
  // configured vendor that does. Naming only the speaker would be misleading.
  const splitStack = Boolean(recognizer && active && recognizer.id !== active.id);

  return (
    <Card style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: Radius.card,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: nativeAudioAvailable ? colors.primary + "1A" : colors.muted,
          }}
        >
          <Ionicons
            name={nativeAudioAvailable ? "volume-high-outline" : "volume-mute-outline"}
            size={18}
            color={nativeAudioAvailable ? colors.primary : colors.mutedForeground}
          />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Title size={FontSize.h3}>Amharic voice</Title>
          <Body size={FontSize.caption} color={colors.mutedForeground}>
            {nativeAudioAvailable && active
              ? `Native audio is live through ${active.label}.`
              : "No native voice is configured, so the app stays silent rather than mispronounce Amharic with an English voice."}
          </Body>
          <Body size={FontSize.caption} color={colors.mutedForeground}>
            {recognizer
              ? splitStack
                ? `Speaking practice listens through ${recognizer.label} — a different provider, because the active voice only speaks.`
                : `Speaking practice listens through ${recognizer.label}.`
              : "No recognizer is configured, so recorded takes fall back to the typed self-check — scored by the same rules."}
          </Body>
        </View>
      </View>

      {active ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {active.voices.map((voice) => (
            <Chip
              key={voice.id}
              label={`${voice.label}${voice.preview ? " · preview" : ""}`}
              icon="mic-outline"
            />
          ))}
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        {providers.map((provider) => (
          <View
            key={provider.id}
            style={{
              gap: 6,
              padding: 12,
              borderRadius: Radius.card,
              backgroundColor: colors.muted,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Body size={FontSize.small} medium style={{ flex: 1 }}>
                {provider.label}
              </Body>
              {provider.id === active?.id ? (
                <Chip label="voice" color={colors.primary} background={colors.primary + "1A"} />
              ) : null}
              {provider.id === recognizer?.id ? (
                <Chip
                  label="listens"
                  color={colors.accentForeground}
                  background={colors.accent}
                />
              ) : null}
              <Chip
                label={provider.configured ? "configured" : "no key"}
                color={provider.configured ? colors.primary : undefined}
                background={provider.configured ? colors.primary + "1A" : undefined}
              />
            </View>
            <Body size={FontSize.caption} color={colors.mutedForeground}>
              {provider.notes}
            </Body>
            {!provider.configured && provider.missingEnv.length ? (
              <Body size={FontSize.caption} color={colors.mutedForeground}>
                Needs {provider.missingEnv.join(" and ")}
              </Body>
            ) : null}
          </View>
        ))}
      </View>

      {cache.clips ? (
        <Body size={FontSize.caption} color={colors.mutedForeground}>
          {cache.clips} phrase{cache.clips === 1 ? "" : "s"} cached (
          {Math.round(cache.bytes / 1024)} KB) — course audio is generated once and reused.
        </Body>
      ) : null}
    </Card>
  );
}
