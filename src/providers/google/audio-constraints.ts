/**
 * Gemini audio-INPUT constants — and nothing else.
 *
 * Import-free for the same reason as `./tts-constraints.ts` and
 * `./model-path.ts`: `./constraints.ts` reads `src/catalog/google.gen.ts` and
 * `./veo-models.ts`, so a single edge from the STT surface to the constraint
 * tables would drag the generated catalog and the Veo rows into a bundle that
 * only wanted an audio MIME list. `./constraints.ts` re-exports everything
 * below, so the public surface of `unmodel/google` is unchanged by the split.
 *
 * The split point is INPUT vs OUTPUT audio: what a model can be *given* lives
 * here (formats, byte and duration caps, tokens-per-second, the curated
 * transcription model list), what it *produces* lives in `./tts-constraints.ts`.
 */

/** The audio-understanding guide (formats, token rate, duration cap). */
export const GOOGLE_AUDIO_DOCS_URL = "https://ai.google.dev/gemini-api/docs/audio";

/**
 * Inline media rides in the JSON body, and Google caps the TOTAL request
 * (prompts + all inline bytes) at 100MB — so any single inline part over
 * 100MB is certainly over. Sources:
 * - https://ai.google.dev/gemini-api/docs/files ("Always use the Files API
 *   when the total request size ... is larger than 100 MB")
 * - https://ai.google.dev/gemini-api/docs/file-input-methods ("100 MB per
 *   request or payload (50 MB for PDFs)")
 * NOTE: the audio page (GOOGLE_AUDIO_DOCS_URL) still says 20MB — Google's docs
 * conflict; we chose the permissive bound to avoid false positives. The API is
 * the final arbiter.
 *
 * It lives in the *audio* leaf although it bounds every inline media kind:
 * ./stt needs it without reaching ./constraints, and one declaration that the
 * image and video rules import back is better than two that can disagree.
 */
export const INLINE_MEDIA_MAX_BYTES = 100 * 1024 * 1024;

/** "Max length: 9.5 hours of audio per prompt." Source: GOOGLE_AUDIO_DOCS_URL */
export const GEMINI_AUDIO_MAX_DURATION_SECONDS = 9.5 * 3600;

/**
 * "Tokens: 32 tokens per second of audio (1 minute = 1,920 tokens)."
 * Source: GOOGLE_AUDIO_DOCS_URL ("Technical details about audio").
 * ./stt's estimate multiplies a declared `durationSeconds` by this.
 */
export const GEMINI_AUDIO_TOKENS_PER_SECOND = 32;

/**
 * Documented audio MIME subtypes (wav, mp3, aiff, aac, ogg, flac);
 * "mpeg" added because MP3 files are conventionally sent as audio/mpeg.
 * Source: GOOGLE_AUDIO_DOCS_URL ("Supported audio formats").
 */
export const GEMINI_AUDIO_FORMATS = ["wav", "mp3", "mpeg", "aiff", "aac", "ogg", "flac"] as const;

/**
 * The same seven, as full MIME types.
 *
 * CLOSED — deliberately no `(string & {})` tail. The audio page publishes the
 * whole set, and `checkPartMedia` already reports `media_unsupported_format`
 * for anything off it, so a tail would advertise an allowed-value space Google
 * has not published *and* switch the editor's completion list off. (Contrast
 * `GeminiTtsLanguageCode`, which is tailed because the REST reference's own
 * example is a value its table does not list.)
 */
export const GEMINI_AUDIO_MIME_TYPES = [
  "audio/wav",
  "audio/mp3",
  "audio/mpeg",
  "audio/aiff",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
] as const;

/** One of the seven documented audio input MIME types. */
export type GeminiAudioMimeType = (typeof GEMINI_AUDIO_MIME_TYPES)[number];

/**
 * The Gemini models `google.stt` curates for transcription: mainline
 * generateContent models whose catalog row is audio-in / text-out.
 *
 * Hand-curated rather than derived, and the drift test in `stt.test.ts` is
 * what keeps the hand off the scale: every id below must still be audio-in /
 * text-out in the generated catalog, and every audio-input id in that catalog
 * must appear either here or in {@link GEMINI_STT_EXCLUDED_IDS}. A codegen
 * refresh therefore has to CLASSIFY a new model, not absorb it.
 */
export const GEMINI_STT_MODEL_IDS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-3.1-pro-preview",
  "gemini-3.1-pro-preview-customtools",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
] as const;

/** One of the curated Gemini transcription model ids. */
export type GeminiSttModelId = (typeof GEMINI_STT_MODEL_IDS)[number];

/**
 * The audio-input models `google.stt` deliberately does NOT serve, each with
 * the reason `checkStt`'s error message quotes.
 *
 * They are listed rather than merely absent so the refusal can say *why* and
 * name the surface that does serve them — an unlisted id would fall through to
 * the generic "not curated" message, which tells a caller nothing about
 * whether they picked a wrong model or hit a gap in unmodel.
 */
export const GEMINI_STT_EXCLUDED_IDS: Readonly<Record<string, string>> = {
  "gemini-3.1-flash-live-preview":
    "it is a Live API model — its audio arrives over the bidiGenerateContent WebSocket, not this unary generateContent route",
  "gemini-3.5-live-translate-preview":
    "it is a Live API translation model — its audio arrives over the bidiGenerateContent WebSocket, not this unary generateContent route",
  "gemini-embedding-2":
    "it is an embedding model served by :embedContent (its output limit is 1 token), so it cannot return a transcript",
  "gemini-robotics-er-1.6-preview":
    "it is an embodied-reasoning model; Google documents no transcription behaviour for it",
  "deep-research-preview-04-2026":
    "it is the agentic Deep Research surface (it emits images alongside text), not a transcription model",
  "deep-research-max-preview-04-2026":
    "it is the agentic Deep Research surface (it emits images alongside text), not a transcription model",
};
