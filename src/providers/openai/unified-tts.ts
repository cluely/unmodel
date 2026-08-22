/**
 * `unmodel/tts` → `openai.tts` (POST /v1/audio/speech).
 *
 * The simplest of the fourteen, and therefore the one worth reading first: the
 * body is `{ model, input, voice, response_format?, speed? }`, so all the
 * adapter does is rename `text` → `input`, decide which of the six
 * `response_format` values a canonical codec is, and hand the result to
 * `openai.tts.safe` — the same validator a hand-written call ends in.
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
import { applyExtras, resolveAudioFormat, resolveVoice, toSpeed } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { TtsAdapterFor, TtsParams } from "../../core/unified/vocabulary/tts";
import { tts as validator, type SpeechCustomVoice } from "./tts";
import { FORMAT, MODELS, OPENAI_TTS_MODEL_PARAMS, SPEECH_DOCS } from "./tts-params";

/** The wire body this adapter compiles to — the loose arm of `SpeechBody`. */
export interface OpenaiTtsWire {
  model: string;
  input: string;
  voice: string | SpeechCustomVoice;
  response_format?: string;
  speed?: number;
  [key: string]: unknown;
}

/** What a unified call to `openai/…` returns: `openai.tts`'s own `Validated`. */
export type OpenaiTtsResult = ReturnType<typeof validator>;

/** Documented `speed` bounds: "0.25 to 4.0; 1.0 is the default". */
const SPEED = { min: 0.25, max: 4, source: SPEECH_DOCS };

export const tts = {
  category: "tts",
  provider: "openai",
  models: MODELS,
  modelParams: OPENAI_TTS_MODEL_PARAMS,
  unsupported: {
    language:
      "POST /v1/audio/speech has no language field — gpt-4o-mini-tts takes language direction " +
      "as prose through `instructions` (send it via `providerOptions.openai`), and tts-1 reads " +
      "the language off the text itself.",
  },
  compile(
    input: TtsParams,
    ctx: CompileContext<TtsParams>,
  ): CompiledCall<OpenaiTtsWire, OpenaiTtsResult> {
    const body: OpenaiTtsWire = { model: ctx.model, input: input.text, voice: "" };
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

    applyExtras(input, OPENAI_TTS_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies TtsAdapterFor<
  typeof OPENAI_TTS_MODEL_PARAMS,
  OpenaiTtsWire,
  OpenaiTtsResult
>;
