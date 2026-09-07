import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Fonts, FontSize, Radius } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { authClient, captureToken } from "@/lib/auth";
import { Am, Body, Button, Card, Title, TibebRule } from "@/components/ui";

/**
 * Sign-in / sign-up.
 *
 * Two paths onto the same bearer token store (see `lib/auth.ts`): the managed
 * Google broker and plain email/password. Lessons and ፊደል stay readable while
 * signed out — an account only buys progress, streaks and the review deck.
 */

export default function SignInScreen() {
  const colors = useColors();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function done() {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  async function google() {
    setError(null);
    setBusy("google");
    try {
      const result = await authClient.managedAuth.signIn({ provider: "google" });
      // AUTH_SESSION_DISMISSED just means the browser was closed — not a failure.
      if (result.error && result.error.code !== "AUTH_SESSION_DISMISSED") {
        setError(result.error.message ?? "Google sign-in failed.");
      } else if (!result.error) {
        done();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setBusy(null);
    }
  }

  async function withEmail() {
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (mode === "signup" && password.length < 8) {
      setError("Passwords need at least 8 characters.");
      return;
    }
    setBusy("email");

    const handlers = {
      onSuccess: captureToken,
      onError: (ctx: { error: { message?: string } }) =>
        setError(ctx.error.message ?? "Something went wrong. Try again."),
    };

    const result =
      mode === "signin"
        ? await authClient.signIn.email(
            { email: email.trim(), password },
            handlers,
          )
        : await authClient.signUp.email(
            { email: email.trim(), password, name: name.trim() || email.trim().split("@")[0]! },
            handlers,
          );

    setBusy(null);
    if (!result.error) done();
  }

  const inputStyle = {
    fontFamily: Fonts.body,
    fontSize: FontSize.body,
    color: colors.foreground,
    backgroundColor: colors.background,
    borderWidth: 1,
    // Text input — the border is the affordance. Needs 3:1.
    borderColor: colors.borderStrong,
    borderRadius: Radius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
  };

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: 24, gap: 20, paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
            <Pressable
              onPress={done}
              hitSlop={12}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.borderStrong,
              }}
            >
              <Ionicons name="close" size={20} color={colors.foreground} />
            </Pressable>
          </View>

          <View style={{ gap: 6, alignItems: "flex-start" }}>
            <Title size={FontSize.hero}>AmharicAI</Title>
            <Am size={FontSize.body} color={colors.primary}>
              እንኳን ደህና መጡ
            </Am>
            <TibebRule width={140} />
            <Body size={FontSize.small} color={colors.mutedForeground}>
              {mode === "signin"
                ? "Sign in to keep your streak, XP and review deck across devices."
                : "Create an account to save your progress from the first lesson."}
            </Body>
          </View>

          <Button
            label="Continue with Google"
            icon="logo-google"
            variant="secondary"
            full
            loading={busy === "google"}
            disabled={busy === "email"}
            onPress={google}
          />

          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
            <Body size={FontSize.caption} color={colors.mutedForeground}>
              or with email
            </Body>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
          </View>

          <Card style={{ gap: 12 }}>
            {mode === "signup" ? (
              <View style={{ gap: 6 }}>
                <Body size={FontSize.caption} color={colors.mutedForeground}>
                  Name
                </Body>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Your name"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="words"
                  style={inputStyle}
                />
              </View>
            ) : null}

            <View style={{ gap: 6 }}>
              <Body size={FontSize.caption} color={colors.mutedForeground}>
                Email
              </Body>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                style={inputStyle}
              />
            </View>

            <View style={{ gap: 6 }}>
              <Body size={FontSize.caption} color={colors.mutedForeground}>
                Password
              </Body>
              <View style={{ justifyContent: "center" }}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={!showPassword}
                  style={[inputStyle, { paddingRight: 44 }]}
                  onSubmitEditing={withEmail}
                />
                <Pressable
                  onPress={() => setShowPassword((v) => !v)}
                  hitSlop={10}
                  style={{ position: "absolute", right: 12 }}
                >
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={18}
                    color={colors.mutedForeground}
                  />
                </Pressable>
              </View>
            </View>

            {error ? (
              <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                <Ionicons
                  name="alert-circle-outline"
                  size={16}
                  color={colors.destructive}
                  style={{ marginTop: 2 }}
                />
                <Body size={FontSize.small} color={colors.destructive} style={{ flex: 1 }}>
                  {error}
                </Body>
              </View>
            ) : null}

            <Button
              label={mode === "signin" ? "Sign in" : "Create account"}
              icon="arrow-forward"
              full
              loading={busy === "email"}
              disabled={busy === "google"}
              onPress={withEmail}
            />
          </Card>

          <Pressable
            onPress={() => {
              setMode((m) => (m === "signin" ? "signup" : "signin"));
              setError(null);
            }}
            hitSlop={8}
            style={{ alignSelf: "center" }}
          >
            <Body size={FontSize.small} color={colors.primary} medium>
              {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
            </Body>
          </Pressable>

          <Body size={FontSize.caption} color={colors.mutedForeground} style={{ textAlign: "center" }}>
            You can keep reading lessons and the ፊደል chart without an account.
          </Body>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
