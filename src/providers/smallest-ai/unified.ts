/**
 * `unmodel/tts` → `smallest-ai.tts` (POST /waves/v1/tts).
 *
 * The flattest body of the fourteen: `text`, `voice_id`, `model`, `speed`,
 * `language`, `output_format` and `sample_rate` are all top-level, so the
 * adapter is a rename table plus two derivations.
 *
 * `output_format` names the container and the codec together (`pcm` is the
 * bare stream, `wav` the same samples with a header, `ulaw`/`alaw` the
 * telephony codecs) and there is no bitrate field anywhere, so a canonical
 * bitrate is an error rather than a value dropped.
 *
 * Note the endpoint's 250-character cap and its `accept: audio/wav` header:
 * both are the provider validator's business, and a unified call gets them for
 * free because it ends in that same validator.
 */
import {
  applyExtras,
  resolveAudioFormat,
  resolveVoice,
  toPrimaryLanguage,
  toSpeed,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { TtsAdapterFor, TtsParams } from "../../core/unified/vocabulary/tts";
import {
  tts as validator,
  type SmallestLanguage,
  type SmallestOutputFormat,
  type SmallestSampleRate,
  type TtsParams as SmallestWireParams,
} from "./tts";
import { FORMAT, MODELS, SMALLEST_TTS_MODEL_PARAMS, SYNTHESIZE_DOCS } from "./tts-params";

/** The wire params this adapter compiles to. */
export type SmallestTtsWire = SmallestWireParams;

/** What a unified call to `smallest-ai/…` returns. */
export type SmallestTtsResult = ReturnType<typeof validator<SmallestTtsWire>>;

export const tts = {
  category: "tts",
  provider: "smallest-ai",
  models: MODELS,
  modelParams: SMALLEST_TTS_MODEL_PARAMS,
  compile(
    input: TtsParams,
    ctx: CompileContext<TtsParams>,
  ): CompiledCall<SmallestTtsWire, SmallestTtsResult> {
    ctx.from(["voice_id"], "voice");
    ctx.from(["output_format"], "outputFormat");
    ctx.from(["sample_rate"], "outputFormat");

    const body: SmallestTtsWire = { text: input.text, voice_id: "", model: ctx.model };

    if (input.voice !== undefined) {
      const voice = ctx.take(
        resolveVoice(
          input.voice,
          { accepts: ["id"], source: SYNTHESIZE_DOCS },
          { path: ["voice"], warn: ctx.warn },
        ),
      );
      if (voice !== undefined) body.voice_id = voice.value;
    }

    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined) {
        body.output_format =
          format.codec === "pcm_s16le" && format.container === "raw"
            ? "pcm"
            : (format.wire as SmallestOutputFormat);
        if (format.sampleRate !== undefined) {
          body.sample_rate = format.sampleRate as SmallestSampleRate;
        }
      }
    }

    if (input.speed !== undefined) {
      const speed = ctx.take(
        toSpeed(
          input.speed,
          { min: 0.5, max: 2, source: SYNTHESIZE_DOCS },
          { path: ["speed"], warn: ctx.warn },
        ),
      );
      if (speed !== undefined) body.speed = speed;
    }

    if (input.language !== undefined) {
      const language = ctx.take(
        toPrimaryLanguage(
          input.language,
          { path: ["language"], warn: ctx.warn },
          { source: SYNTHESIZE_DOCS },
        ),
      );
      // The 32-code enum (and the 11 codes that are Pro-only) is the provider
      // validator's business — it knows which pool the ref selected.
      if (language !== undefined) body.language = language as SmallestLanguage;
    }

    applyExtras(input, SMALLEST_TTS_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies TtsAdapterFor<
  typeof SMALLEST_TTS_MODEL_PARAMS,
  SmallestTtsWire,
  SmallestTtsResult
>;
