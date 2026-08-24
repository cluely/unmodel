/**
 * `unmodel/tts` → `elevenlabs.tts` (POST /v1/text-to-speech/{voice_id}).
 *
 * The composite-format provider: `output_format` is a single
 * `codec_sampleRate[_bitrate]` enum (`"mp3_44100_128"`, `"pcm_24000"`,
 * `"ulaw_8000"`), so a canonical `{ format, sampleRate, bitrate }` is
 * *assembled* into one string rather than spread across three fields.
 *
 * Three consequences worth stating:
 *
 * - **Filling a gap warns.** The endpoint's documented default is
 *   `mp3_44100_128`, so `outputFormat: "mp3"` alone compiles to that and
 *   reports two `approximated_param` warnings naming the invented rate and
 *   bitrate. Opus overrides the rate default because ElevenLabs publishes Opus
 *   at 48 kHz only, and filling 44100 there would invent a value the API
 *   rejects.
 * - **Only the combinations ElevenLabs publishes exist.** `mp3_22050_128` is
 *   not one of them; the composite is built here and rejected by
 *   `elevenlabs.tts`'s own `checkOutputFormat`, whose finding is remapped
 *   onto `outputFormat`. One list of legal formats, in the provider.
 * - **`speed` carries no bounds here on purpose.** Its documented range
 *   (0.7–1.2) lives in that same validator's `checkVoiceSettings`; duplicating
 *   it in the adapter would be a second copy to drift, so an out-of-range
 *   speed surfaces the provider's own message at the canonical `speed` path.
 *
 * `voice` becomes `voice_id`, which the validator relocates into the URL path
 * — it is still a params key, so provenance is declared for it and a missing
 * or empty voice is reported at `voice`.
 */
import {
  applyExtras,
  bitsToKbps,
  resolveAudioFormat,
  resolveVoice,
  toPrimaryLanguage,
  toSpeed,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { TtsAdapterFor, TtsParams } from "../../core/unified/vocabulary/tts";
import { tts as validator, type TextToSpeechParams } from "./tts";
import {
  ELEVENLABS_TTS_DELIVERY,
  ELEVENLABS_TTS_MODEL_PARAMS,
  FORMAT,
  MODELS,
  TTS_DOCS,
} from "./tts-params";

/** The wire params this adapter compiles to (voice_id + query params included). */
export type ElevenlabsTtsWire = TextToSpeechParams;

/** What a unified call to `elevenlabs/…` returns. */
export type ElevenlabsTtsResult = ReturnType<typeof validator<ElevenlabsTtsWire>>;

/** The four settings members that live under `voice_settings`, not at the root. */
const VOICE_SETTINGS_NESTING: Readonly<Record<string, readonly string[]>> = {
  stability: ["voice_settings"],
  similarity_boost: ["voice_settings"],
  style: ["voice_settings"],
  use_speaker_boost: ["voice_settings"],
};

export const tts = {
  category: "tts",
  provider: "elevenlabs",
  models: MODELS,
  modelParams: ELEVENLABS_TTS_MODEL_PARAMS,
  delivery: ELEVENLABS_TTS_DELIVERY,
  compile(
    input: TtsParams,
    ctx: CompileContext<TtsParams>,
  ): CompiledCall<ElevenlabsTtsWire, ElevenlabsTtsResult> {
    // `voice_id` is a URL path param the validator strips out of the body; it
    // is still a params key, so the provenance below is what makes "voice_id
    // must be a non-empty voice id" arrive at `voice`.
    const body: ElevenlabsTtsWire = { voice_id: "", text: input.text, model_id: ctx.model };
    ctx.from(["model_id"], "model");
    ctx.from(["voice_id"], "voice");
    ctx.from(["output_format"], "outputFormat");
    ctx.from(["voice_settings", "speed"], "speed");
    ctx.from(["language_code"], "language");

    if (input.voice !== undefined) {
      const voice = ctx.take(
        resolveVoice(
          input.voice,
          { accepts: ["id"], source: TTS_DOCS },
          { path: ["voice"], warn: ctx.warn },
        ),
      );
      if (voice !== undefined) body.voice_id = voice.value;
    }

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
        body.output_format = composite as TextToSpeechParams["output_format"];
      }
    }

    if (input.speed !== undefined) {
      // No bounds here by design — see the module note.
      const speed = ctx.take(toSpeed(input.speed, {}, { path: ["speed"], warn: ctx.warn }));
      if (speed !== undefined) body.voice_settings = { speed };
    }

    if (input.language !== undefined) {
      const language = ctx.take(
        toPrimaryLanguage(input.language, { path: ["language"], warn: ctx.warn }, { source: TTS_DOCS }),
      );
      if (language !== undefined) body.language_code = language;
    }

    applyExtras(input, ELEVENLABS_TTS_MODEL_PARAMS, body, ctx, { nest: VOICE_SETTINGS_NESTING });

    return { params: body, validate: validator.safe };
  },
} as const satisfies TtsAdapterFor<
  typeof ELEVENLABS_TTS_MODEL_PARAMS,
  ElevenlabsTtsWire,
  ElevenlabsTtsResult
>;
