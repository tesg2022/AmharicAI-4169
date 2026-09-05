import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { base } from "../__core/app";
import { db } from "../database";
import * as s from "../database/schema";
import { authed, withUser } from "../middleware/auth";
import { cacheStats } from "../speech/cache";
import { estimateDurationMs, prepareSpeech } from "../speech/normalize";
import {
  activeProvider,
  activeRecognizer,
  allStatuses,
  nativeAudioAvailable,
} from "../speech/providers";
import { VOICE_MODES } from "../speech/ssml";

/**
 * The native Amharic speech layer.
 *
 * Audio bytes themselves are not served through oRPC — `<audio>` and the
 * mobile player both want a URL, so synthesis is a plain HTTP route
 * (`/api/speech/audio`) registered in src/api/index.ts. What lives here is
 * everything the UI needs to decide *what* to play and to be honest when it
 * cannot: provider status, the text pipeline, dialogue casting, and the
 * READ → LISTEN → REPEAT → SPEAK → FEEDBACK session record.
 */

const modeSchema = z.enum(VOICE_MODES);

export const speech = {
  /**
   * Whether native audio is actually reachable, and what is missing if not.
   *
   * The clients use this instead of assuming: with no provider key they must
   * not fall back to an English voice reading a Latin transliteration, which
   * teaches the wrong sounds. They fall back to a device am-ET voice if one is
   * installed, and otherwise stay silent and say so.
   */
  status: base.handler(async () => {
    const provider = activeProvider();
    // Reported separately because they are genuinely different providers: our
    // own LoRA voice speaks but does not listen, so recognition falls through
    // to the first configured vendor that does.
    const recognizer = activeRecognizer();
    const stats = await cacheStats().catch(() => ({ clips: 0, bytes: 0, hits: 0, recent: [] }));

    return {
      nativeAudioAvailable: nativeAudioAvailable(),
      recognizer: recognizer ? { id: recognizer.id, label: recognizer.label } : null,
      active: provider
        ? {
            id: provider.id,
            label: provider.label,
            dialect: provider.dialect,
            voices: provider.voices,
            defaultVoice: provider.defaultVoice,
            secondVoice: provider.secondVoice,
          }
        : null,
      providers: allStatuses(),
      modes: VOICE_MODES,
      cache: stats,
    };
  }),

  /**
   * Runs the text-processing pipeline without synthesizing anything.
   *
   * This is the part that makes synthetic Amharic sound like speech rather
   * than a list of syllables, and it is fully deterministic — no key needed,
   * which is also why it is the piece that can be verified today.
   */
  prepare: base
    .input(z.object({ text: z.string().min(1).max(4000), mode: modeSchema.default("native") }))
    .handler(async ({ input }) => {
      const prepared = prepareSpeech(input.text, { mode: input.mode });
      return {
        raw: prepared.raw,
        normalized: prepared.normalized,
        segments: prepared.segments,
        isAmharic: prepared.isAmharic,
        amharicRatio: prepared.amharicRatio,
        estimatedMs: estimateDurationMs(prepared),
      };
    }),

  /**
   * Casts a dialogue for two-voice playback: each speaker gets a distinct
   * native voice so a conversation sounds like two people, and each line
   * carries its own planned pause.
   */
  dialogue: base
    .input(z.object({ dialogueId: z.string(), mode: modeSchema.default("native") }))
    .handler(async ({ input }) => {
      const [dialogue] = await db
        .select()
        .from(s.dialogues)
        .where(eq(s.dialogues.id, input.dialogueId));
      if (!dialogue) return null;

      const lines = await db
        .select()
        .from(s.dialogueLines)
        .where(eq(s.dialogueLines.dialogueId, dialogue.id))
        .orderBy(s.dialogueLines.lineNo);

      const provider = activeProvider();
      // Speakers are cast in order of first appearance, alternating the two
      // available voices — stable across replays because the order is the
      // dialogue's own line order.
      const speakers: string[] = [];
      for (const line of lines) {
        const who = line.speaker ?? "A";
        if (!speakers.includes(who)) speakers.push(who);
      }

      const voiceFor = (speaker: string): string | null => {
        if (!provider) return null;
        const index = Math.max(0, speakers.indexOf(speaker));
        return index % 2 === 0
          ? provider.defaultVoice
          : (provider.secondVoice ?? provider.defaultVoice);
      };

      return {
        dialogue,
        speakers,
        lines: lines.map((line) => {
          const prepared = prepareSpeech(line.amharic ?? "", { mode: input.mode });
          return {
            ...line,
            voice: voiceFor(line.speaker ?? "A"),
            normalized: prepared.normalized,
            estimatedMs: estimateDurationMs(prepared),
            /** Gap before the next turn — a real conversation is not gapless. */
            turnGapMs: 380,
          };
        }),
      };
    }),

  /** Opens a practice loop for a lesson and returns its id. */
  startSession: authed
    .input(z.object({ lessonId: z.string().nullish(), itemsTotal: z.number().int().min(0) }))
    .handler(async ({ input, context }) => {
      const id = crypto.randomUUID();
      await db.insert(s.speechSessions).values({
        id,
        userId: context.user.id,
        lessonId: input.lessonId ?? null,
        stage: "read",
        itemsTotal: input.itemsTotal,
      });
      return { id };
    }),

  /** Advances the loop. Stage order is fixed: read → listen → repeat → speak → feedback. */
  advanceSession: authed
    .input(
      z.object({
        id: z.string(),
        stage: z.enum(["read", "listen", "repeat", "speak", "feedback"]),
        itemsCompleted: z.number().int().min(0).optional(),
        averageScore: z.number().min(0).max(100).nullish(),
        completed: z.boolean().default(false),
      }),
    )
    .handler(async ({ input, context }) => {
      const [row] = await db
        .select()
        .from(s.speechSessions)
        .where(and(eq(s.speechSessions.id, input.id), eq(s.speechSessions.userId, context.user.id)));
      if (!row) return null;

      await db
        .update(s.speechSessions)
        .set({
          stage: input.stage,
          itemsCompleted: input.itemsCompleted ?? row.itemsCompleted,
          averageScore: input.averageScore ?? row.averageScore,
          completedAt: input.completed ? new Date() : row.completedAt,
        })
        .where(eq(s.speechSessions.id, input.id));

      return { ok: true };
    }),

  /** Recent loops, for the progress screen. */
  sessions: withUser
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }).optional())
    .handler(async ({ input, context }) => {
      if (!context.user) return [];
      return db
        .select()
        .from(s.speechSessions)
        .where(eq(s.speechSessions.userId, context.user.id))
        .orderBy(desc(s.speechSessions.createdAt))
        .limit(input?.limit ?? 10);
    }),
};
