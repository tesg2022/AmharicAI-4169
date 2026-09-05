/**
 * Emits golden vectors from the *app's* Amharic text pipeline.
 *
 * The training data and the inference path must normalize text identically.
 * If they diverge, the model learns one mapping and is served another — a
 * failure mode that is invisible until the voice mispronounces numbers in
 * production. So the Python trainer-side normalizer is held to these vectors
 * by `test_parity.py`, and this file is the single source of truth.
 *
 * Run: bun run tts/qa/make_parity_vectors.ts > tts/qa/parity_vectors.json
 */

import { expandNumbers, numberToAmharic, ethiopicToNumber, timeToAmharic } from "../../packages/web/src/api/speech/numbers";
import {
  amharicRatio,
  countEjectives,
  foldHomophones,
  modernizeWordspace,
  normalizeForSpeech,
} from "../../packages/web/src/api/speech/fidel";

/** Strings chosen to exercise every branch, plus the real dataset sentences. */
const CASES = [
  // --- numbers ---
  "0", "1", "9", "10", "11", "15", "19", "20", "21", "40", "99",
  "100", "101", "110", "947", "834", "1000", "1995", "2024",
  "1000000", "1900000", "834000000", "1000000000",
  "3.5", "1.9", "-42",
  // --- thousands separators ---
  "1,000", "12,345",
  // --- times ---
  "3:30 ላይ", "14:05", "9:00", "25:99",
  // --- dates ---
  "2024-05-03", "1995-12-31",
  // --- percentages ---
  "25% ነው", "3.5 %",
  // --- ethiopic numerals ---
  "፻፳፫", "፩", "፲", "፼", "፲፱፻፺፭",
  // --- homophones (scoring-only fold) ---
  "ሠላም ሐዲስ ፀሐይ ዐይን", "ሡሉ ሢሣ ሤሥሦ", "ኁኂኃኄኅኆ",
  // --- wordspace / encoding hygiene ---
  "ሰላም፡እንዴት፡ነህ", "ሰላም።።። እንዴት", "ሰላም​‌‍ነህ", "ሰላም ነህ",
  "  ሰላም   ነህ  ", "ሰላም \n ነህ",
  // --- ejectives ---
  "ጠረጴዛ ቀይ", "ጨርቅ ጰጰ ጸሀይ", "ሰላም",
  // --- mixed / real dataset text ---
  "በአገልግሎቱ ከ947 ሺህ በላይ በጎ ፈቃደኞችን በማሳተፍ 1 ነጥብ 9 ሚሊዮን የህብረተሰብ ክፍሎችን ተጠቃሚ ለማድረግ እየተሰራ መሆኑን ጠቁመው በጎ ፈቃደኞች 834 ሚሊዮን ብር የሚገመት አስተዋጽኦ ያደርጋሉ ብለዋል።",
  "ሀሳብ ካለ ሀብት መፍጠር እንደሚቻል አምናለሁ ያሉት ሚኒስትሯ፤ ይህን ተግባራዊ ማድረግ የሚያስችል እምቅ ሀገራዊ አቅም፣ ፖሊሲና ተቋም ተገንብቷልም ብለዋል።",
  "አንጋፋው አርቲስት ደበበ እሽቱ ጠልፎ በኪሴ፣ ያላቻ ጋብቻ፣ ሮሚዮና ዡልየት፣ ዳንዴው ጨቡዴ፣ አንድ ዓመት ከአንድ ቀን፣እናት ዓለም ጠኑ፣ በቀይ ካባ ስውር ደባ፣ የአዛውንቶች ክበብ፣ የወፍ ጎጆ፣ ማዕበል፣ የቬኒሱ ነጋዴ፣ ዘ ጌም ኦፍ ቼዝ፣ ኦቴ በተሰኙ እና ሌሎች ከ40 በላይ ታላላቅ ተጠቃሽ የመድረክ ስራዎችን አበርክቷል።",
  "ከመድረኩ ተሳታፊዎች መካከል የሞጆ ከተማ ነዋሪ አቶ ተክለማርያም ቱሉ በበኩላቸው የቫይረሱን ስርጭት ለመቀነስ ከተማ አስተዳደሩ በሚያከናውነው የግንዛቤ ማስጨበጫ ስራ የበኩላቸውን እየተወጡ መሆኑን ጠቁመዋል።",
  "የማጠቃለያ መደረኩ ተሳታፊ ወጣቶች ለሰላም አርአያ ሆነው ሌሎች በርካታ ወጣቶች ለሰላም ዘብ እንዲሆኑ ማድረግን ያለመ መሆኑንም ገልጻለች ።",
];

const INTEGERS = [
  0, 1, 7, 10, 11, 17, 20, 21, 40, 99, 100, 101, 200, 947, 1000, 1995, 2024,
  10000, 100000, 834000, 1900000, 1000000000,
];

const TIMES: [number, number][] = [
  [3, 30], [9, 0], [14, 5], [1, 15], [23, 59],
];

const ETHIOPIC = ["፩", "፲", "፻", "፼", "፻፳፫", "፲፱፻፺፭", "abc"];

console.log(
  JSON.stringify(
    {
      note: "Generated from packages/web/src/api/speech by make_parity_vectors.ts. Do not hand-edit.",
      expandNumbers: Object.fromEntries(CASES.map((c) => [c, expandNumbers(c)])),
      normalizeForSpeech: Object.fromEntries(CASES.map((c) => [c, normalizeForSpeech(c)])),
      foldHomophones: Object.fromEntries(CASES.map((c) => [c, foldHomophones(c)])),
      modernizeWordspace: Object.fromEntries(CASES.map((c) => [c, modernizeWordspace(c)])),
      amharicRatio: Object.fromEntries(CASES.map((c) => [c, amharicRatio(c)])),
      countEjectives: Object.fromEntries(CASES.map((c) => [c, countEjectives(c)])),
      numberToAmharic: Object.fromEntries(INTEGERS.map((n) => [String(n), numberToAmharic(n)])),
      timeToAmharic: Object.fromEntries(TIMES.map(([h, m]) => [`${h}:${m}`, timeToAmharic(h, m)])),
      ethiopicToNumber: Object.fromEntries(ETHIOPIC.map((e) => [e, ethiopicToNumber(e)])),
    },
    null,
    2,
  ),
);
