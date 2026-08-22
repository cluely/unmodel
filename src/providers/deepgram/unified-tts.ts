/**
 * `unmodel/tts` → `deepgram.tts` (POST /v1/speak).
 *
 * Two things make this adapter unlike the other thirteen.
 *
 * **The voice IS the model.** `model=aura-2-thalia-en` picks both at once, so
 * the ref carries the voice and there is nothing for `voice` to say. Rather
 * than declare `voice` unsupported — which would reject
 * `{ model: "deepgram/aura-2-thalia-en", voice: "aura-2-thalia-en" }`, a
 * request that is perfectly coherent — a `voice` that *agrees* with the ref is
 * accepted and one that disagrees is an `invalid_enum_value` naming the model.
 * Silently preferring one of two conflicting values is the one thing that must
 * not happen.
 *
 * **Everything is a query param.** `encoding`, `container`, `sample_rate` and
 * `bit_rate` ride in the URL, not the body; the provider validator does that
 * split, so this adapter writes them as ordinary params and declares
 * provenance so their findings arrive at `outputFormat`.
 *
 * The documented "Audio Format Combinations" table is what the format spec
 * below encodes: mp3 is fixed at 22050 Hz and opus/aac have no sample-rate
 * field at all (so naming one is an error, not a silent drop), while linear16,
 * μ-law, A-law and FLAC are uncompressed and have no bitrate. The bitrate
 * *ranges* for opus (4–650 kbps) and aac (4–192 kbps) are deliberately not
 * duplicated here: they live in `deepgram.tts`'s own `checkAudioFormat`, and
 * an out-of-range value surfaces that message remapped onto `outputFormat`.
 */
import { applyExtras, resolveAudioFormat, resolveVoice, toSpeed } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { TtsAdapterFor, TtsParams } from "../../core/unified/vocabulary/tts";
import {
  tts as validator,
  type DeepgramSpeakEncoding,
  type DeepgramSpeakSampleRate,
  type SpeakParams,
} from "./tts";
import { DEEPGRAM_TTS_MODEL_PARAMS, FORMAT, MEDIA_DOCS, MODELS } from "./tts-params";

const SPEAK_DOCS = "https://developers.deepgram.com/reference/text-to-speech/speak-request";

/** The wire params this adapter compiles to (body `{text}` + query params). */
export type DeepgramTtsWire = SpeakParams;

/** What a unified call to `deepgram/…` returns. */
export type DeepgramTtsResult = ReturnType<typeof validator>;

export const tts = {
  category: "tts",
  provider: "deepgram",
  models: MODELS,
  modelParams: DEEPGRAM_TTS_MODEL_PARAMS,
  unsupported: {
    language:
      "POST /v1/speak has no language field — the language is baked into the voice, which is " +
      'also the model: pick an id with the locale you want (e.g. "aura-2-celeste-es").',
  },
  compile(
    input: TtsParams,
    ctx: CompileContext<TtsParams>,
  ): CompiledCall<DeepgramTtsWire, DeepgramTtsResult> {
    const body: DeepgramTtsWire = { text: input.text, model: ctx.model };
    ctx.from(["encoding"], "outputFormat");
    ctx.from(["container"], "outputFormat");
    ctx.from(["sample_rate"], "outputFormat");
    ctx.from(["bit_rate"], "outputFormat");

    if (input.voice !== undefined) {
      const voice = ctx.take(
        resolveVoice(
          input.voice,
          { accepts: ["id"], source: SPEAK_DOCS },
          { path: ["voice"], warn: ctx.warn },
        ),
      );
      if (voice !== undefined && voice.value !== ctx.model) {
        ctx.fail({
          code: "invalid_enum_value",
          path: ["voice"],
          message:
            `\`voice\` must be ${JSON.stringify(ctx.model)} for this model — on Deepgram the voice ` +
            `IS the model (\`model=aura-2-thalia-en\` picks both), so ${JSON.stringify(voice.value)} ` +
            `and the ref name two different voices. Drop \`voice\`, or point the ref at it.`,
          meta: { allowed: [ctx.model], value: voice.value, source: SPEAK_DOCS },
        });
      }
    }

    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined) {
        body.encoding = format.wire as DeepgramSpeakEncoding;
        // `container` is only configurable where the table says so; for mp3,
        // FLAC and AAC the codec specifies its own and sending one is an error
        // at the provider. Deepgram spells "no container" as `none`.
        if (format.codec === "opus") body.container = "ogg";
        else if (format.wire === "linear16" || format.wire === "mulaw" || format.wire === "alaw") {
          body.container = format.container === "wav" ? "wav" : "none";
        }
        if (format.sampleRate !== undefined) {
          body.sample_rate = format.sampleRate as DeepgramSpeakSampleRate;
        }
        if (format.bitrate !== undefined) body.bit_rate = format.bitrate;
      }
    }

    if (input.speed !== undefined) {
      const speed = ctx.take(
        toSpeed(
          input.speed,
          { min: 0.7, max: 1.5, source: MEDIA_DOCS },
          { path: ["speed"], warn: ctx.warn },
        ),
      );
      if (speed !== undefined) body.speed = speed;
    }

    applyExtras(input, DEEPGRAM_TTS_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies TtsAdapterFor<
  typeof DEEPGRAM_TTS_MODEL_PARAMS,
  DeepgramTtsWire,
  DeepgramTtsResult
>;
