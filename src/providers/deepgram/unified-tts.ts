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
import {
  applyExtras,
  EXTRA,
  resolveAudioFormat,
  resolveVoice,
  toSpeed,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  TtsAdapterFor,
  TtsModelParamTable,
  TtsParams,
} from "../../core/unified/vocabulary/tts";
import {
  tts as validator,
  type DeepgramSpeakEncoding,
  type DeepgramSpeakSampleRate,
  type SpeakParams,
} from "./tts";
import { ttsModels } from "./models";

const SPEAK_DOCS = "https://developers.deepgram.com/reference/text-to-speech/speak-request";
const MEDIA_DOCS = "https://developers.deepgram.com/docs/tts-media-output-settings";

/**
 * Every Aura and Aura-2 voice, read off the hand catalog rather than copied:
 * on this endpoint the model list *is* the voice list (all 105 of them), so
 * the ref union, the `unknown_model` warning and the catalog cannot drift
 * apart. The cast is what keeps the *literal* ids — `Object.keys` widens to
 * `string[]`, which would collapse the ref union to `` `deepgram/${string}` ``
 * and take the autocomplete with it.
 */
const MODELS = Object.keys(ttsModels) as readonly (keyof typeof ttsModels)[];

/** The wire params this adapter compiles to (body `{text}` + query params). */
export type DeepgramTtsWire = SpeakParams;

/** What a unified call to `deepgram/…` returns. */
export type DeepgramTtsResult = ReturnType<typeof validator>;

const FORMAT: AudioFormatSpec = {
  codecs: {
    pcm_s16le: "linear16",
    pcm_mulaw: "mulaw",
    pcm_alaw: "alaw",
    mp3: "mp3",
    opus: "opus",
    flac: "flac",
    aac: "aac",
  },
  containers: {
    pcm_s16le: ["wav", "raw"],
    pcm_mulaw: ["wav", "raw"],
    pcm_alaw: ["wav", "raw"],
    opus: ["ogg"],
    mp3: ["mp3"],
    flac: ["flac"],
    aac: ["aac"],
  },
  sampleRates: {
    pcm_s16le: [8000, 16000, 24000, 32000, 48000],
    pcm_mulaw: [8000, 16000],
    pcm_alaw: [8000, 16000],
    flac: [8000, 16000, 22050, 32000, 48000],
  },
  bitrates: { mp3: [32000, 48000] },
  unavailable: {
    // "the codec fixes it" — mp3 is always 22050 Hz here.
    mp3: ["sampleRate"],
    opus: ["sampleRate"],
    aac: ["sampleRate"],
    // Uncompressed formats have no configurable bitrate.
    pcm_s16le: ["bitrate"],
    pcm_mulaw: ["bitrate"],
    pcm_alaw: ["bitrate"],
    flac: ["bitrate"],
  },
  source: MEDIA_DOCS,
};

/**
 * The per-model surface, which on this endpoint is *one* surface.
 *
 * `POST /v1/speak` takes the same seven encodings and the same two
 * non-canonical query params whichever of the 103 voices the ref names —
 * because here the model id selects a *voice*, and a voice does not change
 * which container the bytes come back in. So the row is built rather than
 * typed out: `Object.fromEntries` over the same `MODELS` array the ref union
 * comes from, so a voice added to the catalog gets a row automatically and the
 * two lists cannot fall out of step. (103 hand-written identical literals would
 * also imply, wrongly, that some of them differ.)
 *
 * The cast is what keeps the literal keys — `Object.fromEntries` widens to
 * `Record<string, …>`, which would make every row lookup miss and silently
 * degrade all 103 models to the wide vocabulary. `satisfies` then checks the
 * row itself, field by field.
 *
 * No `languages`: the language is baked into the voice, which is baked into the
 * model, and the adapter declares the gap outright.
 *
 * `mip_opt_out` (Model Improvement Program opt-out) and `tag` (billing labels
 * that come back on the usage record) are the two documented query params with
 * no canonical word. Neither changes the audio, which is why the *research*
 * pass and this table agree that they are the whole extras list here.
 */
const AURA_ROW = {
  codecs: ["mp3", "opus", "aac", "flac", "pcm_s16le", "pcm_mulaw", "pcm_alaw"],
  extras: {
    mip_opt_out: EXTRA as boolean,
    tag: EXTRA as string | string[],
  },
} as const;

const DEEPGRAM_TTS_MODEL_PARAMS = Object.fromEntries(
  MODELS.map((model) => [model, AURA_ROW]),
) as Readonly<Record<(typeof MODELS)[number], typeof AURA_ROW>> satisfies TtsModelParamTable;

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
