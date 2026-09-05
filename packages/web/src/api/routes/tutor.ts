import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db } from "../database";
import * as s from "../database/schema";
import { authed } from "../middleware/auth";

/**
 * Tutor chat persistence. The streaming turn itself is a plain HTTP route
 * (`POST /api/agent/messages` in src/api/index.ts) — these procedures store and
 * replay the transcript so a conversation survives app restarts.
 */

export const tutor = {
  history: authed
    .input(z.object({ limit: z.number().int().min(10).max(200).default(60) }).optional())
    .handler(async ({ input, context }) => {
      const rows = await db
        .select()
        .from(s.tutorMessages)
        .where(eq(s.tutorMessages.userId, context.user.id))
        .orderBy(asc(s.tutorMessages.createdAt))
        .limit(input?.limit ?? 60);
      return rows;
    }),

  save: authed
    .input(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
        lessonId: z.string().nullish(),
      }),
    )
    .handler(async ({ input, context }) => {
      const [row] = await db
        .insert(s.tutorMessages)
        .values({
          id: crypto.randomUUID(),
          userId: context.user.id,
          role: input.role,
          content: input.content,
          lessonId: input.lessonId ?? null,
        })
        .returning();
      return row!;
    }),

  clear: authed.handler(async ({ context }) => {
    await db.delete(s.tutorMessages).where(eq(s.tutorMessages.userId, context.user.id));
    return { cleared: true };
  }),
};
