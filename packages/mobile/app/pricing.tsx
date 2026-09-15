import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { FontSize } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useSession } from "@/hooks/use-session";
import { t } from "@/i18n/messages";
import { usePreview, type PreviewPlan } from "@/lib/preview-plan";
import { failureMessage, useEntitlements } from "@/queries/catalog";
import { PaidPlans } from "@/components/paid-plans";
import {
  Am,
  Body,
  Button,
  Card,
  ErrorState,
  Loading,
  ScreenHeader,
} from "@/components/ui";

/**
 * Plans.
 *
 * Two things this screen refuses to do:
 *
 *  1. Sell a capability that does not exist. A plan can GRANT a feature while
 *     the feature is `coming_soon` (custom voice, speaking feedback),
 *     `preview` (AI tutor) or `not_configured` (TTS host, translation key).
 *     The server folds the grant axis and the capability axis into one
 *     resolved `state` per feature and ships the chip copy with it, so this
 *     screen cannot word it differently from the website. `coming_soon` is
 *     reported ahead of `plan_gated` on purpose: never invite an upgrade for
 *     something that does not exist.
 *  2. Offer a preview switch to somebody who is signed in. The server resolves
 *     a signed-in learner's plan from their session and ignores the switch
 *     entirely, so those buttons would do nothing at all.
 *
 * It used to refuse a third thing — to pretend it could charge — with a notice
 * saying billing was not wired into this build. That notice outlived its
 * truth: Paystack is connected, checkout opens, and a card is charged. A stale
 * honesty notice is just another false statement, so it is gone and the real
 * state of checkout now comes from `billing.catalogue`, which knows.
 */

type CapabilityStatus = "available" | "preview" | "coming_soon" | "not_configured";
type FeatureState = CapabilityStatus | "plan_gated";

type Feature = {
  id: string;
  label_en: string;
  label_am: string;
  min_plan: string;
  capability: CapabilityStatus;
  caveat_en?: string | undefined;
  caveat_am?: string | undefined;
  granted: boolean;
  usable: boolean;
  /** Resolved by the server; the only thing this screen should report. */
  state: FeatureState;
  /** Chip copy, shipped with the state so the two surfaces cannot diverge. */
  state_label: { en: string; am: string };
};

const STATE_ICON: Record<FeatureState, keyof typeof Ionicons.glyphMap> = {
  available: "checkmark-circle",
  preview: "flask-outline",
  coming_soon: "construct-outline",
  not_configured: "alert-circle-outline",
  plan_gated: "lock-closed-outline",
};

function CapabilityRow({ feature }: { feature: Feature }) {
  const colors = useColors();
  const { locale } = usePreview();

  const icon = STATE_ICON[feature.state];

  const tint =
    feature.state === "available"
      ? colors.success
      : feature.state === "plan_gated"
        ? colors.mutedForeground
        : colors.warning;

  const status = feature.state_label[locale];

  // Only ever the caveat written in the reader's own language — a mixed-script
  // fallback would be worse than showing nothing.
  //
  // A plan-gated feature keeps its capability caveat, prefixed: a Free learner
  // told only "needs a higher plan" would upgrade for translation and find it
  // unconfigured. The prefix makes it read as "and upgrading still would not
  // be enough" rather than as the reason for the gate.
  const rawCaveat = locale === "am" ? feature.caveat_am : feature.caveat_en;
  const caveat = rawCaveat
    ? feature.state === "plan_gated"
      ? `${t(locale, "evenThen")} ${rawCaveat}`
      : rawCaveat
    : undefined;

  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
      <Ionicons name={icon} size={16} color={tint} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {locale === "am" ? (
          <Am size={FontSize.small}>{feature.label_am}</Am>
        ) : (
          <Body size={FontSize.small}>{feature.label_en}</Body>
        )}
        <Body size={FontSize.caption} color={tint} medium>
          {status}
        </Body>
        {/* The caveat is rendered verbatim — it is the honest part. */}
        {caveat ? (
          locale === "am" ? (
            <Am size={FontSize.caption} color={colors.mutedForeground}>
              {caveat}
            </Am>
          ) : (
            <Body size={FontSize.caption} color={colors.mutedForeground}>
              {caveat}
            </Body>
          )
        ) : null}
      </View>
    </View>
  );
}

export default function PricingScreen() {
  const colors = useColors();
  const { plan, setPlan, locale, toggleLocale } = usePreview();
  const { isSignedIn } = useSession();
  const me = useEntitlements();

  const features = (me.data?.features ?? []) as Feature[];
  const previewPlans = me.data?.plans ?? [];

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScreenHeader
        title={t(locale, "pricing")}
        subtitle={t(locale, "pricingSubtitle")}
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

      {me.isLoading ? (
        <Loading />
      ) : me.isError ? (
        <ErrorState message={failureMessage(me.error)} onRetry={() => me.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Who the purchase would belong to, said before anyone taps. A
              subscription has to have an owner, so a signed-out tap is refused
              by the server — better to know now. */}
          {isSignedIn ? (
            <Button
              label="Your plan"
              variant="secondary"
              icon="ribbon-outline"
              onPress={() => router.push("/subscription")}
              style={{ alignSelf: "flex-start" }}
            />
          ) : (
            <View
              style={{
                backgroundColor: colors.accent + "22",
                borderLeftWidth: 3,
                borderLeftColor: colors.primary,
                borderRadius: 10,
                padding: 12,
                gap: 4,
              }}
            >
              <Body size={FontSize.small} bold>
                Sign in before you buy
              </Body>
              <Body size={FontSize.caption} color={colors.foreground}>
                A subscription belongs to an account, so there is nothing to attach one to yet.
                Checkout will say the same thing if you try — nothing is charged.
              </Body>
              <Button
                label="Sign in"
                icon="log-in-outline"
                variant="secondary"
                onPress={() => router.push("/sign-in")}
                style={{ alignSelf: "flex-start", marginTop: 4 }}
              />
            </View>
          )}

          {/* Prices, terms and checkout — the same block Your plan renders, so
              the two screens cannot quote different numbers. */}
          <PaidPlans />

          {/* The preview switch grants nothing and is ignored once signed in,
              so it is only offered to people it can actually do something
              for: anonymous readers deciding what to buy. */}
          {isSignedIn ? null : (
            <Card tone="muted" style={{ gap: 10 }}>
              <Body size={FontSize.small} bold>
                Look around first
              </Body>
              <Body size={FontSize.caption} color={colors.mutedForeground}>
                {t(locale, "previewNote")}
              </Body>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {previewPlans.map((p) => (
                  <Button
                    key={p.id}
                    label={p.id === plan ? `${p.name_en} ✓` : p.name_en}
                    variant={p.id === plan ? "primary" : "secondary"}
                    icon="eye-outline"
                    onPress={() => setPlan(p.id as PreviewPlan)}
                  />
                ))}
              </View>
            </Card>
          )}

          <Card tone="muted" style={{ gap: 10 }}>
            <Body size={FontSize.small} bold>
              {isSignedIn
                ? "What each feature actually does today, on the plan your account holds"
                : `What each feature actually does today, on the ${plan} preview`}
            </Body>
            {features.map((feature) => (
              <CapabilityRow key={feature.id} feature={feature} />
            ))}
            {locale === "am" ? (
              <Am size={FontSize.caption} color={colors.mutedForeground}>
                {t(locale, "stateLegend")}
              </Am>
            ) : (
              <Body size={FontSize.caption} color={colors.mutedForeground}>
                {t(locale, "stateLegend")}
              </Body>
            )}
          </Card>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
