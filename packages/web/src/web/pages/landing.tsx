import { Link } from "wouter";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  GraduationCap,
  Layers,
  Library,
  MessageCircle,
  Smartphone,
  Type,
} from "lucide-react";
import { useCourseStats } from "../queries/content";
import { useSession } from "../hooks/use-session";
import { ORIGIN, useSeo } from "../hooks/use-seo";
import { Am, Card, Chip, TibebRule } from "../components/ui/kit";

/**
 * The public front door.
 *
 * Everything claimed here has to be true of the build that is actually
 * deployed — the course is real and written, the tutor is a preview, the
 * custom voice does not exist. Marketing copy that outruns the capability
 * table in api/content/plans.ts is the fastest way to a refund request, so
 * this page states the state of things plainly and lets /features carry the
 * detail.
 */

const PILLARS = [
  {
    icon: Type,
    title: "Start at the ፊደል",
    body: "All 34 base characters across seven orders, with the vowel each form carries — not a vocabulary list that assumes you can already read.",
  },
  {
    icon: BookOpen,
    title: "A written course, not clips",
    body: "Units built from a real beginner textbook: greetings, introductions, verbs, food, travel and work — kept verbatim, never silently rewritten.",
  },
  {
    icon: GraduationCap,
    title: "Pronunciation for English speakers",
    body: "The sounds English does not have — ejectives, gemination, the ä/a distinction — taught as minimal pairs instead of being glossed over.",
  },
  {
    icon: Layers,
    title: "Practice that remembers",
    body: "Flashcards on a spaced-repetition schedule, quizzes per lesson, and XP and streaks recorded against your account.",
  },
];

/**
 * Site-level structured data for the front door. The Organization block lives
 * statically in index.html; this adds the WebSite it belongs to and the one
 * course that actually exists, both pointing at the canonical origin.
 *
 * A module constant, not a literal in the render: `useSeo` serialises this
 * whenever the value changes.
 */
const LANDING_JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${ORIGIN}/#website`,
      url: `${ORIGIN}/`,
      name: "AmharicAI",
      inLanguage: "en",
      description:
        "Learn Amharic online as an English speaker: the ፊደል syllabary, pronunciation, a written beginner course, practice and a searchable course dictionary.",
    },
    {
      "@type": "Course",
      "@id": `${ORIGIN}/app#course`,
      url: `${ORIGIN}/app`,
      name: "Amharic Language — Beginner",
      description:
        "A written beginner course in Amharic for English speakers: the ፊደል syllabary, pronunciation, greetings and introductions, verbs, food, travel and work.",
      inLanguage: "en",
      teaches: "Amharic (Ethiopian language) reading, pronunciation and beginner vocabulary",
      educationalLevel: "Beginner",
      isAccessibleForFree: true,
      provider: { "@type": "Organization", name: "AmharicAI", url: `${ORIGIN}/` },
    },
  ],
};

/**
 * The study path, as links. Written as one list so the front door, and only
 * the front door, decides the order the pages are introduced in.
 */
const LEARNING_PATH = [
  {
    to: "/fidel",
    icon: Type,
    title: "Read the Fidel",
    body: "The ፊደል syllabary — the Amharic alphabet — as a grid: 34 consonants across seven vowel orders, with transliteration for each form.",
    cta: "Learn Amharic Fidel",
  },
  {
    to: "/pronunciation",
    icon: GraduationCap,
    title: "Fix the sounds",
    body: "Ejectives, gemination and the ä/a split, taught as minimal pairs with IPA and mouth position.",
    cta: "Amharic pronunciation guide",
  },
  {
    to: "/app",
    icon: BookOpen,
    title: "Work the lessons",
    body: "A written beginner course, unit by unit — greetings, introductions, verbs, food, travel and work.",
    cta: "Amharic lessons for beginners",
  },
  {
    to: "/practice",
    icon: Layers,
    title: "Drill and review",
    body: "Spaced-repetition flashcards for Amharic vocabulary, per-lesson quizzes and a read-listen-repeat-speak loop.",
    cta: "Practice Amharic pronunciation",
  },
  {
    to: "/dictionary",
    icon: Library,
    title: "Look words up",
    body: "Search every word the course teaches by Amharic script, transliteration or English meaning.",
    cta: "Amharic dictionary online",
  },
] as const;

export default function LandingPage() {
  const stats = useCourseStats();
  const { isSignedIn } = useSession();

  useSeo({
    // Brand token leads the homepage title: the search competition is against
    // other "Amharic AI" results, so "AmharicAI" has to be the first thing
    // both a reader and a ranker see. What follows it is the phrase people
    // actually type — "learn Amharic online" — rather than a slogan.
    title: "AmharicAI — Learn Amharic Online from the Fidel Up",
    exactTitle: true,
    // Deliberately does not promise free-text translation: it needs a provider
    // key this build has not been given (see plans.ts). The tutor is named as a
    // preview because that is its real status on /features.
    // Exact copy the brief specifies, so the snippet in search results reads
    // as the product owner wrote it. Every claim in it is real: the tutor
    // exists and is labelled a preview on /features and on this page.
    description:
      "Learn Amharic online with Fidel lessons, pronunciation practice, vocabulary, an Amharic dictionary, interactive exercises, and an AI tutor for beginners.",
    path: "/",
    jsonLd: LANDING_JSON_LD,
  });

  const unitCount = stats.data?.units ?? null;
  const lessonCount = stats.data?.lessons ?? null;

  return (
    <div className="space-y-16">
      {/* Hero */}
      <section className="grid gap-10 md:grid-cols-[1.35fr_1fr] md:items-center">
        <div className="space-y-5">
          <Chip label="Free to start · no card required" icon={CheckCircle2} />
          {/*
            One H1, carrying the phrase people actually search for. The glyphs
            are followed by their own name in Latin script, read out by screen
            readers and by crawlers that do not transliterate Ethiopic — the
            sighted reader sees exactly what they saw before.
          */}
          <h1 className="font-display text-4xl font-bold leading-[1.1] md:text-6xl">
            Learn Amharic online from the{" "}
            <Am className="text-primary">ፊደል</Am>
            <span className="sr-only"> Fidel</span> up
          </h1>
          <TibebRule className="max-w-64" />
          <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
            Most courses hand English speakers a phrasebook and hope the script sorts itself
            out. AmharicAI starts where the Ethiopian language actually starts — the syllabary,
            then the sounds, then a written beginner course you can work through at your own
            pace, in a browser, for free.
          </p>
          <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
            The whole Amharic course sits in one place: Amharic Fidel lessons that teach the
            alphabet order by order, Amharic lessons for beginners that build from greetings
            upward, pronunciation practice for the sounds English does not have, vocabulary you
            keep through spaced repetition, a searchable Amharic dictionary, interactive
            exercises and quizzes drawn from each lesson, and an AI tutor you can ask questions
            in English — labelled a preview, because that is what it is.
          </p>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            Start anywhere:{" "}
            <Link to="/fidel" className="font-medium text-primary hover:underline">
              Learn Amharic Fidel
            </Link>
            ,{" "}
            <Link to="/app" className="font-medium text-primary hover:underline">
              Amharic lessons for beginners
            </Link>
            ,{" "}
            <Link to="/practice" className="font-medium text-primary hover:underline">
              Practice Amharic pronunciation
            </Link>{" "}
            or the{" "}
            <Link to="/dictionary" className="font-medium text-primary hover:underline">
              Amharic dictionary online
            </Link>
            .
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              to={isSignedIn ? "/app" : "/sign-in"}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              {isSignedIn ? "Continue learning" : "Start learning free"}
              <ArrowRight className="size-4" />
            </Link>
            <Link
              to="/app"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-6 py-3 text-sm font-semibold transition hover:bg-muted"
            >
              Browse the course
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">
            Works in any browser. The Android app is in preparation —{" "}
            <Link to="/download" className="font-medium underline hover:text-foreground">
              get told when it lands
            </Link>
            .
          </p>
        </div>

        {/* Script showcase: the product's actual subject, used as the art. */}
        <Card tone="script" className="relative overflow-hidden">
          <div className="grid grid-cols-4 gap-2 text-center">
            {["ሀ", "ለ", "ሐ", "መ", "ሠ", "ረ", "ሰ", "ሸ", "ቀ", "በ", "ተ", "ቸ"].map((glyph) => (
              <div
                key={glyph}
                className="rounded-xl border border-border/60 bg-background/60 py-3"
              >
                <Am className="text-2xl text-primary">{glyph}</Am>
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Twelve of the 34 base characters. Each one has seven orders — that is the first
            thing the course teaches you to read.
          </p>
        </Card>
      </section>

      {/* What the course actually contains */}
      <section className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold md:text-3xl">
              What you get on day one
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Free covers the ፊደል, the pronunciation guide and the first two units.
            </p>
          </div>
          <Link
            to="/features"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
          >
            See everything, including what is not ready <ArrowRight className="size-3.5" />
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {PILLARS.map((p) => (
            <Card key={p.title} className="space-y-2.5">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <p.icon className="size-5" />
              </span>
              <h3 className="font-display text-lg font-bold">{p.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{p.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* The route through the product, in the order it is meant to be used.
          Doubles as the site's main internal-link path: front door → ፊደል →
          lessons → practice → dictionary. */}
      <section className="space-y-6">
        <div>
          <h2 className="font-display text-2xl font-bold md:text-3xl">
            The order to learn Amharic in
          </h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Each step below is a page you can open now: Fidel, then pronunciation, then the
            lessons, then practice, then the dictionary. Work them in that order — the script
            comes first, because everything after it is written in the script, which is the part
            of Ethiopian language learning most courses skip.
          </p>
        </div>

        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LEARNING_PATH.map((step, i) => (
            <li key={step.to}>
              <Card className="h-full space-y-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {i + 1}
                  </span>
                  <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <step.icon className="size-4" />
                  </span>
                </div>
                <h3 className="font-display text-base font-bold leading-snug">{step.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                <Link
                  to={step.to}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                >
                  {step.cta} <ArrowRight className="size-3.5" />
                </Link>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      {/* Honest status band — the tutor is a preview and the voice is unbuilt. */}
      <section className="grid gap-4 sm:grid-cols-3">
        <Card className="space-y-1.5">
          <p className="font-display text-3xl font-bold text-primary">
            {unitCount ?? "20"}
          </p>
          <p className="text-sm font-medium">units mapped</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {lessonCount
              ? `${lessonCount} lessons written so far. Units still being written say so on the card — they are never sold as locked content.`
              : "Units still being written say so on the card — they are never sold as locked content."}
          </p>
        </Card>
        <Card className="space-y-1.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-sky/10 text-sky">
            <MessageCircle className="size-4" />
          </span>
          <p className="text-sm font-medium">AI tutor — in preview</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Ask questions in English about anything in the course. It is labelled a preview
            because its Amharic has not been verified line by line — treat it as a draft.
          </p>
        </Card>
        <Card className="space-y-1.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Smartphone className="size-4" />
          </span>
          <p className="text-sm font-medium">Android — not yet</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The mobile app is built but not on Google Play. The web app works on a phone
            browser today and your progress is the same account.
          </p>
        </Card>
      </section>

      {/* Closing CTA */}
      <section className="rounded-2xl border border-border bg-card px-6 py-10 text-center">
        <h2 className="font-display text-2xl font-bold md:text-3xl">
          Start with the alphabet. It takes an evening.
        </h2>
        <p className="mx-auto mt-2.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
          The free plan is not a trial — it does not expire, and it does not ask for a card.
          Upgrade only once you have decided the course is worth it.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            to={isSignedIn ? "/app" : "/sign-in"}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            {isSignedIn ? "Continue learning" : "Create a free account"}
            <ArrowRight className="size-4" />
          </Link>
          <Link
            to="/pricing"
            className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-semibold hover:bg-muted"
          >
            Compare plans
          </Link>
        </div>
      </section>
    </div>
  );
}
