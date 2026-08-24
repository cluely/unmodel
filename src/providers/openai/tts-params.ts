/**
 * The tts adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/openai/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { TtsDeliverySpec, TtsModelParamTable } from "../../core/unified/vocabulary/tts";
import { SPEECH_VOICES, TTS_1_VOICES } from "./constraints";

/** Every speech model the hand catalog carries — the ref union for `openai/…`. */
export const MODELS = ["tts-1", "tts-1-hd", "gpt-4o-mini-tts", "gpt-4o-mini-tts-2025-12-15"] as const;

export const SPEECH_DOCS = "https://developers.openai.com/api/docs/api-reference/audio/createSpeech";

/**
 * `response_format` — a codec, full stop.
 *
 * `pcm_s16le` is the one canonical codec with two homes here: `"wav"` when it
 * is asked for in a WAV container (the canonical default) and `"pcm"` for the
 * bare 24 kHz stream. Both carry the same samples; only the header differs, so
 * neither is an approximation.
 */
export const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", opus: "opus", aac: "aac", flac: "flac", pcm_s16le: "pcm" },
  containers: { opus: ["ogg"], pcm_s16le: ["wav", "raw"] },
  unavailable: ["sampleRate", "bitrate"],
  source: SPEECH_DOCS,
};

/** The five codecs `response_format` names, in canonical spelling. */
export const CODECS = ["mp3", "opus", "aac", "flac", "pcm_s16le"] as const;

/**
 * OpenAI's per-model speech surface: one codec set, and one param that splits
 * the catalog in two.
 *
 * `instructions` is `gpt-4o-mini-tts`'s alone — "Does not work with `tts-1` or
 * `tts-1-hd`", which `./tts.ts` states in the type system as
 * `instructions?: never` on the tts-1 arms and `constraints.ts` re-states as a
 * deny rule. Declaring it here makes that the same fact a third time in the one
 * place a *unified* caller can see it, and an editor now offers the key on the
 * two models that take it and refuses it on the two that do not.
 *
 * `voices` is the same split a second time, and the reason this adapter is the
 * only one in the category that declares one: OpenAI hand-catalogues its
 * built-in voices per model — nine for tts-1 / tts-1-hd, thirteen for
 * gpt-4o-mini-tts — and `./tts.ts` already refuses an off-list *string* at
 * the wire with `checkVoice`. Reusing the two constants that drive that check
 * means the unified surface completes exactly what the wire surface completes,
 * rather than the bare `Voice` it used to offer. The TYPE completes and does
 * not gate — `VoiceOf` carries a `(string & {})` tail, so a bare id string
 * compiles on every model. The runtime check is narrower: `checkVoice` skips
 * only a model with NO table, and all four rows below have one, so an off-list
 * bare string is an `invalid_enum_value` at validate time. A cloned voice must
 * be spelled `{ id: "voice_1234" }`, which is the only form the wire documents.
 *
 * `stream_format` is deliberately absent: it selects SSE framing rather than
 * anything about the audio, which puts it in the transport half that
 * `providerOptions.openai` owns. `language` is not narrowed because the
 * endpoint has no language field at all — the adapter declares that gap
 * outright, and the kernel reports it before compile.
 */
export const OPENAI_TTS_MODEL_PARAMS = {
  "tts-1": { codecs: CODECS, voices: TTS_1_VOICES },
  "tts-1-hd": { codecs: CODECS, voices: TTS_1_VOICES },
  "gpt-4o-mini-tts": {
    codecs: CODECS,
    voices: SPEECH_VOICES,
    extras: { instructions: EXTRA as string },
  },
  "gpt-4o-mini-tts-2025-12-15": {
    codecs: CODECS,
    voices: SPEECH_VOICES,
    extras: { instructions: EXTRA as string },
  },
} as const satisfies TtsModelParamTable;

/**
 * Raw audio bytes — unless `stream_format` asks for frames.
 *
 * "JSON in, raw audio bytes (or an SSE stream) out — there is no response
 * checker for speech" (./tts.ts). `stream_format` is the one request field that
 * moves it, which is why it is named here rather than answered: the same field
 * the table above leaves out of `extras` on purpose, because it frames the
 * transport and not the audio. tts-1 and tts-1-hd do not accept `"sse"` at all.
 */
export const OPENAI_TTS_DELIVERY = {
  byRequestField: "stream_format",
  variants: { audio: { kind: "bytes" }, sse: { kind: "sse" } },
  default: { kind: "bytes" },
} as const satisfies TtsDeliverySpec;
