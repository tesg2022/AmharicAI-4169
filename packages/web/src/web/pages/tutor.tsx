import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowUp, BookOpen, MessageCircle, Sparkles, Trash2 } from "lucide-react";
import { authClient } from "../lib/auth";
import { useSession } from "../hooks/use-session";
import { useClearTutor, useSaveTutorMessage, useTutorHistory } from "../queries/tutor";
import { Am, Card, Loading, MixedText, TibebRule } from "../components/ui/kit";

/**
 * AI tutor chat.
 *
 * The turn streams from `POST /api/agent/messages`; the transcript is mirrored
 * into the database through the tutor procedures so a conversation survives a
 * reload and shows up on the phone too.
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
  const labels: Record<string, string> = {
    lookupVocabulary: "Checking the course vocabulary",
    lookupLesson: "Reading the lesson",
    lookupConjugation: "Checking the verb paradigm",
  };
  const name = type.slice(5);
  return labels[name] ?? `Using ${name}`;
}

export default function TutorPage() {
  const { isSignedIn } = useSession();
  const history = useTutorHistory(isSignedIn);
  const saveMessage = useSaveTutorMessage();
  const clearTutor = useClearTutor();

  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const savedIds = useRef(new Set<string>());
  const hydrated = useRef(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: "/api/agent/messages",
        headers: (): Record<string, string> => {
          const token = authClient.managedAuth.getToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    [],
  );

  const { messages, sendMessage, status, setMessages, error } = useChat({ transport });

  // Replay the stored transcript once, before the learner adds to it.
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

  // Persist finished turns once streaming settles.
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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const busy = status === "streaming" || status === "submitted";

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    void sendMessage({ text: trimmed });
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-13rem)] max-w-3xl flex-col gap-4">
      <header className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-sky/10 text-sky">
          <Sparkles className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">AI Tutor</h1>
          <p className="text-xs text-muted-foreground">
            Answers grounded in your course material
          </p>
        </div>
        {messages.length ? (
          <button
            type="button"
            title="Clear conversation"
            onClick={() => {
              setMessages([]);
              savedIds.current.clear();
              hydrated.current = true;
              if (isSignedIn) clearTutor.mutate({});
            }}
            className="rounded-full border border-border bg-card p-2.5 text-muted-foreground hover:bg-muted"
          >
            <Trash2 className="size-4" />
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {history.isLoading && isSignedIn ? <Loading /> : null}

        {!messages.length ? (
          <div className="space-y-3">
            <Card tone="script" className="space-y-2">
              <Am className="block text-2xl font-bold text-primary">ጤና ይስጥልኝ!</Am>
              <TibebRule className="max-w-32" />
              <p className="text-sm text-muted-foreground">
                ṭena yisṭiliñ — hello. Ask me anything about the course. I answer in Amharic first,
                then transliteration, then English.
              </p>
            </Card>
            <div className="grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => send(suggestion)}
                  className="flex items-start gap-2.5 rounded-xl border border-border bg-card p-3.5 text-left text-sm transition hover:border-sky/40 hover:bg-muted"
                >
                  <MessageCircle className="mt-0.5 size-4 shrink-0 text-sky" />
                  <MixedText text={suggestion} />
                </button>
              ))}
            </div>
            {!isSignedIn ? (
              <p className="text-xs text-muted-foreground">
                You can chat while signed out — the transcript just is not saved.
              </p>
            ) : null}
          </div>
        ) : null}

        {messages.map((message) => {
          const mine = message.role === "user";
          const content = textOf(message);
          const tools = (message.parts ?? [])
            .map((part) => toolLabel(part.type))
            .filter((label): label is string => Boolean(label));

          return (
            <div
              key={message.id}
              className={`flex flex-col gap-1.5 ${mine ? "items-end" : "items-start"}`}
            >
              {tools.length ? (
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <BookOpen className="size-3" />
                  {tools[tools.length - 1]}
                </span>
              ) : null}
              {content ? (
                <div
                  className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
                    mine
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card text-foreground"
                  }`}
                >
                  <MixedText text={content} />
                </div>
              ) : null}
            </div>
          );
        })}

        {busy ? (
          <p className="text-sm text-muted-foreground">Thinking…</p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}

        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-end gap-2 border-t border-border pt-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Message the AI tutor"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          placeholder="Ask about a word, a rule, a phrase…"
          className="min-h-[46px] max-h-32 flex-1 resize-none rounded-2xl border border-border bg-card px-4 py-3 text-[15px] outline-none focus:border-sky"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-sky text-white transition hover:opacity-90 disabled:opacity-50"
        >
          <ArrowUp className="size-5" />
        </button>
      </form>
    </div>
  );
}
