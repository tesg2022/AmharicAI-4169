import type { Locale } from "@/lib/preview-plan";

/**
 * UI strings for the English/Amharic switcher.
 *
 * Hand-written, no i18n dependency — the string set is small and adding a
 * runtime library for it would be more moving parts than the feature needs.
 * Amharic strings here are UI chrome only; course content is never translated
 * by this table, it comes from the source-faithful generated course.
 */

export const MESSAGES = {
  en: {
    course: "Course",
    courseSubtitle: "The 20-unit map",
    lessons: "lessons",
    lesson: "Lesson",
    unit: "Unit",
    written: "Written",
    notWritten: "Coming soon",
    notWrittenBody:
      "Coming soon — not yet written. This unit is advertised scope only: it has a title and a key phrase, and no lessons have been written for it yet. It is not locked and no plan unlocks it; there is nothing behind it yet.",
    planRequired: "Included from the Learner plan",
    upgrade: "See plans",
    pricing: "Plans",
    pricingSubtitle: "What each plan includes — and what does not exist yet",
    translate: "Translate",
    translateSubtitle: "Free text, English and Amharic",
    translateGate: "Translating your own text is included from the Learner plan.",
    translateCta: "Translate",
    translatePlaceholder: "Type the text to translate",
    plan: "Plan",
    preview: "preview",
    previewNote:
      "The plan is a preview switch on this device, not a subscription. There are no accounts in this build.",
    granted: "Included",
    notIncluded: "Not included",
    stateLegend:
      "Available means it works now. Preview means it is built but not verified end to end — treat the output as a draft. Coming soon means it does not exist in this build; no plan unlocks it. Not configured means the code exists but this deployment has no key or host for it. Needs a higher plan means it exists and your plan does not include it.",
    // Prefixed onto a capability caveat when the plan is what blocks the
    // feature, so "needs a higher plan" is never read as "upgrading fixes it".
    evenThen: "Even on a higher plan:",
    progressNotTracked: "Progress is not tracked",
    progressNotTrackedBody:
      "This build has no accounts and stores nothing about you, so there are no completions, scores or streaks to show. An empty list here is not zero progress — nothing is being recorded at all.",
    perMonth: "/month",
    choose: "Choose",
    current: "Current preview plan",
    objectives: "What you should be able to do",
    source: "Source",
    page: "p.",
    prev: "Previous",
    next: "Next",
    qaWarnings: "content checks",
    language: "አማርኛ",
    retry: "Retry",
  },
  am: {
    course: "ኮርስ",
    courseSubtitle: "የ20 ምዕራፍ ዝርዝር",
    lessons: "ትምህርቶች",
    lesson: "ትምህርት",
    unit: "ምዕራፍ",
    written: "ተጽፏል",
    notWritten: "በቅርቡ ይመጣል",
    notWrittenBody:
      "በቅርቡ ይመጣል — እስካሁን አልተጻፈም። ይህ ምዕራፍ ርዕስና ቁልፍ ሐረግ ብቻ አለው፤ ትምህርቶቹ እስካሁን አልተጻፉም። አልተቆለፈም፤ የሚከፍተው ዕቅድም የለም — እስካሁን ከኋላው ምንም የለም።",
    planRequired: "ከተማሪ ዕቅድ ጀምሮ ይካተታል",
    upgrade: "ዕቅዶችን ይመልከቱ",
    pricing: "ዕቅዶች",
    pricingSubtitle: "እያንዳንዱ ዕቅድ የያዘው — እና እስካሁን የሌለው",
    translate: "ተርጉም",
    translateSubtitle: "ነጻ ጽሑፍ፣ እንግሊዝኛና አማርኛ",
    translateGate: "የራስዎን ጽሑፍ መተርጎም ከተማሪ ዕቅድ ጀምሮ ይካተታል።",
    translateCta: "ተርጉም",
    translatePlaceholder: "የሚተረጎመውን ጽሑፍ ይጻፉ",
    plan: "ዕቅድ",
    preview: "ቅድመ-ዕይታ",
    previewNote:
      "ዕቅዱ በዚህ መሣሪያ ላይ የቅድመ-ዕይታ ማብሪያ ነው፣ ክፍያ የተከፈለበት አይደለም። በዚህ ግንባታ ውስጥ መለያዎች የሉም።",
    granted: "ተካትቷል",
    notIncluded: "አልተካተተም",
    stateLegend:
      "«ይሠራል» ማለት አሁን ይሠራል። «በቅድመ እይታ» ማለት ተገንብቷል ግን ሙሉ በሙሉ አልተፈተነም፤ ውጤቱን እንደ ረቂቅ ይያዙት። «በቅርቡ ይመጣል» ማለት በዚህ ግንባታ ውስጥ የለም፤ የሚከፍተው ዕቅድም የለም። «አልተዘጋጀም» ማለት ኮዱ አለ ግን ለዚህ ማሰማራት ቁልፍ ወይም አገልጋይ አልተሰጠም። «ከፍ ያለ ዕቅድ ያስፈልጋል» ማለት ነገሩ አለ ግን ዕቅድዎ አልያዘውም።",
    evenThen: "በከፍ ያለ ዕቅድም እንኳ፦",
    progressNotTracked: "እድገት አይመዘገብም",
    progressNotTrackedBody:
      "በዚህ ግንባታ ውስጥ መለያዎች የሉም፤ ስለ እርስዎ ምንም አይቀመጥም። በመሆኑም የተጠናቀቁ ትምህርቶች፣ ነጥቦች ወይም ተከታታይ ቀናት አይታዩም። ባዶ መሆኑ ዜሮ እድገት ማለት አይደለም — ምንም አይመዘገብም።",
    perMonth: "/ወር",
    choose: "ይምረጡ",
    current: "የአሁኑ የቅድመ-ዕይታ ዕቅድ",
    objectives: "ማድረግ የሚችሉት",
    source: "ምንጭ",
    page: "ገጽ",
    prev: "ቀዳሚ",
    next: "ቀጣይ",
    qaWarnings: "የይዘት ምልከታዎች",
    language: "English",
    retry: "እንደገና ሞክር",
  },
} as const;

export type MessageKey = keyof (typeof MESSAGES)["en"];

export function t(locale: Locale, key: MessageKey): string {
  return MESSAGES[locale][key];
}
