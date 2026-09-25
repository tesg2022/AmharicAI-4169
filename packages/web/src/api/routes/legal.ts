import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { base } from "../__core/app";
import {
  LEGAL_DOCUMENTS,
  LEGAL_INDEX,
  OPERATOR,
  POLICY_VERSION,
  type LegalSlug,
} from "../content/legal";

/**
 * The legal documents, served to every client from one source.
 *
 * Public on purpose: Google Play's reviewers, and anyone comparing the policy
 * in the app against the policy at the listing URL, must be able to read these
 * without an account.
 */

const slugSchema = z.enum(["privacy", "terms", "about", "contact"]);

export const legal = {
  /** Titles and summaries, for footers and settings menus. */
  index: base.handler(async () => ({
    version: POLICY_VERSION,
    documents: LEGAL_INDEX,
    operator: {
      public_name: OPERATOR.publicName,
      trading_as: OPERATOR.tradingAs,
      website: OPERATOR.website,
      support_email: OPERATOR.supportEmail,
      privacy_email: OPERATOR.privacyEmail,
      jurisdiction: OPERATOR.jurisdiction,
      minimum_age: OPERATOR.minimumAge,
    },
  })),

  /** One document in full. */
  document: base
    .input(z.object({ slug: slugSchema }))
    .handler(async ({ input }) => {
      const doc = LEGAL_DOCUMENTS[input.slug as LegalSlug];
      if (!doc) {
        throw new ORPCError("NOT_FOUND", { message: "No such document." });
      }
      return doc;
    }),
};
