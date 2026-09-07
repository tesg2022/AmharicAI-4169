import { useEffect, useMemo, useRef, useState } from "react";
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
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Fonts, FontSize, Radius } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useSession } from "@/hooks/use-session";
import { baseUrl } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { useClearTutor, useSaveTutorMessage, useTutorHistory } from "@/queries/tutor";
import { Am, Body, Card, Loading, Title } from "@/components/ui";

/**
 * AI tutor chat. The turn itself streams from `/api/agent/messages`; the
 * transcript is mirrored into the database so it survives an app restart.
 */

const SUGGESTIONS = [
  "How do I greet someone politely in the morning?",
  "Explain how Amharic verbs change for “you” (male vs female).",
  "Quiz me on the words from the shopping unit.",
  "What is the difference between አንተ and አንቺ?",
];

function textOf(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}

function toolLabel(type: string): string | null {
  if (!type.startsWith("tool-")) return null;
  const name = type.slice(5);
  const labels: Record<string, string> = {
    lookupVocabulary: "Checking the course vocabulary",
    lookupLesson: "Reading the lesson",
    lookupConjugation: "Checking the verb paradigm",
  };
  return labels[name] ?? `Using ${name}`;
}

/** Amharic script gets the Ethiopic face even inside a mixed-language reply. */
const ETHIOPIC = /[ሀ-፿]/;

function MessageText({ content, color }: { content: string; color: string }) {
  const segments = useMemo(() => {
    // Split on runs of Ethiopic script so each run can use the right font.
    return content
      .split(/([ሀ-፿][ሀ-፿\s፡።፣፤!?.]*)/g)
      .filter((segment) => segment.length > 0);
  }, [content]);

  return (
    <View>
      {segments.map((segment, i) =>
        ETHIOPIC.test(segment) ? (
          <Am key={i} size={FontSize.h3} color={color}>
            {segment.trim()}
          </Am>
        ) : (
          <Body key={i} size={FontSize.small} color={color}>
            {segment}
          </Body>
        ),
      )}
    </View>
  );
}

export default function TutorScreen() {
  const colors = useColors();
  const { isSignedIn } = useSession();
  const history = useTutorHistory(isSignedIn);
  const saveMessage = useSaveTutorMessage();
  const clearTutor = useClearTutor();
  const scrollRef = useRef<ScrollView>(null);
  const savedIds = useRef(new Set<string>());
  const [input, setInput] = useState("");

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: `${baseUrl}/api/agent/messages`,
        headers: (): Record<string, string> => {
          const token = getToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    [],
  );

  const { messages, sendMessage, status, setMessages, error } = useChat({ transport });

  // Replay the stored transcript once, before the learner adds to it.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || !history.data?.length || messages.length) return;
    hydrated.current = true;
    setMessages(
      history.data.map((row) => {
        savedIds.current.add(row.id);
        return {
          id: row.id,
          role: row.role as "user" | "assistant",
          parts: [{ type: "text" as const, text: row.content }],
        };
      }),
    );
  }, [history.data, messages.length, setMessages]);

  // Persist finished turns (both sides) once streaming settles.
  useEffect(() => {
    if (!isSignedIn || status !== "ready") return;
    for (const message of messages) {
      if (savedIds.current.has(message.id)) continue;
      const content = textOf(message);
      if (!content) continue;
      savedIds.current.add(message.id);
      saveMessage.mutate({ role: message.role as "user" | "assistant", content });
    }
  }, [messages, status, isSignedIn, saveMessage]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  const busy = status === "streaming" || status === "submitted";

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    void sendMessage({ text: trimmed });
  }

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 20,
            paddingBottom: 12,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.sky + "1A",
              }}
            >
              <Ionicons name="sparkles" size={18} color={colors.sky} />
            </View>
            <View>
              <Title size={FontSize.h3}>AI Tutor</Title>
              <Body size={FontSize.caption} color={colors.mutedForeground}>
                Answers grounded in your course
              </Body>
            </View>
          </View>
          {messages.length ? (
            <Pressable
              hitSlop={10}
              onPress={() => {
                setMessages([]);
                savedIds.current.clear();
                if (isSignedIn) clearTutor.mutate({});
              }}
            >
              <Ionicons name="trash-outline" size={19} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {history.isLoading && isSignedIn ? <Loading /> : null}

          {!messages.length ? (
            <View style={{ gap: 12 }}>
              <Card tone="script" style={{ gap: 6 }}>
                <Am size={FontSize.h2} bold color={colors.primary}>
                  ጤና ይስጥልኝ!
                </Am>
                <Body size={FontSize.small} color={colors.mutedForeground}>
                  ṭena yisṭiliñ — hello. Ask me anything about the course. I answer in Amharic
                  first, then transliteration, then English.
                </Body>
              </Card>
              {SUGGESTIONS.map((suggestion) => (
                <Pressable
                  key={suggestion}
                  onPress={() => send(suggestion)}
                  style={({ pressed }) => ({
                    padding: 14,
                    borderRadius: Radius.card,
                    borderWidth: 1,
                    borderColor: colors.borderStrong,
                    backgroundColor: colors.card,
                    opacity: pressed ? 0.8 : 1,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                  })}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.sky} />
                  <Body size={FontSize.small} style={{ flex: 1 }}>
                    {suggestion}
                  </Body>
                </Pressable>
              ))}
            </View>
          ) : null}

          {messages.map((message) => {
            const mine = message.role === "user";
            const content = textOf(message);
            const tools = (message.parts ?? [])
              .map((part) => toolLabel(part.type))
              .filter((label): label is string => Boolean(label));

            return (
              <View
                key={message.id}
                style={{
                  alignSelf: mine ? "flex-end" : "flex-start",
                  maxWidth: "88%",
                  gap: 6,
                }}
              >
                {tools.length ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons name="library-outline" size={12} color={colors.mutedForeground} />
                    <Body size={FontSize.caption} color={colors.mutedForeground}>
                      {tools[tools.length - 1]}
                    </Body>
                  </View>
                ) : null}
                {content ? (
                  <View
                    style={{
                      padding: 14,
                      borderRadius: Radius.card,
                      backgroundColor: mine ? colors.primary : colors.card,
                      borderWidth: mine ? 0 : 1,
                      borderColor: colors.border,
                    }}
                  >
                    <MessageText
                      content={content}
                      color={mine ? colors.primaryForeground : colors.foreground}
                    />
                  </View>
                ) : null}
              </View>
            );
          })}

          {busy ? (
            <View style={{ alignSelf: "flex-start", flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.mutedForeground} />
              <Body size={FontSize.caption} color={colors.mutedForeground}>
                Thinking…
              </Body>
            </View>
          ) : null}

          {error ? (
            <Body size={FontSize.caption} color={colors.destructive}>
              {error.message}
            </Body>
          ) : null}
        </ScrollView>

        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 8,
            paddingHorizontal: 16,
            paddingTop: 10,
            paddingBottom: 12,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.background,
          }}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Ask about a word, a rule, a phrase…"
            placeholderTextColor={colors.mutedForeground}
            multiline
            onSubmitEditing={() => send(input)}
            style={{
              flex: 1,
              maxHeight: 110,
              minHeight: 44,
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: 12,
              borderRadius: Radius.sheet,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.borderStrong,
              fontFamily: Fonts.body,
              fontSize: FontSize.small,
              color: colors.foreground,
            }}
          />
          <Pressable
            onPress={() => send(input)}
            disabled={busy || !input.trim()}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.sky,
              opacity: busy || !input.trim() ? 0.5 : 1,
            }}
          >
            <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
