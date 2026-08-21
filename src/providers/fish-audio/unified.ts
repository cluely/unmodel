/**
 * `unmodel/speech` → `fish-audio.speech` (POST /v1/tts).
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
  EXTRA,
  resolveAudioFormat,
  resolveVoice,
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
  type FishAudioFormat,
  type FishAudioLatency,
  type FishAudioMp3Bitrate,
  type FishAudioOpusBitrate,
  type TtsBody,
} from "./speech";

/** The four TTS model ids — the ref union for `fish-audio/…`. */
const MODELS = ["s2.1-pro", "s2.1-pro-free", "s2-pro", "s1"] as const;

const TTS_DOCS = "https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech";

/** The wire params this adapter compiles to (`model` becomes a header). */
export type FishAudioSpeechWire = TtsBody;

/** What a unified call to `fish-audio/…` returns. */
export type FishAudioSpeechResult = ReturnType<typeof validator<FishAudioSpeechWire>>;

const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", opus: "opus", pcm_s16le: "wav" },
  containers: { mp3: ["mp3"], opus: ["ogg"], pcm_s16le: ["wav", "raw"] },
  // `sample_rate` is an open positive integer on the wire ("defaults per
  // format"), so there is no list to check against here.
  bitrates: { mp3: [64000, 128000, 192000], opus: [24000, 32000, 48000, 64000] },
  unavailable: { pcm_s16le: ["bitrate"] },
  source: TTS_DOCS,
};

/**
 * Fish Audio's per-model surface: one codec set, and one row that is a member
 * short.
 *
 * `normalize_loudness` "applies to the S2 family (`s2-pro`, `s2.1-pro`,
 * `s2.1-pro-free`); on `s1` it is accepted but has no effect" — the
 * accepted-and-ignored case again, and the provider's own `checkProsody` warns
 * about it. Declaring it on the three S2 ids and not on `s1` moves that warning
 * to compile time, where a caller can still change their mind about the model.
 *
 * The rest is one shared block of sampling and chunking controls, which is what
 * this endpoint has instead of a canonical vocabulary: `temperature` / `top_p`
 * / `repetition_penalty` steer the model, `chunk_length` / `min_chunk_length` /
 * `max_new_tokens` / `early_stop_threshold` / `condition_on_previous_chunks`
 * steer the streaming decoder, and `latency` picks a quality-versus-delay
 * profile. `prosody.volume` nests beside the `speed` the adapter compiles;
 * everything else is a body-root field.
 *
 * `references` and `reference_audio` are excluded: they are inline voice
 * cloning payloads, and `voice` — the canonical word — is Fish's
 * `reference_id`, the *stored* form of the same thing.
 */
const SHARED_TTS_EXTRAS = {
  // → prosody.*
  volume: EXTRA as number | null,
  // → body root
  temperature: EXTRA as number | null,
  top_p: EXTRA as number | null,
  repetition_penalty: EXTRA as number | null,
  normalize: EXTRA as boolean | null,
  latency: EXTRA as FishAudioLatency,
  chunk_length: EXTRA as number | null,
  min_chunk_length: EXTRA as number | null,
  max_new_tokens: EXTRA as number | null,
  condition_on_previous_chunks: EXTRA as boolean | null,
  early_stop_threshold: EXTRA as number | null,
  features: EXTRA as string[] | null,
} as const;

const CODECS = ["mp3", "opus", "pcm_s16le"] as const;

const S2_ROW = {
  codecs: CODECS,
  extras: { ...SHARED_TTS_EXTRAS, normalize_loudness: EXTRA as boolean | null },
} as const;

const FISH_AUDIO_SPEECH_MODEL_PARAMS = {
  "s2.1-pro": S2_ROW,
  "s2.1-pro-free": S2_ROW,
  "s2-pro": S2_ROW,
  s1: { codecs: CODECS, extras: SHARED_TTS_EXTRAS },
} as const satisfies SpeechModelParamTable;

/** The two prosody members; everything else is a body-root field. */
const PROSODY_NESTING: Readonly<Record<string, readonly string[]>> = {
  volume: ["prosody"],
  normalize_loudness: ["prosody"],
};

export const speech = {
  category: "speech",
  provider: "fish-audio",
  models: MODELS,
  modelParams: FISH_AUDIO_SPEECH_MODEL_PARAMS,
  unsupported: {
    language:
      "POST /v1/tts has no language field — Fish Audio infers the language from the text and " +
      "from the voice behind `reference_id`.",
  },
  compile(
    input: SpeechParams,
    ctx: CompileContext<SpeechParams>,
  ): CompiledCall<FishAudioSpeechWire, FishAudioSpeechResult> {
    ctx.from(["reference_id"], "voice");
    ctx.from(["format"], "outputFormat");
    ctx.from(["sample_rate"], "outputFormat");
    ctx.from(["mp3_bitrate"], "outputFormat");
    ctx.from(["opus_bitrate"], "outputFormat");
    ctx.from(["prosody", "speed"], "speed");

    const body: FishAudioSpeechWire = { model: ctx.model, text: input.text };

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

    applyExtras(input, FISH_AUDIO_SPEECH_MODEL_PARAMS, body, ctx, { nest: PROSODY_NESTING });

    return { params: body, validate: validator.safe };
  },
} as const satisfies SpeechAdapterFor<
  typeof FISH_AUDIO_SPEECH_MODEL_PARAMS,
  FishAudioSpeechWire,
  FishAudioSpeechResult
>;
