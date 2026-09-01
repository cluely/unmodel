/**
 * `unmodel/sts` → `elevenlabs.sts` (POST /v1/speech-to-speech/{voice_id}).
 *
 * Every canonical word lands on a field, and two of them land somewhere other
 * than the body: `voice` is a URL PATH segment and `outputFormat` is a QUERY
 * param, both stripped by `elevenlabs.sts`'s own finalize. `voice_id` is
 * therefore seeded `""` here and the provider validator's own non-empty check
 * answers, remapped onto `voice` — the `unified-tts` arrangement, one route
 * over, and the reason the provenance rules below are worth reading.
 *
 * `voice` is an ID here and nothing else: ElevenLabs' voice field is an opaque
 * handle from GET /v1/voices, so `{ name }` is an error naming the id rather
 * than a string sent to produce a 404. (Hume, the category's other witness,
 * takes both — which is the whole reason the canonical `Voice` has three arms.)
 *
 * `outputFormat` is the same `codec_sampleRate[_bitrate]` composite this
 * provider uses for speech, sound effects and music — assembled here and
 * *validated there*. The enum is byte-identical to the text-to-speech one, and
 * `./sts-params.ts` says why it is still its own constant.
 *
 * The four body knobs (`remove_background_noise`, `seed`, `voice_settings`,
 * `file_format`) and the `enable_logging` query switch ride as per-model
 * extras: not one of them has a second witness in this category, which is
 * `docs/decisions.md` §8 acting rather than an oversight.
 */
import { applyExtras, bitsToKbps, resolveAudioFormat, resolveVoice } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { StsAdapterFor, StsParams } from "../../core/unified/vocabulary/sts";
import { sts as validator, type SpeechToSpeechParams } from "./sts";
import { ELEVENLABS_STS_MODEL_PARAMS, FORMAT, MODELS, STS_DOCS } from "./sts-params";

/** The wire params this adapter compiles to (voice_id + query params included). */
export type ElevenlabsStsWire = SpeechToSpeechParams;

/** What a unified call to `elevenlabs/…` returns. */
export type ElevenlabsStsResult = ReturnType<typeof validator<ElevenlabsStsWire>>;

export const sts = {
  category: "sts",
  provider: "elevenlabs",
  models: MODELS,
  modelParams: ELEVENLABS_STS_MODEL_PARAMS,
  compile(
    input: StsParams,
    ctx: CompileContext<StsParams>,
  ): CompiledCall<ElevenlabsStsWire, ElevenlabsStsResult> {
    const body: ElevenlabsStsWire = {
      voice_id: "",
      audio: input.audio.file,
      model_id: ctx.model,
    };
    ctx.from(["model_id"], "model");
    ctx.from(["voice_id"], "voice");
    ctx.from(["audio"], "audio");
    ctx.from(["output_format"], "outputFormat");

    const voice = ctx.take(
      resolveVoice(
        input.voice,
        { accepts: ["id"], source: STS_DOCS },
        { path: ["voice"], warn: ctx.warn },
      ),
    );
    if (voice !== undefined) body.voice_id = voice.value;

    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined && format.sampleRate !== undefined) {
        const codec =
          format.codec === "pcm_s16le" && format.container === "wav" ? "wav" : format.wire;
        let composite = `${codec}_${format.sampleRate}`;
        if (format.bitrate !== undefined) {
          const kbps = ctx.take(
            bitsToKbps(format.bitrate, { path: ["outputFormat"], warn: ctx.warn }),
          );
          if (kbps === undefined) return { params: body, validate: validator.safe };
          composite = `${composite}_${kbps}`;
        }
        body.output_format = composite as SpeechToSpeechParams["output_format"];
      }
    }

    applyExtras(input, ELEVENLABS_STS_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies StsAdapterFor<
  typeof ELEVENLABS_STS_MODEL_PARAMS,
  ElevenlabsStsWire,
  ElevenlabsStsResult
>;
