/**
 * `unmodel/tts` → `inworld.tts` (POST /tts/v1/voice).
 *
 * `audioConfig` is the closest thing in this category to the canonical
 * `outputFormat`: encoding, sample rate and bitrate are three fields on one
 * object, so the mapping is nearly a rename — plus `speakingRate`, which is a
 * plain multiplier (0.5–1.5) and therefore an identity mapping.
 *
 * One deliberate omission: **`LINEAR16` is not used.** Inworld's encoding enum
 * carries `LINEAR16`, `PCM` and `WAV`, and its docs do not say which of the
 * three includes a RIFF header. `PCM` and `WAV` are unambiguous by name, so
 * they are what a canonical `pcm_s16le` compiles to (raw and WAV
 * respectively); `LINEAR16` stays reachable through
 * `providerOptions.inworld.audioConfig`.
 */
import { applyExtras, resolveAudioFormat, resolveVoice, toSpeed } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { TtsAdapterFor, TtsParams } from "../../core/unified/vocabulary/tts";
import {
  tts as validator,
  type InworldAudioConfig,
  type InworldAudioEncoding,
  type InworldSampleRateHertz,
  type TtsVoiceBody,
} from "./tts";
import { FORMAT, INWORLD_TTS_MODEL_PARAMS, MODELS, SYNTHESIZE_DOCS } from "./tts-params";

/** The wire body this adapter compiles to. */
export type InworldTtsWire = TtsVoiceBody;

/** What a unified call to `inworld/…` returns. */
export type InworldTtsResult = ReturnType<typeof validator>;

export const tts = {
  category: "tts",
  provider: "inworld",
  models: MODELS,
  modelParams: INWORLD_TTS_MODEL_PARAMS,
  compile(
    input: TtsParams,
    ctx: CompileContext<TtsParams>,
  ): CompiledCall<InworldTtsWire, InworldTtsResult> {
    ctx.from(["voiceId"], "voice");
    ctx.from(["modelId"], "model");
    ctx.from(["audioConfig"], "outputFormat");
    ctx.from(["audioConfig", "speakingRate"], "speed");

    const body: InworldTtsWire = { text: input.text, voiceId: "", modelId: ctx.model };

    if (input.voice !== undefined) {
      const voice = ctx.take(
        resolveVoice(
          input.voice,
          { accepts: ["id"], source: SYNTHESIZE_DOCS },
          { path: ["voice"], warn: ctx.warn },
        ),
      );
      if (voice !== undefined) body.voiceId = voice.value;
    }

    const audioConfig: InworldAudioConfig = {};
    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined) {
        audioConfig.audioEncoding =
          format.codec === "pcm_s16le" && format.container === "raw"
            ? "PCM"
            : (format.wire as InworldAudioEncoding);
        if (format.sampleRate !== undefined) {
          audioConfig.sampleRateHertz = format.sampleRate as InworldSampleRateHertz;
        }
        if (format.bitrate !== undefined) audioConfig.bitRate = format.bitrate;
      }
    }

    if (input.speed !== undefined) {
      const speed = ctx.take(
        toSpeed(
          input.speed,
          { min: 0.5, max: 1.5, source: SYNTHESIZE_DOCS },
          { path: ["speed"], warn: ctx.warn },
        ),
      );
      if (speed !== undefined) audioConfig.speakingRate = speed;
    }

    if (Object.keys(audioConfig).length > 0) body.audioConfig = audioConfig;

    // BCP-47 already ("en-US"), which is exactly what `language` takes.
    if (input.language !== undefined) body.language = input.language;

    applyExtras(input, INWORLD_TTS_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies TtsAdapterFor<
  typeof INWORLD_TTS_MODEL_PARAMS,
  InworldTtsWire,
  InworldTtsResult
>;
