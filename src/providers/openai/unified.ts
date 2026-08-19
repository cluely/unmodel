/**
 * `unmodel/speech` → `openai.speech` (POST /v1/audio/speech).
 *
 * The simplest of the fourteen, and therefore the one worth reading first: the
 * body is `{ model, input, voice, response_format?, speed? }`, so all the
 * adapter does is rename `text` → `input`, decide which of the six
 * `response_format` values a canonical codec is, and hand the result to
 * `openai.speech.safe` — the same validator a hand-written call ends in.
 *
 * Two things it deliberately does NOT do:
 *
 * - **`response_format` names a codec and nothing else.** There is no sample
 *   rate or bitrate field on this endpoint (`pcm` is documented as 24 kHz
 *   16-bit, and mp3 is encoded at OpenAI's own bitrate), so a request that
 *   names either is an `unsupported_param` error rather than a value quietly
 *   dropped.
 * - **No `language`.** gpt-4o-mini-tts steers language through `instructions`,
 *   which is provider-specific prose rather than a BCP-47 tag, and tts-1 reads
 *   it off the text. Declaring the gap makes the kernel say so uniformly.
 *
 * One convention every adapter in this category follows: `ctx.from` is declared
 * for a wire key **only when its name differs from the canonical one**. The
 * remap appends `` (compiled from `x`) `` to the provider's message, which is
 * exactly what you want for `input` ← `text` and pure noise for `speed` ←
 * `speed`. Undeclared paths are left alone, and an identical name needs no
 * translation to be readable.
 */
import {
  resolveAudioFormat,
  resolveVoice,
  toSpeed,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall, UnifiedAdapter } from "../../core/unified/types";
import type { SpeechParams } from "../../core/unified/vocabulary/speech";
import { speech as validator, type SpeechCustomVoice } from "./speech";

/** Every speech model the hand catalog carries — the ref union for `openai/…`. */
const MODELS = ["tts-1", "tts-1-hd", "gpt-4o-mini-tts", "gpt-4o-mini-tts-2025-12-15"] as const;

const SPEECH_DOCS = "https://developers.openai.com/api/docs/api-reference/audio/createSpeech";

/** The wire body this adapter compiles to — the loose arm of `SpeechBody`. */
export interface OpenaiSpeechWire {
  model: string;
  input: string;
  voice: string | SpeechCustomVoice;
  response_format?: string;
  speed?: number;
  [key: string]: unknown;
}

/** What a unified call to `openai/…` returns: `openai.speech`'s own `Validated`. */
export type OpenaiSpeechResult = ReturnType<typeof validator>;

/**
 * `response_format` — a codec, full stop.
 *
 * `pcm_s16le` is the one canonical codec with two homes here: `"wav"` when it
 * is asked for in a WAV container (the canonical default) and `"pcm"` for the
 * bare 24 kHz stream. Both carry the same samples; only the header differs, so
 * neither is an approximation.
 */
const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", opus: "opus", aac: "aac", flac: "flac", pcm_s16le: "pcm" },
  containers: { opus: ["ogg"], pcm_s16le: ["wav", "raw"] },
  unavailable: ["sampleRate", "bitrate"],
  source: SPEECH_DOCS,
};

/** Documented `speed` bounds: "0.25 to 4.0; 1.0 is the default". */
const SPEED = { min: 0.25, max: 4, source: SPEECH_DOCS };

export const speech = {
  category: "speech",
  provider: "openai",
  models: MODELS,
  unsupported: {
    language:
      "POST /v1/audio/speech has no language field — gpt-4o-mini-tts takes language direction " +
      "as prose through `instructions` (send it via `providerOptions.openai`), and tts-1 reads " +
      "the language off the text itself.",
  },
  compile(
    input: SpeechParams,
    ctx: CompileContext<SpeechParams>,
  ): CompiledCall<OpenaiSpeechWire, OpenaiSpeechResult> {
    const body: OpenaiSpeechWire = { model: ctx.model, input: input.text, voice: "" };
    ctx.from(["input"], "text");
    ctx.from(["response_format"], "outputFormat");

    if (input.voice !== undefined) {
      const voice = ctx.take(
        resolveVoice(
          input.voice,
          { accepts: ["name", "id"], source: SPEECH_DOCS },
          { path: ["voice"], warn: ctx.warn },
        ),
      );
      // A built-in voice is a NAME (`"marin"`); a custom voice is the object
      // `{ id: "voice_1234" }`. OpenAI is one of the two providers that take
      // both, which is exactly why `Voice` has three arms.
      if (voice !== undefined) body.voice = voice.kind === "id" ? { id: voice.value } : voice.value;
    }

    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined) {
        body.response_format =
          format.codec === "pcm_s16le" ? (format.container === "wav" ? "wav" : "pcm") : format.wire;
      }
    }

    if (input.speed !== undefined) {
      const speed = ctx.take(toSpeed(input.speed, SPEED, { path: ["speed"], warn: ctx.warn }));
      if (speed !== undefined) body.speed = speed;
    }

    return { params: body, validate: validator.safe };
  },
} as const satisfies UnifiedAdapter<SpeechParams, OpenaiSpeechWire, OpenaiSpeechResult>;
