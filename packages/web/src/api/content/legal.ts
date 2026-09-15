/**
 * The legal and company documents: privacy policy, terms of service, about,
 * and the contact details.
 *
 * These live on the server rather than in each client's source for two
 * reasons. The first is that Google Play requires the policy shown in the app
 * to match the policy at the listing URL, and two hand-copied versions drift.
 * The second is that a policy change must reach installed apps immediately —
 * an Android release takes days to roll out, and "we updated our terms, please
 * upgrade" is not a lawful way to give notice.
 *
 * Everything stated here is checked against what the code actually does. The
 * data-collection table is derived from the real schema (see
 * `entitlements/erasure.ts`, which deletes exactly these tables), and the
 * sub-processor list is the set of services the server actually calls. If a
 * new provider is added, it is added here in the same commit — an accurate
 * policy is a compliance requirement, not a formality.
 */

import { BILLING_OPTIONS, formatZar } from "./plans";

/**
 * Bump whenever a material change is made, and set `effective` to that day.
 * The client compares this against the version the user last accepted, so a
 * bump is what re-prompts them.
 */
export const POLICY_VERSION = "2026-09-12";

export const OPERATOR = {
  /** The natural person who publishes the app — the Play developer account. */
  legalName: "Tesfaye Tessema Gintamo",
  tradingAs: "AmharicAI",
  brand: "AmharicAI",
  website: "https://amharicai.org",
  supportEmail: "admin@amharicai.org",
  /** Deletion and access requests. Same inbox today; separated so it can move. */
  privacyEmail: "admin@amharicai.org",
  /**
   * A general location, deliberately not a street address.
   *
   * Google Play requires a street-level address on the *developer account*,
   * which is entered in the Play Console and is a different thing from this.
   * Publishing an invented or approximated street address here would be worse
   * than publishing none, so this field is named `location` — not `address` —
   * so that no page can render it under a "Postal address" heading by
   * assuming it is one.
   */
  location: "Cape Town, South Africa",
  jurisdiction: "Republic of South Africa",
  /** Under this age an account may not be created. Drives the Play age rating. */
  minimumAge: 13,
} as const;

export type LegalSlug = "privacy" | "terms" | "about" | "contact";

export interface LegalSection {
  heading: string;
  /** Paragraphs, rendered in order. Plain text — no markup to sanitise. */
  body?: string[];
  /** Optional bullet list rendered after the paragraphs. */
  bullets?: string[];
  /** Optional simple table: header row plus data rows. */
  table?: { columns: string[]; rows: string[][] };
}

export interface LegalDocument {
  slug: LegalSlug;
  title: string;
  /** One-line summary, used as the page subtitle and the meta description. */
  summary: string;
  version: string;
  effective: string;
  sections: LegalSection[];
}

const EFFECTIVE = "12 September 2026";

const TERM_SUFFIX: Record<string, string> = {
  monthly: "",
  annual: " Annual",
  lifetime: " Lifetime",
};

const TERM_BILLING: Record<string, string> = {
  monthly: "Monthly, renews until cancelled",
  annual: "Yearly, renews until cancelled",
  lifetime: "One payment, no renewal",
};

/**
 * The price table in the Terms, built from the price list rather than typed out.
 *
 * It was typed out, and it went stale: it still promised "Basic $4.99" and
 * "Premium Lifetime $149" after billing moved to rand, in the one document a
 * customer can hold us to. A contractual price that disagrees with the price
 * charged is the worst kind of drift, so this table now cannot disagree with
 * checkout — both read `BILLING_OPTIONS`.
 */
const PRICE_TABLE: { columns: string[]; rows: string[][] } = {
  columns: ["Plan", "Price (ZAR)", "Billing"],
  rows: [
    ["Free", formatZar(0), "No payment, no card"],
    ...BILLING_OPTIONS.map((option): string[] => [
      option.plan === "basic" ? "Basic" : `Premium${TERM_SUFFIX[option.term] ?? ""}`,
      formatZar(option.price_zar),
      TERM_BILLING[option.term] ?? "",
    ]),
  ],
};

/** What the server stores, why, and how long — the heart of the policy. */
const DATA_TABLE: LegalSection = {
  heading: "What we collect, and why",
  body: [
    "This is the complete list. It is derived from the database schema itself, and the account deletion routine deletes exactly these records.",
  ],
  table: {
    columns: ["Data", "Why we hold it", "Kept until"],
    rows: [
      [
        "Your name, email address and sign-in credentials",
        "To create your account, sign you in, and recover access. Passwords are stored only as a one-way hash — we cannot read them.",
        "You delete your account",
      ],
      [
        "Lesson progress, XP, streaks, quiz answers and flashcard schedules",
        "To show you where you are in the course and to schedule revision at the right time.",
        "You delete your account",
      ],
      [
        "Your conversations with the AI tutor",
        "So the tutor remembers the thread of a lesson and so you can read back what you practised.",
        "You delete your account, or you clear the conversation",
      ],
      [
        "Pronunciation attempt scores and the transcript of what was recognised",
        "To score your speaking and show improvement over time. The recording itself is never written to disk — it is streamed to the recogniser and discarded.",
        "You delete your account",
      ],
      [
        "Counts of tutor questions and audio playbacks you have used",
        "To enforce the free-tier allowance and to keep our AI costs predictable. Counts only — never the content of what you asked.",
        "The period ends, or you delete your account",
      ],
      [
        "Your subscription tier and its expiry date",
        "To unlock what you have paid for. We never see or store your card details.",
        "You delete your account",
      ],
      [
        "A one-way hash of the IP address of signed-out visitors",
        "To stop the free trial being reset by signing out. The hash is salted with a server secret, so the address cannot be recovered from it.",
        "The end of the calendar month",
      ],
    ],
  },
};

const PRIVACY: LegalDocument = {
  slug: "privacy",
  title: "Privacy Policy",
  summary:
    "What AmharicAI stores about you, who it is shared with, and how to get all of it deleted.",
  version: POLICY_VERSION,
  effective: EFFECTIVE,
  sections: [
    {
      heading: "In short",
      bullets: [
        "We store your account, your progress through the course, and your tutor conversations. Nothing else.",
        "We do not sell your data, and we do not share it for advertising.",
        "Your pronunciation recordings are never saved. They are transcribed and discarded.",
        "You can delete your account, and everything in it, from inside the app. It is a real deletion, not a flag.",
        `Questions, or a data request: ${OPERATOR.privacyEmail}.`,
      ],
    },
    {
      heading: "Who we are",
      body: [
        `${OPERATOR.brand} is developed and operated by ${OPERATOR.legalName} ("we," "us," or "our"), operating under the brand name ${OPERATOR.tradingAs}.`,
        `For the purposes of the Protection of Personal Information Act, 2013 (POPIA) and the EU/UK General Data Protection Regulation, we are the responsible party and data controller for the information described here.`,
        `Privacy and data requests: ${OPERATOR.privacyEmail}. Location: ${OPERATOR.location}.`,
      ],
    },
    DATA_TABLE,
    {
      heading: "What we do not collect",
      body: [
        "Stating this plainly, because these are the things learning apps are usually assumed to take:",
      ],
      bullets: [
        "No audio recordings. Speaking practice is transcribed in the moment; the audio is never stored by us.",
        "No contacts, photos, files, calendar or location data. The app never asks for those permissions.",
        "No advertising identifiers, no ad networks, and no cross-app tracking.",
        "No card numbers. Payment details are entered on our payment provider's page and never reach our servers.",
      ],
    },
    {
      heading: "The legal basis for using your data",
      body: [
        "Under GDPR terms: we process your account and progress data to perform the contract you entered into when you created an account; we process usage counts and security data under our legitimate interest in keeping the service running and affordable; and we process anything else only with your consent, which you can withdraw at any time.",
        "Under POPIA: processing is necessary to carry out the service you asked for, and is limited to what that purpose requires.",
      ],
    },
    {
      heading: "Who else touches your data",
      body: [
        "We use a small number of sub-processors to run the service. Each receives only what it needs to do its job, and none of them is permitted to use your data for their own purposes.",
      ],
      table: {
        columns: ["Service", "What it receives", "Why"],
        rows: [
          [
            "Anthropic (via our AI gateway)",
            "The text of your tutor questions and the relevant course material",
            "To generate the tutor's reply. Sent per message, not used to train their models under our API terms.",
          ],
          [
            "Turso",
            "The database described above",
            "Managed database hosting.",
          ],
          [
            "Paystack",
            "Your name and email address, and an internal account reference; your card details are entered on Paystack's own payment page and never reach us",
            "To take subscription and one-off payments, and to tell us which plan you are on. Paystack is a licensed payment processor; prices are charged in South African rand.",
          ],
          [
            "Our speech provider, where native audio is enabled",
            "The Amharic text to be spoken, or the audio of a pronunciation attempt",
            "To produce native audio and to transcribe speaking practice. No account identifier is attached to the request, and the audio is not retained by us.",
          ],
          [
            "One Dollar Stats",
            "Anonymous page-view counts",
            "To see which parts of the course are used. No cookies, no personal identifiers, no cross-site profile.",
          ],
        ],
      },
    },
    {
      heading: "Where your data is held, and cross-border transfers",
      body: [
        "Our database and the services above are operated from data centres outside South Africa, including in the European Union and the United States. Section 72 of POPIA and Chapter V of the GDPR permit this where the recipient is bound to a comparable level of protection; each of our sub-processors is bound by a data processing agreement with standard contractual clauses to that effect.",
      ],
    },
    {
      heading: "How long we keep things",
      body: [
        "Your account data is kept for as long as your account exists. When you delete your account we erase it as described below.",
        "Two things outlive the account, deliberately. The first is the audit record of the deletion itself — an opaque account identifier, a timestamp, and a count of how many rows were removed from each table. It contains no personal data and exists so we can prove a deletion was carried out. The second is the synthesised Amharic audio cache, which is keyed by the text that was spoken and shared across all learners; it contains no learner data of any kind.",
      ],
    },
    {
      heading: "Deleting your account",
      body: [
        "You can delete your account from Account settings in the app, or by emailing us. Deletion removes your profile, your credentials, your progress, your tutor conversations, your speaking attempts, your usage counters and your active sessions — the rows are deleted, not marked as hidden.",
        `We offer a 7-day grace period so that a deletion made in frustration can be undone; you can also choose to delete immediately, and we will not make you wait. Once it completes it cannot be reversed, and we cannot restore your progress.`,
        `If you ask us by email at ${OPERATOR.privacyEmail} instead, we will complete the deletion within 30 days and confirm when it is done.`,
      ],
    },
    {
      heading: "Your rights",
      body: [
        "Wherever you live, you can ask us to give you a copy of your data, correct it, delete it, or restrict what we do with it, and you can object to processing based on legitimate interest. Write to us and we will respond within 30 days.",
        "If you are in South Africa and you believe we have mishandled your information, you may complain to the Information Regulator (South Africa). If you are in the EU or the UK, you may complain to your national supervisory authority. We would rather you told us first, but you are not obliged to.",
      ],
    },
    {
      heading: "Children",
      body: [
        `${OPERATOR.brand} is intended for users aged ${OPERATOR.minimumAge} and older. Users under ${OPERATOR.minimumAge} may not create an account or use account-based services.`,
        `If you believe a child has created an account, tell us at ${OPERATOR.privacyEmail} and we will delete it and its data.`,
      ],
    },
    {
      heading: "Security",
      body: [
        "Traffic to the app is encrypted in transit. Passwords are stored as salted one-way hashes. Access to the production database is limited to the operator. Anonymous visitors' IP addresses are hashed with a server-side secret before they are written anywhere.",
        "No service is perfectly secure. If a breach affects your personal information we will notify you and the Information Regulator as POPIA requires, without undue delay.",
      ],
    },
    {
      heading: "Changes to this policy",
      body: [
        `This policy is versioned. The current version is ${POLICY_VERSION}, effective ${EFFECTIVE}. Material changes will be announced in the app before they take effect, and the app reads this policy from our servers so what you see here is always current.`,
      ],
    },
  ],
};

const TERMS: LegalDocument = {
  slug: "terms",
  title: "Terms of Service",
  summary: "The agreement between you and AmharicAI: what you get, what it costs, and the rules.",
  version: POLICY_VERSION,
  effective: EFFECTIVE,
  sections: [
    {
      heading: "Agreement",
      body: [
        `${OPERATOR.brand} is developed and operated by ${OPERATOR.legalName} ("we," "us," or "our"), operating under the brand name ${OPERATOR.tradingAs}. These terms are between you and us. By creating an account or using the app you accept them. If you do not accept them, do not use the service.`,
        `${OPERATOR.brand} is intended for users aged ${OPERATOR.minimumAge} and older. Users under ${OPERATOR.minimumAge} may not create an account or use account-based services.`,
      ],
    },
    {
      heading: "What the service is",
      body: [
        "AmharicAI teaches beginner Amharic: a structured course, the ፊደል syllabary, pronunciation practice, spaced-repetition flashcards, and an AI tutor.",
        "The AI tutor is a language model. It is grounded in the course material and it is usually right, but it can be wrong about grammar, spelling or cultural detail. It is a study aid, not a certified teacher, an interpreter, or a source of professional advice.",
      ],
    },
    {
      heading: "Your account",
      bullets: [
        "Keep your password to yourself. You are responsible for what happens under your account.",
        "One account per person. Sharing an account or a paid plan between people is not permitted.",
        "Give us an email address you can actually receive mail at — it is how we reach you about your account.",
        "Tell us promptly if you think someone else has got into your account.",
      ],
    },
    {
      heading: "Plans, prices and payment",
      body: [
        "The free plan is genuinely free and has monthly limits on AI tutor questions and native audio playback. Paid plans raise or remove those limits.",
        "All prices are in South African rand (ZAR) and every charge is taken in rand, because our payment provider settles to a South African account. Where we show an approximate amount in another currency it is a convenience conversion and is marked as approximate: it is not the amount charged, and your bank sets its own exchange rate and may add its own conversion fee.",
        "Subscriptions renew automatically at the end of each period until you cancel. A lifetime purchase is a single payment that grants Premium access for as long as the service operates.",
      ],
      table: PRICE_TABLE,
    },
    {
      heading: "Cancelling and refunds",
      bullets: [
        "You can cancel at any time. Your plan then runs to the end of the period you have already paid for, and is not renewed.",
        "We do not pro-rate refunds for partial periods.",
        "If you bought through Google Play, refunds are handled under Google Play's refund policy and you should request them there.",
        "If something is broken on our side and you did not get what you paid for, write to us — we will sort it out rather than hide behind this clause.",
        "Where the law of your country gives you a cooling-off right, that right stands, whatever this section says.",
      ],
    },
    {
      heading: "Fair use of the AI tutor",
      body: [
        "Plans marked as unlimited are subject to fair use. We meter tutor questions and audio playback to keep the service affordable; if one account's usage is so far beyond normal study that it looks automated, we may contact you and, if it continues, apply a limit. We will always tell you before we do.",
      ],
    },
    {
      heading: "What you may not do",
      bullets: [
        "Resell, redistribute or republish the course content — it is licensed to you for your own study.",
        "Use the app to break the law, to harass anyone, or to generate abusive or illegal material through the tutor.",
        "Scrape the service, automate access to it, or try to bypass the usage limits or the paywall.",
        "Reverse-engineer the service, or probe it for vulnerabilities without asking us first. If you find one, tell us — we will thank you.",
      ],
    },
    {
      heading: "Content and ownership",
      body: [
        "The course material, the software and the AmharicAI name belong to us or to our licensors. Your account gets a personal, non-transferable licence to use them for study.",
        "What you write stays yours. You grant us only the licence we need to run the service: to store your messages, to send them to the AI provider to get a reply, and to show them back to you.",
      ],
    },
    {
      heading: "Availability",
      body: [
        "We aim to keep the app running but we do not promise uninterrupted service. We may take it down for maintenance, and features may change as the course develops. If we discontinue a paid feature you have already paid for, we will refund the unused part of your subscription.",
      ],
    },
    {
      heading: "Liability",
      body: [
        "The service is provided as it is. To the fullest extent the law allows, we are not liable for indirect or consequential loss, and our total liability to you is limited to what you paid us in the twelve months before the claim.",
        "Nothing in these terms limits liability that cannot lawfully be limited, including under the Consumer Protection Act, 2008 where it applies to you.",
      ],
    },
    {
      heading: "Ending the agreement",
      body: [
        "You may stop using the service and delete your account at any time. We may suspend or close an account that breaches these terms, and we will tell you why unless the law prevents us. If we close your account without cause, we refund the unused part of any paid period.",
      ],
    },
    {
      heading: "Governing law",
      body: [
        `These Terms of Service are governed by the laws of the ${OPERATOR.jurisdiction}, and the courts of South Africa have jurisdiction over any dispute. This does not deprive you of the protection of mandatory consumer law in the country where you live.`,
      ],
    },
    {
      heading: "Changes",
      body: [
        `We may update these terms. The current version is ${POLICY_VERSION}, effective ${EFFECTIVE}. If a change is material we will tell you in the app before it takes effect; continuing to use the service after that means you accept it.`,
        `Questions about these terms: ${OPERATOR.supportEmail}.`,
      ],
    },
  ],
};

const ABOUT: LegalDocument = {
  slug: "about",
  title: "About AmharicAI",
  summary: "Why this exists, who makes it, and how the course is put together.",
  version: POLICY_VERSION,
  effective: EFFECTIVE,
  sections: [
    {
      heading: "Why this exists",
      body: [
        "Amharic is spoken by more than thirty million people and taught to almost none of them abroad. Learners in the diaspora are handed a photocopied grammar and a YouTube playlist and told to get on with it. There is no Duolingo for Amharic, and the apps that do exist tend to be flashcard decks with the vowels wrong.",
        "AmharicAI is a proper beginner course: the ፊደል syllabary taught as a system rather than a wall of 231 characters, dialogues you can hear and repeat, and a tutor that answers the question you actually asked at two in the morning.",
      ],
    },
    {
      heading: "How the course is built",
      body: [
        "The material follows a six-unit beginner syllabus — pronunciation and the ፊደል, greetings, introducing yourself, introducing others, verbs, and shopping. It is kept verbatim from its source: where the source book writes a word a particular way, we render it that way rather than silently correcting it, and where our own editors flagged a question we show the flag instead of hiding it.",
        "Every Amharic item is given in three layers — the script, a transliteration, and the English gloss — because learners who only ever read transliteration never learn to read.",
      ],
    },
    {
      heading: "About the AI tutor",
      body: [
        "The tutor is a language model that looks words, lessons and verb paradigms up in the course database before it answers, so the spellings it gives you match the material you are studying. When you ask about something outside the course it says so rather than inventing a page reference.",
        "It is a study aid. It will occasionally be wrong, and the course material, not the tutor, is the authority.",
      ],
    },
    {
      heading: "Who makes it",
      body: [
        `${OPERATOR.brand} is developed and operated by ${OPERATOR.legalName} ("we," "us," or "our"), operating under the brand name ${OPERATOR.tradingAs}, from ${OPERATOR.location}. It is a small independent project rather than a company with a support department, which means the person who reads your email is the person who can fix the bug.`,
      ],
    },
    {
      heading: "What is coming",
      body: [
        "Native recorded audio across the whole course, speech recognition tuned for Amharic rather than a generic model, and intermediate units beyond the beginner syllabus. These are marked as coming soon in the app rather than shipped half-working.",
      ],
    },
  ],
};

const CONTACT: LegalDocument = {
  slug: "contact",
  title: "Contact",
  summary: "How to reach a human about AmharicAI.",
  version: POLICY_VERSION,
  effective: EFFECTIVE,
  sections: [
    {
      heading: "Email us",
      body: [
        `Everything goes to ${OPERATOR.supportEmail} and is read by a person. There is no ticket queue and no chatbot in front of it.`,
      ],
      table: {
        columns: ["What you need", "Where to write", "Typical reply"],
        rows: [
          ["Help with the app, a bug, a wrong lesson", OPERATOR.supportEmail, "Within 2 working days"],
          ["Billing, refunds, changing your plan", OPERATOR.supportEmail, "Within 2 working days"],
          ["Delete my data, or send me a copy of it", OPERATOR.privacyEmail, "Within 30 days, usually far sooner"],
          ["Security issue or vulnerability", OPERATOR.privacyEmail, "Within 1 working day"],
        ],
      },
    },
    {
      heading: "Reporting something wrong in the course",
      body: [
        "If a translation, a transliteration or a fidel is wrong, tell us which lesson and what it should be. Corrections from native speakers are the single most useful thing anyone sends us, and they get applied to the source material rather than patched over.",
      ],
    },
    {
      heading: "Who you are writing to",
      body: [
        `${OPERATOR.brand} is developed and operated by ${OPERATOR.legalName} ("we," "us," or "our"), operating under the brand name ${OPERATOR.tradingAs}.`,
        `Email: ${OPERATOR.supportEmail}`,
        `Privacy and data requests: ${OPERATOR.privacyEmail}`,
        `Location: ${OPERATOR.location}`,
        "We are an email-first project and have no public walk-in or postal office. Email reaches us; post does not.",
      ],
    },
    {
      heading: "Before you write about your account",
      bullets: [
        "Deleting your account: you can do it yourself, immediately, from Account settings — you do not need to email us.",
        "Cancelling a subscription bought in the app: manage it from the Plan page.",
        "Cancelling a subscription bought through Google Play: cancel it in Google Play, not here, or it will keep renewing.",
      ],
    },
  ],
};

export const LEGAL_DOCUMENTS: Record<LegalSlug, LegalDocument> = {
  privacy: PRIVACY,
  terms: TERMS,
  about: ABOUT,
  contact: CONTACT,
};

export const LEGAL_INDEX = (Object.values(LEGAL_DOCUMENTS) as LegalDocument[]).map((d) => ({
  slug: d.slug,
  title: d.title,
  summary: d.summary,
}));
