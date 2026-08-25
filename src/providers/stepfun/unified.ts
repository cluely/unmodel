/**
 * `unmodel/tts` → `stepfun.tts` (POST /v1/audio/speech).
 *
 * An OpenAI-shaped body (`model`, `input`, `voice`, `response_format`,
 * `speed`) plus StepFun's own knobs, so the adapter is a rename table and two
 * derivations: `text` → `input`, and one canonical `outputFormat` fanned out
 * to `response_format` + `sample_rate` (a separate wire field here, unlike
 * OpenAI). `pcm_s16le` has two wire spellings — `"wav"` when asked for in a
 * WAV container, `"pcm"` for the bare stream.
 *
 * No `language`: the endpoint has no language field at all — the model reads
 * it off the text (and off `instruction` prose). Declaring the gap makes the
 * kernel report it before compile.
 */
import { applyExtras, resolveAudioFormat, resolveVoice, toSpeed } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { TtsAdapterFor, TtsParams } from "../../core/unified/vocabulary/tts";
import { tts as validator, type StepfunSampleRate, type TtsBody } from "./tts";
import {
  CREATE_SPEECH_DOCS,
  FORMAT,
  MODELS,
  STEPFUN_TTS_DELIVERY,
  STEPFUN_TTS_MODEL_PARAMS,
} from "./tts-params";

/** The wire body this adapter compiles to. */
export type StepfunTtsWire = TtsBody;

/** What a unified call to `stepfun/…` returns: `stepfun.tts`'s own `Validated`. */
export type StepfunTtsResult = ReturnType<typeof validator<StepfunTtsWire>>;

/** Documented `speed` bounds: "0.5 to 2.0; default 1.0". */
const SPEED = { min: 0.5, max: 2, source: CREATE_SPEECH_DOCS };

export const tts = {
  category: "tts",
  provider: "stepfun",
  models: MODELS,
  modelParams: STEPFUN_TTS_MODEL_PARAMS,
  delivery: STEPFUN_TTS_DELIVERY,
  unsupported: {
    language:
      "POST /v1/audio/speech has no language field — stepaudio-2.5-tts reads the language off " +
      "the text itself (and takes delivery direction as prose through `instruction`, an extra " +
      "on this model).",
  },
  compile(
    input: TtsParams,
    ctx: CompileContext<TtsParams>,
  ): CompiledCall<StepfunTtsWire, StepfunTtsResult> {
    ctx.from(["input"], "text");
    ctx.from(["response_format"], "outputFormat");
    ctx.from(["sample_rate"], "outputFormat");

    const body: StepfunTtsWire = { model: ctx.model, input: input.text, voice: "" };

    if (input.voice !== undefined) {
      const voice = ctx.take(
        resolveVoice(
          input.voice,
          { accepts: ["id"], source: CREATE_SPEECH_DOCS },
          { path: ["voice"], warn: ctx.warn },
        ),
      );
      // System voices and cloned voices are both bare id strings on this wire.
      if (voice !== undefined) body.voice = voice.value;
    }

    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined) {
        body.response_format =
          format.codec === "pcm_s16le"
            ? format.container === "wav"
              ? "wav"
              : "pcm"
            : (format.wire as StepfunTtsWire["response_format"]);
        if (format.sampleRate !== undefined) {
          body.sample_rate = format.sampleRate as StepfunSampleRate;
        }
      }
    }

    if (input.speed !== undefined) {
      const speed = ctx.take(toSpeed(input.speed, SPEED, { path: ["speed"], warn: ctx.warn }));
      if (speed !== undefined) body.speed = speed;
    }

    applyExtras(input, STEPFUN_TTS_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies TtsAdapterFor<
  typeof STEPFUN_TTS_MODEL_PARAMS,
  StepfunTtsWire,
  StepfunTtsResult
>;
