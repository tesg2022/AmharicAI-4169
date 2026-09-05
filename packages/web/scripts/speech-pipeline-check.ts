/**
 * Verifies the Amharic text pipeline end to end without any provider key.
 *
 * Everything printed here is what a TTS engine will actually receive: numbers
 * verbalized into Amharic words, sentences segmented, questions detected even
 * without a `?`, and prosody rendered per provider dialect.
 *
 *   bun run scripts/speech-pipeline-check.ts
 */

import { expandNumbers, numberToAmharic, ethiopicToNumber, timeToAmharic } from "../src/api/speech/numbers";
import { segment } from "../src/api/speech/segment";
import { foldHomophones, normalizeForSpeech, analyzeFidel, countEjectives, isAmharic } from "../src/api/speech/fidel";
import { prepareSpeech, estimateDurationMs, renderSpeech } from "../src/api/speech/normalize";

const show = (label: string, value: unknown) => console.log(label, "=>", JSON.stringify(value, null, 0));

show("numberToAmharic(11)", numberToAmharic(11));
show("numberToAmharic(21)", numberToAmharic(21));
show("numberToAmharic(1995)", numberToAmharic(1995));
show("numberToAmharic(0)", numberToAmharic(0));
show("numberToAmharic(3.5)", numberToAmharic(3.5));
show("ethiopicToNumber(፲፪)", ethiopicToNumber("፲፪"));
show("ethiopicToNumber(፻፳፫)", ethiopicToNumber("፻፳፫"));
show("timeToAmharic(3,30)", timeToAmharic(3,30));
show("expandNumbers('3:30 ላይ')", expandNumbers("3:30 ላይ"));
show("expandNumbers('25% ነው')", expandNumbers("25% ነው"));
show("expandNumbers('፲፪ ብር')", expandNumbers("፲፪ ብር"));
show("expandNumbers('2024-05-03')", expandNumbers("2024-05-03"));
show("foldHomophones(ሠላም ሐዲስ ፀሐይ ዐይን)", foldHomophones("ሠላም ሐዲስ ፀሐይ ዐይን"));
show("normalizeForSpeech", normalizeForSpeech("ሰላም​   ነው።።"));
show("analyzeFidel(ሉ)", analyzeFidel("ሉ"));
show("analyzeFidel(ጠ)", analyzeFidel("ጠ"));
show("countEjectives(ጠረጴዛ ቀይ)", countEjectives("ጠረጴዛ ቀይ"));
show("isAmharic(hello)", isAmharic("hello"));
const segs = segment("ሰላም። እንዴት ነህ\nቡና እፈልጋለሁ፣ እባክህ።");
show("segments", segs.map(s => ({t:s.text,i:s.intonation,p:s.pauseMs})));
const prep = prepareSpeech("ሰላም። ስንት ሰዓት ነው? 3:30 ላይ እንገናኝ።", { mode: "slow" });
show("prepared.normalized", prep.normalized);
show("estimatedMs", estimateDurationMs(prep));
console.log("AZURE SSML:\n", renderSpeech(prep, "azure", "am-ET-MekdesNeural"));
console.log("GOOGLE SSML:\n", renderSpeech(prep, "google", "am-ET-Standard-A"));
