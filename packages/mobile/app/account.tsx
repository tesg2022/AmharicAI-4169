import { useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Fonts, FontSize, Radius } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useSession } from "@/hooks/use-session";
import { authClient, clearToken } from "@/lib/auth";
import {
  useAccount,
  useCancelDeletion,
  useDeleteNow,
  useRequestDeletion,
} from "@/queries/account";
import {
  Body,
  Button,
  Card,
  Loading,
  ScreenHeader,
  SignInPrompt,
  TibebRule,
  Title,
} from "@/components/ui";

/**
 * Account, and the in-app deletion path Google Play requires.
 *
 * The same three rules as the web screen: what is erased and what is kept are
 * read from the server so the two surfaces cannot drift; nothing irreversible
 * happens on one tap, the phrase is typed; and a scheduled deletion is read
 * from the server so it is visible on every device.
 */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

// plan_source, not plan_is_verified, is what the learner needs explained: an
// unverified "free" plan is simply the default tier, not a failed subscription.
function planProvenance(source: string, verified: boolean): string {
  if (source === "default_free") return "You are on the free tier. Upgrade whenever you want more.";
  if (source === "preview_cookie")
    return "A preview on this device only — it is not recorded against your account.";
  return verified
    ? "Recorded against your account on the server."
    : "Not yet confirmed on the server. Reload in a moment, or contact support.";
}

function Choice({
  selected,
  title,
  detail,
  onPress,
  disabled,
}: {
  selected: boolean;
  title: string;
  detail: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="radio"
      // A radio reports checked, not selected. aria-checked is set explicitly because
      // react-native-web does not derive it from accessibilityState for a Pressable.
      aria-checked={selected}
      accessibilityState={{ checked: selected, selected, disabled: Boolean(disabled) }}
      accessibilityLabel={`${title}. ${detail}`}
      style={{
        flexDirection: "row",
        gap: 12,
        padding: 14,
        borderRadius: Radius.card,
        borderWidth: 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: colors.card,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Ionicons
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={20}
        color={selected ? colors.primary : colors.mutedForeground}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Body medium>{title}</Body>
        <Body size={FontSize.caption} color={colors.mutedForeground}>
          {detail}
        </Body>
      </View>
    </Pressable>
  );
}

export default function AccountScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { isSignedIn, isPending } = useSession();
  const account = useAccount(isSignedIn);

  const requestDeletion = useRequestDeletion();
  const cancelDeletion = useCancelDeletion();
  const deleteNow = useDeleteNow();

  const [phrase, setPhrase] = useState("");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"schedule" | "immediate">("schedule");
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const policy = account.data?.deletion_policy;
  const pending = account.data?.deletion ?? null;
  const phraseOk =
    Boolean(policy) && phrase.trim().toUpperCase() === policy?.confirm_phrase;
  const busy = requestDeletion.isPending || deleteNow.isPending || cancelDeletion.isPending;

  async function submit() {
    setFailure(null);
    try {
      if (mode === "immediate") {
        await deleteNow.mutateAsync({ confirm: phrase.trim() });
        // The server already destroyed the session rows; drop the local token
        // so the app does not keep rendering a signed-in shell.
        await authClient.signOut().catch(() => undefined);
        await clearToken();
        queryClient.clear();
        setDone(true);
        return;
      }
      await requestDeletion.mutateAsync({
        confirm: phrase.trim(),
        reason: reason.trim() || undefined,
      });
      setPhrase("");
      setReason("");
    } catch (error) {
      setFailure(errorMessage(error, "That did not go through. Nothing has been deleted."));
    }
  }

  async function cancel() {
    setFailure(null);
    try {
      await cancelDeletion.mutateAsync({});
    } catch (error) {
      setFailure(errorMessage(error, "The deletion could not be cancelled."));
    }
  }

  // Checked before the session: the erasure destroys the session, and the
  // learner must see confirmation rather than a sign-in prompt.
  if (done) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 14 }}>
          <Ionicons name="checkmark-circle" size={44} color={colors.primary} />
          <Title size={FontSize.h2} style={{ textAlign: "center" }}>
            Your account is deleted
          </Title>
          <Body color={colors.mutedForeground} style={{ textAlign: "center", lineHeight: 22 }}>
            Everything we held about you has been erased from our database. Nothing is recoverable,
            including by us. The only record kept is a dated note that a deletion happened, with no
            personal data in it.
          </Body>
          <Button label="Back to the course" icon="home-outline" onPress={() => router.replace("/")} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScreenHeader title="Your account" subtitle={account.data?.user.email ?? null} back />

      {isPending || (isSignedIn && account.isLoading) ? (
        <Loading label="Loading your account" />
      ) : !isSignedIn ? (
        <View style={{ padding: 20, gap: 16 }}>
          <SignInPrompt message="Sign in to manage your account, or to delete it and everything in it." />
          <Body size={FontSize.caption} color={colors.mutedForeground}>
            Cannot sign in and need your data deleted? Email admin@amharicai.org from the address on
            the account.
          </Body>
        </View>
      ) : !account.data || !policy ? (
        <View style={{ padding: 20, gap: 14 }}>
          <Body color={colors.mutedForeground}>
            Your account could not be loaded. Check your connection and try again.
          </Body>
          <Button label="Retry" icon="refresh-outline" onPress={() => account.refetch()} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}
        >
          <Card style={{ gap: 6 }}>
            <Title size={FontSize.body} style={{ textTransform: "capitalize" }}>
              {account.data.plan} plan
            </Title>
            <Body size={FontSize.caption} color={colors.mutedForeground}>
              {planProvenance(account.data.plan_source, account.data.plan_is_verified)}
              {account.data.expires_at
                ? ` Renews or ends ${formatDate(account.data.expires_at)}.`
                : ""}
            </Body>
            <Button
              label="Manage plan"
              variant="secondary"
              icon="ribbon-outline"
              onPress={() => router.push("/subscription")}
            />
          </Card>

          <TibebRule width={160} />

          {pending ? (
            <Card style={{ gap: 10, borderColor: colors.destructive }}>
              <Title size={FontSize.body}>Deletion scheduled</Title>
              <Body color={colors.mutedForeground} style={{ lineHeight: 22 }}>
                Your account and everything in it will be erased on{" "}
                {formatDate(pending.execute_after)} — {daysUntil(pending.execute_after)} day
                {daysUntil(pending.execute_after) === 1 ? "" : "s"} from now. Until then you can keep
                learning, and you can change your mind.
              </Body>
              <Button
                label={cancelDeletion.isPending ? "Cancelling…" : "Keep my account"}
                icon="arrow-undo-outline"
                loading={cancelDeletion.isPending}
                disabled={busy}
                onPress={cancel}
              />
            </Card>
          ) : null}

          <Card style={{ gap: 12 }}>
            <Title size={FontSize.body}>
              {pending ? "Delete immediately instead" : "Delete your account"}
            </Title>
            <Body color={colors.mutedForeground} style={{ lineHeight: 22 }}>
              This is a real deletion, not a deactivation. It cannot be undone once it runs, and we
              cannot restore anything afterwards.
            </Body>

            <View style={{ gap: 6 }}>
              <Body size={FontSize.caption} medium>
                What is erased
              </Body>
              {policy.erased.map((item) => (
                <Body key={item} size={FontSize.caption} color={colors.mutedForeground}>
                  · {item}
                </Body>
              ))}
            </View>

            <View style={{ gap: 6 }}>
              <Body size={FontSize.caption} medium>
                What is kept, and why
              </Body>
              {policy.retained.map((item) => (
                <Body key={item.what} size={FontSize.caption} color={colors.mutedForeground}>
                  · {item.what} — {item.why}
                </Body>
              ))}
            </View>

            <View style={{ gap: 8 }}>
              <Body size={FontSize.caption} medium>
                When
              </Body>
              <Choice
                selected={mode === "schedule"}
                disabled={Boolean(pending)}
                title={`In ${policy.grace_days} days${pending ? " (already scheduled)" : " (recommended)"}`}
                detail={`You can cancel at any point during those ${policy.grace_days} days by signing in.`}
                onPress={() => setMode("schedule")}
              />
              <Choice
                selected={mode === "immediate"}
                title="Immediately"
                detail="Erased the moment you confirm. There is no grace period and no way back."
                onPress={() => setMode("immediate")}
              />
            </View>

            {mode === "schedule" && !pending ? (
              <View style={{ gap: 6 }}>
                <Body size={FontSize.caption} medium>
                  Why are you leaving? (optional)
                </Body>
                <TextInput
                  value={reason}
                  onChangeText={setReason}
                  maxLength={500}
                  multiline
                  placeholder="It helps us fix what drove you away."
                  placeholderTextColor={colors.mutedForeground}
                  accessibilityLabel="Reason for leaving, optional"
                  style={{
                    minHeight: 64,
                    padding: 12,
                    borderRadius: Radius.card,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.card,
                    color: colors.foreground,
                    fontFamily: Fonts.body,
                    fontSize: FontSize.small,
                    textAlignVertical: "top",
                  }}
                />
              </View>
            ) : null}

            <View style={{ gap: 6 }}>
              <Body size={FontSize.caption} medium>
                Type {policy.confirm_phrase} to confirm
              </Body>
              <TextInput
                value={phrase}
                onChangeText={setPhrase}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder={policy.confirm_phrase}
                placeholderTextColor={colors.mutedForeground}
                accessibilityLabel={`Type ${policy.confirm_phrase} to confirm account deletion`}
                style={{
                  minHeight: 48,
                  paddingHorizontal: 14,
                  borderRadius: Radius.card,
                  borderWidth: 1,
                  borderColor: phraseOk ? colors.destructive : colors.border,
                  backgroundColor: colors.card,
                  color: colors.foreground,
                  fontFamily: Fonts.bodyBold,
                  fontSize: FontSize.body,
                  letterSpacing: 2,
                }}
              />
            </View>

            {failure ? (
              /* Wrapped so the failure is announced as an alert — `Body` is a
                 styled Text and does not forward accessibility props. */
              <View accessibilityRole="alert" accessibilityLiveRegion="polite">
                <Body size={FontSize.caption} color={colors.destructive}>
                  {failure}
                </Body>
              </View>
            ) : null}

            <Button
              label={
                busy
                  ? "Working…"
                  : mode === "immediate"
                    ? "Delete everything now"
                    : `Schedule deletion in ${policy.grace_days} days`
              }
              variant="destructive"
              icon="trash-outline"
              full
              loading={busy}
              disabled={!phraseOk || busy || (mode === "schedule" && Boolean(pending))}
              onPress={submit}
            />
          </Card>

          <Card tone="muted" style={{ gap: 8 }}>
            <Body size={FontSize.caption} color={colors.mutedForeground} style={{ lineHeight: 20 }}>
              You can also ask for a copy of your data, or ask us to delete it on your behalf, by
              emailing admin@amharicai.org from the address on your account. The Privacy Policy
              lists what we hold and for how long.
            </Body>
            <Button
              label="Privacy Policy"
              variant="secondary"
              icon="lock-closed-outline"
              onPress={() => router.push("/legal/privacy")}
            />
          </Card>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
