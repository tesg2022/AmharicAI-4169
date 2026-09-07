import { useState } from "react";
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
import { router } from "expo-router";
import { Fonts, FontSize, Radius } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { t } from "@/i18n/messages";
import { usePreview } from "@/lib/preview-plan";
import {
  failureMessage,
  failureReason,
  useTranslate,
  type TranslateDirection,
} from "@/queries/catalog";
import { Am, Body, Button, Card, EmptyState, ScreenHeader } from "@/components/ui";

/**
 * Free-text translation.
 *
 * When no translation provider is configured this screen says so and translates
 * nothing. It never echoes the input back, and never falls back to a guess —
 * a wrong Amharic sentence shown confidently is worse than no sentence.
 *
 * (The English gloss inside lessons is a different thing: it comes from the
 * course data, works offline, and needs no provider.)
 */

export default function TranslateScreen() {
  const colors = useColors();
  const { plan, locale, toggleLocale } = usePreview();
  const [text, setText] = useState("");
  const [direction, setDirection] = useState<TranslateDirection>("en2am");
  const translate = useTranslate();

  const gatedByPlan = plan === "free";
  const reason = failureReason(translate.error);
  const result = translate.data;

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScreenHeader
        title={t(locale, "translate")}
        subtitle={t(locale, "translateSubtitle")}
        back
        right={
          <Button
            label={t(locale, "language")}
            variant="secondary"
            onPress={toggleLocale}
            style={{ paddingVertical: 8, paddingHorizontal: 14 }}
          />
        }
      />

      {gatedByPlan ? (
        <EmptyState
          icon="lock-closed-outline"
          title={t(locale, "planRequired")}
          body={t(locale, "translateGate")}
          action={<Button label={t(locale, "upgrade")} onPress={() => router.push("/pricing")} />}
        />
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={0}
        >
          <ScrollView
            contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View
              style={{
                flexDirection: "row",
                borderRadius: Radius.pill,
                backgroundColor: colors.muted,
                padding: 4,
              }}
            >
              {(
                [
                  ["en2am", "English → አማርኛ"],
                  ["am2en", "አማርኛ → English"],
                ] as [TranslateDirection, string][]
              ).map(([value, label]) => {
                const active = direction === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => setDirection(value)}
                    style={{
                      flex: 1,
                      alignItems: "center",
                      paddingVertical: 9,
                      borderRadius: Radius.pill,
                      backgroundColor: active ? colors.card : "transparent",
                    }}
                  >
                    <Am
                      size={FontSize.small}
                      bold={active}
                      color={active ? colors.foreground : colors.mutedForeground}
                    >
                      {label}
                    </Am>
                  </Pressable>
                );
              })}
            </View>

            <Card style={{ gap: 10 }}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={t(locale, "translatePlaceholder")}
                placeholderTextColor={colors.mutedForeground}
                multiline
                maxLength={2000}
                style={{
                  minHeight: 110,
                  textAlignVertical: "top",
                  // Amharic input needs the Ethiopic face or the glyphs fall back.
                  fontFamily: direction === "am2en" ? Fonts.ethiopic : Fonts.body,
                  fontSize: FontSize.body,
                  color: colors.foreground,
                }}
              />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Button
                  label={t(locale, "translateCta")}
                  icon="language-outline"
                  loading={translate.isPending}
                  disabled={text.trim().length === 0}
                  onPress={() => translate.run(text.trim(), direction)}
                />
                <Body size={FontSize.caption} color={colors.mutedForeground}>
                  {text.length}/2000
                </Body>
              </View>
            </Card>

            {result ? (
              <Card tone="script" style={{ gap: 6 }}>
                <Body size={FontSize.caption} color={colors.mutedForeground} medium>
                  From the configured provider
                </Body>
                {result.direction === "en2am" ? (
                  <Am size={FontSize.h3}>{result.translation}</Am>
                ) : (
                  <Body size={FontSize.h3}>{result.translation}</Body>
                )}
              </Card>
            ) : null}

            {translate.isError ? (
              <Card style={{ gap: 6, borderColor: colors.warning }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="alert-circle-outline" size={17} color={colors.warning} />
                  <Body size={FontSize.small} bold color={colors.warning}>
                    {reason === "translation_not_configured"
                      ? "Translation is not configured"
                      : "No translation was produced"}
                  </Body>
                </View>
                <Body size={FontSize.small}>{failureMessage(translate.error)}</Body>
                <Body size={FontSize.caption} color={colors.mutedForeground}>
                  Nothing was translated. The app will not show you a guessed Amharic sentence.
                </Body>
              </Card>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}
