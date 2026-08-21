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
  applyExtras,
  bitsToKbps,
  EXTRA,
  resolveAudioFormat,
  resolveVoice,
  toPrimaryLanguage,
  toSpeed,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  SpeechAdapterFor,
  SpeechModelParamTable,
  SpeechParams,
} from "../../core/unified/vocabulary/speech";
import {
  speech as validator,
  type ElevenlabsPronunciationDictionaryLocator,
  type TextToSpeechParams,
} from "./speech";

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
export type ElevenlabsSpeechResult = ReturnType<typeof validator<ElevenlabsSpeechWire>>;

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

/**
 * ElevenLabs' per-model speech surface — one row, six times.
 *
 * The six model ids share one endpoint, one schema and one `output_format`
 * enum, and `constraints.ts` carries exactly one per-model rule
 * (`language_code` is a documented no-op on `eleven_multilingual_v2`) which is
 * a *warning* about a param the API accepts. So there is nothing here that
 * differs by model, and saying so with one shared row is the honest shape —
 * six divergent-looking literals would imply a distinction the wire does not
 * make.
 *
 * `codecs` is `FORMAT.codecs`' key set, which is the composite enum's codec
 * half: `aac`, `flac` and the wider PCM widths are absent from
 * `TTS_OUTPUT_FORMATS` and are therefore compile errors rather than requests
 * that 422.
 *
 * **No `languages`.** `language_code` is documented as "ISO 639-1" with no
 * published enum — models that do not serve a code ignore it silently — so
 * there is no list to complete, and inventing one would be a completion list
 * with no authority behind it.
 *
 * ## Extras, and the one that nests
 *
 * `voice_settings` is a per-request override of the voice's stored settings,
 * and the adapter already writes `voice_settings.speed` there from the
 * canonical `speed`. Its four other members ride in as extras through
 * {@link VOICE_SETTINGS_NESTING}, so a caller writes `stability: 0.3` beside
 * `speed: 1.1` and both land in the same object — `applyExtras` merges into it
 * rather than replacing it, which is exactly why that merge exists.
 *
 * `pronunciation_dictionary_locators` is on the list even though the research
 * pass did not surface it: it is a documented, typed, generation-affecting body
 * field on every one of the six, and its two sibling providers (Cartesia's
 * `pronunciation_dict_id`, smallest.ai's `pronunciation_dicts`) expose theirs.
 *
 * Excluded on purpose: `output_format` and `voice_id` are canonical words'
 * wire spellings, and the streaming-only knobs (`optimize_streaming_latency`,
 * `enable_logging`) are transport and stay on `providerOptions.elevenlabs`.
 */
const SPEECH_EXTRAS = {
  // → voice_settings.*
  stability: EXTRA as number | null,
  similarity_boost: EXTRA as number | null,
  style: EXTRA as number | null,
  use_speaker_boost: EXTRA as boolean | null,
  // → body root
  pronunciation_dictionary_locators: EXTRA as ElevenlabsPronunciationDictionaryLocator[] | null,
  seed: EXTRA as number | null,
  previous_text: EXTRA as string | null,
  next_text: EXTRA as string | null,
  previous_request_ids: EXTRA as string[] | null,
  next_request_ids: EXTRA as string[] | null,
  apply_text_normalization: EXTRA as "auto" | "on" | "off",
  apply_language_text_normalization: EXTRA as boolean,
  use_pvc_as_ivc: EXTRA as boolean,
} as const;

const ROW = {
  codecs: ["mp3", "opus", "pcm_s16le", "pcm_mulaw", "pcm_alaw"],
  extras: SPEECH_EXTRAS,
} as const;

const ELEVENLABS_SPEECH_MODEL_PARAMS = {
  eleven_v3: ROW,
  eleven_multilingual_v2: ROW,
  eleven_flash_v2_5: ROW,
  eleven_flash_v2: ROW,
  eleven_turbo_v2_5: ROW,
  eleven_turbo_v2: ROW,
} as const satisfies SpeechModelParamTable;

/** The four settings members that live under `voice_settings`, not at the root. */
const VOICE_SETTINGS_NESTING: Readonly<Record<string, readonly string[]>> = {
  stability: ["voice_settings"],
  similarity_boost: ["voice_settings"],
  style: ["voice_settings"],
  use_speaker_boost: ["voice_settings"],
};

export const speech = {
  category: "speech",
  provider: "elevenlabs",
  models: MODELS,
  modelParams: ELEVENLABS_SPEECH_MODEL_PARAMS,
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

    applyExtras(input, ELEVENLABS_SPEECH_MODEL_PARAMS, body, ctx, { nest: VOICE_SETTINGS_NESTING });

    return { params: body, validate: validator.safe };
  },
} as const satisfies SpeechAdapterFor<
  typeof ELEVENLABS_SPEECH_MODEL_PARAMS,
  ElevenlabsSpeechWire,
  ElevenlabsSpeechResult
>;
