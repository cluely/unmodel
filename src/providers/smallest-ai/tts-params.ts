/**
 * The tts adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/smallest-ai/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { TtsDeliverySpec, TtsModelParamTable } from "../../core/unified/vocabulary/tts";
import type { SmallestLanguage } from "./models";
import { LANGUAGES, PRO_ONLY_LANGUAGES } from "./models";

/** The two Lightning pools — the ref union for `smallest-ai/…`. */
export const MODELS = ["lightning_v3.1", "lightning_v3.1_pro"] as const;

export const SYNTHESIZE_DOCS =
  "https://docs.smallest.ai/models/api-reference/text-to-speech/synthesize-speech";

export const SAMPLE_RATES = [8000, 16000, 24000, 44100] as const;

export const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", pcm_s16le: "wav", pcm_mulaw: "ulaw", pcm_alaw: "alaw" },
  containers: {
    mp3: ["mp3"],
    pcm_s16le: ["wav", "raw"],
    pcm_mulaw: ["raw"],
    pcm_alaw: ["raw"],
  },
  sampleRates: {
    mp3: SAMPLE_RATES,
    pcm_s16le: SAMPLE_RATES,
    pcm_mulaw: SAMPLE_RATES,
    pcm_alaw: SAMPLE_RATES,
  },
  unavailable: ["bitrate"],
  source: SYNTHESIZE_DOCS,
};

/**
 * The two Lightning pools, and the one thing that separates them: eleven
 * languages.
 *
 * Both rows are computed from the provider's own two arrays rather than copied
 * out of them — `LANGUAGES` minus `"auto"` is the Pro pool's 31, and minus
 * `PRO_ONLY_LANGUAGES` as well is the base pool's 20 — so `checkProOnly`'s
 * allow-list and the editor's completion list are derived from the same source
 * and cannot drift. `"auto"` is dropped for LMNT's reason: it is a wire value
 * the canonical BCP-47 `language` cannot spell, and omitting the field is how
 * this vocabulary says "detect it".
 *
 * `number_pronunciation_language` is the endpoint's second language field —
 * "the language used to read numeric content, independent of `language`" — so
 * it is an extra rather than a canonical word, typed with the provider's own
 * 32-member union (including `"auto"`, which *is* legal there because nothing
 * translates it). `checkProOnly` covers it too, so a Pro-only code on the base
 * pool is still refused at run time.
 */
/**
 * The two pools, derived rather than copied — and cast rather than
 * type-guarded, which is the load-bearing detail.
 *
 * `Array.prototype.filter` with a type predicate answers `Exclude<…>` for
 * *both* calls whatever the predicate actually tests, because a predicate is a
 * claim about one element and not about the array. Written the obvious way
 * (`filter((c): c is Exclude<SmallestLanguage, "auto"> => …)`) both pools type
 * as the same 31 codes, the base row silently gains the 11 Pro-only ones, and
 * an editor offers `"ja"` on `lightning_v3.1` — where `checkProOnly` refuses
 * it. Measured. So each `as` names exactly the set its runtime filter produces,
 * and `test/unified/tts-presets.test.ts` proves the runtime half matches by
 * compiling every code the row declares.
 */
export type ProOnlyLanguage = (typeof PRO_ONLY_LANGUAGES)[number];

export const BASE_LANGUAGES = LANGUAGES.filter(
  (code) => code !== "auto" && !(PRO_ONLY_LANGUAGES as readonly string[]).includes(code),
) as ReadonlyArray<Exclude<SmallestLanguage, "auto" | ProOnlyLanguage>>;

export const PRO_LANGUAGES = LANGUAGES.filter((code) => code !== "auto") as ReadonlyArray<
  Exclude<SmallestLanguage, "auto">
>;

export const SHARED_EXTRAS = {
  number_pronunciation_language: EXTRA as SmallestLanguage,
  math_notation: EXTRA as boolean,
  pronunciation_dicts: EXTRA as string[],
} as const;

export const CODECS = ["mp3", "pcm_s16le", "pcm_mulaw", "pcm_alaw"] as const;

export const SMALLEST_TTS_MODEL_PARAMS = {
  "lightning_v3.1": { codecs: CODECS, languages: BASE_LANGUAGES, extras: SHARED_EXTRAS },
  "lightning_v3.1_pro": { codecs: CODECS, languages: PRO_LANGUAGES, extras: SHARED_EXTRAS },
} as const satisfies TtsModelParamTable;

/**
 * Raw audio bytes: "The response is binary audio, so there is no response
 * checker" (./tts.ts). The streaming routes (POST/WS /waves/v1/tts/live) are
 * not validated by unmodel, so nothing here flips.
 */
export const SMALLEST_TTS_DELIVERY = { kind: "bytes" } as const satisfies TtsDeliverySpec;
