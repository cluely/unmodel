import type { DenyRule, EndpointConstraints } from "../../core/constraint-types";

/**
 * Per-model constraints for POST /v1/text-to-speech/{voice_id}.
 * Every rule carries a reason + source per the constraint-table contract.
 */
export const ttsConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  eleven_multilingual_v2: {
    deny: {
      // "Language code (ISO 639-1) used to enforce a language for the model
      // and text normalization. … This parameter is not supported for
      // multilingual_v2 models." — the API accepts the request and ignores
      // the param, so the requested language is NOT actually enforced. Flagged
      // `ignored`: loud about the silent no-op, but a warning rather than an
      // error, because the request itself succeeds.
      language_code: {
        reason:
          "language enforcement via `language_code` is not supported for multilingual_v2 models, so the requested language is not applied",
        source: "https://elevenlabs.io/docs/api-reference/text-to-speech/convert",
        ignored: true,
      },
    },
  },
};

/**
 * The two scribe_v3-only form fields — https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/batch/number-and-language-options
 * (2026-11-12): "Both parameters are only supported by `scribe_v3`. Sending
 * either one with another model returns an `invalid_parameters` error."
 */
const SCRIBE_V3_ONLY_SOURCE =
  "https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/batch/number-and-language-options";
const SCRIBE_V3_ONLY: Record<string, DenyRule> = {
  numbers_format: {
    reason: "`numbers_format` is only supported by scribe_v3; other models return `invalid_parameters`",
    source: SCRIBE_V3_ONLY_SOURCE,
  },
  secondary_language_codes: {
    reason:
      "`secondary_language_codes` is only supported by scribe_v3; other models return `invalid_parameters`",
    source: SCRIBE_V3_ONLY_SOURCE,
  },
};

/** Per-model constraints for POST /v1/speech-to-text. */
export const speechToTextConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  scribe_v2: { deny: SCRIBE_V3_ONLY },
  scribe_v2_medical: { deny: SCRIBE_V3_ONLY },
  scribe_v1: {
    deny: {
      // "If true, the transcription will not have any filler words, false
      // starts and non-speech sounds. Supported by scribe_v2, scribe_v2_medical
      // and scribe_v3." — `no_verbatim` on https://api.elevenlabs.io/openapi.json
      // (2026-11-12).
      no_verbatim: {
        reason: "`no_verbatim` is only supported by scribe_v2, scribe_v2_medical and scribe_v3",
        source: "https://api.elevenlabs.io/openapi.json#/paths/~1v1~1speech-to-text/post",
      },
      ...SCRIBE_V3_ONLY,
    },
  },
};
