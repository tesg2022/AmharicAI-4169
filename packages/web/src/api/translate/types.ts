/**
 * The provider-agnostic translation contract.
 *
 * It mirrors `speech/providers/types.ts` deliberately, down to the shape of
 * `ProviderStatus`. Translation, synthesis, recognition and the tutor are four
 * models that will end up on the same GPU box, and having four different
 * adapter shapes for that box would mean four different failure reports, four
 * different "not configured" messages and four places to change when the URL
 * moves.
 */

export type TranslateDirection = "en2am" | "am2en";

export interface TranslateRequest {
  text: string;
  direction: TranslateDirection;
}

export interface TranslateResult {
  translation: string;
  direction: TranslateDirection;
  provider: string;
  /** Model identifier the provider reports, when it reports one. */
  model: string | null;
}

export interface TranslateProviderStatus {
  id: string;
  label: string;
  configured: boolean;
  /** Missing env var names, so the UI can name exactly what to supply. */
  missingEnv: string[];
  notes: string;
}

export interface TranslateProvider {
  id: string;
  label: string;
  status: () => TranslateProviderStatus;
  translate: (request: TranslateRequest) => Promise<TranslateResult>;
}

export class TranslateProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    /** True when the provider answered but the answer was unusable. */
    readonly upstream = true,
  ) {
    super(message);
    this.name = "TranslateProviderError";
  }
}
