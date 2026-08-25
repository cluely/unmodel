/**
 * The tts adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/stepfun/values` publishes these arrays for client-side pickers and
 * the adapter imports this provider's validator, its zod schema and the
 * compile helpers in `core/unified/derive`. The adapter reads the very same
 * objects, so what is published and what is sent cannot drift.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { TtsDeliverySpec, TtsModelParamTable } from "../../core/unified/vocabulary/tts";

/**
 * The one id the create-speech reference accepts today ("Currently supports
 * `stepaudio-2.5-tts`") — the ref union for `stepfun/…`. The generated
 * catalog also carries `step-tts-2`; it is off the documented enum, so it is
 * not offered here and ./tts.ts warns when it is sent raw.
 */
export const MODELS = ["stepaudio-2.5-tts"] as const;

export const CREATE_SPEECH_DOCS =
  "https://platform.stepfun.ai/docs/en/api-reference/audio/create-audio.md";

/** `sample_rate` — "8000, 16000, 22050, 24000, 48000"; default 24000. */
export const SAMPLE_RATES = [8000, 16000, 22050, 24000, 48000] as const;

/**
 * `response_format` — a codec, with `pcm_s16le` split across two spellings:
 * `"wav"` for the containered stream (the canonical default) and `"pcm"` for
 * the bare one. Same samples, different header — neither is an approximation.
 * `sample_rate` is a separate body field documented endpoint-wide, so every
 * codec advertises the same five rates.
 */
export const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", opus: "opus", flac: "flac", pcm_s16le: "pcm" },
  containers: { pcm_s16le: ["wav", "raw"] },
  sampleRates: {
    mp3: SAMPLE_RATES,
    opus: SAMPLE_RATES,
    flac: SAMPLE_RATES,
    pcm_s16le: SAMPLE_RATES,
  },
  unavailable: ["bitrate"],
  source: CREATE_SPEECH_DOCS,
};

/** The four codecs `response_format` names, in canonical spelling. */
export const CODECS = ["mp3", "opus", "flac", "pcm_s16le"] as const;

/**
 * The system voices the voice-list reference enumerates for
 * stepaudio-2.5-tts (four purpose-built English voices, three
 * Mandarin/multilingual) —
 * https://platform.stepfun.ai/docs/en/api-reference/audio/system-voices.md
 * (2026-08-24). NOT a closed set: `voice` also takes ids cloned via
 * POST /v1/audio/voices, which are account-scoped strings this table cannot
 * know, so no `voices` row is declared and the validator never enum-checks
 * the field. This list exists for pickers.
 */
export const SYSTEM_VOICES = [
  "elegantgentle-female",
  "lively-girl",
  "livelybreezy-female",
  "magnetic-voiced-male",
  "soft-spoken-gentleman",
  "vibrant-youth",
  "zixinnansheng",
] as const;

/**
 * One model, so the table is one row: the four codecs above plus the two
 * documented steering knobs a canonical word does not cover — `instruction`
 * ("global context natural language guidance", ≤200 characters) and `volume`
 * (0.1–2.0, default 1.0). `language` is deliberately absent from the wire:
 * the endpoint has no language field, and the model reads it off the text.
 */
export const STEPFUN_TTS_MODEL_PARAMS = {
  "stepaudio-2.5-tts": {
    codecs: CODECS,
    extras: { instruction: EXTRA as string, volume: EXTRA as number },
  },
} as const satisfies TtsModelParamTable;

/**
 * Raw audio bytes by default; `stream_format: "sse"` switches to SSE frames
 * (`speech.audio.delta` carries base64 chunks). `return_url: true` swaps the
 * binary body for JSON holding a 12-hour download URL — a transport choice
 * the wire body owns, not a delivery kind this spec can express, so it is
 * documented on ./tts.ts rather than modeled here.
 */
export const STEPFUN_TTS_DELIVERY = {
  byRequestField: "stream_format",
  variants: { audio: { kind: "bytes" }, sse: { kind: "sse" } },
  default: { kind: "bytes" },
} as const satisfies TtsDeliverySpec;
