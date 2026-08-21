/**
 * `unmodel/tts` → `murf.tts` / `murf.ttsStream` (POST
 * /v1/speech/generate and /v1/speech/stream).
 *
 * **The ref picks the route.** Murf spells its two models in two different
 * places: `/v1/speech/generate` selects Gen2 with `modelVersion: "GEN2"`, and
 * Falcon 2 is served *only* by `/v1/speech/stream` via `model: "falcon-2"`.
 * So `murf/gen2` compiles to the generate route and `murf/falcon-2` to the
 * streaming one — the alternative, sending Falcon 2 to `/v1/speech/generate`,
 * is an `invalid_enum_value` that no caller of a unified surface could act on.
 *
 * **Speed is a signed percentage.** `rate` is "any integer between -50 and
 * 50", i.e. 0.5×–1.5× in whole percentage points, so `murfSpeed` rounds and
 * warns with the speed actually achieved. `1.234` is not representable; `23`
 * (1.23×) is what gets sent, and the warning says so.
 *
 * **`OGG` is deliberately unmapped.** Murf documents the value but not which
 * codec is inside the container, and guessing between Vorbis and Opus would
 * mean sending a request that quietly produces something else. It stays
 * reachable through `providerOptions.murf.format`.
 */
import {
  applyExtras,
  EXTRA,
  murfSpeed,
  resolveAudioFormat,
  resolveVoice,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  TtsAdapterFor,
  TtsModelParamTable,
  TtsParams,
} from "../../core/unified/vocabulary/tts";
import {
  tts as generateValidator,
  ttsStream as streamValidator,
  type MurfChannelType,
  type MurfFormat,
  type SpeechGenerateBody,
  type SpeechStreamBody,
} from "./tts";

/** The two catalog rows — the ref union for `murf/…`. */
const MODELS = ["gen2", "falcon-2"] as const;

const TTS_OVERVIEW_DOCS = "https://murf.ai/api/docs/text-to-speech/overview";

/** The wire body this adapter compiles to — one arm per route. */
export type MurfTtsWire = SpeechGenerateBody | SpeechStreamBody;

/** What a unified call to `murf/…` returns — again one arm per route. */
export type MurfTtsResult = ReturnType<typeof generateValidator> | ReturnType<typeof streamValidator>;

type MurfValidate = CompiledCall<MurfTtsWire, MurfTtsResult>["validate"];

/**
 * The body under construction, before the route narrows it.
 *
 * Deliberately looser than either arm: the two routes publish different
 * `sampleRate` enums (the streaming one adds 16 kHz), and the value is already
 * checked against the route's own list by {@link formatSpec} before it lands
 * here.
 */
interface MurfDraft {
  text: string;
  voiceId: string;
  model?: string;
  modelVersion?: string;
  format?: MurfFormat;
  sampleRate?: number;
  rate?: number;
  locale?: string;
}

/** Falcon 2 lives on the streaming route and nowhere else. */
const STREAM_ONLY_MODELS: ReadonlySet<string> = new Set(["falcon-2"]);

const CODECS: AudioFormatSpec["codecs"] = {
  mp3: "MP3",
  flac: "FLAC",
  pcm_s16le: "WAV",
  pcm_mulaw: "ULAW",
  pcm_alaw: "ALAW",
};

const CONTAINERS: AudioFormatSpec["containers"] = {
  mp3: ["mp3"],
  flac: ["flac"],
  pcm_s16le: ["wav", "raw"],
  pcm_mulaw: ["raw"],
  pcm_alaw: ["raw"],
};

/** The streaming route adds 16 kHz; everything else about the two matches. */
function formatSpec(rates: readonly number[]): AudioFormatSpec {
  return {
    codecs: CODECS,
    containers: CONTAINERS,
    sampleRates: {
      mp3: rates,
      flac: rates,
      pcm_s16le: rates,
      // "ULAW and ALAW formats only support … a sample rate of 8000 Hz."
      pcm_mulaw: [8000],
      pcm_alaw: [8000],
    },
    unavailable: ["bitrate"],
    source: TTS_OVERVIEW_DOCS,
  };
}

const GENERATE_FORMAT = formatSpec([8000, 24000, 44100, 48000]);
const STREAM_FORMAT = formatSpec([8000, 16000, 24000, 44100, 48000]);

/**
 * Murf's per-model surface, which is really a per-**route** surface — and here
 * that is the same thing.
 *
 * The ref picks the endpoint (`gen2` → `/v1/speech/generate`, `falcon-2` →
 * `/v1/speech/stream`, because Falcon 2 is served nowhere else), so a model
 * serves exactly one route and the video wave's route hazard cannot arise: an
 * extra declared on a row is a field of the one body that row compiles to.
 *
 * `style`, `pitch` and `channelType` are `SpeechCommon` and therefore on both.
 * The four the generate body adds are Gen2's alone: `variation` and
 * `audioDuration` are marked "Gen2 only" in the reference, and
 * `encodeAsBase64` / `wordDurationsAsOriginalText` exist only on
 * `SpeechGenerateBody`. Sending any of them to `/v1/speech/stream` would put a
 * key on a body that has no such field, which is the silent-drop the loss
 * contract forbids — so `falcon-2`'s row stops at three.
 *
 * No `languages`: `locale` is BCP-47 and passes through unmapped (Murf
 * publishes a voice list, not a language enum), so there is nothing closed to
 * complete. `multiNativeLocale` is excluded as deprecated — the provider's own
 * validator says so — and `OGG` never reaches `codecs` because the adapter
 * refuses to guess which codec is inside the container.
 */
const SHARED_MURF_EXTRAS = {
  /** Predefined voice style, e.g. "Angry", "Sad" — a catalog string, not an enum. */
  style: EXTRA as string,
  /** Integer −50…50, like `rate`; the canonical vocabulary has no word for pitch. */
  pitch: EXTRA as number,
  channelType: EXTRA as MurfChannelType,
} as const;

const MURF_CODECS = ["mp3", "flac", "pcm_s16le", "pcm_mulaw", "pcm_alaw"] as const;

const MURF_TTS_MODEL_PARAMS = {
  gen2: {
    codecs: MURF_CODECS,
    extras: {
      ...SHARED_MURF_EXTRAS,
      variation: EXTRA as number,
      audioDuration: EXTRA as number,
      encodeAsBase64: EXTRA as boolean,
      wordDurationsAsOriginalText: EXTRA as boolean,
    },
  },
  "falcon-2": { codecs: MURF_CODECS, extras: SHARED_MURF_EXTRAS },
} as const satisfies TtsModelParamTable;

export const tts = {
  category: "tts",
  provider: "murf",
  models: MODELS,
  modelParams: MURF_TTS_MODEL_PARAMS,
  compile(
    input: TtsParams,
    ctx: CompileContext<TtsParams>,
  ): CompiledCall<MurfTtsWire, MurfTtsResult> {
    const streaming = STREAM_ONLY_MODELS.has(ctx.model);
    ctx.from(["voiceId"], "voice");
    ctx.from(["modelVersion"], "model");
    ctx.from(["format"], "outputFormat");
    ctx.from(["sampleRate"], "outputFormat");
    ctx.from(["rate"], "speed");
    ctx.from(["locale"], "language");

    const body: MurfDraft = { text: input.text, voiceId: "" };
    // Two spellings of one decision, one per route (see the module note).
    if (streaming) body.model = ctx.model;
    else body.modelVersion = ctx.model.toUpperCase();

    if (input.voice !== undefined) {
      const voice = ctx.take(
        resolveVoice(
          input.voice,
          { accepts: ["id"], source: TTS_OVERVIEW_DOCS },
          { path: ["voice"], warn: ctx.warn },
        ),
      );
      if (voice !== undefined) body.voiceId = voice.value;
    }

    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, streaming ? STREAM_FORMAT : GENERATE_FORMAT, {
          path: ["outputFormat"],
          warn: ctx.warn,
        }),
      );
      if (format !== undefined) {
        body.format =
          format.codec === "pcm_s16le" && format.container === "raw"
            ? "PCM"
            : (format.wire as MurfFormat);
        if (format.sampleRate !== undefined) body.sampleRate = format.sampleRate;
      }
    }

    if (input.speed !== undefined) {
      const rate = ctx.take(murfSpeed(input.speed, { path: ["speed"], warn: ctx.warn }));
      if (rate !== undefined) body.rate = rate;
    }

    // `locale` is BCP-47 already ("en-US", "es-ES"), so it passes through.
    if (input.language !== undefined) body.locale = input.language;

    applyExtras(input, MURF_TTS_MODEL_PARAMS, body, ctx);

    return {
      params: body as MurfTtsWire,
      // One cast, at the one place the two routes meet: each validator takes
      // its own arm of the union, and the ref decided which arm `body` is.
      validate: (streaming ? streamValidator.safe : generateValidator.safe) as MurfValidate,
    };
  },
} as const satisfies TtsAdapterFor<
  typeof MURF_TTS_MODEL_PARAMS,
  MurfTtsWire,
  MurfTtsResult
>;
