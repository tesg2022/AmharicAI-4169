import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight, ChevronDown } from "lucide-react";
import { useSeo } from "../hooks/use-seo";
import { Am, TibebRule } from "../components/ui/kit";
import { billingOptionById, formatZar } from "../../api/content/plans";

/**
 * Questions people actually ask before paying.
 *
 * Answers are rendered as <details>, not a JS accordion, so the text is in the
 * DOM for a crawler and reachable by keyboard without any of our code running.
 *
 * Prices are read from `api/content/plans.ts` and never typed in here. This
 * page used to restate them in prose, and they went stale the moment billing
 * changed — it was still quoting dollar prices months later, on the page
 * people read specifically to find out what they would be charged. Even the
 * annual saving is computed from the two options rather than written down,
 * because a hand-copied figure is a wrong figure eventually.
 */

const SUPPORT_EMAIL = "admin@amharicai.org";

/**
 * The price of a billing option, in rand, exactly as the pricing page and the
 * checkout button show it.
 *
 * One currency and one figure, with no dollar conversion beside it: an
 * approximation dropped into a sentence reads like the price, and the price is
 * the rand amount. Reading the same number here, on the pricing page, in the
 * Terms and on Paystack's page is the whole point — they all come from
 * `BILLING_OPTIONS`, so an answer here cannot quietly go stale.
 */
function price(optionId: string): string {
  const option = billingOptionById(optionId);
  // Unreachable while the ids above match the price list, but a missing option
  // must not render "RNaN" or crash the page somebody is reading to decide.
  if (!option) return "see the pricing page";
  return formatZar(option.price_zar);
}

/**
 * What an annual option saves against twelve of the matching monthly one, in
 * rand, worked out from the price list rather than typed in.
 */
function annualSaving(monthlyId: string, annualId: string): string {
  const monthly = billingOptionById(monthlyId);
  const annual = billingOptionById(annualId);
  if (!monthly || !annual) return "money";
  return formatZar(monthly.price_zar * 12 - annual.price_zar);
}

interface Qa {
  q: string;
  a: ReactNode;
}

interface Section {
  heading: string;
  items: Qa[];
}

const SECTIONS: Section[] = [
  {
    heading: "The course",
    items: [
      {
        q: "What is AmharicAI?",
        a: (
          <>
            <p>
              A course that teaches Amharic to English speakers, starting with the{" "}
              <Am>ፊደል</Am> — the syllabary the language is written in — rather than with a
              phrasebook that assumes you can already read it.
            </p>
            <p>
              It runs in your browser. There is a written beginner course, a pronunciation guide
              built around the sounds English does not have, flashcards on a spaced-repetition
              schedule, per-lesson quizzes, and an AI tutor you can ask questions in English.
            </p>
          </>
        ),
      },
      {
        q: "Who is it for?",
        a: (
          <p>
            Adults who speak English and are starting Amharic from zero, or who can speak some
            Amharic at home but never learned to read or write it. It is a beginner course: if
            you are already reading Amharic newspapers comfortably, this is below your level.
            The minimum age to hold an account is 13.
          </p>
        ),
      },
      {
        q: "What can I actually learn here?",
        a: (
          <>
            <p>
              All 34 base characters across their seven orders, and the vowel each form carries.
              The pronunciation work that English speakers get wrong — ejectives, gemination,
              the ä/a distinction — taught as minimal pairs. Then units drawn from a written
              beginner course: greetings, introductions, verbs, food, travel, work.
            </p>
            <p>
              Course text is kept verbatim from its source and is never silently corrected. Where
              the source material carries a quality flag, the app shows you the flag instead of
              hiding it.
            </p>
          </>
        ),
      },
      {
        q: "Can I use it offline?",
        a: (
          <p>
            No. AmharicAI needs an internet connection — lessons, progress and the tutor are all
            served from the account, so nothing is cached for offline study. There is no offline
            mode planned that we are prepared to promise a date for.
          </p>
        ),
      },
    ],
  },
  {
    heading: "Plans and payment",
    items: [
      {
        q: "What do the Free, Basic and Premium plans include?",
        a: (
          <>
            <p>
              <strong>Free — R0, forever, no card.</strong> The <Am>ፊደል</Am> chart, the
              pronunciation guide, the first two course units, flashcards and quizzes, 10 AI
              tutor questions a month and 20 audio plays a day.
            </p>
            <p>
              <strong>Basic — {price("basic_monthly")} a month.</strong> Every published written
              course unit, 300 tutor questions a month, 300 audio plays a day, and translation of
              your own text up to 1,000 characters a request.
            </p>
            <p>
              <strong>Premium — {price("premium_monthly")} a month.</strong> Everything in Basic,
              unmetered audio playback, translation up to 5,000 characters a request, and 3,000
              tutor questions a month as a fair-use ceiling — written down as a number rather
              than advertised as unlimited.
            </p>
            <p>
              The full comparison, including the allowances the server enforces, is on the{" "}
              <Link to="/pricing" className="font-medium underline">
                pricing page
              </Link>
              .
            </p>
          </>
        ),
      },
      {
        q: "What is Annual? Is it a different plan?",
        a: (
          <>
            <p>
              No — it is a way of paying for Premium, not an extra tier. Premium is{" "}
              {price("premium_annual")} a year instead of {price("premium_monthly")} a month,
              which saves {annualSaving("premium_monthly", "premium_annual")} against paying
              monthly twelve times. Basic is monthly only, at {price("basic_monthly")} a month.
            </p>
            <p>
              An annual and a monthly subscriber on the same tier can do exactly the same
              things. Annual is charged once and renews once a year.
            </p>
          </>
        ),
      },
      {
        q: "What currency will I be charged in?",
        a: (
          <>
            <p>
              South African rand, wherever you are. Our payment processor settles to a South
              African account, so rand is the only currency it can charge — there is no dollar
              or euro option to pick, and we show no approximate conversion, because an
              approximation is not a price. The rand figure on the pricing page is the amount
              charged, and a completed payment is checked against that same figure before
              access is granted.
            </p>
            <p>
              Your bank converts it into your own currency at their rate on the day, sometimes
              with a conversion fee of their own. That part is between you and your bank. Any
              card that accepts international payments works.
            </p>
          </>
        ),
      },
      {
        q: "Can I cancel?",
        a: (
          <p>
            Yes, at any time, from the Plan page inside the app. Every paid plan is a
            subscription, so there is always something to cancel and cancelling is the only way
            to stop it renewing. Your plan then runs to the end of the period you have already
            paid for and is not renewed. If you ever buy through Google Play, cancel it in
            Google Play rather than here or it will keep renewing.
          </p>
        ),
      },
      {
        q: "What is the refund policy?",
        a: (
          <>
            <p>
              We do not pro-rate refunds for partial periods — cancelling stops the next renewal
              rather than refunding the current one.
            </p>
            <p>
              Two exceptions, both in the Terms: if we discontinue a paid feature you have
              already paid for, we refund the unused part of your subscription; and if we close
              your account without cause, we refund the unused part of any paid period. Anything
              bought through Google Play is refunded under Google Play's policy, requested there.
            </p>
            <p>
              Billing questions go to{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium underline">
                {SUPPORT_EMAIL}
              </a>
              , answered within two working days.
            </p>
          </>
        ),
      },
    ],
  },
  {
    heading: "Audio and voice",
    items: [
      {
        q: "How does the Amharic audio work?",
        a: (
          <p>
            Lines of Amharic in the course have a speak button that sends the text to a
            text-to-speech host and plays the result. In this build no TTS host is connected, so
            the button tells you it is unavailable instead of playing silence. When it is
            connected, Free gets 20 playbacks a day, Basic 300, and Premium is unmetered.
          </p>
        ),
      },
      {
        q: "Is there a native Amharic voice yet?",
        a: (
          <p>
            No. There is no fine-tuned Amharic voice — the recording corpus it would be trained
            on has not been delivered, so nothing has been trained. Premium is described as
            including a custom voice <em>when it ships</em>; paying today does not switch it on,
            and no screen in the app claims otherwise. The same is true of
            microphone-based speaking feedback: there is no speech recognizer in this build, so
            speaking practice is scored by typed self-check instead.
          </p>
        ),
      },
      {
        q: "How good is the AI tutor?",
        a: (
          <p>
            It is labelled a preview, and that is not modesty — the tutor has not been verified
            line by line, so its Amharic should be read as a draft rather than trusted as a
            teacher. Use it for questions about the course material in English. Where it and the
            written lesson disagree, the lesson is the one to believe.
          </p>
        ),
      },
    ],
  },
  {
    heading: "Devices",
    items: [
      {
        q: "Can I use AmharicAI on the web?",
        a: (
          <p>
            Yes — the web app at amharicai.org is the product, not a preview of it. It works in
            any modern browser, on a desktop or on a phone browser, and your progress lives on
            your account rather than on the device.
          </p>
        ),
      },
      {
        q: "Is there an Android app?",
        a: (
          <p>
            Not yet. A mobile app is built but it is not on Google Play, so there is nothing you
            can install today and we are not posting an APK. Leave your email on the{" "}
            <Link to="/download" className="font-medium underline">
              download page
            </Link>{" "}
            and you will hear once it is actually listed — one email, no newsletter. Until then
            the web app on your phone browser is the same account and the same progress.
          </p>
        ),
      },
    ],
  },
  {
    heading: "Your account and your data",
    items: [
      {
        q: "How do I delete my account and my data?",
        a: (
          <p>
            From the{" "}
            <Link to="/account" className="font-medium underline">
              Account &amp; data
            </Link>{" "}
            page, reachable from the footer of every page without installing anything. It is a
            real deletion, not a flag: the routine erases exactly the records listed in the
            Privacy Policy. You can also request it by writing to{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium underline">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        ),
      },
      {
        q: "How is my personal information protected?",
        a: (
          <p>
            The{" "}
            <Link to="/privacy" className="font-medium underline">
              Privacy Policy
            </Link>{" "}
            lists every category of data stored, why it is kept, who it is shared with, and when
            it is erased — and that list is derived from the database schema itself rather than
            written from memory. Payment card details never reach our servers; the payment
            provider handles them. AmharicAI is published by amharicai.org and is available
            wherever you are; the service is governed by South African law, and the Privacy
            Policy names the responsible party for data-protection purposes.
          </p>
        ),
      },
      {
        q: "How do I contact support?",
        a: (
          <p>
            Email{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium underline">
              {SUPPORT_EMAIL}
            </a>
            . Billing, refunds and plan changes are answered within two working days; the{" "}
            <Link to="/contact" className="font-medium underline">
              contact page
            </Link>{" "}
            lists the response times for everything else. Course corrections are welcome — say
            which lesson and what is wrong with it.
          </p>
        ),
      },
    ],
  },
];

export default function FaqPage() {
  useSeo({
    title: "FAQ — plans, refunds, Amharic audio, Android and your data",
    description:
      "Answers on what AmharicAI teaches, what the Free, Basic, Premium and Annual plans include, cancelling and refunds, offline use, Amharic voice, Android availability, and deleting your account.",
    path: "/faq",
  });

  return (
    <div className="space-y-12">
      <header className="max-w-3xl space-y-4">
        <h1 className="font-display text-3xl font-bold leading-tight md:text-5xl">
          Questions, answered straight
        </h1>
        <TibebRule className="max-w-56" />
        <p className="text-base leading-relaxed text-muted-foreground">
          Including the ones with awkward answers. If what you need is not here, write to{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </header>

      {SECTIONS.map((section) => (
        <section key={section.heading} className="space-y-3">
          <h2 className="font-display text-xl font-bold md:text-2xl">{section.heading}</h2>
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {section.items.map((item) => (
              <details key={item.q} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-medium transition hover:bg-muted/60">
                  <span>{item.q}</span>
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground transition group-open:rotate-180" />
                </summary>
                <div className="space-y-3 px-5 pb-5 text-sm leading-relaxed text-muted-foreground">
                  {item.a}
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}

      <section className="rounded-2xl border border-border bg-card px-6 py-9 text-center">
        <h2 className="font-display text-2xl font-bold">Start with the alphabet</h2>
        <p className="mx-auto mt-2.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Free, no card, does not expire. The fastest way to find out whether this course suits
          you is to do the first unit.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            to="/sign-in"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Create a free account <ArrowRight className="size-4" />
          </Link>
          <Link
            to="/features"
            className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-semibold hover:bg-muted"
          >
            See what works today
          </Link>
        </div>
      </section>
    </div>
  );
}
