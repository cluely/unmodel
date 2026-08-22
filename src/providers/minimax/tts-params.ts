/**
 * The tts adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/minimax/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { TtsModelParamTable } from "../../core/unified/vocabulary/tts";
import type {
  MinimaxEmotion,
  MinimaxLanguageBoost,
  MinimaxTimbreWeight,
  MinimaxVoiceModify,
} from "./tts";

/** The eight T2A v2 model ids — the ref union for `minimax/…`. */
export const MODELS = [
  "speech-2.8-hd",
  "speech-2.8-turbo",
  "speech-2.6-hd",
  "speech-2.6-turbo",
  "speech-02-hd",
  "speech-02-turbo",
  "speech-01-hd",
  "speech-01-turbo",
] as const;

export const T2A_DOCS = "https://platform.minimax.io/docs/api-reference/speech-t2a-http";

export const SAMPLE_RATES = [8000, 16000, 22050, 24000, 32000, 44100] as const;

export const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", flac: "flac", opus: "opus", pcm_s16le: "pcm", pcm_mulaw: "pcmu_raw" },
  containers: {
    mp3: ["mp3"],
    flac: ["flac"],
    opus: ["ogg"],
    pcm_s16le: ["wav", "raw"],
    pcm_mulaw: ["wav", "raw"],
  },
  sampleRates: {
    mp3: SAMPLE_RATES,
    flac: SAMPLE_RATES,
    opus: SAMPLE_RATES,
    pcm_s16le: SAMPLE_RATES,
    pcm_mulaw: SAMPLE_RATES,
  },
  bitrates: { mp3: [32000, 64000, 128000, 256000] },
  unavailable: {
    flac: ["bitrate"],
    opus: ["bitrate"],
    pcm_s16le: ["bitrate"],
    pcm_mulaw: ["bitrate"],
  },
  source: T2A_DOCS,
};

/**
 * BCP-47 primary subtag → MiniMax's own word for that language.
 *
 * Transcribed from the `language_boost` enum in `./tts`. Two spellings map
 * onto one word where the wire has only one (`tl`/`fil` → Filipino,
 * `no`/`nb` → Norwegian); Cantonese has its own entry because MiniMax gives it
 * one (`"Chinese,Yue"`).
 *
 * `as const satisfies`, not an annotation: the per-model `languages` rows below
 * are `keyof typeof LANGUAGE_BOOSTS`, and an annotated
 * `Readonly<Record<string, …>>` makes that `string` — which widens the rows to
 * `readonly string[]`, makes `LanguageOf` answer the bare `string`, and leaves
 * `language:` completing nothing while tsc stays green. Measured with the
 * language service; the same class of silent degrade `AnyModelParamTable`
 * documents. `satisfies` keeps the value checked against the wire enum.
 */
export const LANGUAGE_BOOSTS = {
  af: "Afrikaans",
  ar: "Arabic",
  bg: "Bulgarian",
  ca: "Catalan",
  cs: "Czech",
  da: "Danish",
  de: "German",
  el: "Greek",
  en: "English",
  es: "Spanish",
  fa: "Persian",
  fi: "Finnish",
  fil: "Filipino",
  fr: "French",
  he: "Hebrew",
  hi: "Hindi",
  hr: "Croatian",
  hu: "Hungarian",
  id: "Indonesian",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  ms: "Malay",
  nb: "Norwegian",
  nl: "Dutch",
  nn: "Nynorsk",
  no: "Norwegian",
  pl: "Polish",
  pt: "Portuguese",
  ro: "Romanian",
  ru: "Russian",
  sk: "Slovak",
  sl: "Slovenian",
  sv: "Swedish",
  ta: "Tamil",
  th: "Thai",
  tl: "Filipino",
  tr: "Turkish",
  uk: "Ukrainian",
  vi: "Vietnamese",
  yue: "Chinese,Yue",
  zh: "Chinese",
} as const satisfies Readonly<Record<string, MinimaxLanguageBoost>>;

/** The 42 primary subtags above, and the four the 01/02 series does not serve. */
export type BoostedLanguage = keyof typeof LANGUAGE_BOOSTS;

export type LateLanguage = "fa" | "fil" | "tl" | "ta";

/**
 * MiniMax's per-model surface: one codec set, three language sets, three
 * emotion sets.
 *
 * ## Languages
 *
 * The row is the *canonical* side of {@link LANGUAGE_BOOSTS} — BCP-47 primary
 * subtags, not MiniMax's English words — because that is what a caller writes.
 * "The speech-01 and speech-02 series models do not currently support Persian,
 * Filipino, or Tamil", which the provider's `checkLanguageBoost` enforces, so
 * the four older ids drop `fa`, `fil`, `tl` and `ta` and complete the other 38.
 *
 * ## `emotion`, which is why the extras differ per row
 *
 * `voice_setting.emotion` has seven values everywhere, plus `"fluent"` on the
 * 2.6 and 2.8 pairs and `"whisper"` on the 2.6 pair alone — the wire's own
 * `FLUENT_MODELS` / `WHISPER_MODELS` / `FLUENT_ALSO_ON_2_8` sets, transcribed
 * into three `EXTRA as` casts. So `emotion: "whisper"` completes on
 * `speech-2.6-hd` and is a compile error on `speech-2.8-hd`, which is the
 * `unsupported_capability` that model raises at run time, moved forward.
 *
 * ## Nesting, and the one collision it avoids
 *
 * `voice_setting`'s members and `pronunciation_dict.tone` arrive under their
 * own prefixes ({@link TTS_NESTING}), beside the `voice_id` and `speed` the
 * adapter compiles. `voice_modify` is deliberately **one whole-object extra**
 * rather than four flattened members: it carries its own `pitch`, and
 * `voice_setting` carries a `pitch` too — two different wire params with the
 * same leaf name, which is exactly the case a flat extras namespace cannot
 * spell. One typed object keeps both reachable and keeps them apart.
 *
 * `output_format` (`"url" | "hex"`, how the *response* carries the bytes) is
 * excluded as transport, and its name would collide with the canonical word for
 * the encoding besides.
 */
export const BASE_EMOTIONS = ["happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm"] as const;

export const SHARED_TTS_EXTRAS = {
  // → voice_setting.*
  vol: EXTRA as number,
  pitch: EXTRA as number,
  text_normalization: EXTRA as boolean,
  latex_read: EXTRA as boolean,
  // → pronunciation_dict.*
  tone: EXTRA as string[],
  // → body root
  timbre_weights: EXTRA as MinimaxTimbreWeight[],
  voice_modify: EXTRA as MinimaxVoiceModify,
  subtitle_enable: EXTRA as boolean,
  subtitle_type: EXTRA as "sentence" | "word" | "word_streaming",
} as const;

/**
 * The 42 primary subtags {@link LANGUAGE_BOOSTS} maps, and the 38 the 01/02
 * series serves — "the speech-01 and speech-02 series models do not currently
 * support Persian, Filipino, or Tamil", which is `fa`, `fil`/`tl` and `ta`.
 *
 * Both casts name the exact set the runtime expression produces; a `filter`
 * type predicate would answer the *same* type for both and hand the older
 * models a completion list containing four codes `checkLanguageBoost` refuses.
 */
export const ALL_LANGUAGES = Object.keys(LANGUAGE_BOOSTS) as ReadonlyArray<BoostedLanguage>;

export const LATE_LANGUAGES: ReadonlySet<string> = new Set<LateLanguage>(["fa", "fil", "tl", "ta"]);

export const LEGACY_LANGUAGES = ALL_LANGUAGES.filter((code) => !LATE_LANGUAGES.has(code)) as ReadonlyArray<
  Exclude<BoostedLanguage, LateLanguage>
>;

export const CODECS = ["mp3", "flac", "opus", "pcm_s16le", "pcm_mulaw"] as const;

export const ROW_2_8 = {
  codecs: CODECS,
  languages: ALL_LANGUAGES,
  extras: { ...SHARED_TTS_EXTRAS, emotion: EXTRA as Exclude<MinimaxEmotion, "whisper"> },
} as const;

export const ROW_2_6 = {
  codecs: CODECS,
  languages: ALL_LANGUAGES,
  extras: { ...SHARED_TTS_EXTRAS, emotion: EXTRA as MinimaxEmotion },
} as const;

export const ROW_LEGACY = {
  codecs: CODECS,
  languages: LEGACY_LANGUAGES,
  extras: { ...SHARED_TTS_EXTRAS, emotion: EXTRA as (typeof BASE_EMOTIONS)[number] },
} as const;

export const MINIMAX_TTS_MODEL_PARAMS = {
  "speech-2.8-hd": ROW_2_8,
  "speech-2.8-turbo": ROW_2_8,
  "speech-2.6-hd": ROW_2_6,
  "speech-2.6-turbo": ROW_2_6,
  "speech-02-hd": ROW_LEGACY,
  "speech-02-turbo": ROW_LEGACY,
  "speech-01-hd": ROW_LEGACY,
  "speech-01-turbo": ROW_LEGACY,
} as const satisfies TtsModelParamTable;
