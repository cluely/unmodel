/**
 * The tts adapter's **data**: the model list, the per-model narrowing table,
 * the closed voice lists, and the delivery spec.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/alibaba/values` publishes these arrays for client-side pickers and
 * the adapter imports this provider's validator, its zod schema and the
 * compile helpers in `core/unified/derive`. The adapter reads the very same
 * objects, so what is published and what is sent cannot drift. The raw wire
 * enums (voice lists, language_type words) live in `./models` — an
 * import-free leaf — so the validator can read them without this module.
 */

import { EXTRA } from "../../core/unified/derive";
import type { TtsDeliverySpec, TtsModelParamTable } from "../../core/unified/vocabulary/tts";
import type { AlibabaLanguageType } from "./models";
import {
  LANGUAGE_TYPES,
  QWEN3_TTS_FLASH_2025_09_18_VOICES,
  QWEN3_TTS_FLASH_VOICES,
  QWEN3_TTS_INSTRUCT_FLASH_VOICES,
} from "./models";

export {
  LANGUAGE_TYPES,
  QWEN3_TTS_FLASH_VOICES,
  QWEN3_TTS_FLASH_2025_09_18_VOICES,
  QWEN3_TTS_INSTRUCT_FLASH_VOICES,
  VOICES_BY_MODEL,
} from "./models";
export type { AlibabaLanguageType } from "./models";

/** The five unary (HTTP) TTS ids — the ref union for `alibaba/…`. */
export const MODELS = [
  "qwen3-tts-flash",
  "qwen3-tts-flash-2025-11-27",
  "qwen3-tts-flash-2025-09-18",
  "qwen3-tts-instruct-flash",
  "qwen3-tts-instruct-flash-2026-01-26",
] as const;

export const TTS_DOCS = "https://www.alibabacloud.com/help/en/model-studio/qwen-tts";

/**
 * BCP-47 primary subtag → Alibaba's own word for that language.
 *
 * "Auto" is not mapped: it is what an omitted canonical `language` means, and
 * no tag spells it. `as const satisfies`, not an annotation, for the reason
 * `minimax/tts-params.ts` documents at its LANGUAGE_BOOSTS: an annotated
 * `Record<string, …>` widens the keys to `string` and the rows' `languages`
 * lists to `readonly string[]`, silently degrading `LanguageOf`.
 */
export const LANGUAGE_TYPE_BY_SUBTAG = {
  zh: "Chinese",
  en: "English",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  es: "Spanish",
  ja: "Japanese",
  ko: "Korean",
  fr: "French",
  ru: "Russian",
} as const satisfies Readonly<Record<string, AlibabaLanguageType>>;

export type AlibabaTtsLanguage = keyof typeof LANGUAGE_TYPE_BY_SUBTAG;

export const TTS_LANGUAGES = Object.keys(
  LANGUAGE_TYPE_BY_SUBTAG,
) as ReadonlyArray<AlibabaTtsLanguage>;

/**
 * Per-model narrowing.
 *
 * `codecs: []` is the empty-list idiom: this route has NO request field for
 * the audio encoding — non-streaming answers a fixed WAV URL (24 kHz, 16-bit,
 * mono), streaming answers Base64 PCM — so a canonical `outputFormat` is not
 * expressible and the adapter declares it unsupported. `stream` is the one
 * shared extra (it flips the delivery, see ALIBABA_TTS_DELIVERY); the
 * Instruct rows add the instruction pair. Voices are a closed per-model list
 * on this API — 48 on the Flash pair, 17 on the 2025-09-18 snapshot, 24 on
 * the Instruct pair — so the rows narrow `voice` where almost every other
 * provider leaves it open.
 */
const FLASH_EXTRAS = { stream: EXTRA as boolean } as const;

const INSTRUCT_EXTRAS = {
  stream: EXTRA as boolean,
  instructions: EXTRA as string,
  optimize_instructions: EXTRA as boolean,
} as const;

const FLASH_ROW = {
  codecs: [],
  languages: TTS_LANGUAGES,
  voices: QWEN3_TTS_FLASH_VOICES,
  extras: FLASH_EXTRAS,
} as const;

const INSTRUCT_ROW = {
  codecs: [],
  languages: TTS_LANGUAGES,
  voices: QWEN3_TTS_INSTRUCT_FLASH_VOICES,
  extras: INSTRUCT_EXTRAS,
} as const;

export const ALIBABA_TTS_MODEL_PARAMS = {
  "qwen3-tts-flash": FLASH_ROW,
  "qwen3-tts-flash-2025-11-27": FLASH_ROW,
  "qwen3-tts-flash-2025-09-18": {
    codecs: [],
    languages: TTS_LANGUAGES,
    voices: QWEN3_TTS_FLASH_2025_09_18_VOICES,
    extras: FLASH_EXTRAS,
  },
  "qwen3-tts-instruct-flash": INSTRUCT_ROW,
  "qwen3-tts-instruct-flash-2026-01-26": INSTRUCT_ROW,
} as const satisfies TtsModelParamTable;

/**
 * A URL by default — `output.audio.url`, a WAV file valid for 24 hours — and
 * an SSE stream of Base64 PCM chunks when the request sets `stream: true`.
 */
export const ALIBABA_TTS_DELIVERY = {
  byRequestField: "stream",
  variants: {
    true: { kind: "sse" },
    false: { kind: "url", path: ["output", "audio", "url"] },
  },
  default: { kind: "url", path: ["output", "audio", "url"] },
} as const satisfies TtsDeliverySpec;
