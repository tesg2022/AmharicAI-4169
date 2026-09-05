import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import * as Speech from "expo-speech";
import { baseUrl } from "./api";

/**
 * Amharic playback on mobile.
 *
 * The old behaviour — reading a Latin transliteration with an English voice
 * when no Amharic voice was installed — is gone deliberately. An English voice
 * saying "selam" teaches an English approximation, and the ejectives
 * (ጠ ቀ ጰ ጸ ጨ) do not exist in English at all, so the learner drills a sound
 * that is not in the language.
 *
 * The ladder is strictly:
 *   1. native am-ET audio synthesized server-side (real neural voice)
 *   2. an am-ET voice installed on the device, if there is one
 *   3. silence, reported honestly, so the screen can say why
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
  /** Content class for the server cache: vocabulary | dialogue_line | drill | tutor. */
  kind?: string;
  refId?: string | null;
  onEnd?: () => void;
};

const SILENT: SpeechResult = {
  source: "none",
  reason:
    "No native Amharic voice is available. Rather than mispronounce it with an English voice, this stays silent — read the fidel and the pronunciation guide instead.",
};

const MODE_RATE: Record<VoiceMode, number> = {
  native: 1,
  slow: 0.7,
  syllable: 0.6,
};

let cachedHasDeviceVoice: boolean | null = null;
let player: AudioPlayer | null = null;
let audioModeReady = false;

export function audioUrl(text: string, options: SpeakOptions = {}): string {
  const params = new URLSearchParams({ text, mode: options.mode ?? "native" });
  if (options.voice) params.set("voice", options.voice);
  if (options.kind) params.set("kind", options.kind);
  if (options.refId) params.set("refId", options.refId);
  return `${String(baseUrl).replace(/\/+$/, "")}/api/speech/audio?${params.toString()}`;
}

/** Whether the device itself has an Amharic voice installed. Rare, but free. */
export async function hasDeviceAmharicVoice(): Promise<boolean> {
  if (cachedHasDeviceVoice !== null) return cachedHasDeviceVoice;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    cachedHasDeviceVoice = voices.some((v) => v.language?.toLowerCase().startsWith("am"));
  } catch {
    cachedHasDeviceVoice = false;
  }
  return cachedHasDeviceVoice;
}

export function stopSpeaking() {
  try {
    player?.pause();
  } catch {
    /* playback teardown must never break a lesson */
  }
  try {
    Speech.stop();
  } catch {
    /* noop */
  }
}

/** Confirms the server actually has a native voice before we rely on it. */
async function serverAudioAvailable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    if (response.ok) return true;
    if (response.status === 405) {
      // Some hosts reject HEAD; a ranged GET is a cheap confirmation.
      const probe = await fetch(url, { headers: { Range: "bytes=0-1" } });
      return probe.ok;
    }
    return false;
  } catch {
    return false;
  }
}

async function speakWithDevice(text: string, options: SpeakOptions): Promise<SpeechResult> {
  if (!(await hasDeviceAmharicVoice())) {
    options.onEnd?.();
    return SILENT;
  }

  try {
    Speech.stop();
    Speech.speak(text, {
      language: "am-ET",
      rate: MODE_RATE[options.mode ?? "native"],
      pitch: 1,
      onDone: () => options.onEnd?.(),
      onStopped: () => options.onEnd?.(),
    });
    return { source: "device" };
  } catch {
    options.onEnd?.();
    return SILENT;
  }
}

/**
 * Speaks Amharic. Resolves once playback has started (or been ruled out);
 * `onEnd` fires when the clip finishes.
 */
export async function speakAmharic(
  text: string,
  options: SpeakOptions = {},
): Promise<SpeechResult> {
  if (!text.trim()) return { source: "none" };
  stopSpeaking();

  const url = audioUrl(text, options);
  if (await serverAudioAvailable(url)) {
    try {
      if (!audioModeReady) {
        // Play through the main speaker even when the ringer is silenced —
        // a muted phone should not silently break pronunciation practice.
        await setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
        audioModeReady = true;
      }
      player?.remove();
      player = createAudioPlayer({ uri: url });
      const subscription = player.addListener("playbackStatusUpdate", (status) => {
        if (status.didJustFinish) {
          subscription?.remove();
          options.onEnd?.();
        }
      });
      player.play();
      return { source: "server" };
    } catch {
      // Fall through to the device voice.
    }
  }

  return speakWithDevice(text, options);
}

/** Plays one phrase and resolves only when it has finished. */
export function speakAndWait(text: string, options: SpeakOptions = {}): Promise<SpeechResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: SpeechResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    void speakAmharic(text, { ...options, onEnd: () => finish({ source: "server" }) })
      .then((result) => {
        if (result.source === "none") finish(result);
        // Safety net: never leave a sequence hanging on a missing end event.
        setTimeout(() => finish(result), 20_000);
      })
      .catch(() => finish({ source: "none", reason: "Playback failed." }));
  });
}

/** Repeat mode — the same phrase several times, with a gap between takes. */
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

/** Conversation mode — a distinct voice per speaker and a real gap per turn. */
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
