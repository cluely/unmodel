/**
 * `unmodel/tts` → `fish-audio.tts` (POST /v1/tts).
 *
 * `model` is a **header**, not a body field — the provider validator strips it
 * out of the body and emits `.request.headers.model` — so the adapter writes
 * it as an ordinary param and lets that relocation happen where it is already
 * implemented.
 *
 * The bitrate fields are the interesting part, and they disagree with each
 * other: **`mp3_bitrate` is in kbps** (64 / 128 / 192) while **`opus_bitrate`
 * is in bits per second** (24000 / 32000 / 48000 / 64000). The canonical
 * `bitrate` is bits per second throughout, so mp3 goes through `bitsToKbps` —
 * which refuses anything that is not a whole number of kbps rather than
 * rounding — and Opus is passed straight through.
 *
 * A bitrate against the wrong codec is an error here rather than the warning
 * the provider would give: `mp3_bitrate` with `format: "opus"` is documented as
 * accepted-and-ignored, so the only way to honour "never silently" is not to
 * emit it in the first place.
 */
import {
  applyExtras,
  bitsToKbps,
  resolveAudioFormat,
  resolveVoice,
  toSpeed,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { TtsAdapterFor, TtsParams } from "../../core/unified/vocabulary/tts";
import {
  tts as validator,
  type FishAudioFormat,
  type FishAudioMp3Bitrate,
  type FishAudioOpusBitrate,
  type TtsBody,
} from "./tts";
import { FISH_AUDIO_TTS_MODEL_PARAMS, FORMAT, MODELS, TTS_DOCS } from "./tts-params";

/** The wire params this adapter compiles to (`model` becomes a header). */
export type FishAudioTtsWire = TtsBody;

/** What a unified call to `fish-audio/…` returns. */
export type FishAudioTtsResult = ReturnType<typeof validator<FishAudioTtsWire>>;

/** The two prosody members; everything else is a body-root field. */
const PROSODY_NESTING: Readonly<Record<string, readonly string[]>> = {
  volume: ["prosody"],
  normalize_loudness: ["prosody"],
};

export const tts = {
  category: "tts",
  provider: "fish-audio",
  models: MODELS,
  modelParams: FISH_AUDIO_TTS_MODEL_PARAMS,
  unsupported: {
    language:
      "POST /v1/tts has no language field — Fish Audio infers the language from the text and " +
      "from the voice behind `reference_id`.",
  },
  compile(
    input: TtsParams,
    ctx: CompileContext<TtsParams>,
  ): CompiledCall<FishAudioTtsWire, FishAudioTtsResult> {
    ctx.from(["reference_id"], "voice");
    ctx.from(["format"], "outputFormat");
    ctx.from(["sample_rate"], "outputFormat");
    ctx.from(["mp3_bitrate"], "outputFormat");
    ctx.from(["opus_bitrate"], "outputFormat");
    ctx.from(["prosody", "speed"], "speed");

    const body: FishAudioTtsWire = { model: ctx.model, text: input.text };

    if (input.voice !== undefined) {
      const voice = ctx.take(
        resolveVoice(
          input.voice,
          { accepts: ["id"], source: TTS_DOCS },
          { path: ["voice"], warn: ctx.warn },
        ),
      );
      if (voice !== undefined) body.reference_id = voice.value;
    }

    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined) {
        body.format =
          format.codec === "pcm_s16le" && format.container === "raw"
            ? "pcm"
            : (format.wire as FishAudioFormat);
        if (format.sampleRate !== undefined) body.sample_rate = format.sampleRate;
        if (format.bitrate !== undefined) {
          if (format.codec === "opus") {
            // Already bits per second on the wire — no conversion.
            body.opus_bitrate = format.bitrate as FishAudioOpusBitrate;
          } else {
            const kbps = ctx.take(
              bitsToKbps(format.bitrate, { path: ["outputFormat"], warn: ctx.warn }),
            );
            if (kbps !== undefined) body.mp3_bitrate = kbps as FishAudioMp3Bitrate;
          }
        }
      }
    }

    if (input.speed !== undefined) {
      const speed = ctx.take(
        toSpeed(
          input.speed,
          { min: 0.5, max: 2, source: TTS_DOCS },
          { path: ["speed"], warn: ctx.warn },
        ),
      );
      if (speed !== undefined) body.prosody = { speed };
    }

    applyExtras(input, FISH_AUDIO_TTS_MODEL_PARAMS, body, ctx, { nest: PROSODY_NESTING });

    return { params: body, validate: validator.safe };
  },
} as const satisfies TtsAdapterFor<
  typeof FISH_AUDIO_TTS_MODEL_PARAMS,
  FishAudioTtsWire,
  FishAudioTtsResult
>;
