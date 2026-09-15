import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, Users, VolumeX } from "lucide-react";
import { useDialogueSpeech } from "../queries/speech";
import { speakDialogue, stopSpeaking, type VoiceMode } from "../lib/speech";
import { Am, SpeakButton, Translit, VoiceModeToggle } from "./ui/kit";

/**
 * Conversation mode.
 *
 * A dialogue read by one voice is a script; read by two it is a conversation.
 * The server casts each speaker to a distinct native voice and plans the gap
 * between turns, and this component walks that cast, highlighting whoever is
 * talking so the learner can follow along by ear and eye at once.
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

type Props = {
  dialogueId: string;
  lines: DialogueLineView[];
};

export function DialoguePlayer({ dialogueId, lines }: Props) {
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

  // Stop audio if the learner navigates away mid-conversation.
  useEffect(() => stop, [stop]);

  const run = useCallback(
    async (turns: { amharic: string | null; voice: string | null; turnGapMs: number }[]) => {
      const ticket = ++runId.current;
      setPlaying(true);
      setNotice(null);

      const result = await speakDialogue(
        turns
          .filter((t) => t.amharic?.trim())
          .map((t) => ({ text: t.amharic as string, voice: t.voice, gapMs: t.turnGapMs })),
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

  function toggle() {
    if (playing) return stop();
    setNotice(null);
    if (cast.data) return void run(cast.data.lines);
    wantPlay.current = true;
    setArmed(true);
  }

  const loading = armed && cast.isLoading;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {playing ? (
            <>
              <Pause className="size-4" /> Stop
            </>
          ) : (
            <>
              <Play className="size-4" /> {loading ? "Casting voices…" : "Play conversation"}
            </>
          )}
        </button>

        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="size-3.5" />
          {cast.data?.speakers.length
            ? `${cast.data.speakers.length} voices`
            : "Two voices, one per speaker"}
        </span>

        <div className="ml-auto">
          <VoiceModeToggle mode={mode} onChange={setMode} />
        </div>
      </div>

      {notice ? (
        <p className="flex items-start gap-2 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
          <VolumeX className="mt-0.5 size-3.5 shrink-0" />
          {notice}
        </p>
      ) : null}

      <div className="space-y-1">
        {lines.map((line, index) => {
          const isActive = playing && active === index;
          return (
            <div
              key={line.id}
              className={`flex items-start gap-3 rounded-xl px-3 py-2 transition-colors ${
                isActive ? "bg-primary/10 ring-1 ring-primary/30" : ""
              }`}
            >
              <span className="mt-1 w-14 shrink-0 truncate text-xs font-semibold uppercase tracking-wide text-primary">
                {line.speaker ?? "—"}
              </span>
              <div className="min-w-0 flex-1">
                {line.amharic ? <Am className="text-lg">{line.amharic}</Am> : null}
                {line.transliteration ? (
                  <div className="text-sm">
                    <Translit>{line.transliteration}</Translit>
                  </div>
                ) : null}
                {line.english ? (
                  <p className="text-sm text-muted-foreground">{line.english}</p>
                ) : null}
              </div>
              {line.amharic ? (
                <SpeakButton
                  amharic={line.amharic}
                  transliteration={line.transliteration}
                  mode={mode}
                  kind="dialogue_line"
                  refId={line.id}
                  className="size-8"
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
