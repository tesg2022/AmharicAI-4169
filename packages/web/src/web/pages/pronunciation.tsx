import { useState } from "react";
import { AlertTriangle, AudioLines, Ear, Repeat2 } from "lucide-react";
import {
  usePronunciationDrills,
  usePronunciationGuide,
  usePronunciationPairs,
} from "../queries/pronunciation";
import {
  Am,
  Card,
  Chip,
  ErrorState,
  Loading,
  SpeakButton,
  VoiceModeToggle,
  TibebRule,
  Translit,
} from "../components/ui/kit";
import { speakAmharic, type VoiceMode } from "../lib/speech";

/**
 * Amharic Pronunciation for English Speakers — ለእንግሊዝኛ ተናጋሪዎች የአማርኛ አነባበብ
 *
 * The module exists because telling an English speaker "ጠ = ta" teaches the
 * wrong sound. Every ejective is therefore rendered next to its plain
 * counterpart, with IPA, mouth position and the trap spelled out.
 */

type Sound = {
  id: string;
  fidel: string;
  family: string;
  roman: string;
  ipa: string;
  soundClass: string;
  label: string;
  englishApprox: string;
  warning: string | null;
  mouthPosition: string;
  contrastWith: string | null;
  examples: { amharic: string; transliteration: string; english: string }[];
};

function Ipa({ value }: { value: string }) {
  return (
    <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
      /{value}/
    </span>
  );
}

function Warning({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border-l-[3px] border-warning bg-accent/15 p-2.5 text-xs leading-relaxed text-warning">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span className="flex-1">{text}</span>
    </div>
  );
}

function SoundCard({ sound, mode }: { sound: Sound; mode: VoiceMode }) {
  const ejective = sound.soundClass === "ejective";
  return (
    <Card
      tone="script"
      className={ejective ? "space-y-3 border-primary/40" : "space-y-3"}
    >
      <div className="flex items-start gap-4">
        <Am className="text-5xl leading-none text-primary">{sound.fidel}</Am>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-xl font-bold">{sound.roman}</span>
            <Ipa value={sound.ipa} />
            {ejective ? (
              <Chip label="ejective" className="bg-primary/15 text-primary" />
            ) : null}
          </div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {sound.label}
          </p>
        </div>
        <SpeakButton amharic={sound.fidel} transliteration={sound.roman} mode={mode} kind="drill" refId={sound.id} />
      </div>

      <div className="space-y-2 text-[13px] leading-relaxed">
        <p>
          <span className="font-semibold">Sounds like: </span>
          <span className="text-muted-foreground">{sound.englishApprox}</span>
        </p>
        <p>
          <span className="font-semibold">Mouth &amp; throat: </span>
          <span className="text-muted-foreground">{sound.mouthPosition}</span>
        </p>
      </div>

      {sound.warning ? <Warning text={sound.warning} /> : null}

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          The seven orders
        </p>
        <div className="flex flex-wrap gap-1.5">
          {sound.family
            .split(/\s+/)
            .filter(Boolean)
            .map((char, i) => (
              <button
                key={`${sound.id}-fam-${i}`}
                type="button"
                aria-label={`Play ${char}`}
                onClick={() => {
                  void speakAmharic(char, { mode });
                }}
                className="script-surface rounded-lg border border-border px-2.5 py-1.5 text-lg transition hover:border-primary/50 hover:bg-primary/5"
              >
                <Am>{char}</Am>
              </button>
            ))}
        </div>
      </div>

      {sound.examples.length ? (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Example words
          </p>
          <ul className="space-y-2">
            {sound.examples.map((ex, i) => (
              <li key={`${sound.id}-ex-${i}`} className="flex items-center gap-3">
                <SpeakButton
                  amharic={ex.amharic}
                  transliteration={ex.transliteration}
                  className="size-8"
                />
                <div className="min-w-0 flex-1">
                  <Am className="text-base">{ex.amharic}</Am>{" "}
                  <Translit className="text-xs">{ex.transliteration}</Translit>
                  <p className="text-xs text-muted-foreground">{ex.english}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

const TABS = [
  { id: "sounds", label: "Sounds" },
  { id: "contrast", label: "Ejective contrast" },
  { id: "pairs", label: "Minimal pairs" },
  { id: "drills", label: "Listen & repeat" },
] as const;

export default function PronunciationPage() {
  const guide = usePronunciationGuide();
  const pairs = usePronunciationPairs();
  const drills = usePronunciationDrills();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("sounds");
  const [mode, setMode] = useState<VoiceMode>("native");

  if (guide.isLoading) return <Loading label="Loading the pronunciation guide…" />;
  if (guide.isError)
    return <ErrorState message={guide.error?.message} onRetry={() => guide.refetch()} />;

  const data = guide.data;
  const vowels = (data?.vowels ?? []) as Sound[];
  const plain = (data?.plain ?? []) as Sound[];
  const ejectives = (data?.ejectives ?? []) as Sound[];
  const other = (data?.other ?? []) as Sound[];
  const contrasts = (data?.contrasts ?? []) as {
    plain: Sound;
    ejective: Sound | null;
  }[];

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex items-center gap-2 text-primary">
          <AudioLines className="size-5" />
          <span className="text-xs font-semibold uppercase tracking-wide">
            Pronunciation
          </span>
        </div>
        <h1 className="text-3xl font-bold md:text-4xl">
          {data?.title.en ?? "Amharic Pronunciation for English Speakers"}
        </h1>
        <p className="text-lg">
          <Am className="text-muted-foreground">{data?.title.am}</Am>
        </p>
        <TibebRule className="max-w-44" />
        <p className="max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
          Amharic is written in the Geʿez syllabary (ፊደል): every symbol is one consonant
          plus one of seven vowels. Most sounds have a close English equivalent — but five
          do not. ጠ, ቀ, ጰ, ጨ and ጸ are <strong className="text-foreground">ejectives</strong>,
          made with the throat closed and released with a small pop. They are separate
          consonants, not accented versions of ተ, ከ, ፐ, ቸ and ሰ.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              tab === t.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-primary/10"
            }`}
          >
            {t.label}
          </button>
        ))}
        <VoiceModeToggle mode={mode} onChange={setMode} className="ml-auto" />
      </div>

      {tab === "sounds" ? (
        <div className="space-y-8">
          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold">The seven vowel orders</h2>
            <p className="text-sm text-muted-foreground">
              Every consonant runs through these seven vowels. Learn the vowels once and
              the whole syllabary becomes readable.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              {vowels.map((s) => (
                <SoundCard key={s.id} sound={s} mode={mode} />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold">Ejective consonants</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {ejectives.map((s) => (
                <SoundCard key={s.id} sound={s} mode={mode} />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold">Plain counterparts</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {plain.map((s) => (
                <SoundCard key={s.id} sound={s} mode={mode} />
              ))}
            </div>
          </section>

          {other.length ? (
            <section className="space-y-3">
              <h2 className="font-display text-xl font-bold">Other sounds to watch</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {other.map((s) => (
                  <SoundCard key={s.id} sound={s} mode={mode} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {tab === "contrast" ? (
        <div className="space-y-4">
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Each row puts a plain consonant next to its ejective. Play them back to back —
            the tongue is in the same place both times; only the closed throat and the
            popped release change.
          </p>
          {contrasts.map(({ plain: p, ejective: e }) =>
            e ? (
              <Card key={p.id} className="space-y-3">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 rounded-xl border border-border p-4">
                    <div className="flex items-center gap-3">
                      <Am className="text-4xl text-foreground">{p.fidel}</Am>
                      <div>
                        <p className="font-display text-lg font-bold">{p.roman}</p>
                        <Ipa value={p.ipa} />
                      </div>
                      <SpeakButton
                        amharic={p.fidel}
                        transliteration={p.roman}
                        className="ml-auto"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">plain — {p.englishApprox}</p>
                  </div>
                  <div className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-4">
                    <div className="flex items-center gap-3">
                      <Am className="text-4xl text-primary">{e.fidel}</Am>
                      <div>
                        <p className="font-display text-lg font-bold">{e.roman}</p>
                        <Ipa value={e.ipa} />
                      </div>
                      <SpeakButton
                        amharic={e.fidel}
                        transliteration={e.roman}
                        className="ml-auto"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      ejective — {e.englishApprox}
                    </p>
                  </div>
                </div>
                {e.warning ? <Warning text={e.warning} /> : null}
              </Card>
            ) : null,
          )}
        </div>
      ) : null}

      {tab === "pairs" ? (
        <div className="space-y-6">
          {pairs.isLoading ? <Loading label="Loading exercises…" /> : null}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Ear className="size-4 text-primary" />
              <h2 className="font-display text-xl font-bold">Minimal pairs</h2>
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Identical vowel, one consonant feature apart. Play the left side, then the
              right, then say both yourself until the difference is automatic.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {(pairs.data?.minimalPairs ?? []).map((pair) => (
                <Card key={pair.id} className="space-y-3">
                  <div className="flex items-center justify-center gap-4">
                    <button
                      type="button"
                      aria-label={`Play ${pair.plainText}`}
                      onClick={() => {
                        void speakAmharic(pair.plainText, { mode });
                      }}
                      className="flex-1 rounded-xl border border-border p-4 text-center transition hover:border-primary/40 hover:bg-primary/5"
                    >
                      <Am className="text-3xl">{pair.plainText}</Am>
                      <p className="pt-1 text-xs italic text-muted-foreground">
                        {pair.plainRoman}
                      </p>
                    </button>
                    <span className="text-xs font-semibold uppercase text-muted-foreground">
                      vs
                    </span>
                    <button
                      type="button"
                      aria-label={`Play ${pair.ejectiveText}`}
                      onClick={() => {
                        void speakAmharic(pair.ejectiveText, { mode });
                      }}
                      className="flex-1 rounded-xl border border-primary/40 bg-primary/5 p-4 text-center transition hover:bg-primary/10"
                    >
                      <Am className="text-3xl text-primary">{pair.ejectiveText}</Am>
                      <p className="pt-1 text-xs italic text-muted-foreground">
                        {pair.ejectiveRoman}
                      </p>
                    </button>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <SpeakButton amharic={pair.plainText} transliteration={pair.plainRoman} />
                    <SpeakButton
                      amharic={pair.ejectiveText}
                      transliteration={pair.ejectiveRoman}
                    />
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{pair.note}</p>
                </Card>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold">Contrast examples in words</h2>
            <p className="max-w-3xl text-sm text-muted-foreground">
              These are real words showing each sound word-initially. They are contrast
              examples, not minimal pairs — the rest of the word differs too.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {(pairs.data?.contrastExamples ?? []).map((pair) => (
                <Card key={pair.id} className="space-y-3">
                  <div className="flex items-center gap-3">
                    <SpeakButton amharic={pair.plainText} className="size-8" />
                    <div>
                      <Am className="text-xl">{pair.plainText}</Am>
                      <p className="text-xs italic text-muted-foreground">{pair.plainRoman}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <SpeakButton amharic={pair.ejectiveText} className="size-8" />
                    <div>
                      <Am className="text-xl text-primary">{pair.ejectiveText}</Am>
                      <p className="text-xs italic text-muted-foreground">
                        {pair.ejectiveRoman}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{pair.note}</p>
                </Card>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {tab === "drills" ? (
        <div className="space-y-4">
          {drills.isLoading ? <Loading label="Loading drills…" /> : null}
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Listen, then repeat out loud. Your browser reads the Amharic aloud where an
            Amharic voice is installed; where it is not, it reads the transliteration and
            says so.
          </p>
          {(drills.data ?? []).map((drill) => (
            <Card key={drill.id} className="space-y-3">
              <div className="flex items-center gap-2">
                <Repeat2 className="size-4 text-primary" />
                <h3 className="font-display text-lg font-bold">{drill.title}</h3>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {drill.instructions}
              </p>
              <div className="flex flex-wrap gap-2">
                {drill.items.map((item, i) => (
                  <div
                    key={`${drill.id}-${i}`}
                    className="script-surface flex items-center gap-2 rounded-xl border border-border px-3 py-2"
                  >
                    <Am className="text-xl">{item}</Am>
                    <SpeakButton amharic={item} className="size-7" />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
