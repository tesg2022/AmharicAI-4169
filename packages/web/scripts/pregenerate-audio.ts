/**
 * Pre-generates the audio for the fixed course content.
 *
 * The course text never changes between learners: the vocabulary, the dialogue
 * lines and the pronunciation drills are the same 300-odd phrases for
 * everyone. Synthesizing each one once and caching it is both cheaper and
 * faster than a provider call per tap — only free-form tutor replies are
 * synthesized live.
 *
 * Usage (from packages/web):
 *   bun --env-file=../../.env run scripts/pregenerate-audio.ts
 *   bun --env-file=../../.env run scripts/pregenerate-audio.ts --dry-run
 *   bun --env-file=../../.env run scripts/pregenerate-audio.ts --modes=native,slow --limit=20
 *
 * With no provider key configured the script cannot synthesize anything, so it
 * reports exactly what it *would* generate and exits 0. That is the only mode
 * that can run today — there are no speech credentials in the environment.
 */

import { db } from "../src/api/database";
import * as s from "../src/api/database/schema";
import { cacheKey, writeCache } from "../src/api/speech/cache";
import { estimateDurationMs, prepareSpeech } from "../src/api/speech/normalize";
import { activeProvider } from "../src/api/speech/providers";
import { VOICE_MODES, type VoiceMode } from "../src/api/speech/ssml";
import { eq } from "drizzle-orm";

type Job = {
  kind: "vocabulary" | "dialogue_line" | "drill";
  refId: string;
  text: string;
};

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=")[1];
}
const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT = Number(arg("limit") ?? 0) || Infinity;

const MODES: VoiceMode[] = (arg("modes")?.split(",") ?? ["native", "slow"])
  .map((m) => m.trim())
  .filter((m): m is VoiceMode => (VOICE_MODES as readonly string[]).includes(m));

async function collect(): Promise<Job[]> {
  const jobs: Job[] = [];

  const vocab = await db
    .select({ id: s.vocabulary.id, amharic: s.vocabulary.amharic })
    .from(s.vocabulary);
  for (const row of vocab) {
    if (row.amharic?.trim()) {
      jobs.push({ kind: "vocabulary", refId: row.id, text: row.amharic.trim() });
    }
  }

  const lines = await db
    .select({ id: s.dialogueLines.id, amharic: s.dialogueLines.amharic })
    .from(s.dialogueLines);
  for (const row of lines) {
    if (row.amharic?.trim()) {
      jobs.push({ kind: "dialogue_line", refId: row.id, text: row.amharic.trim() });
    }
  }

  const drills = await db
    .select({ id: s.pronunciationDrills.id, items: s.pronunciationDrills.items })
    .from(s.pronunciationDrills);
  for (const row of drills) {
    const items = Array.isArray(row.items) ? row.items : [];
    items.forEach((item, i) => {
      if (typeof item === "string" && item.trim()) {
        // Each drill item is spoken on its own, so each is its own clip.
        jobs.push({ kind: "drill", refId: `${row.id}#${i}`, text: item.trim() });
      }
    });
  }

  return jobs;
}

async function alreadyCached(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: s.speechAudio.id })
    .from(s.speechAudio)
    .where(eq(s.speechAudio.id, id));
  return Boolean(row);
}

async function main() {
  const provider = activeProvider();
  const jobs = (await collect()).slice(0, LIMIT === Infinity ? undefined : LIMIT);

  const characters = jobs.reduce((sum, job) => sum + job.text.length, 0);
  const clips = jobs.length * MODES.length;

  console.log("AmharicAI — course audio pre-generation");
  console.log("=".repeat(52));
  console.log(`modes            : ${MODES.join(", ")}`);
  console.log(`phrases          : ${jobs.length}`);
  console.log(`  vocabulary     : ${jobs.filter((j) => j.kind === "vocabulary").length}`);
  console.log(`  dialogue lines : ${jobs.filter((j) => j.kind === "dialogue_line").length}`);
  console.log(`  drill items    : ${jobs.filter((j) => j.kind === "drill").length}`);
  console.log(`clips to make    : ${clips}  (phrases x modes)`);
  console.log(`characters       : ${characters} per mode, ${characters * MODES.length} total`);
  console.log(`provider         : ${provider ? `${provider.id} (${provider.label})` : "NONE"}`);
  console.log("=".repeat(52));

  if (!provider) {
    console.log("");
    console.log("No speech provider is configured, so nothing can be synthesized.");
    console.log("This is a dry run — the work above is what would happen once a key exists.");
    console.log("");
    console.log("Set ONE of these in the root .env, then run this script again:");
    console.log("  AZURE_SPEECH_KEY + AZURE_SPEECH_REGION   (neural am-ET voices + am-ET STT)");
    console.log("  GOOGLE_SPEECH_API_KEY                    (am-ET voices + STT)");
    console.log("  ADDIS_AI_API_KEY                         (Amharic specialist)");
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log("\n--dry-run given: stopping before any provider call.");
    process.exit(0);
  }

  const voice = provider.defaultVoice;
  let made = 0;
  let skipped = 0;
  let failed = 0;

  for (const job of jobs) {
    for (const mode of MODES) {
      const prepared = prepareSpeech(job.text, { mode });
      const id = cacheKey({ provider: provider.id, voice, mode, normalizedText: prepared.normalized });

      if (await alreadyCached(id)) {
        skipped++;
        continue;
      }

      try {
        const result = await provider.synthesize({
          text: job.text,
          mode,
          voice,
        });
        await writeCache({
          provider: provider.id,
          voice,
          mode,
          normalizedText: prepared.normalized,
          sourceText: job.text,
          mimeType: result.mimeType,
          audio: result.audio,
          durationMsEstimate: estimateDurationMs(prepared),
          kind: job.kind,
          refId: job.refId,
        });
        made++;
        if (made % 25 === 0) console.log(`  … ${made} clips generated`);
      } catch (error) {
        failed++;
        console.error(
          `  ! ${job.kind} ${job.refId} [${mode}]: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }
  }

  console.log("");
  console.log(`generated: ${made}   already cached: ${skipped}   failed: ${failed}`);
  process.exit(failed > 0 && made === 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
