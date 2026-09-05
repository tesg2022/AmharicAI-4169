/**
 * Amharic playback for the web app.
 *
 * There used to be a fallback here that read a Latin transliteration with an
 * English voice when no Amharic voice existed. That is deleted on purpose: an
 * English voice saying "selam" teaches an English approximation of ሰላም, and
 * the ejectives (ጠ ቀ ጰ ጸ ጨ) have no English equivalent at all, so the learner
 * drills a sound that does not exist in the language.
 *
 * The ladder is now, strictly:
 *   1. native am-ET audio synthesized server-side (real neural voice)
 *   2. an am-ET voice installed on the device, if there is one
 *   3. silence, reported honestly, so the UI can say why
 */

export const VOICE_MODES = ["native", "slow", "syllable"] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];

export type SpeechSource = "server" | "device" | "none";

export type SpeechResult = {
  source: SpeechSource;
  /** Present when nothing was audible — shown to the learner verbatim. */
  reason?: string;
};

export type SpeakOptions = {
  mode?: VoiceMode;
  /** Provider-native voice id, e.g. `am-ET-MekdesNeural`. */
  voice?: string | null;
  /** Content class for the server-side cache: vocabulary | dialogue_line | drill | tutor. */
  kind?: string;
  refId?: string | null;
  onEnd?: () => void;
};

const MODE_RATE: Record<VoiceMode, number> = {
  native: 1,
  slow: 0.7,
  syllable: 0.6,
};

/** Built once, reused, so a new tap always interrupts the previous clip. */
let element: HTMLAudioElement | null = null;

function audio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!element) element = new Audio();
  return element;
}

export function audioUrl(text: string, options: SpeakOptions = {}): string {
  const params = new URLSearchParams({ text, mode: options.mode ?? "native" });
  if (options.voice) params.set("voice", options.voice);
  if (options.kind) params.set("kind", options.kind);
  if (options.refId) params.set("refId", options.refId);
  return `${window.location.origin}/api/speech/audio?${params.toString()}`;
}

function deviceVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices();
}

/** An am-ET voice installed in the browser, if the platform ships one. */
export function deviceAmharicVoice(): SpeechSynthesisVoice | null {
  return deviceVoices().find((v) => v.lang?.toLowerCase().startsWith("am")) ?? null;
}

export function stopSpeaking() {
  if (element) {
    element.pause();
    element.currentTime = 0;
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

function speakWithDevice(text: string, options: SpeakOptions): SpeechResult {
  const voice = deviceAmharicVoice();
  if (!voice) {
    options.onEnd?.();
    return {
      source: "none",
      reason:
        "No native Amharic voice is available. Rather than mispronounce it with an English voice, this stays silent — read the fidel and the guide instead.",
    };
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = MODE_RATE[options.mode ?? "native"];
  utterance.onend = () => options.onEnd?.();
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);

  return { source: "device" };
}

/**
 * Speaks Amharic. Resolves once playback has started (or been ruled out) —
 * `onEnd` fires when the clip finishes.
 */
export async function speakAmharic(
  text: string,
  options: SpeakOptions = {},
): Promise<SpeechResult> {
  if (typeof window === "undefined" || !text.trim()) return { source: "none" };
  stopSpeaking();

  const player = audio();
  if (player) {
    try {
      const response = await fetch(audioUrl(text, options));
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        player.src = url;
        player.onended = () => {
          URL.revokeObjectURL(url);
          options.onEnd?.();
        };
        await player.play();
        return { source: "server" };
      }
      // 503 means the server has no provider key; anything else is a real
      // failure. Both land on the device voice before silence.
    } catch {
      // Network failure — fall through to the device voice.
    }
  }

  return speakWithDevice(text, options);
}

/**
 * Plays one phrase and resolves only once it has finished — the sequencing
 * primitive behind repeat and conversation modes.
 */
export function speakAndWait(text: string, options: SpeakOptions = {}): Promise<SpeechResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: SpeechResult) => {
      if (settled) return;
      settled = true;
      options.onEnd?.();
      resolve(result);
    };

    void speakAmharic(text, { ...options, onEnd: undefined })
      .then((result) => {
        // Nothing was audible: there is no end event coming.
        if (result.source === "none") return finish(result);
        const player = audio();
        if (result.source === "server" && player) {
          player.onended = () => finish(result);
        } else if (typeof window !== "undefined" && window.speechSynthesis) {
          const poll = window.setInterval(() => {
            if (!window.speechSynthesis.speaking) {
              window.clearInterval(poll);
              finish(result);
            }
          }, 120);
        } else {
          finish(result);
        }
      })
      .catch(() => finish({ source: "none", reason: "Playback failed." }));
  });
}

/**
 * Repeat mode: plays the same phrase several times with a gap between takes,
 * which is how a phrase actually gets into the ear.
 */
export async function repeatAmharic(
  text: string,
  options: SpeakOptions & { times?: number; gapMs?: number } = {},
): Promise<SpeechResult> {
  const times = Math.max(1, options.times ?? 3);
  const gap = options.gapMs ?? 700;
  let last: SpeechResult = { source: "none" };

  for (let i = 0; i < times; i++) {
    last = await speakAndWait(text, { ...options, onEnd: undefined });
    if (last.source === "none") break;
    if (i < times - 1) await new Promise((r) => setTimeout(r, gap));
  }

  options.onEnd?.();
  return last;
}

export type DialogueTurn = {
  text: string;
  voice?: string | null;
  gapMs?: number;
};

/**
 * Conversation mode: plays a dialogue with a distinct voice per speaker and a
 * real gap between turns, so it sounds like two people rather than one voice
 * reading a script.
 */
export async function speakDialogue(
  turns: DialogueTurn[],
  options: { mode?: VoiceMode; onTurn?: (index: number) => void } = {},
): Promise<SpeechResult> {
  let last: SpeechResult = { source: "none" };

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    options.onTurn?.(i);
    last = await speakAndWait(turn.text, {
      mode: options.mode,
      voice: turn.voice,
      kind: "dialogue_line",
    });
    if (last.source === "none") break;
    await new Promise((r) => setTimeout(r, turn.gapMs ?? 380));
  }

  return last;
}
