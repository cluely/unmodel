import type { EndpointConstraints } from "../../core/constraint-types";

/**
 * Per-model constraints for POST /v1/text-to-speech/{voice_id}.
 * Every rule carries a reason + source per the constraint-table contract.
 */
export const textToSpeechConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
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

/** Per-model constraints for POST /v1/speech-to-text. */
export const speechToTextConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  scribe_v1: {
    deny: {
      // "If true, the transcription will not have any filler words, false
      // starts and non-speech sounds. Only supported with scribe_v2 model."
      no_verbatim: {
        reason: "`no_verbatim` is only supported with the scribe_v2 model",
        source: "https://elevenlabs.io/docs/api-reference/speech-to-text/convert",
      },
    },
  },
};
