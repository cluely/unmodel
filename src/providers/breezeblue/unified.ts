/**
 * `unmodel/tts` → `breezeblue.tts` (POST /v1/text-to-speech/{voice_id}).
 *
 * A small surface: the body is five fields, the format is a bare codec name
 * or a 24 kHz profile in a QUERY param, and the knobs with no canonical word
 * (`instructions`, plus `guidance_scale`, `volume` and `use_speaker_boost`)
 * ride in as extras — the last three nested under `voice_settings`, the only
 * place the wire accepts them.
 *
 * - **`voice` becomes `voice_id`**, which the validator relocates into the
 *   URL path — it is still a params key, so provenance is declared for it and
 *   a missing or empty voice is reported at `voice`. Only the id spelling
 *   (`voc_…`, from GET /v1/voices) is accepted: the API takes no voice name.
 * - **`outputFormat` compiles to a bare codec or a profile.** A bitrate is
 *   spelled `codec_24000_kbps` (`mp3_24000_128`, `aac_24000_128`); a sample
 *   rate alone is spelled `codec_24000` where such a profile exists (FLAC,
 *   WAV, PCM). MP3 and AAC profiles always carry a bitrate, so a rate alone
 *   there sends the bare name, which is already the native 24 kHz. Anything
 *   but 24 kHz, an off-list bitrate, or either on Opus is an error rather than
 *   a value dropped (`FORMAT`). `pcm_s16le` picks its wire word from the
 *   container: `wav` with the RIFF header, `pcm` for the bare stream.
 * - **`speed` becomes `voice_settings.speed`** — the same pitch-preserving
 *   multiplier ("Speech speed multiplier that preserves pitch"). Its 0.5–2.0
 *   range is NOT copied here: it lives in the provider validator, whose
 *   finding arrives at the canonical `speed` path.
 * - **`language` → `language_code`** (ISO 639-1 primary subtag). Which codes
 *   a model serves is runtime data (GET /v1/models `languages`), so the
 *   two-letter shape is checked by the provider validator and the pairing is
 *   the API's to refuse. `breeze-tts-2-multilingual`'s 51 documented codes
 *   complete the canonical `language` — a completion, never a gate.
 * - **`delivery` stays off the canonical surface**: it selects the response
 *   contract (bytes vs 202 job), which the delivery spec describes; set it
 *   through `providerOptions.breezeblue` when you want the async job.
 */
import {
  applyExtras,
  bitsToKbps,
  resolveAudioFormat,
  resolveVoice,
  toPrimaryLanguage,
  toSpeed,
  type ResolvedAudioFormat,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { TtsAdapterFor, TtsParams } from "../../core/unified/vocabulary/tts";
import { tts as validator, type TtsParams as BreezeblueWireParams } from "./tts";
import {
  BREEZEBLUE_TTS_DELIVERY,
  BREEZEBLUE_TTS_MODEL_PARAMS,
  FORMAT,
  MODELS,
  NATIVE_SAMPLE_RATE,
  TTS_DOCS,
} from "./tts-params";

/** The wire params this adapter compiles to (voice_id + query params included). */
export type BreezeblueTtsWire = BreezeblueWireParams;

/** What a unified call to `breezeblue/…` returns. */
export type BreezeblueTtsResult = ReturnType<typeof validator<BreezeblueTtsWire>>;

/** The three settings extras that live under `voice_settings`, not at the body root. */
const VOICE_SETTINGS_NESTING: Readonly<Record<string, readonly string[]>> = {
  guidance_scale: ["voice_settings"],
  volume: ["voice_settings"],
  use_speaker_boost: ["voice_settings"],
};

/** The codecs whose profiles carry no bitrate — "omitting the bitrate for WAV, PCM, and FLAC". */
const RATE_ONLY_PROFILE_CODECS: ReadonlySet<string> = new Set(["flac", "pcm_s16le"]);

export const tts = {
  category: "tts",
  provider: "breezeblue",
  models: MODELS,
  modelParams: BREEZEBLUE_TTS_MODEL_PARAMS,
  delivery: BREEZEBLUE_TTS_DELIVERY,
  compile(
    input: TtsParams,
    ctx: CompileContext<TtsParams>,
  ): CompiledCall<BreezeblueTtsWire, BreezeblueTtsResult> {
    // `voice_id` is a URL path param the validator strips out of the body; it
    // is still a params key, so the provenance below is what makes "voice_id
    // must be a non-empty voice id" arrive at `voice`.
    const body: BreezeblueTtsWire = { voice_id: "", text: input.text, model_id: ctx.model };
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
      if (format !== undefined) {
        let kbps: number | undefined;
        if (format.bitrate !== undefined) {
          kbps = ctx.take(bitsToKbps(format.bitrate, { path: ["outputFormat"], warn: ctx.warn }));
          if (kbps === undefined) return { params: body, validate: validator.safe };
        }
        body.output_format = outputFormatOf(format, kbps) as BreezeblueWireParams["output_format"];
      }
    }

    if (input.speed !== undefined) {
      // No bounds here by design — see the module note.
      const speed = ctx.take(toSpeed(input.speed, {}, { path: ["speed"], warn: ctx.warn }));
      if (speed !== undefined) body.voice_settings = { speed };
    }

    if (input.language !== undefined) {
      const language = ctx.take(
        toPrimaryLanguage(
          input.language,
          { path: ["language"], warn: ctx.warn },
          { source: TTS_DOCS },
        ),
      );
      if (language !== undefined) body.language_code = language;
    }

    applyExtras(input, BREEZEBLUE_TTS_MODEL_PARAMS, body, ctx, { nest: VOICE_SETTINGS_NESTING });

    return { params: body, validate: validator.safe };
  },
} as const satisfies TtsAdapterFor<
  typeof BREEZEBLUE_TTS_MODEL_PARAMS,
  BreezeblueTtsWire,
  BreezeblueTtsResult
>;

/**
 * A resolved encoding → its `output_format` value. The wire word for 16-bit
 * PCM depends on the container: "wav" is the RIFF-framed spelling, "pcm"
 * (FORMAT.codecs' value) the bare stream. FORMAT has already confined the
 * rate to 24 kHz and the bitrate to a published profile, so the spelling is
 * all that is left to decide.
 */
function outputFormatOf(format: ResolvedAudioFormat, kbps: number | undefined): string {
  const word = format.codec === "pcm_s16le" && format.container === "wav" ? "wav" : format.wire;
  if (kbps !== undefined) return `${word}_${NATIVE_SAMPLE_RATE}_${kbps}`;
  if (format.sampleRate !== undefined && RATE_ONLY_PROFILE_CODECS.has(format.codec)) {
    return `${word}_${NATIVE_SAMPLE_RATE}`;
  }
  return word;
}
