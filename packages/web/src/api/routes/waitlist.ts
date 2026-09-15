import { z } from "zod";
import { eq } from "drizzle-orm";
import { base } from "../__core/app";
import { db } from "../database";
import { launchSignups } from "../database/schema";

/**
 * The Android launch notification list.
 *
 * This exists because /download has nothing to download yet: the app is not on
 * Google Play, and a Play badge that opens nothing would be a lie. An address
 * here is a promise to send exactly one mail, once, when the build is live.
 *
 * Public on purpose — asking someone to create an account before they can be
 * told the app exists is backwards. That makes it an unauthenticated write, so
 * it is deliberately narrow: one column of user input, validated and
 * normalised, with the unique index doing the deduplication rather than a
 * read-then-write race.
 */
export const waitlist = {
  join: base
    .input(
      z.object({
        email: z.string().trim().toLowerCase().email().max(254),
        source: z.enum(["download", "app", "landing"]).default("download"),
      }),
    )
    .handler(async ({ input }) => {
      const existing = await db
        .select({ id: launchSignups.id })
        .from(launchSignups)
        .where(eq(launchSignups.email, input.email))
        .limit(1);

      // Already on the list is a success, not an error — telling a visitor
      // "you already signed up" is friendlier than an error state, and it
      // avoids confirming address existence any more than they just did.
      if (existing.length > 0) return { ok: true as const, already: true as const };

      try {
        await db.insert(launchSignups).values({
          id: crypto.randomUUID(),
          email: input.email,
          source: input.source,
        });
      } catch {
        // Unique-constraint race: two tabs, same address. Same outcome.
        return { ok: true as const, already: true as const };
      }

      return { ok: true as const, already: false as const };
    }),
};
