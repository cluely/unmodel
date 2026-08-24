/**
 * Gemini TTS constants — and nothing else.
 *
 * This module must import nothing at runtime, for the same reason
 * `./model-path.ts` imports nothing: `./constraints.ts` reads
 * `src/catalog/google.gen.ts` and `./veo-models.ts`, so every consumer of one
 * TTS constant used to pay for the whole generated google catalog.
 * `unmodel/tts`'s bundle budget asserts the pack carries **zero** catalogs
 * (test/bundle-budget.test.ts), which a single `./constraints` edge from the
 * TTS surface would break outright. The two `import type`s below are erased by
 * `verbatimModuleSyntax` (tsconfig.json) and emit no edge.
 *
 * `./constraints.ts` re-exports everything below, so the public surface of
 * `unmodel/google` is unchanged by the split.
 *
 * The 30 preset voice names are NOT here: `GooglePrebuiltVoiceConfig.voiceName`
 * is typed from them, and a wire leaf may not import a constraints module — so
 * they live in `./wire.ts` (see the note there). Their descriptors are here,
 * in `GEMINI_TTS_VOICE_INFO`, because nothing is typed from those.
 */

import type { TtsDelivery, TtsDeliverySpec } from "../../core/unified/vocabulary/common";
import type { GeminiTtsVoiceName } from "./wire";

/** The generateContent speech-generation guide (voices, languages, limits, REST samples). */
export const GEMINI_TTS_DOCS_URL =
  "https://ai.google.dev/gemini-api/docs/generate-content/speech-generation";

/** The three TTS model ids on the guide's "Supported models" table. */
export const GEMINI_TTS_MODEL_IDS = [
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-flash-preview-tts",
  "gemini-2.5-pro-preview-tts",
] as const;

/** "you'll need a multiSpeakerVoiceConfig object with each speaker (up to 2)". */
export const GEMINI_TTS_MAX_SPEAKERS = 2;

/**
 * "A TTS session has a context window limit of 32k tokens." models.dev
 * carries 8192 for these ids; the docs win — see ./tts-models.
 */
export const GEMINI_TTS_CONTEXT_TOKENS = 32768;

/**
 * "TTS does not support streaming for models older than version 3.1
 * (streaming is supported for gemini-3.1-flash-tts-preview and newer)."
 * `ttsStreamUrl` in ./tts builds the `:streamGenerateContent` URL; unmodel
 * validates the unary route, so this set is informational.
 */
export const GEMINI_TTS_STREAMING_MODEL_IDS = ["gemini-3.1-flash-tts-preview"] as const;

/**
 * The one-word characteristic the guide's "Voice options" list prints beside
 * each of the 30 preset voices (GEMINI_TTS_DOCS_URL), transcribed 2026-08-24
 * from the live page — the descriptors that sit on the same bulleted list the
 * names in `GEMINI_TTS_VOICES` (./wire) come from.
 *
 * **Display data, never enforced.** No check reads this table: an off-list
 * voice is refused against `GEMINI_TTS_VOICES` by `checkVoiceName`
 * (./tts-checks), and `GooglePrebuiltVoiceConfig.voiceName` is typed from that
 * array, not from these keys. This is here so a picker can label "Zephyr" as
 * "Bright" without inventing the word.
 *
 * Google publishes one column today, so the value is an OBJECT rather than a
 * bare string — the shape a second column can join without breaking callers,
 * the same arrangement `GEMINI_AUDIO_OUTPUT_FORMATS` and `AudioFormatSpec`
 * already use. `as const satisfies` keeps `…["Zephyr"].description` the
 * literal `"Bright"` and makes a 31st voice a BUILD error until its descriptor
 * is transcribed too. Keys are in guide order, which is `GEMINI_TTS_VOICES`
 * order; `src/providers/google/tts.test.ts` pins that.
 *
 * Nothing here is fetched: a reworded descriptor is invisible to every test,
 * exactly as the 78 language names and the 32k context number are. The
 * transcription date above is the guard.
 */
export const GEMINI_TTS_VOICE_INFO = {
  Zephyr: { description: "Bright" },
  Puck: { description: "Upbeat" },
  Charon: { description: "Informative" },
  Kore: { description: "Firm" },
  Fenrir: { description: "Excitable" },
  Leda: { description: "Youthful" },
  Orus: { description: "Firm" },
  Aoede: { description: "Breezy" },
  Callirrhoe: { description: "Easy-going" },
  Autonoe: { description: "Bright" },
  Enceladus: { description: "Breathy" },
  Iapetus: { description: "Clear" },
  Umbriel: { description: "Easy-going" },
  Algieba: { description: "Smooth" },
  Despina: { description: "Smooth" },
  Erinome: { description: "Clear" },
  Algenib: { description: "Gravelly" },
  Rasalgethi: { description: "Informative" },
  Laomedeia: { description: "Upbeat" },
  Achernar: { description: "Soft" },
  Alnilam: { description: "Firm" },
  Schedar: { description: "Even" },
  Gacrux: { description: "Mature" },
  Pulcherrima: { description: "Forward" },
  Achird: { description: "Friendly" },
  Zubenelgenubi: { description: "Casual" },
  Vindemiatrix: { description: "Gentle" },
  Sadachbia: { description: "Lively" },
  Sadaltager: { description: "Knowledgeable" },
  Sulafat: { description: "Warm" },
} as const satisfies Record<GeminiTtsVoiceName, { readonly description: string }>;

/**
 * Every language code on the guide's "Supported languages" table
 * (GEMINI_TTS_DOCS_URL), transcribed 2026-08-21 from the live page — 78 rows,
 * deduped and sorted by code. `test/…/tts.test.ts` pins the count, because the
 * table is the kind of data that grows silently.
 *
 * **These are primary language subtags, not full BCP-47 tags.** The table's
 * column header says "BCP-47 Code" while every value in it is a bare primary
 * subtag ("ar", "pt", "cmn"), including five three-letter ISO 639-2/3 codes
 * (`ceb`, `cmn`, `fil`, `kok`, `mai`) that ISO 639-1 has no member for — which
 * is why this list is transcribed rather than derived from a 639-1 table.
 *
 * The REST reference's own `SpeechConfig.languageCode` example is "en-US", so
 * the type built on this list carries a `(string & {})` tail and the runtime
 * check compares only the PRIMARY subtag and reports a WARNING: the table
 * states which languages the models speak, not which strings the field
 * rejects.
 */
export const GEMINI_TTS_LANGUAGE_CODES = [
  "af", // Afrikaans
  "am", // Amharic
  "ar", // Arabic
  "az", // Azerbaijani
  "be", // Belarusian
  "bg", // Bulgarian
  "bn", // Bangla
  "ca", // Catalan
  "ceb", // Cebuano
  "cmn", // Chinese, Mandarin
  "cs", // Czech
  "da", // Danish
  "de", // German
  "el", // Greek
  "en", // English
  "es", // Spanish
  "et", // Estonian
  "eu", // Basque
  "fa", // Persian
  "fi", // Finnish
  "fil", // Filipino
  "fr", // French
  "gl", // Galician
  "gu", // Gujarati
  "he", // Hebrew
  "hi", // Hindi
  "hr", // Croatian
  "ht", // Haitian Creole
  "hu", // Hungarian
  "hy", // Armenian
  "id", // Indonesian
  "is", // Icelandic
  "it", // Italian
  "ja", // Japanese
  "jv", // Javanese
  "ka", // Georgian
  "kn", // Kannada
  "ko", // Korean
  "kok", // Konkani
  "la", // Latin
  "lb", // Luxembourgish
  "lo", // Lao
  "lt", // Lithuanian
  "lv", // Latvian
  "mai", // Maithili
  "mg", // Malagasy
  "mk", // Macedonian
  "ml", // Malayalam
  "mn", // Mongolian
  "mr", // Marathi
  "ms", // Malay
  "my", // Burmese
  "nb", // Norwegian, Bokmål
  "ne", // Nepali
  "nl", // Dutch
  "nn", // Norwegian, Nynorsk
  "or", // Odia
  "pa", // Punjabi
  "pl", // Polish
  "ps", // Pashto
  "pt", // Portuguese
  "ro", // Romanian
  "ru", // Russian
  "sd", // Sindhi
  "si", // Sinhala
  "sk", // Slovak
  "sl", // Slovenian
  "sq", // Albanian
  "sr", // Serbian
  "sv", // Swedish
  "sw", // Swahili
  "ta", // Tamil
  "te", // Telugu
  "th", // Thai
  "tr", // Turkish
  "uk", // Ukrainian
  "ur", // Urdu
  "vi", // Vietnamese
] as const;

/** One of the 78 primary language subtags the speech-generation guide tabulates. */
export type GeminiTtsLanguageCode = (typeof GEMINI_TTS_LANGUAGE_CODES)[number];

/**
 * The sample rate Gemini TTS natively emits: "raw PCM bytes (24kHz, 1-channel,
 * 16-bit)" in the guide's own streaming sample, and `rate = 24000` in every
 * wave-file helper it ships. It is the DEFAULT for
 * `responseFormat.audio.sampleRate`, not a bound — the REST reference
 * enumerates no allowed rates at all.
 */
export const GEMINI_SPEECH_NATIVE_SAMPLE_RATE = 24000;

/**
 * The band outside which `responseFormat.audio.sampleRate` earns an
 * `approximated_param` WARNING (never an error).
 *
 * DOCUMENTED-UNCERTAINTY, stated plainly because the number is not a quote:
 * the only sample-rate fact Google publishes for this surface is the 24 kHz
 * native rate above. 8000–48000 is the conventional telephony-to-studio span
 * every audio API in this repo lands inside, so a value outside it is much
 * more likely a unit mistake (24 for kHz, 2400 for a typo) than a real
 * request — which is a warning's job, not an error's. Widen or delete it the
 * moment Google publishes a range.
 */
export const GEMINI_SPEECH_SAMPLE_RATE_RANGE = { min: 8000, max: 48000 } as const;

/**
 * The audio output formats `generationConfig.responseFormat.audio.mimeType`
 * takes, in BOTH first-party spellings: the proto-JSON enum name (the REST
 * reference types the field as `enum (AudioResponseFormatMimeType)`) and the
 * MIME spelling (@google/genai@2.17.0's `AudioResponseFormatMimeType` union).
 * The two pages agree on the six values and disagree on how to write them, so
 * all twelve spellings validate — the same arrangement `imageConfig`'s
 * aspectRatio/imageSize pair already has.
 *
 * `as const satisfies`, not an annotation: the annotation erases the pairing,
 * and the discriminated union in ./tts is derived from these literals.
 */
export const GEMINI_AUDIO_OUTPUT_FORMATS = {
  AUDIO_MP3: "audio/mp3",
  AUDIO_OGG_OPUS: "audio/ogg_opus",
  AUDIO_L16: "audio/l16",
  AUDIO_WAV: "audio/wav",
  AUDIO_ALAW: "audio/alaw",
  AUDIO_MULAW: "audio/mulaw",
} as const satisfies Readonly<Record<string, string>>;

/** The proto-JSON enum-name spelling of an audio output format. */
export type GeminiAudioOutputEnumName = keyof typeof GEMINI_AUDIO_OUTPUT_FORMATS;

/** The MIME spelling of an audio output format. */
export type GeminiAudioOutputMimeSpelling =
  (typeof GEMINI_AUDIO_OUTPUT_FORMATS)[GeminiAudioOutputEnumName];

/** Either documented spelling of an audio output format — twelve values. */
export type GeminiAudioOutputMimeType =
  | GeminiAudioOutputEnumName
  | GeminiAudioOutputMimeSpelling;

/**
 * The two COMPRESSED formats, in both spellings.
 * "`bitRate` … Only applicable for compressed formats (MP3, Opus)." — the
 * REST reference and @google/genai's `AudioResponseFormat.bitRate` docstring
 * word for word, which is unambiguous enough to be an ERROR rather than a
 * warning on the other four.
 */
export const GEMINI_COMPRESSED_AUDIO_ENUM_NAMES = ["AUDIO_MP3", "AUDIO_OGG_OPUS"] as const;

/** Compressed audio output formats, either spelling — the only ones `bitRate` applies to. */
export type GeminiCompressedAudioMimeType =
  | (typeof GEMINI_COMPRESSED_AUDIO_ENUM_NAMES)[number]
  | (typeof GEMINI_AUDIO_OUTPUT_FORMATS)[(typeof GEMINI_COMPRESSED_AUDIO_ENUM_NAMES)[number]];

/** Uncompressed audio output formats, either spelling — `bitRate` is refused on these. */
export type GeminiUncompressedAudioMimeType = Exclude<
  GeminiAudioOutputMimeType,
  GeminiCompressedAudioMimeType
>;

/** Every spelling the runtime check accepts, flattened once. */
export const GEMINI_AUDIO_OUTPUT_MIME_TYPES: readonly GeminiAudioOutputMimeType[] = [
  ...(Object.keys(GEMINI_AUDIO_OUTPUT_FORMATS) as GeminiAudioOutputEnumName[]),
  ...(Object.values(GEMINI_AUDIO_OUTPUT_FORMATS) as GeminiAudioOutputMimeSpelling[]),
];

/** Every compressed spelling the runtime check accepts, flattened once. */
export const GEMINI_COMPRESSED_AUDIO_MIME_TYPES: readonly GeminiCompressedAudioMimeType[] = [
  ...GEMINI_COMPRESSED_AUDIO_ENUM_NAMES,
  ...GEMINI_COMPRESSED_AUDIO_ENUM_NAMES.map((name) => GEMINI_AUDIO_OUTPUT_FORMATS[name]),
];

/** `delivery` on `responseFormat.audio` — both first-party spellings. */
export const GEMINI_AUDIO_DELIVERY_MODES = [
  "DELIVERY_UNSPECIFIED",
  "INLINE",
  "URI",
  "inline",
  "uri",
] as const;

/** How generated audio comes back: inline base64, or a URI to fetch. */
export type GeminiAudioDelivery = (typeof GEMINI_AUDIO_DELIVERY_MODES)[number];

/**
 * The same five modes, read from the response side — where the audio actually
 * lands for each of them.
 *
 * Declared beside the enum it maps rather than on `./tts-params.ts`, because
 * this IS that enum's other half; `unmodel/google/values` publishes both from
 * here. `./tts-check.ts` states the shapes: "the audio comes back as
 * `candidates[0].content.parts[0].inlineData` with an `audio/*` mimeType and
 * base64 `data` … or, when the request set `responseFormat.audio.delivery` to
 * `URI`, as a `fileData` part carrying an `audio/*` mimeType and a `fileUri` to
 * fetch instead of bytes."
 */
const INLINE_AUDIO_PART = {
  kind: "base64",
  path: ["candidates", 0, "content", "parts", 0, "inlineData", "data"],
  mimePath: ["candidates", 0, "content", "parts", 0, "inlineData", "mimeType"],
} as const satisfies TtsDelivery;

/** The URI arm: a `fileUri` to fetch, and therefore no bytes in hand. */
const URI_AUDIO_PART = {
  kind: "url",
  path: ["candidates", 0, "content", "parts", 0, "fileData", "fileUri"],
} as const satisfies TtsDelivery;

/**
 * How Gemini hands the audio back, keyed by the request field that decides it.
 *
 * `DELIVERY_UNSPECIFIED` is mapped to the inline arm rather than left out: it
 * is the enum's own name for "not stated", and not stating it is what the
 * default row below already covers.
 */
export const GOOGLE_TTS_DELIVERY = {
  byRequestField: "generationConfig.responseFormat.audio.delivery",
  variants: {
    DELIVERY_UNSPECIFIED: INLINE_AUDIO_PART,
    INLINE: INLINE_AUDIO_PART,
    inline: INLINE_AUDIO_PART,
    URI: URI_AUDIO_PART,
    uri: URI_AUDIO_PART,
  },
  default: INLINE_AUDIO_PART,
} as const satisfies TtsDeliverySpec;
