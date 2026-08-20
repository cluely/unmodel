/**
 * `unmodel/speech` → `elevenlabs.speech` (POST /v1/text-to-speech/{voice_id}).
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
 *   `elevenlabs.speech`'s own `checkOutputFormat`, whose finding is remapped
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
  bitsToKbps,
  resolveAudioFormat,
  resolveVoice,
  toPrimaryLanguage,
  toSpeed,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall, UnifiedAdapter } from "../../core/unified/types";
import type { SpeechParams } from "../../core/unified/vocabulary/speech";
import { speech as validator, type TextToSpeechParams } from "./speech";

/** The six text-to-speech model ids — the ref union for `elevenlabs/…`. */
const MODELS = [
  "eleven_v3",
  "eleven_multilingual_v2",
  "eleven_flash_v2_5",
  "eleven_flash_v2",
  "eleven_turbo_v2_5",
  "eleven_turbo_v2",
] as const;

const TTS_DOCS = "https://elevenlabs.io/docs/api-reference/text-to-speech/convert";

/** The wire params this adapter compiles to (voice_id + query params included). */
export type ElevenlabsSpeechWire = TextToSpeechParams;

/** What a unified call to `elevenlabs/…` returns. */
export type ElevenlabsSpeechResult = ReturnType<typeof validator>;

/**
 * The capability behind `output_format`, enumerated from the same
 * `TTS_OUTPUT_FORMATS` list the provider validator checks against.
 *
 * `ulaw`/`alaw` are bare telephony streams with no WAV header, so their only
 * container is `"raw"` — asking for μ-law substitutes the container the
 * canonical default assumes and says so.
 */
const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", opus: "opus", pcm_s16le: "pcm", pcm_mulaw: "ulaw", pcm_alaw: "alaw" },
  containers: {
    mp3: ["mp3"],
    opus: ["ogg"],
    pcm_s16le: ["wav", "raw"],
    pcm_mulaw: ["raw"],
    pcm_alaw: ["raw"],
  },
  sampleRates: {
    mp3: [22050, 24000, 44100],
    opus: [48000],
    pcm_s16le: [8000, 16000, 22050, 24000, 32000, 44100, 48000],
    pcm_mulaw: [8000],
    pcm_alaw: [8000],
  },
  bitrates: {
    mp3: [32000, 48000, 64000, 96000, 128000, 192000],
    opus: [32000, 64000, 96000, 128000, 192000],
  },
  // PCM, μ-law and A-law are uncompressed: the composite has no bitrate slot.
  unavailable: { pcm_s16le: ["bitrate"], pcm_mulaw: ["bitrate"], pcm_alaw: ["bitrate"] },
  defaults: { sampleRate: 44100, bitrate: 128000 },
  defaultsByCodec: {
    opus: { sampleRate: 48000 },
    pcm_mulaw: { sampleRate: 8000 },
    pcm_alaw: { sampleRate: 8000 },
  },
  source: TTS_DOCS,
};

export const speech = {
  category: "speech",
  provider: "elevenlabs",
  models: MODELS,
  compile(
    input: SpeechParams,
    ctx: CompileContext<SpeechParams>,
  ): CompiledCall<ElevenlabsSpeechWire, ElevenlabsSpeechResult> {
    // `voice_id` is a URL path param the validator strips out of the body; it
    // is still a params key, so the provenance below is what makes "voice_id
    // must be a non-empty voice id" arrive at `voice`.
    const body: ElevenlabsSpeechWire = { voice_id: "", text: input.text, model_id: ctx.model };
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

    return { params: body, validate: validator.safe };
  },
} as const satisfies UnifiedAdapter<SpeechParams, ElevenlabsSpeechWire, ElevenlabsSpeechResult>;
