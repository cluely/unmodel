/**
 * The voice-clone adapter's **data**: the model list and the per-model
 * narrowing table. A leaf for `unmodel/cartesia/values`, per the usual split.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VoiceCloneModelParamTable } from "../../core/unified/vocabulary/voice-clone";

/**
 * The one voice-clone id — the synthetic route noun (POST /voices/clone has
 * no model field).
 */
export const MODELS = ["voice-clone"] as const;

export const VOICE_CLONE_DOCS = "https://docs.cartesia.ai/api-reference/voices/clone";

/**
 * The 44 documented `language` codes — REQUIRED on this wire, the only clone
 * route in the pack where it is. Sorted; `LanguageOf` keeps the list open, so
 * a BCP-47 tag still compiles and `toPrimaryLanguage` reduces it.
 */
export const VOICE_CLONE_LANGUAGES = [
  "ar", "bg", "bn", "cs", "da", "de", "el", "en", "es", "fi",
  "fr", "gu", "he", "hi", "hr", "hu", "id", "it", "ja", "ka",
  "kn", "ko", "ml", "mr", "ms", "nl", "no", "or", "pa", "pl",
  "pt", "ro", "ru", "sk", "sv", "ta", "te", "th", "tl", "tr",
  "uk", "ur", "vi", "zh",
] as const;

/**
 * Excluded on purpose: `clip` (← `samples`), `name`, `language`,
 * `description` and `access` (← `visibility`) are canonical words' wire
 * spellings. `accent` takes a catalog accent ID from GET /accents — a
 * per-version catalog unmodel cannot see, so the value stays open.
 */
export const VOICE_CLONE_EXTRAS = {
  tagline: EXTRA as string,
  accent: EXTRA as string,
  base_voice_id: EXTRA as string,
} as const;

export const CARTESIA_VOICE_CLONE_MODEL_PARAMS = {
  "voice-clone": {
    languages: VOICE_CLONE_LANGUAGES,
    extras: VOICE_CLONE_EXTRAS,
  },
} as const satisfies VoiceCloneModelParamTable;
