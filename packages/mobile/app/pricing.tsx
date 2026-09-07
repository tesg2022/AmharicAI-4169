import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { FontSize, Radius } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useSession } from "@/hooks/use-session";
import { t } from "@/i18n/messages";
import { usePreview, type PreviewPlan } from "@/lib/preview-plan";
import {
  failureBlockers,
  failureMessage,
  useCheckout,
  useEntitlements,
} from "@/queries/catalog";
import {
  Am,
  Body,
  Button,
  Card,
  Chip,
  ErrorState,
  Loading,
  ScreenHeader,
  Title,
} from "@/components/ui";

/**
 * Plans.
 *
 * Two things this screen refuses to do:
 *
 *  1. Pretend it can charge. The Autumn billing integration is not wired into
 *     this build, so checkout fails and reports that as the real blocker. The
 *     notice above the buttons says so before anyone taps. (The older copy
 *     here also claimed there was no account store to record a subscription
 *     against — that stopped being true when accounts landed, and a stale
 *     honesty notice is just another false statement.)
 *  2. Sell a capability that does not exist. A plan can GRANT a feature while
 *     the feature is `coming_soon` (custom voice, speaking feedback),
 *     `preview` (AI tutor) or `not_configured` (TTS host, translation key).
 *     The server folds the grant axis and the capability axis into one
 *     resolved `state` per feature and ships the chip copy with it, so this
 *     screen cannot word it differently from the website. `coming_soon` is
 *     reported ahead of `plan_gated` on purpose: never invite an upgrade for
 *     something that does not exist.
 *  3. Offer a preview switch to somebody who is signed in. The server resolves
 *     a signed-in learner's plan from their session and ignores the switch
 *     entirely, so those buttons would do nothing at all. They are replaced by
 *     a link to the real plan screen.
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
  const checkout = useCheckout();

  const plans = me.data?.plans ?? [];
  const features = (me.data?.features ?? []) as Feature[];

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
          {/* Stated BEFORE the buttons, not after a failed tap. */}
          <View
            style={{
              backgroundColor: colors.accent + "22",
              borderLeftWidth: 3,
              borderLeftColor: colors.warning,
              borderRadius: 10,
              padding: 12,
              gap: 4,
            }}
          >
            <Body size={FontSize.small} bold color={colors.warning}>
              Nothing here can be purchased yet
            </Body>
            <Body size={FontSize.caption} color={colors.foreground}>
              Payment is not connected: the Autumn billing integration is not wired into this
              build, so no plan on this screen can be bought. Tapping a subscribe button will tell
              you exactly what is missing, and nothing is charged.
            </Body>
            <Body size={FontSize.caption} color={colors.foreground}>
              {isSignedIn
                ? "You are signed in, so your plan is resolved on the server from your account and the preview switch is ignored. Open Your plan to see what you actually hold, or to redeem an access code."
                : "The plan switch below only previews how the app gates content. It grants nothing, and it is ignored once you sign in."}
            </Body>
            {isSignedIn ? (
              <Button
                label="Your plan"
                variant="secondary"
                icon="ribbon-outline"
                onPress={() => router.push("/subscription")}
                style={{ alignSelf: "flex-start", marginTop: 4 }}
              />
            ) : null}
          </View>

          {plans.map((p) => {
            const isCurrent = p.id === plan;
            return (
              <Card
                key={p.id}
                style={{
                  gap: 10,
                  borderColor: isCurrent ? colors.primary : colors.border,
                  borderWidth: isCurrent ? 2 : 1,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Title size={FontSize.h3}>{p.name_en}</Title>
                    <Am size={FontSize.small} color={colors.primary}>
                      {p.name_am}
                    </Am>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Title size={FontSize.h2}>
                      {p.price_usd_month === 0 ? "Free" : `$${p.price_usd_month.toFixed(2)}`}
                    </Title>
                    {p.price_usd_month > 0 ? (
                      <Body size={FontSize.caption} color={colors.mutedForeground}>
                        {t(locale, "perMonth")}
                      </Body>
                    ) : null}
                  </View>
                </View>

                <Body size={FontSize.small} color={colors.mutedForeground}>
                  {p.tagline_en}
                </Body>

                <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                  <Chip
                    label={
                      p.max_units === null
                        ? "Every written unit"
                        : `Units 1-${p.max_units} only`
                    }
                    icon="book-outline"
                  />
                  <Chip
                    label={
                      p.tts_per_day === null
                        ? "Unmetered listening · not enforced yet"
                        : `${p.tts_per_day} listens/day · not enforced yet`
                    }
                    icon="volume-medium-outline"
                  />
                </View>

                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  {isSignedIn ? null : isCurrent ? (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        borderRadius: Radius.pill,
                        backgroundColor: colors.muted,
                      }}
                    >
                      <Ionicons name="eye-outline" size={15} color={colors.foreground} />
                      <Body size={FontSize.small} medium>
                        {t(locale, "current")}
                      </Body>
                    </View>
                  ) : (
                    <Button
                      label={`Preview as ${p.name_en}`}
                      variant="secondary"
                      icon="eye-outline"
                      onPress={() => setPlan(p.id as PreviewPlan)}
                    />
                  )}
                  {p.price_usd_month > 0 ? (
                    <Button
                      label="Try to subscribe"
                      variant="ghost"
                      icon="card-outline"
                      loading={checkout.isPending && checkout.variables?.plan === p.id}
                      onPress={() => checkout.mutate({ plan: p.id })}
                    />
                  ) : null}
                </View>
              </Card>
            );
          })}

          {checkout.isError ? (
            <Card style={{ gap: 8, borderColor: colors.destructive }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="close-circle-outline" size={18} color={colors.destructive} />
                <Body size={FontSize.small} bold color={colors.destructive}>
                  Nothing was charged
                </Body>
              </View>
              <Body size={FontSize.small}>{failureMessage(checkout.error)}</Body>
              {failureBlockers(checkout.error).map((blocker, i) => (
                <View key={`b-${i}`} style={{ flexDirection: "row", gap: 8 }}>
                  <Body size={FontSize.caption} color={colors.mutedForeground}>
                    •
                  </Body>
                  <Body size={FontSize.caption} color={colors.mutedForeground} style={{ flex: 1 }}>
                    {blocker}
                  </Body>
                </View>
              ))}
            </Card>
          ) : null}

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
            {isSignedIn ? null : (
              <Body size={FontSize.caption} color={colors.mutedForeground}>
                {t(locale, "previewNote")}
              </Body>
            )}
          </Card>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
