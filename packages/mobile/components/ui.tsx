import type { ReactNode } from "react";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import Svg, { Path } from "react-native-svg";
import { Fonts, FontSize, Radius, shadow } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { repeatAmharic, speakAmharic, type VoiceMode } from "@/lib/speech";

/**
 * Shared AmharicAI primitives — see `design.md` at the app root.
 * Every Amharic string must render through `Am` so it gets the Ethiopic face.
 */

/* ------------------------------------------------------------------ text */

export function Am({
  children,
  size = FontSize.body,
  bold,
  color,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  size?: number;
  bold?: boolean;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const colors = useColors();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          fontFamily: bold ? Fonts.ethiopicBold : Fonts.ethiopic,
          fontSize: size,
          color: color ?? colors.foreground,
          lineHeight: size * 1.5,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Title({
  children,
  size = FontSize.h2,
  color,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const colors = useColors();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          fontFamily: Fonts.display,
          fontSize: size,
          color: color ?? colors.foreground,
          letterSpacing: -0.3,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Body({
  children,
  size = FontSize.body,
  color,
  medium,
  bold,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  size?: number;
  color?: string;
  medium?: boolean;
  bold?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const colors = useColors();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          fontFamily: bold ? Fonts.bodyBold : medium ? Fonts.bodyMedium : Fonts.body,
          fontSize: size,
          color: color ?? colors.foreground,
          lineHeight: size * 1.45,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Latin transliteration — always italic-ish muted, never confused with English. */
export function Translit({ children, size = FontSize.small }: { children: ReactNode; size?: number }) {
  const colors = useColors();
  return (
    <Text
      style={{
        fontFamily: Fonts.body,
        fontSize: size,
        color: colors.mutedForeground,
        fontStyle: "italic",
      }}
    >
      {children}
    </Text>
  );
}

/* --------------------------------------------------------------- surfaces */

export function Card({
  children,
  style,
  tone = "card",
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: "card" | "script" | "muted";
}) {
  const colors = useColors();
  const background =
    tone === "script" ? colors.scriptSurface : tone === "muted" ? colors.muted : colors.card;
  return (
    <View
      style={[
        {
          backgroundColor: background,
          borderRadius: Radius.card,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 16,
          ...shadow,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Chip({
  label,
  color,
  background,
  icon,
}: {
  label: string;
  color?: string;
  background?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: Radius.pill,
        backgroundColor: background ?? colors.muted,
      }}
    >
      {icon ? <Ionicons name={icon} size={12} color={color ?? colors.mutedForeground} /> : null}
      <Text
        style={{
          fontFamily: Fonts.bodyMedium,
          fontSize: FontSize.caption,
          color: color ?? colors.mutedForeground,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/** QA flags from the source spec surface as amber notes — never silently fixed. */
export function QaNote({ flag }: { flag?: string | null }) {
  const colors = useColors();
  if (!flag) return null;
  const label =
    flag === "generated_from_source"
      ? "Practice drill generated from the source material"
      : flag.replace(/_/g, " ");
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 8,
        alignItems: "flex-start",
        backgroundColor: colors.accent + "22",
        borderLeftWidth: 3,
        borderLeftColor: colors.warning,
        borderRadius: 8,
        padding: 10,
      }}
    >
      <Ionicons name="alert-circle-outline" size={15} color={colors.warning} style={{ marginTop: 1 }} />
      <Body size={FontSize.caption} color={colors.warning} style={{ flex: 1 }}>
        {label}
      </Body>
    </View>
  );
}

/* --------------------------------------------------------------- controls */

export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  loading,
  disabled,
  style,
  full,
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "accent" | "sky" | "destructive";
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  full?: boolean;
}) {
  const colors = useColors();

  const palette: Record<string, { bg: string; fg: string; border: string }> = {
    primary: { bg: colors.primary, fg: colors.primaryForeground, border: colors.primary },
    accent: { bg: colors.accent, fg: colors.accentForeground, border: colors.accent },
    sky: { bg: colors.sky, fg: "#FFFFFF", border: colors.sky },
    destructive: { bg: colors.destructive, fg: "#FFFFFF", border: colors.destructive },
    secondary: { bg: colors.card, fg: colors.foreground, border: colors.border },
    ghost: { bg: "transparent", fg: colors.primary, border: "transparent" },
  };
  const tone = palette[variant]!;
  const inactive = disabled || loading;

  return (
    <Pressable
      onPress={inactive ? undefined : onPress}
      accessibilityRole="button"
      // The label is the visible text, so a screen reader and a sighted user
      // hear and read the same thing. Loading/disabled is announced as state
      // rather than being silently unresponsive.
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          minHeight: 44,
          paddingVertical: 14,
          paddingHorizontal: 20,
          borderRadius: Radius.pill,
          backgroundColor: tone.bg,
          borderWidth: 1,
          borderColor: tone.border,
          opacity: inactive ? 0.5 : pressed ? 0.85 : 1,
          alignSelf: full ? "stretch" : "flex-start",
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={tone.fg} />
      ) : icon ? (
        <Ionicons name={icon} size={17} color={tone.fg} />
      ) : null}
      <Text style={{ fontFamily: Fonts.bodyBold, fontSize: FontSize.small, color: tone.fg }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Plays a phrase in a real Amharic voice.
 *
 * `transliteration` is only used for the accessibility label — it is never
 * spoken. Reading Latin letters with an English voice would teach an English
 * approximation of the word, which is the exact habit this app exists to
 * prevent. When no native voice is reachable the button goes muted and
 * `onMissingVoice` fires so the screen can explain why.
 */
export function SpeakButton({
  amharic,
  transliteration,
  mode = "native",
  voice,
  kind,
  refId,
  size = 38,
  onMissingVoice,
}: {
  amharic: string;
  transliteration?: string | null;
  mode?: VoiceMode;
  voice?: string | null;
  kind?: string;
  refId?: string | null;
  size?: number;
  onMissingVoice?: (reason: string) => void;
}) {
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const [silent, setSilent] = useState(false);
  const tint = silent ? colors.muted : colors.primary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Play ${amharic}${transliteration ? ` (${transliteration})` : ""}`}
      onPress={async () => {
        setBusy(true);
        const result = await speakAmharic(amharic, { mode, voice, kind, refId });
        setSilent(result.source === "none");
        if (result.source === "none" && result.reason) onMissingVoice?.(result.reason);
        setTimeout(() => setBusy(false), 600);
      }}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: silent
          ? colors.muted
          : colors.primary + (pressed ? "33" : "1A"),
        borderWidth: 1,
        borderColor: silent ? colors.border : colors.primary + "44",
      })}
    >
      <Ionicons
        name={silent ? "volume-mute-outline" : busy ? "volume-high" : "volume-medium-outline"}
        size={size * 0.45}
        color={silent ? colors.mutedForeground : tint}
      />
    </Pressable>
  );
}

/** Native / Slow switch. Slow is 0.7x with wider pauses, not a pitch-shifted clip. */
export function VoiceModeToggle({
  mode,
  onChange,
}: {
  mode: VoiceMode;
  onChange: (mode: VoiceMode) => void;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 4,
        padding: 3,
        borderRadius: Radius.pill,
        backgroundColor: colors.muted,
      }}
    >
      {(["native", "slow"] as const).map((value) => {
        const active = mode === value;
        return (
          <Pressable
            key={value}
            onPress={() => onChange(value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={value === "native" ? "Native speed" : "Slow speed, 0.7x"}
            hitSlop={10}
            style={{
              minHeight: 44,
              justifyContent: "center",
              paddingHorizontal: 14,
              paddingVertical: 6,
              borderRadius: Radius.pill,
              backgroundColor: active ? colors.primary : "transparent",
            }}
          >
            <Text
              style={{
                fontFamily: Fonts.bodyBold,
                fontSize: FontSize.caption,
                color: active ? colors.primaryForeground : colors.mutedForeground,
              }}
            >
              {value === "native" ? "Native" : "Slow"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Plays the phrase several times with a gap — the "get it into your ear" drill. */
export function RepeatButton({
  amharic,
  mode = "native",
  times = 3,
}: {
  amharic: string;
  mode?: VoiceMode;
  times?: number;
}) {
  const colors = useColors();
  const [running, setRunning] = useState(false);

  return (
    <Pressable
      disabled={running}
      onPress={async () => {
        setRunning(true);
        await repeatAmharic(amharic, { mode, times });
        setRunning(false);
      }}
      accessibilityRole="button"
      accessibilityLabel={`Repeat the phrase ${times} times`}
      accessibilityState={{ disabled: running, busy: running }}
      hitSlop={8}
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: 44,
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: Radius.pill,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        opacity: running ? 0.6 : 1,
      }}
    >
      <Ionicons name="repeat" size={15} color={colors.mutedForeground} />
      <Text
        style={{
          fontFamily: Fonts.bodyBold,
          fontSize: FontSize.caption,
          color: colors.mutedForeground,
        }}
      >
        {running ? "Repeating…" : `Repeat ×${times}`}
      </Text>
    </Pressable>
  );
}

export function ProgressBar({
  value,
  color,
  height = 8,
}: {
  value: number;
  color?: string;
  height?: number;
}) {
  const colors = useColors();
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View
      style={{
        height,
        borderRadius: height / 2,
        backgroundColor: colors.muted,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: `${pct * 100}%`,
          height: "100%",
          borderRadius: height / 2,
          backgroundColor: color ?? colors.primary,
        }}
      />
    </View>
  );
}

/* ---------------------------------------------------------------- chrome */

export function ScreenHeader({
  title,
  subtitle,
  amharic,
  back,
  right,
}: {
  title: string;
  subtitle?: string | null;
  amharic?: string | null;
  back?: boolean;
  right?: ReactNode;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 14,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.background,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        {back ? (
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={12}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Ionicons name="chevron-back" size={20} color={colors.foreground} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <Title size={FontSize.h2} numberOfLines={2}>
            {title}
          </Title>
          {amharic ? (
            <Am size={FontSize.small} color={colors.primary}>
              {amharic}
            </Am>
          ) : null}
          {subtitle ? (
            <Body size={FontSize.caption} color={colors.mutedForeground}>
              {subtitle}
            </Body>
          ) : null}
        </View>
        {right}
      </View>
    </View>
  );
}

/** Tibeb-inspired chevron rule — the one decorative motif in the app. */
export function TibebRule({ width = 200, color }: { width?: number; color?: string }) {
  const colors = useColors();
  const stroke = color ?? colors.accent;
  const step = 14;
  const height = 10;
  let d = "";
  for (let x = 0; x < width; x += step) {
    d += `M ${x} ${height - 1} L ${x + step / 2} 1 L ${x + step} ${height - 1} `;
  }
  return (
    <Svg width={width} height={height} accessibilityLabel="">
      <Path d={d} stroke={stroke} strokeWidth={1.5} fill="none" strokeLinejoin="round" />
    </Svg>
  );
}

export function Loading({ label }: { label?: string }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 }}>
      <ActivityIndicator color={colors.primary} />
      {label ? (
        <Body size={FontSize.small} color={colors.mutedForeground}>
          {label}
        </Body>
      ) : null}
    </View>
  );
}

export function EmptyState({
  icon = "sparkles-outline",
  title,
  body,
  action,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={{ alignItems: "center", gap: 10, padding: 32 }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.muted,
        }}
      >
        <Ionicons name={icon} size={26} color={colors.mutedForeground} />
      </View>
      <Title size={FontSize.h3}>{title}</Title>
      {body ? (
        <Body size={FontSize.small} color={colors.mutedForeground} style={{ textAlign: "center" }}>
          {body}
        </Body>
      ) : null}
      {action}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title="Could not load"
      body={message ?? "Check your connection and try again."}
      action={onRetry ? <Button label="Retry" variant="secondary" icon="refresh" onPress={onRetry} /> : undefined}
    />
  );
}

/** Prompts an anonymous learner to sign in before a progress-bearing action. */
export function SignInPrompt({ message }: { message: string }) {
  return (
    <EmptyState
      icon="person-circle-outline"
      title="Sign in to keep your progress"
      body={message}
      action={<Button label="Sign in" icon="log-in-outline" onPress={() => router.push("/sign-in")} />}
    />
  );
}
