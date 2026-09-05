import { CheckCircle2, Mic, Volume2, VolumeX } from "lucide-react";
import { useSpeechStatus } from "../queries/speech";
import { Card, Chip } from "./ui/kit";

/**
 * An honest report on the native Amharic voice.
 *
 * This app refuses to read Amharic with an English voice, so when no provider
 * key is configured it simply stays silent. That silence would look like a bug
 * unless the app says plainly what is missing — this panel names the exact
 * environment variables to supply, and never implies audio works when it does
 * not.
 */
export function SpeechStatusCard() {
  const status = useSpeechStatus();

  if (status.isLoading || !status.data) return null;

  const { nativeAudioAvailable, active, recognizer, providers, cache } = status.data;
  // Speaker and listener are genuinely different providers: our own LoRA voice
  // speaks but does not listen, so recognition falls through to the first
  // configured vendor that does. Saying only who speaks would be misleading.
  const splitStack = Boolean(recognizer && active && recognizer.id !== active.id);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`flex size-9 items-center justify-center rounded-xl ${
            nativeAudioAvailable ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          }`}
        >
          {nativeAudioAvailable ? (
            <Volume2 className="size-4" />
          ) : (
            <VolumeX className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Amharic voice</h2>
          <p className="text-sm text-muted-foreground">
            {nativeAudioAvailable && active
              ? `Native audio is live through ${active.label}.`
              : "No native voice is configured, so the app stays silent rather than mispronounce Amharic with an English voice."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {recognizer ? (
              splitStack ? (
                <>
                  Speaking practice listens through{" "}
                  <span className="font-medium text-foreground">{recognizer.label}</span> — a
                  different provider, because the active voice only speaks.
                </>
              ) : (
                <>
                  Speaking practice listens through{" "}
                  <span className="font-medium text-foreground">{recognizer.label}</span>.
                </>
              )
            ) : (
              "No recognizer is configured, so recorded takes fall back to the typed self-check — scored by the same rules."
            )}
          </p>
        </div>
        {nativeAudioAvailable ? (
          <Chip label="Live" icon={CheckCircle2} className="bg-primary/10 text-primary" />
        ) : (
          <Chip label="Silent" />
        )}
      </div>

      {active ? (
        <div className="flex flex-wrap gap-1.5">
          {active.voices.map((voice) => (
            <Chip
              key={voice.id}
              label={`${voice.label}${voice.gender ? ` · ${voice.gender}` : ""}${
                voice.preview ? " · preview" : ""
              }`}
            />
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        {providers.map((provider) => (
          <div
            key={provider.id}
            className="flex flex-wrap items-start gap-2 rounded-xl bg-muted/40 p-3 text-sm"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{provider.label}</span>
                {provider.id === active?.id ? (
                  <Chip label="voice" className="bg-primary/10 text-primary" />
                ) : null}
                {provider.id === recognizer?.id ? (
                  <Chip label="recognizer" className="bg-accent/20 text-accent-foreground" />
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">{provider.notes}</p>
              {!provider.configured && provider.missingEnv.length ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Needs{" "}
                  {provider.missingEnv.map((key, index) => (
                    <span key={key}>
                      {index ? " and " : ""}
                      <code className="rounded bg-background px-1 py-0.5 font-mono">{key}</code>
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {provider.supportsSynthesis ? <Chip label="speaks" icon={Volume2} /> : null}
              {provider.supportsRecognition ? <Chip label="listens" icon={Mic} /> : null}
              <Chip
                label={provider.configured ? "configured" : "no key"}
                className={provider.configured ? "bg-primary/10 text-primary" : ""}
              />
            </div>
          </div>
        ))}
      </div>

      {cache.clips ? (
        <p className="text-xs text-muted-foreground">
          {cache.clips} phrase{cache.clips === 1 ? "" : "s"} cached (
          {Math.round(cache.bytes / 1024)} KB) — course audio is generated once and reused.
        </p>
      ) : null}
    </Card>
  );
}
