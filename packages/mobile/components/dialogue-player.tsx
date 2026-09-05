import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FontSize, Radius } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useDialogueSpeech } from "@/queries/speech";
import { speakDialogue, stopSpeaking, type VoiceMode } from "@/lib/speech";
import { Am, Body, SpeakButton, Translit, VoiceModeToggle } from "@/components/ui";

/**
 * Conversation mode.
 *
 * A dialogue read by one voice is a script; read by two it is a conversation.
 * The server casts each speaker to a distinct native voice and plans the gap
 * between turns, and this component walks that cast, highlighting whoever is
 * talking so the learner follows along by ear and eye at once.
 *
 * The cast is only fetched once the learner actually presses play — there is
 * no reason to ask the server about voices for a dialogue nobody listens to.
 */

export type DialogueLineView = {
  id: string;
  speaker: string | null;
  amharic: string | null;
  transliteration: string | null;
  english: string | null;
};

export function DialoguePlayer({
  dialogueId,
  lines,
}: {
  dialogueId: string;
  lines: DialogueLineView[];
}) {
  const colors = useColors();
  const [mode, setMode] = useState<VoiceMode>("native");
  const [armed, setArmed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const wantPlay = useRef(false);
  const runId = useRef(0);

  const cast = useDialogueSpeech(armed ? dialogueId : null, mode);

  const stop = useCallback(() => {
    runId.current += 1;
    wantPlay.current = false;
    stopSpeaking();
    setPlaying(false);
    setActive(null);
  }, []);

  // Stop audio if the learner leaves the lesson mid-conversation.
  useEffect(() => stop, [stop]);

  const run = useCallback(
    async (turns: { amharic: string | null; voice: string | null; turnGapMs: number }[]) => {
      const ticket = ++runId.current;
      setPlaying(true);
      setNotice(null);

      const result = await speakDialogue(
        turns
          .filter((turn) => turn.amharic?.trim())
          .map((turn) => ({
            text: turn.amharic as string,
            voice: turn.voice,
            gapMs: turn.turnGapMs,
          })),
        {
          mode,
          onTurn: (index) => {
            if (runId.current === ticket) setActive(index);
          },
        },
      );

      if (runId.current !== ticket) return;
      setPlaying(false);
      setActive(null);
      if (result.source === "none" && result.reason) setNotice(result.reason);
    },
    [mode],
  );

  // The cast arrived after a play request — start the conversation.
  useEffect(() => {
    if (!wantPlay.current || !cast.data) return;
    wantPlay.current = false;
    void run(cast.data.lines);
  }, [cast.data, run]);

  const loading = armed && cast.isLoading;

  function toggle() {
    if (playing) {
      stop();
      return;
    }
    setNotice(null);
    if (cast.data) {
      void run(cast.data.lines);
      return;
    }
    wantPlay.current = true;
    setArmed(true);
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? "Stop conversation" : "Play conversation"}
          onPress={toggle}
          disabled={loading}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderRadius: Radius.pill,
            opacity: loading ? 0.5 : pressed ? 0.85 : 1,
            backgroundColor: colors.primary,
          })}
        >
          <Ionicons
            name={playing ? "stop" : "play"}
            size={16}
            color={colors.primaryForeground}
          />
          <Body size={FontSize.small} color={colors.primaryForeground}>
            {playing ? "Stop" : loading ? "Casting voices…" : "Play conversation"}
          </Body>
        </Pressable>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="people-outline" size={14} color={colors.mutedForeground} />
          <Body size={FontSize.caption} color={colors.mutedForeground}>
            {cast.data?.speakers.length
              ? `${cast.data.speakers.length} voices`
              : "Two voices, one per speaker"}
          </Body>
        </View>

        <View style={{ marginLeft: "auto" }}>
          <VoiceModeToggle mode={mode} onChange={setMode} />
        </View>
      </View>

      {notice ? (
        <View
          style={{
            flexDirection: "row",
            gap: 8,
            padding: 12,
            borderRadius: Radius.card,
            backgroundColor: colors.muted,
          }}
        >
          <Ionicons name="volume-mute-outline" size={14} color={colors.mutedForeground} />
          <Body size={FontSize.caption} color={colors.mutedForeground} style={{ flex: 1 }}>
            {notice}
          </Body>
        </View>
      ) : null}

      <View style={{ gap: 4 }}>
        {lines.map((line, index) => {
          const isActive = playing && active === index;
          return (
            <View
              key={line.id}
              style={{
                flexDirection: "row",
                gap: 10,
                alignItems: "center",
                paddingHorizontal: 10,
                paddingVertical: 8,
                borderRadius: Radius.card,
                backgroundColor: isActive ? colors.primary + "1A" : "transparent",
                borderWidth: 1,
                borderColor: isActive ? colors.primary + "44" : "transparent",
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                {line.speaker ? (
                  <Am size={FontSize.caption} color={colors.primary}>
                    {line.speaker}
                  </Am>
                ) : null}
                {line.amharic ? <Am size={FontSize.h3}>{line.amharic}</Am> : null}
                {line.transliteration ? <Translit>{line.transliteration}</Translit> : null}
                {line.english ? (
                  <Body size={FontSize.small} color={colors.mutedForeground}>
                    {line.english}
                  </Body>
                ) : null}
              </View>
              {line.amharic ? (
                <SpeakButton
                  amharic={line.amharic}
                  transliteration={line.transliteration}
                  mode={mode}
                  kind="dialogue_line"
                  refId={line.id}
                  onMissingVoice={setNotice}
                />
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}
