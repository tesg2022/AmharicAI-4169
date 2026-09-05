import { useCallback, useRef, useState } from "react";
import { Platform } from "react-native";
import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type RecordingOptions,
} from "expo-audio";
import { baseUrl } from "./api";

/**
 * Amharic speech-to-text on mobile.
 *
 * The learner records a take, the bytes go to `/api/speech/recognize`, and the
 * server runs real `am-ET` recognition on whichever provider is configured.
 * The typed self-check is kept as the last rung of the ladder — it runs
 * through the exact same server-side scorer, so a learner without a mic (or
 * without a configured recognizer) still gets a real score.
 *
 * ## Recording format — a real constraint, not a detail
 *
 * Speech APIs are picky about codecs, and the two platforms cannot record the
 * same one:
 *
 *   - iOS   → 16 kHz mono LINEAR PCM in a `.wav`. Accepted by both Azure and
 *             Google.
 *   - Android → cannot produce WAV/PCM at all; expo-audio only offers
 *             3gp / mpeg4 / amrnb / amrwb / aac_adts / webm. We pick AMR-WB,
 *             which **Google accepts and Azure does not**.
 *
 * So Android + Azure is a combination that is expected to fail. The clean fix
 * is a server-side transcode to WAV before handing bytes to the provider; that
 * is deliberately not half-built here because there is no provider key to test
 * it against yet. Until then: prefer Google if your learners are on Android.
 *
 * None of this path has been exercised against a live key — no provider
 * credentials are configured.
 */

export type RecognizeFailure =
  | "no_permission"
  | "no_recognizer"
  | "empty"
  | "failed"
  | "unsupported";

export type RecognizeOutcome =
  | { ok: true; transcript: string; confidence: number | null; provider: string }
  | { ok: false; reason: RecognizeFailure; message: string };

/** 16 kHz mono — what recognizers want, and a quarter the bytes of 44.1 kHz stereo. */
export const RECOGNITION_RECORDING: RecordingOptions = {
  extension: Platform.OS === "ios" ? ".wav" : ".amr",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 128000,
  android: {
    extension: ".amr",
    outputFormat: "amrwb",
    audioEncoder: "amr_wb",
    sampleRate: 16000,
  },
  ios: {
    extension: ".wav",
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.HIGH,
    sampleRate: 16000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: "audio/webm",
    bitsPerSecond: 128000,
  },
};

/** Content type matching what each platform actually recorded. */
function recordedMimeType(): string {
  if (Platform.OS === "ios") return "audio/wav";
  if (Platform.OS === "android") return "audio/amr-wb";
  return "audio/webm";
}

/** POSTs recorded audio to the server recognizer. */
export async function recognizeRecording(
  uri: string,
  expected?: string,
): Promise<RecognizeOutcome> {
  const params = new URLSearchParams();
  if (expected) params.set("expected", expected);
  const query = params.toString();
  const endpoint = `${String(baseUrl).replace(/\/+$/, "")}/api/speech/recognize${
    query ? `?${query}` : ""
  }`;

  let body: Blob;
  try {
    body = await (await fetch(uri)).blob();
  } catch {
    return { ok: false, reason: "failed", message: "Could not read the recording." };
  }
  if (body.size === 0) {
    return { ok: false, reason: "empty", message: "Nothing was recorded — try again." };
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": recordedMimeType() },
      body,
    });

    if (response.status === 503) {
      return {
        ok: false,
        reason: "no_recognizer",
        message:
          "No Amharic recognizer is configured on the server yet. Type what you said instead — it is scored the same way.",
      };
    }
    if (!response.ok) {
      return { ok: false, reason: "failed", message: "Recognition failed. Try again." };
    }

    const json = (await response.json()) as {
      transcript?: string;
      confidence?: number | null;
      provider?: string;
    };
    const transcript = (json.transcript ?? "").trim();
    if (!transcript) {
      return {
        ok: false,
        reason: "empty",
        message: "Nothing was picked up — try again a little louder.",
      };
    }

    return {
      ok: true,
      transcript,
      confidence: json.confidence ?? null,
      provider: json.provider ?? "server",
    };
  } catch {
    return { ok: false, reason: "failed", message: "Could not reach the recognizer." };
  }
}

export type AmharicRecognizer = {
  recording: boolean;
  busy: boolean;
  start: () => Promise<boolean>;
  /** Stops the take, uploads it, and resolves with the transcript or a reason. */
  stopAndRecognize: (expected?: string) => Promise<RecognizeOutcome>;
  cancel: () => Promise<void>;
};

/**
 * Mic + upload in one hook, so a screen only deals with `start()` and
 * `stopAndRecognize()`.
 */
export function useAmharicRecognizer(): AmharicRecognizer {
  const recorder = useAudioRecorder(RECOGNITION_RECORDING);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = useRef(false);

  const start = useCallback(async () => {
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) return false;

      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      active.current = true;
      setRecording(true);
      return true;
    } catch {
      active.current = false;
      setRecording(false);
      return false;
    }
  }, [recorder]);

  const stopAndRecognize = useCallback(
    async (expected?: string): Promise<RecognizeOutcome> => {
      if (!active.current) {
        return { ok: false, reason: "failed", message: "Nothing was being recorded." };
      }
      setBusy(true);
      try {
        await recorder.stop();
        active.current = false;
        setRecording(false);
        // Let playback have the audio session back.
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });

        const uri = recorder.uri;
        if (!uri) {
          return { ok: false, reason: "empty", message: "Nothing was recorded — try again." };
        }
        return await recognizeRecording(uri, expected);
      } catch {
        return { ok: false, reason: "failed", message: "Recording failed. Try again." };
      } finally {
        setBusy(false);
      }
    },
    [recorder],
  );

  const cancel = useCallback(async () => {
    if (!active.current) return;
    try {
      await recorder.stop();
    } catch {
      /* already stopped */
    }
    active.current = false;
    setRecording(false);
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch {
      /* noop */
    }
  }, [recorder]);

  return { recording, busy, start, stopAndRecognize, cancel };
}
