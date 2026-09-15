import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
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
import { useSession } from "@/hooks/use-session";
import { useAccess, useMyRedemptions, useRedeemCode } from "@/queries/access";
import { useRefreshEntitlements } from "@/queries/billing";
import { failureMessage } from "@/queries/catalog";
import { PaidPlans } from "@/components/paid-plans";
import {
  Am,
  Body,
  Button,
  Card,
  Chip,
  ErrorState,
  Loading,
  ScreenHeader,
  TibebRule,
  Title,
} from "@/components/ui";

/**
 * Your plan.
 *
 * Everything on this screen comes from `access.me`, which resolves the plan on
 * the server from the session. The rules it must not blur:
 *
 *   - a feature row promises availability from `usable`, never from `granted`.
 *     `granted` says the plan includes it; `usable` says it exists in this
 *     build. Selling the difference is the whole failure mode this app avoids.
 *   - an unverified preview is labelled a preview, not a holding. Only the
 *     server can set `plan_is_verified`.
 *   - a lapsed access-code grant is stated outright (`expired_notice`), never
 *     silently downgraded.
 *   - checkout is real and is asked for permission first: `billing.preflight`
 *     answers whether a purchase makes sense, and its refusal is shown as
 *     written rather than dressed up as a generic error.
 *   - Restore Purchases is present because the stores require it. It re-reads
 *     the entitlement from the server, which is the only place a purchase
 *     exists — it never grants anything itself.
 */

type CapabilityStatus = "available" | "preview" | "coming_soon" | "not_configured";
type FeatureState = CapabilityStatus | "plan_gated";

type Feature = {
  id: string;
  label_en: string;
  label_am: string;
  capability: CapabilityStatus;
  caveat_en?: string | undefined;
  caveat_am?: string | undefined;
  granted: boolean;
  usable: boolean;
  state: FeatureState;
  state_label: { en: string; am: string };
};

const STATE_ICON: Record<FeatureState, keyof typeof Ionicons.glyphMap> = {
  available: "checkmark-circle",
  preview: "flask-outline",
  coming_soon: "construct-outline",
  not_configured: "alert-circle-outline",
  plan_gated: "lock-closed-outline",
};

/**
 * Keyed on what the server actually sends. It used to key the paid case on
 * `paid_subscription`, which `resolvePlan` has never returned — so a paying
 * subscriber fell through to the default and was told "You are on the Free
 * plan" underneath their Premium badge.
 */
const SOURCE_COPY: Record<string, { label: string; body: string }> = {
  subscription: {
    label: "Paid subscription",
    body: "This plan comes from a subscription the payment provider has confirmed.",
  },
  access_code: {
    label: "Access code",
    body: "This plan comes from an administrator-issued access code, not from a payment.",
  },
  preview_cookie: {
    label: "Preview only",
    body: "This is an unverified preview, not a plan you hold. Sign in to have a real entitlement.",
  },
  default_free: { label: "Free", body: "You are on the Free plan." },
};

function daysLeft(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

function FeatureRow({ feature }: { feature: Feature }) {
  const colors = useColors();
  const { locale } = usePreview();

  const tint =
    feature.state === "available"
      ? colors.success
      : feature.state === "plan_gated"
        ? colors.mutedForeground
        : colors.warning;

  // A plan-gated feature KEEPS its capability caveat, behind the "Even on a
  // higher plan:" prefix — otherwise a Free learner upgrades for translation
  // and finds it unconfigured.
  const rawCaveat = locale === "am" ? feature.caveat_am : feature.caveat_en;
  const caveat = rawCaveat
    ? feature.state === "plan_gated"
      ? `${t(locale, "evenThen")} ${rawCaveat}`
      : rawCaveat
    : undefined;

  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
      <Ionicons
        name={STATE_ICON[feature.state]}
        size={16}
        color={tint}
        style={{ marginTop: 2 }}
      />
      <View style={{ flex: 1, gap: 2 }}>
        {locale === "am" ? (
          <Am size={FontSize.small}>{feature.label_am}</Am>
        ) : (
          <Body size={FontSize.small}>{feature.label_en}</Body>
        )}
        <Body size={FontSize.caption} color={tint} medium>
          {feature.state_label[locale]}
        </Body>
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

export default function SubscriptionScreen() {
  const colors = useColors();
  const { locale } = usePreview();
  const { isSignedIn, user } = useSession();
  const access = useAccess();
  const redemptions = useMyRedemptions(isSignedIn);
  const redeem = useRedeemCode();
  const refreshEntitlements = useRefreshEntitlements();

  const [code, setCode] = useState("");
  const [restoreNote, setRestoreNote] = useState(false);

  const data = access.data;
  const plans = data?.plans ?? [];
  const features = (data?.features ?? []) as Feature[];
  const source = SOURCE_COPY[data?.plan_source ?? "default_free"] ?? SOURCE_COPY["default_free"]!;
  const currentPlan = plans.find((p) => p.id === data?.plan);

  const inputStyle = {
    fontFamily: Fonts.mono,
    fontSize: 26,
    letterSpacing: 8,
    textAlign: "center" as const,
    color: colors.foreground,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: Radius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
  };

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScreenHeader
        title="Your plan"
        amharic="እቅድዎ"
        subtitle={isSignedIn ? (user?.email ?? undefined) : "Not signed in"}
        back
      />

      {access.isLoading ? (
        <Loading label="Checking your plan…" />
      ) : access.isError ? (
        <ErrorState message={failureMessage(access.error)} onRetry={() => access.refetch()} />
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 48 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* A lapsed grant is stated, never a silent downgrade. */}
            {data?.expired_notice ? (
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
                  Your access code has expired
                </Body>
                <Body size={FontSize.caption} color={colors.foreground}>
                  The {data.expired_notice.plan} access you were granted ran out on{" "}
                  {new Date(data.expired_notice.expired_at).toLocaleDateString()}, so you are back
                  on Free. Ask your administrator for a new code if you still need it.
                </Body>
              </View>
            ) : null}

            {/* What the SERVER says you hold. */}
            <Card style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Title size={FontSize.h1}>{currentPlan?.name_en ?? data?.plan}</Title>
                  {currentPlan ? (
                    <Am size={FontSize.small} color={colors.primary}>
                      {currentPlan.name_am}
                    </Am>
                  ) : null}
                </View>
                <Chip
                  label={data?.plan_is_verified ? "Verified" : "Unverified preview"}
                  icon={data?.plan_is_verified ? "shield-checkmark" : "eye-outline"}
                  color={data?.plan_is_verified ? colors.success : colors.warning}
                />
              </View>

              <TibebRule width={120} />

              <View style={{ gap: 2 }}>
                <Body size={FontSize.small} medium>
                  {source.label}
                </Body>
                <Body size={FontSize.caption} color={colors.mutedForeground}>
                  {source.body}
                </Body>
              </View>

              {data?.expires_at ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="time-outline" size={15} color={colors.foreground} />
                  <Body size={FontSize.small}>
                    Runs until {new Date(data.expires_at).toLocaleDateString()} ·{" "}
                    {daysLeft(data.expires_at)} days left
                  </Body>
                </View>
              ) : null}

              {currentPlan ? (
                <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                  <Chip
                    label={
                      currentPlan.max_units === null
                        ? "Every written unit"
                        : `Units 1-${currentPlan.max_units} only`
                    }
                    icon="book-outline"
                  />
                  <Chip
                    label={
                      currentPlan.quotas.tts_per_day === null
                        ? "Unmetered listening"
                        : `${currentPlan.quotas.tts_per_day} listens/day`
                    }
                    icon="volume-medium-outline"
                  />
                </View>
              ) : null}
            </Card>

            {/* Redeem — signed in only. The server takes the user id from the
                session, so there is nothing to redeem against without one. */}
            <Card style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="ticket-outline" size={18} color={colors.primary} />
                <Body size={FontSize.small} bold>
                  Have an access code?
                </Body>
              </View>

              {isSignedIn ? (
                <>
                  <Body size={FontSize.caption} color={colors.mutedForeground}>
                    A six-digit code from an AmharicAI administrator. It can be redeemed once, by
                    this account, and grants the plan the administrator chose for a fixed period.
                  </Body>
                  <TextInput
                    value={code}
                    onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="number-pad"
                    maxLength={6}
                    accessibilityLabel="Six-digit access code"
                    style={inputStyle}
                  />
                  <Button
                    label="Redeem code"
                    icon="key-outline"
                    full
                    loading={redeem.isPending}
                    disabled={code.length !== 6}
                    onPress={() => redeem.mutate({ code })}
                  />

                  {/* The server's wording, verbatim — including the lockout
                      message, which the learner needs to read exactly. */}
                  {redeem.isError ? (
                    <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                      <Ionicons
                        name="alert-circle-outline"
                        size={16}
                        color={colors.destructive}
                        style={{ marginTop: 2 }}
                      />
                      <Body size={FontSize.small} color={colors.destructive} style={{ flex: 1 }}>
                        {failureMessage(redeem.error)}
                      </Body>
                    </View>
                  ) : null}

                  {redeem.isSuccess ? (
                    <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                      <Ionicons
                        name="checkmark-circle"
                        size={16}
                        color={colors.success}
                        style={{ marginTop: 2 }}
                      />
                      <Body size={FontSize.small} color={colors.success} style={{ flex: 1 }}>
                        Code accepted. Your plan above now comes from the server.
                      </Body>
                    </View>
                  ) : null}
                </>
              ) : (
                <>
                  <Body size={FontSize.caption} color={colors.mutedForeground}>
                    Codes are granted to an account, so without one there is nothing to grant them
                    to. Sign in first, then come back and redeem.
                  </Body>
                  <Button
                    label="Sign in"
                    icon="log-in-outline"
                    full
                    onPress={() => router.push("/sign-in")}
                  />
                </>
              )}
            </Card>

            {/* Redemption history — hint only, never a full code. */}
            {isSignedIn && (redemptions.data?.length ?? 0) > 0 ? (
              <Card tone="muted" style={{ gap: 10 }}>
                <Body size={FontSize.small} bold>
                  Codes you have redeemed
                </Body>
                {(redemptions.data ?? []).map((r) => (
                  <View key={r.id} style={{ gap: 2 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Body size={FontSize.small} medium>
                        ····{r.hint}
                      </Body>
                      <Chip
                        label={r.status}
                        color={
                          r.status === "active"
                            ? colors.success
                            : r.status === "revoked"
                              ? colors.destructive
                              : colors.mutedForeground
                        }
                      />
                    </View>
                    <Body size={FontSize.caption} color={colors.mutedForeground}>
                      {r.granted_plan} · redeemed {new Date(r.redeemed_at).toLocaleDateString()} ·
                      runs to {new Date(r.grants_until).toLocaleDateString()}
                    </Body>
                  </View>
                ))}
                <Body size={FontSize.caption} color={colors.mutedForeground}>
                  Only the last two digits are stored in a readable form. A code cannot be looked
                  up again after it is issued.
                </Body>
              </Card>
            ) : null}

            {/* Paid plans — the same block the Pricing screen renders, from
                the same `billing.catalogue` call the website uses. Checkout is
                real: it opens a Paystack payment page, charges a card in
                rand, and the entitlement comes back from the server — never
                from this screen. */}
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="card-outline" size={18} color={colors.primary} />
                <Body size={FontSize.small} bold>
                  Paid plans
                </Body>
              </View>
              <PaidPlans />
            </View>

            {/* Restore Purchases. Required by the stores. It does the only
                honest thing available: re-reads the entitlement from the
                server, which is where a purchase lives. It cannot grant
                anything, and it never pretends to have found something. */}
            <Card tone="muted" style={{ gap: 8 }}>
              <Body size={FontSize.small} bold>
                Restore purchases
              </Body>
              <Button
                label="Restore purchases"
                variant="secondary"
                icon="refresh"
                full
                loading={access.isFetching}
                onPress={() => {
                  setRestoreNote(true);
                  refreshEntitlements();
                }}
              />
              {restoreNote ? (
                <Body size={FontSize.caption} color={colors.mutedForeground}>
                  Your plan has been re-read from the server just now, and the card above is what
                  it says you hold. Subscriptions are bought by card rather than through the App
                  Store or Play Store, so there are no store receipts to ask for — a plan is tied
                  to your account and follows you onto any device you sign in on. If you paid and
                  nothing changed here, contact support rather than paying again.
                </Body>
              ) : (
                <Body size={FontSize.caption} color={colors.mutedForeground}>
                  Bought a plan on another device? This re-reads your account from the server and
                  applies whatever it finds.
                </Body>
              )}
            </Card>

            {/* Capability truth. Rows read `usable`, not `granted`. */}
            <Card tone="muted" style={{ gap: 10 }}>
              <Body size={FontSize.small} bold>
                What works today on {currentPlan?.name_en ?? data?.plan}
              </Body>
              {features.map((f) => (
                <FeatureRow key={f.id} feature={f} />
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
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}
