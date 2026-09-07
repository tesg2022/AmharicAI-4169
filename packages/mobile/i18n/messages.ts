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
    notWritten: "Not yet written",
    notWrittenBody:
      "This unit is advertised scope only. It has a title and a key phrase — no lessons have been written for it yet.",
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
    notBuilt: "Does not exist yet",
    notConfigured: "Not configured here",
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
    notWritten: "እስካሁን አልተጻፈም",
    notWrittenBody:
      "ይህ ምዕራፍ ርዕስና ቁልፍ ሐረግ ብቻ አለው። ትምህርቶቹ እስካሁን አልተጻፉም።",
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
    notBuilt: "እስካሁን የለም",
    notConfigured: "አልተዘጋጀም",
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
