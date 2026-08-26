/**
 * The languages ElevenLabs Dubbing can dub INTO, per model.
 *
 * ## There is no machine-readable source for this
 *
 * `api.elevenlabs.io/openapi.json` types `target_language` and
 * `source_language` as bare `string`s whose descriptions say only "must be a
 * language the dubbing model supports" and "a region-qualified tag must be one
 * of the supported dialects". There is no dubbing-languages endpoint in the
 * OpenAPI document (`/v1/productions/orders/languages/{order_item_kind}` is
 * the human-services marketplace, a different product), and the SDK ships no
 * enum either. The only enumeration ElevenLabs publishes is the two prose
 * tables on the capabilities page, which is what these arrays are.
 *
 * That makes this the most rot-prone data in the ElevenLabs provider — it is
 * hand-transcribed, it cannot be regenerated, and nothing upstream will tell
 * us when it changes. Treat a `target_language` refusal as falsifiable: if
 * ElevenLabs accepts a tag this file does not carry, the file is stale.
 *
 * ## Source and verification
 *
 * Both tables transcribed from
 * **https://elevenlabs.io/docs/overview/capabilities/dubbing**
 * (sections "Dubbing v2 languages and dialects" and "Dubbing v1 languages"),
 * **verified 2026-08-26**. Read as raw Markdown at
 * `https://elevenlabs.io/docs/overview/capabilities/dubbing.md`.
 *
 * The page's own framing: "The API accepts a BCP-47 language tag in the
 * `source_language` and `target_language` parameters, for example `fr` or
 * `es-MX`. On Dubbing v2, a region-qualified tag such as `es-MX` must be one of
 * the supported dialects listed below; all other languages use the base
 * language tag. **Dubbing v1 does not support dialects.**"
 *
 * ## Zero imports
 *
 * This module is a data leaf on purpose: `./dubbing.ts` and
 * `./dubbing-language.ts` both need the tables, and a leaf keeps ~190 string
 * literals out of every other graph that reaches the barrel.
 */

/**
 * Dubbing v2 base language tags — 94 of them, in the page's own order
 * (alphabetical by ENGLISH language name, which is why `sq` follows `ak`).
 *
 * Dialects are separate: see {@link DUBBING_V2_DIALECTS}.
 */
export const DUBBING_V2_BASE_LANGUAGES = [
  "af", "ak", "sq", "am", "ar", "hy", "as", "az", "eu", "be", "bs", "bg",
  "my", "yue", "ca", "ceb", "zh", "hr", "cs", "da", "dgo", "nl", "en", "et",
  "fil", "fi", "fr", "gl", "ka", "de", "el", "gu", "ha", "he", "hi", "hu",
  "is", "id", "it", "ja", "jv", "kn", "kk", "ki", "rw", "rn", "ko", "ky",
  "lv", "lt", "lg", "mk", "ms", "ml", "cmn", "mr", "mn", "ne", "no", "fa",
  "pl", "pt", "pa", "ro", "ru", "nso", "st", "sd", "sk", "sl", "es", "su",
  "sw", "ss", "sv", "tg", "ta", "te", "th", "bo", "ts", "tn", "tr", "uk",
  "ur", "ug", "uz", "ve", "vi", "war", "cy", "wo", "yo", "zu",
] as const;

/**
 * The 14 region-qualified tags Dubbing v2 accepts — every non-`—` cell of the
 * page's "Dialects" column. Any other region subtag is refused: the page says
 * "all other languages use the base language tag".
 */
export const DUBBING_V2_DIALECTS = [
  "ar-EG",
  "zh-TW",
  "en-AU", "en-CA", "en-GB", "en-US",
  "fr-CA", "fr-FR",
  "pt-BR", "pt-PT",
  "es-AR", "es-CL", "es-ES", "es-MX",
] as const;

/** Everything `dubbing_v2` accepts as a `target_language`: 94 base tags + 14 dialects. */
export const DUBBING_V2_LANGUAGES: readonly string[] = [
  ...DUBBING_V2_BASE_LANGUAGES,
  ...DUBBING_V2_DIALECTS,
];

/**
 * Dubbing v1 language tags — 86 of them. "Dubbing v1 supports the same
 * languages as the Eleven v3 model. Region-qualified dialect tags are not
 * supported; use the base language tag."
 *
 * This is NOT a subset of v2: v1 carries 14 tags v2 does not (`ast`, `bn`,
 * `ga`, `lb`, `ln`, `mi`, `mt`, `ny`, `oc`, `or`, `ps`, `so`, `sr`, `tl`), and
 * v2 carries 22 v1 does not. A caller moving between models can lose a
 * language in either direction, which is the reason the tables are separate
 * rather than one list with a flag.
 */
export const DUBBING_V1_LANGUAGES = [
  "af", "ar", "hy", "as", "ast", "az", "be", "bn", "bs", "bg", "my", "yue",
  "ca", "ceb", "ny", "zh", "hr", "cs", "da", "nl", "en", "et", "fil", "fi",
  "fr", "gl", "ka", "de", "el", "gu", "ha", "he", "hi", "hu", "is", "id",
  "ga", "it", "ja", "jv", "kn", "kk", "ko", "ky", "lv", "ln", "lt", "lb",
  "mk", "ms", "ml", "mt", "mi", "mr", "mn", "ne", "no", "oc", "or", "ps",
  "fa", "pl", "pt", "pa", "ro", "ru", "sr", "sd", "sk", "sl", "so", "es",
  "sw", "sv", "tl", "tg", "ta", "te", "th", "tr", "uk", "ur", "uz", "vi",
  "cy", "yo",
] as const;

/**
 * The per-model target-language tables, keyed by the `model_id` the project
 * carries. `dubbing_v1` has no dialect arm at all — that is the difference the
 * validators refuse on, naming the base tag as the fix.
 */
export const DUBBING_TARGET_LANGUAGES: Record<string, readonly string[]> = {
  dubbing_v1: DUBBING_V1_LANGUAGES,
  dubbing_v2: DUBBING_V2_LANGUAGES,
};

/** A `target_language` Dubbing v2 accepts (base tag or documented dialect). */
export type ElevenlabsDubbingV2Language =
  | (typeof DUBBING_V2_BASE_LANGUAGES)[number]
  | (typeof DUBBING_V2_DIALECTS)[number];

/** A `target_language` Dubbing v1 accepts. Base tags only — v1 has no dialects. */
export type ElevenlabsDubbingV1Language = (typeof DUBBING_V1_LANGUAGES)[number];

/** Any tag either dubbing model accepts. */
export type ElevenlabsDubbingLanguage =
  | ElevenlabsDubbingV2Language
  | ElevenlabsDubbingV1Language;
