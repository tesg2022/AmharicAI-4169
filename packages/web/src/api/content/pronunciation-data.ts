/**
 * Amharic Pronunciation for English Speakers
 * ለእንግሊዝኛ ተናጋሪዎች የአማርኛ አነባበብ
 *
 * The teaching point this module exists for: an English speaker told "ጠ = ta"
 * learns the wrong sound. ጠ is an EJECTIVE — made with a closed glottis and a
 * popped release — and it is a different consonant from ተ, not an accent on it.
 * Every ejective here is therefore paired with its plain counterpart so the
 * learner drills the contrast rather than collapsing the two.
 *
 * Each sound carries: English approximation, IPA, mouth/throat position, the
 * seven-order Fidel family, and real example words. Audio is spoken by the
 * app's TTS layer, so no audio files are stored here.
 */

export type SoundClass =
  | "vowel"
  | "plain"
  | "ejective"
  | "palatal"
  | "labiovelar";

export interface ExampleWord {
  amharic: string;
  transliteration: string;
  english: string;
}

export interface PronunciationSound {
  id: string;
  /** Base (1st-order) Fidel character. */
  fidel: string;
  /** The seven-order family, for listen-and-repeat. */
  family: string;
  roman: string;
  ipa: string;
  soundClass: SoundClass;
  /** Short label, e.g. "ejective t". */
  label: string;
  englishApprox: string;
  /** The trap an English speaker falls into. Null when there is no trap. */
  warning: string | null;
  mouthPosition: string;
  /** id of the plain counterpart this sound contrasts with. */
  contrastWith: string | null;
  examples: ExampleWord[];
  sortOrder: number;
}

/* ------------------------------------------------------------------ vowels */

export const VOWEL_ORDERS: PronunciationSound[] = [
  {
    id: "v1",
    fidel: "ለ",
    family: "ለ ሉ ሊ ላ ሌ ል ሎ",
    roman: "ä",
    ipa: "ə",
    soundClass: "vowel",
    label: "1st order — ግዕዝ",
    englishApprox: "The unstressed vowel in 'above' or 'sofa'. Short and neutral.",
    warning:
      "Do not stretch this into the 'a' of 'father'. It is the shortest vowel in the language and English speakers routinely over-open it.",
    mouthPosition:
      "Mouth barely open, tongue resting flat in the middle of the mouth. No lip rounding, no effort.",
    contrastWith: null,
    examples: [
      { amharic: "ለምን", transliteration: "lämïn", english: "why" },
      { amharic: "ሰላም", transliteration: "sälam", english: "hello / peace" },
    ],
    sortOrder: 1,
  },
  {
    id: "v2",
    fidel: "ሉ",
    family: "ሉ ሙ ሱ ቡ ቱ ኩ ዉ",
    roman: "u",
    ipa: "u",
    soundClass: "vowel",
    label: "2nd order — ካዕብ",
    englishApprox: "As in 'mood' and 'food'.",
    warning: null,
    mouthPosition: "Tongue high and back, lips firmly rounded and pushed forward.",
    contrastWith: null,
    examples: [
      { amharic: "ሱቅ", transliteration: "suq", english: "shop" },
      { amharic: "ቡና", transliteration: "buna", english: "coffee" },
    ],
    sortOrder: 2,
  },
  {
    id: "v3",
    fidel: "ሊ",
    family: "ሊ ሚ ሲ ቢ ቲ ኪ ዊ",
    roman: "i",
    ipa: "i",
    soundClass: "vowel",
    label: "3rd order — ሣልስ",
    englishApprox: "As in 'heat' and 'feet'.",
    warning: null,
    mouthPosition: "Tongue high and forward, lips spread as in a smile.",
    contrastWith: null,
    examples: [
      { amharic: "ሲጋራ", transliteration: "sigara", english: "cigarette" },
      { amharic: "ቢላ", transliteration: "bila", english: "knife" },
    ],
    sortOrder: 3,
  },
  {
    id: "v4",
    fidel: "ላ",
    family: "ላ ማ ሳ ባ ታ ካ ዋ",
    roman: "a",
    ipa: "a",
    soundClass: "vowel",
    label: "4th order — ራብዕ",
    englishApprox: "As in 'father' — open and clear.",
    warning: null,
    mouthPosition: "Jaw dropped, mouth wide open, tongue low and flat.",
    contrastWith: null,
    examples: [
      { amharic: "ማር", transliteration: "mar", english: "honey" },
      { amharic: "ዋጋ", transliteration: "waga", english: "price" },
    ],
    sortOrder: 4,
  },
  {
    id: "v5",
    fidel: "ሌ",
    family: "ሌ ሜ ሴ ቤ ቴ ኬ ዌ",
    roman: "e",
    ipa: "e",
    soundClass: "vowel",
    label: "5th order — ኃምስ",
    englishApprox: "As in 'gate' and 'way', but held steady.",
    warning:
      "English 'gate' glides into a 'y' sound at the end. Amharic e does not glide — hold one steady vowel.",
    mouthPosition: "Tongue mid-high and forward, lips slightly spread, jaw still.",
    contrastWith: null,
    examples: [
      { amharic: "ቤት", transliteration: "bet", english: "house" },
      { amharic: "ዴሴት", transliteration: "deset", english: "island" },
    ],
    sortOrder: 5,
  },
  {
    id: "v6",
    fidel: "ል",
    family: "ል ም ስ ብ ት ክ ው",
    roman: "ï",
    ipa: "ɨ",
    soundClass: "vowel",
    label: "6th order — ሳድስ",
    englishApprox:
      "A very short central vowel, close to the 'i' in 'roses'. Often almost silent between consonants.",
    warning:
      "This order frequently carries no vowel at all — the consonant simply closes the syllable, as in ብር (bïr). Do not insert a full English vowel.",
    mouthPosition:
      "Mouth nearly closed, tongue central and relaxed. The shortest, weakest vowel of the seven.",
    contrastWith: null,
    examples: [
      { amharic: "ብር", transliteration: "bïr", english: "birr (currency)" },
      { amharic: "ስም", transliteration: "sïm", english: "name" },
    ],
    sortOrder: 6,
  },
  {
    id: "v7",
    fidel: "ሎ",
    family: "ሎ ሞ ሶ ቦ ቶ ኮ ዎ",
    roman: "o",
    ipa: "o",
    soundClass: "vowel",
    label: "7th order — ሳብዕ",
    englishApprox: "As in 'motor' and 'hope', held steady.",
    warning: "Like e, do not let it glide into a 'w' the way English 'hope' does.",
    mouthPosition: "Tongue mid-high and back, lips rounded but relaxed.",
    contrastWith: null,
    examples: [
      { amharic: "ሆድ", transliteration: "hod", english: "stomach" },
      { amharic: "ሾርባ", transliteration: "šorba", english: "soup" },
    ],
    sortOrder: 7,
  },
];

/* -------------------------------------------------------- plain consonants */
/* These exist so each ejective has a counterpart to drill against. */

export const PLAIN_CONSONANTS: PronunciationSound[] = [
  {
    id: "c-t",
    fidel: "ተ",
    family: "ተ ቱ ቲ ታ ቴ ት ቶ",
    roman: "t",
    ipa: "t",
    soundClass: "plain",
    label: "ordinary t",
    englishApprox: "The 't' of 'stop' — plain, unaspirated.",
    warning: null,
    mouthPosition:
      "Tongue tip on the ridge behind the top teeth. Throat open and relaxed; air flows straight from the lungs.",
    contrastWith: "c-te",
    examples: [
      { amharic: "ተማሪ", transliteration: "tämari", english: "student" },
      { amharic: "ትናንት", transliteration: "tïnant", english: "yesterday" },
    ],
    sortOrder: 10,
  },
  {
    id: "c-k",
    fidel: "ከ",
    family: "ከ ኩ ኪ ካ ኬ ክ ኮ",
    roman: "k",
    ipa: "k",
    soundClass: "plain",
    label: "ordinary k",
    englishApprox: "The 'k' of 'skin' — plain, unaspirated.",
    warning: null,
    mouthPosition:
      "Back of the tongue against the soft palate. Throat open, air from the lungs.",
    contrastWith: "c-ke",
    examples: [
      { amharic: "ከተማ", transliteration: "kätäma", english: "city" },
      { amharic: "ካልሲ", transliteration: "kalsi", english: "socks" },
    ],
    sortOrder: 11,
  },
  {
    id: "c-p",
    fidel: "ፐ",
    family: "ፐ ፑ ፒ ፓ ፔ ፕ ፖ",
    roman: "p",
    ipa: "p",
    soundClass: "plain",
    label: "ordinary p",
    englishApprox: "The 'p' of 'spin' — plain, unaspirated.",
    warning: null,
    mouthPosition: "Both lips closed, then released. Throat open and relaxed.",
    contrastWith: "c-pe",
    examples: [
      { amharic: "ፖሊስ", transliteration: "polis", english: "police" },
      { amharic: "ፓስታ", transliteration: "pasta", english: "pasta" },
    ],
    sortOrder: 12,
  },
  {
    id: "c-s",
    fidel: "ሰ",
    family: "ሰ ሱ ሲ ሳ ሴ ስ ሶ",
    roman: "s",
    ipa: "s",
    soundClass: "plain",
    label: "ordinary s",
    englishApprox: "The 's' of 'see'.",
    warning: null,
    mouthPosition:
      "Tongue tip near the ridge behind the top teeth, narrow channel, continuous airflow.",
    contrastWith: "c-tse",
    examples: [
      { amharic: "ሰላም", transliteration: "sälam", english: "hello / peace" },
      { amharic: "ሱሪ", transliteration: "suri", english: "trousers" },
    ],
    sortOrder: 13,
  },
  {
    id: "c-ch",
    fidel: "ቸ",
    family: "ቸ ቹ ቺ ቻ ቼ ች ቾ",
    roman: "č",
    ipa: "t͡ʃ",
    soundClass: "plain",
    label: "ordinary ch",
    englishApprox: "The 'ch' of 'church'.",
    warning: null,
    mouthPosition:
      "Tongue blade against the roof of the mouth, released into a 'sh'. Throat open.",
    contrastWith: "c-che",
    examples: [
      { amharic: "ቻይና", transliteration: "čayna", english: "China" },
      { amharic: "ችግር", transliteration: "čïgïr", english: "problem" },
    ],
    sortOrder: 14,
  },
];

/* ------------------------------------------------------------- the ejectives */

const EJECTIVE_MOUTH =
  "Close the vocal cords so no air comes from the lungs. Make the closure, then lift the whole larynx to squeeze the trapped air. Release the closure first — you get a small sharp pop — and only then open the throat.";

export const EJECTIVES: PronunciationSound[] = [
  {
    id: "c-te",
    fidel: "ጠ",
    family: "ጠ ጡ ጢ ጣ ጤ ጥ ጦ",
    roman: "ṭ",
    ipa: "tʼ",
    soundClass: "ejective",
    label: "ejective ṭ",
    englishApprox:
      "No English equivalent. Start from the 't' of 'stop', then add a sharp popped release with the throat closed.",
    warning:
      "Being taught 'ጠ = ta' is the single most common mistake for English speakers. ጠ is not a variety of ተ — it is a separate consonant, and swapping them changes the word.",
    mouthPosition: `Tongue tip on the ridge behind the top teeth, as for ተ. ${EJECTIVE_MOUTH}`,
    contrastWith: "c-t",
    examples: [
      { amharic: "ጠዋት", transliteration: "ṭäwat", english: "morning" },
      { amharic: "ጤና", transliteration: "ṭena", english: "health" },
      { amharic: "ጥርስ", transliteration: "ṭïrs", english: "teeth" },
    ],
    sortOrder: 20,
  },
  {
    id: "c-ke",
    fidel: "ቀ",
    family: "ቀ ቁ ቂ ቃ ቄ ቅ ቆ",
    roman: "q",
    ipa: "kʼ",
    soundClass: "ejective",
    label: "ejective q",
    englishApprox:
      "A 'k' made further back in the throat with a tight, popped release. Often written q in transliteration.",
    warning:
      "English has no back-of-throat 'q'. Saying an ordinary 'k' for ቀ will be understood as ከ, a different letter.",
    mouthPosition: `Back of the tongue against the soft palate, further back than for ከ. ${EJECTIVE_MOUTH}`,
    contrastWith: "c-k",
    examples: [
      { amharic: "ቀን", transliteration: "qän", english: "day" },
      { amharic: "ቀኝ", transliteration: "qäñ", english: "right (direction)" },
      { amharic: "ቅቤ", transliteration: "qïbe", english: "butter" },
    ],
    sortOrder: 21,
  },
  {
    id: "c-pe",
    fidel: "ጰ",
    family: "ጰ ጱ ጲ ጳ ጴ ጵ ጶ",
    roman: "p̣",
    ipa: "pʼ",
    soundClass: "ejective",
    label: "ejective p̣",
    englishApprox:
      "A 'p' released with a tight throat and a small burst. Rare, but real.",
    warning:
      "Do not simply aspirate an English 'p'. The burst comes from squeezed air, not from the lungs.",
    mouthPosition: `Both lips closed, as for ፐ. ${EJECTIVE_MOUTH}`,
    contrastWith: "c-p",
    examples: [
      { amharic: "ጰጰስ", transliteration: "p̣ap̣as", english: "bishop" },
    ],
    sortOrder: 22,
  },
  {
    id: "c-tse",
    fidel: "ጸ",
    family: "ጸ ጹ ጺ ጻ ጼ ጽ ጾ",
    roman: "ṣ",
    ipa: "t͡sʼ",
    soundClass: "ejective",
    label: "ejective ṣ",
    englishApprox:
      "Like the 'ts' of 'cats', but squeezed and popped rather than breathed. Also written ፀ.",
    warning:
      "This is an affricate, not a plain 's'. Substituting ሰ loses the contrast entirely.",
    mouthPosition: `Tongue tip at the ridge behind the top teeth in a 'ts' shape. ${EJECTIVE_MOUTH}`,
    contrastWith: "c-s",
    examples: [
      { amharic: "ጸሐይ", transliteration: "ṣähay", english: "sun" },
      { amharic: "መጻፍ", transliteration: "mäṣaf", english: "to write" },
    ],
    sortOrder: 23,
  },
  {
    id: "c-che",
    fidel: "ጨ",
    family: "ጨ ጩ ጪ ጫ ጬ ጭ ጮ",
    roman: "č̣",
    ipa: "t͡ʃʼ",
    soundClass: "ejective",
    label: "ejective č̣",
    englishApprox:
      "The 'ch' of 'church' with a closed throat and a sharp popped release.",
    warning:
      "Saying an ordinary 'ch' gives ቸ, a different letter. The pop is what marks ጨ.",
    mouthPosition: `Tongue blade against the roof of the mouth, as for ቸ. ${EJECTIVE_MOUTH}`,
    contrastWith: "c-ch",
    examples: [
      { amharic: "ጫማ", transliteration: "č̣amma", english: "shoes" },
      { amharic: "ጭስ", transliteration: "č̣ïs", english: "smoke" },
    ],
    sortOrder: 24,
  },
];

/* ------------------------------------------- other sounds uncommon in English */

export const OTHER_SOUNDS: PronunciationSound[] = [
  {
    id: "c-sh",
    fidel: "ሸ",
    family: "ሸ ሹ ሺ ሻ ሼ ሽ ሾ",
    roman: "š",
    ipa: "ʃ",
    soundClass: "palatal",
    label: "š — 'sh'",
    englishApprox: "The 'sh' of 'shoe'. Familiar to English speakers.",
    warning:
      "The trap is reading, not saying: ሸ and ሰ look alike at a glance. Check for the extra stroke.",
    mouthPosition: "Tongue blade raised toward the roof of the mouth, lips slightly rounded.",
    contrastWith: "c-s",
    examples: [
      { amharic: "ሻይ", transliteration: "šay", english: "tea" },
      { amharic: "ሸሚዝ", transliteration: "šämiz", english: "shirt" },
    ],
    sortOrder: 30,
  },
  {
    id: "c-zh",
    fidel: "ዠ",
    family: "ዠ ዡ ዢ ዣ ዤ ዥ ዦ",
    roman: "ž",
    ipa: "ʒ",
    soundClass: "palatal",
    label: "ž — as in 'leisure'",
    englishApprox: "The middle sound of 'leisure' or 'measure'.",
    warning: null,
    mouthPosition: "Same shape as š, but with the vocal cords vibrating.",
    contrastWith: "c-sh",
    examples: [{ amharic: "ጋዜጣ", transliteration: "gazeṭa", english: "newspaper" }],
    sortOrder: 31,
  },
  {
    id: "c-ny",
    fidel: "ኘ",
    family: "ኘ ኙ ኚ ኛ ኜ ኝ ኞ",
    roman: "ñ",
    ipa: "ɲ",
    soundClass: "palatal",
    label: "ñ — as in 'canyon'",
    englishApprox: "The 'ny' of 'canyon', said as one single sound.",
    warning:
      "English speakers split this into two sounds, 'n' + 'y'. In Amharic it is one consonant.",
    mouthPosition: "Middle of the tongue pressed flat against the hard palate; air through the nose.",
    contrastWith: null,
    examples: [
      { amharic: "ቀኝ", transliteration: "qäñ", english: "right (direction)" },
      { amharic: "ደንበኛ", transliteration: "dänbäña", english: "customer" },
    ],
    sortOrder: 32,
  },
];

export const ALL_SOUNDS: PronunciationSound[] = [
  ...VOWEL_ORDERS,
  ...PLAIN_CONSONANTS,
  ...EJECTIVES,
  ...OTHER_SOUNDS,
];

/* ---------------------------------------------------------- minimal pairs */

export interface MinimalPair {
  id: string;
  kind: "syllable" | "word";
  /** The plain member. */
  plainText: string;
  plainRoman: string;
  plainSoundId: string;
  /** The ejective member. */
  ejectiveText: string;
  ejectiveRoman: string;
  ejectiveSoundId: string;
  note: string;
  sortOrder: number;
}

/**
 * Syllable pairs are true minimal pairs: identical vowel, one consonant feature
 * apart. Word rows are labelled "word" and are contrast examples showing each
 * sound in a real word — they are deliberately not claimed to be minimal pairs.
 */
export const MINIMAL_PAIRS: MinimalPair[] = [
  {
    id: "mp-t-1",
    kind: "syllable",
    plainText: "ተ",
    plainRoman: "tä",
    plainSoundId: "c-t",
    ejectiveText: "ጠ",
    ejectiveRoman: "ṭä",
    ejectiveSoundId: "c-te",
    note: "Same vowel, same tongue position. Only the closed throat and popped release differ.",
    sortOrder: 1,
  },
  {
    id: "mp-t-2",
    kind: "syllable",
    plainText: "ታ",
    plainRoman: "ta",
    plainSoundId: "c-t",
    ejectiveText: "ጣ",
    ejectiveRoman: "ṭa",
    ejectiveSoundId: "c-te",
    note: "The 4th order makes the contrast easiest to hear — the open vowel carries the pop.",
    sortOrder: 2,
  },
  {
    id: "mp-k-1",
    kind: "syllable",
    plainText: "ከ",
    plainRoman: "kä",
    plainSoundId: "c-k",
    ejectiveText: "ቀ",
    ejectiveRoman: "qä",
    ejectiveSoundId: "c-ke",
    note: "ቀ is also made further back in the throat than ከ.",
    sortOrder: 3,
  },
  {
    id: "mp-k-2",
    kind: "syllable",
    plainText: "ካ",
    plainRoman: "ka",
    plainSoundId: "c-k",
    ejectiveText: "ቃ",
    ejectiveRoman: "qa",
    ejectiveSoundId: "c-ke",
    note: "Alternate the two until the difference is automatic.",
    sortOrder: 4,
  },
  {
    id: "mp-p-1",
    kind: "syllable",
    plainText: "ፐ",
    plainRoman: "pä",
    plainSoundId: "c-p",
    ejectiveText: "ጰ",
    ejectiveRoman: "p̣ä",
    ejectiveSoundId: "c-pe",
    note: "Both lips close for each. The ejective adds squeezed air and a burst.",
    sortOrder: 5,
  },
  {
    id: "mp-s-1",
    kind: "syllable",
    plainText: "ሰ",
    plainRoman: "sä",
    plainSoundId: "c-s",
    ejectiveText: "ጸ",
    ejectiveRoman: "ṣä",
    ejectiveSoundId: "c-tse",
    note: "ሰ flows continuously; ጸ is a stopped 'ts' with a pop.",
    sortOrder: 6,
  },
  {
    id: "mp-ch-1",
    kind: "syllable",
    plainText: "ቸ",
    plainRoman: "čä",
    plainSoundId: "c-ch",
    ejectiveText: "ጨ",
    ejectiveRoman: "č̣ä",
    ejectiveSoundId: "c-che",
    note: "Listen for the sharper, tighter release on ጨ.",
    sortOrder: 7,
  },
  {
    id: "mp-w-t",
    kind: "word",
    plainText: "ተማሪ",
    plainRoman: "tämari — student",
    plainSoundId: "c-t",
    ejectiveText: "ጠዋት",
    ejectiveRoman: "ṭäwat — morning",
    ejectiveSoundId: "c-te",
    note: "Each word in a real sentence. Contrast example, not a minimal pair.",
    sortOrder: 8,
  },
  {
    id: "mp-w-k",
    kind: "word",
    plainText: "ከተማ",
    plainRoman: "kätäma — city",
    plainSoundId: "c-k",
    ejectiveText: "ቀን",
    ejectiveRoman: "qän — day",
    ejectiveSoundId: "c-ke",
    note: "Contrast example showing each sound word-initially.",
    sortOrder: 9,
  },
  {
    id: "mp-w-ch",
    kind: "word",
    plainText: "ችግር",
    plainRoman: "čïgïr — problem",
    plainSoundId: "c-ch",
    ejectiveText: "ጫማ",
    ejectiveRoman: "č̣amma — shoes",
    ejectiveSoundId: "c-che",
    note: "Contrast example showing each sound word-initially.",
    sortOrder: 10,
  },
];

/* ------------------------------------------------ listen-and-repeat drills */

export interface PronunciationDrill {
  id: string;
  title: string;
  instructions: string;
  /** Items are spoken one at a time by the app's TTS. */
  items: string[];
  soundId: string | null;
  sortOrder: number;
}

export const DRILLS: PronunciationDrill[] = [
  {
    id: "d-orders",
    title: "The seven orders",
    instructions:
      "Listen to each order, then repeat it. Keep the consonant identical and change only the vowel.",
    items: ["ለ", "ሉ", "ሊ", "ላ", "ሌ", "ል", "ሎ"],
    soundId: null,
    sortOrder: 1,
  },
  {
    id: "d-te",
    title: "Ejective ጠ family",
    instructions:
      "Close the throat before each one. You should hear a small pop, not a puff of breath.",
    items: ["ጠ", "ጡ", "ጢ", "ጣ", "ጤ", "ጥ", "ጦ"],
    soundId: "c-te",
    sortOrder: 2,
  },
  {
    id: "d-ke",
    title: "Ejective ቀ family",
    instructions: "Make the closure further back than for ከ, then release sharply.",
    items: ["ቀ", "ቁ", "ቂ", "ቃ", "ቄ", "ቅ", "ቆ"],
    soundId: "c-ke",
    sortOrder: 3,
  },
  {
    id: "d-che",
    title: "Ejective ጨ family",
    instructions: "Start from 'ch', then tighten the throat and pop the release.",
    items: ["ጨ", "ጩ", "ጪ", "ጫ", "ጬ", "ጭ", "ጮ"],
    soundId: "c-che",
    sortOrder: 4,
  },
  {
    id: "d-sh",
    title: "ሰ against ሸ",
    instructions:
      "These two letters look similar and sound different. Alternate them until you never confuse them.",
    items: ["ሰ", "ሸ", "ሳ", "ሻ", "ሶ", "ሾ"],
    soundId: "c-sh",
    sortOrder: 5,
  },
  {
    id: "d-words",
    title: "Ejectives in real words",
    instructions: "Say each word twice — once slowly, once at natural speed.",
    items: ["ጠዋት", "ጤና", "ቀን", "ቅቤ", "ጫማ", "ጸሐይ", "ጥርስ"],
    soundId: null,
    sortOrder: 6,
  },
];
