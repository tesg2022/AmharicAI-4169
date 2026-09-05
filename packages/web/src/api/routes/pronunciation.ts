import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { base } from "../__core/app";
import { db } from "../database";
import * as s from "../database/schema";

/**
 * "Amharic Pronunciation for English Speakers" API.
 *
 * Read-only. Sounds are grouped by class so the client can present the
 * plain/ejective contrast side by side — the whole point of the module is that
 * ጠ is a different consonant from ተ, not an accented version of it.
 */
export const pronunciation = {
  /** Every sound, grouped: 7 vowel orders, plain consonants, ejectives, others. */
  guide: base.handler(async () => {
    const sounds = await db
      .select()
      .from(s.pronunciationSounds)
      .orderBy(asc(s.pronunciationSounds.sortOrder));

    const of = (cls: string) => sounds.filter((x) => x.soundClass === cls);
    const ejectives = of("ejective");
    const plain = of("plain");

    return {
      title: {
        en: "Amharic Pronunciation for English Speakers",
        am: "ለእንግሊዝኛ ተናጋሪዎች የአማርኛ አነባበብ",
      },
      vowels: of("vowel"),
      plain,
      ejectives,
      other: sounds.filter(
        (x) => !["vowel", "plain", "ejective"].includes(x.soundClass),
      ),
      /** Plain sound paired with its ejective counterpart, for the contrast grid. */
      contrasts: plain
        .map((p) => ({
          plain: p,
          ejective: ejectives.find((e) => e.contrastWith === p.id) ?? null,
        }))
        .filter((c) => c.ejective !== null),
      all: sounds,
    };
  }),

  /** One sound with its counterpart, pairs and drills — the detail view. */
  sound: base
    .input(z.object({ id: z.string() }))
    .handler(async ({ input }) => {
      const [sound] = await db
        .select()
        .from(s.pronunciationSounds)
        .where(eq(s.pronunciationSounds.id, input.id));
      if (!sound) return null;

      const counterpart = sound.contrastWith
        ? ((
            await db
              .select()
              .from(s.pronunciationSounds)
              .where(eq(s.pronunciationSounds.id, sound.contrastWith))
          )[0] ?? null)
        : null;

      const pairs = (
        await db
          .select()
          .from(s.minimalPairs)
          .orderBy(asc(s.minimalPairs.sortOrder))
      ).filter(
        (p) => p.plainSoundId === sound.id || p.ejectiveSoundId === sound.id,
      );

      const drills = (
        await db
          .select()
          .from(s.pronunciationDrills)
          .orderBy(asc(s.pronunciationDrills.sortOrder))
      ).filter((d) => d.soundId === sound.id);

      return { sound, counterpart, pairs, drills };
    }),

  /**
   * Contrast exercises. `syllable` rows are true minimal pairs; `word` rows are
   * contrast examples and are labelled as such — they are not claimed to be
   * minimal pairs.
   */
  pairs: base.handler(async () => {
    const rows = await db
      .select()
      .from(s.minimalPairs)
      .orderBy(asc(s.minimalPairs.sortOrder));
    return {
      minimalPairs: rows.filter((r) => r.kind === "syllable"),
      contrastExamples: rows.filter((r) => r.kind === "word"),
    };
  }),

  /** Listen-and-repeat drills, spoken by the client's TTS layer. */
  drills: base.handler(async () =>
    db
      .select()
      .from(s.pronunciationDrills)
      .orderBy(asc(s.pronunciationDrills.sortOrder)),
  ),
};
