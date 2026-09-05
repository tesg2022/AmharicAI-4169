import { Platform } from "react-native";

/**
 * AmharicAI color tokens — see `design.md` at the app root.
 * Warm ivory canvas, highland green primary, gold for XP/streak rewards,
 * red-clay for mistakes, a reserved blue for AI Tutor surfaces.
 */
export const Colors = {
  light: {
    background: "#FBF7EF",
    foreground: "#14201B",
    card: "#FFFFFF",
    cardForeground: "#14201B",
    primary: "#0B6E4F",
    primaryForeground: "#FBF7EF",
    secondary: "#EFE7D7",
    secondaryForeground: "#14201B",
    muted: "#EFE7D7",
    mutedForeground: "#6B7B72",
    accent: "#F0B323",
    accentForeground: "#2B1D00",
    border: "#E1D7C4",
    destructive: "#C1272D",
    success: "#2F9E44",
    warning: "#D97706",
    /** AI Tutor surfaces — keeps AI visually distinct from course content. */
    sky: "#1D6F9E",
    /** Tint used behind ፊደል / script surfaces. */
    scriptSurface: "#EDF3F0",
  },
  dark: {
    background: "#0E1512",
    foreground: "#F3EFE6",
    card: "#16211C",
    cardForeground: "#F3EFE6",
    primary: "#12A171",
    primaryForeground: "#06110C",
    secondary: "#1D2A24",
    secondaryForeground: "#F3EFE6",
    muted: "#1D2A24",
    mutedForeground: "#93A79C",
    accent: "#F5C449",
    accentForeground: "#2B1D00",
    border: "#26332C",
    destructive: "#E0484E",
    success: "#3FBF57",
    warning: "#F59E0B",
    sky: "#4AA3D4",
    scriptSurface: "#152420",
  },
} as const;

export type ColorScheme = keyof typeof Colors;
export type ThemeColors = (typeof Colors)[ColorScheme];

/**
 * Font families loaded in `app/_layout.tsx`.
 * Amharic (Ge'ez) script must always use `ethiopic` — the Latin body faces have
 * no Ethiopic glyphs and fall back to an inconsistent system font.
 */
export const Fonts = {
  display: "Sora_700Bold",
  displaySemi: "Sora_600SemiBold",
  body: "Manrope_400Regular",
  bodyMedium: "Manrope_500Medium",
  bodyBold: "Manrope_700Bold",
  ethiopic: "NotoSansEthiopic_400Regular",
  ethiopicBold: "NotoSansEthiopic_700Bold",
  mono: Platform.select({
    ios: "ui-monospace",
    default: "monospace",
    web: "'SF Mono', 'Roboto Mono', monospace",
  }) as string,
};

/** Type scale from design.md. */
export const FontSize = {
  hero: 34,
  h1: 28,
  h2: 22,
  h3: 18,
  body: 16,
  small: 14,
  caption: 12,
} as const;

export const Radius = { card: 14, sheet: 20, pill: 999 } as const;

/** Soft warm shadow — never neutral gray. */
export const shadow = {
  shadowColor: "rgba(20,32,27,1)",
  shadowOpacity: 0.08,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 3,
} as const;
