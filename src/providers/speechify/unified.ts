/**
 * `unmodel/tts` → `speechify.tts` (POST /v1/audio/speech).
 *
 * Speechify has **two** format fields and they are not redundant:
 * `audio_format` names a container only (`"mp3"`, `"wav"`, `"aac"`), while
 * `output_format` is a `codec_sampleRate[_bitrate]` composite that "takes
 * precedence over" it. That gives the adapter an unusually honest option:
 *
 * - a caller who named only a codec (`outputFormat: "mp3"`) gets
 *   `audio_format: "mp3"` — the sample rate stays Speechify's choice because
 *   the caller said it did not matter, and **nothing is invented, so nothing
 *   warns**;
 * - a caller who named a rate or a bitrate gets the composite, which is the
 *   only field that can carry them.
 *
 * μ-law is the exception: `audio_format` has no spelling for it, so it always
 * takes the composite — at the single rate Speechify publishes (8 kHz), filled
 * with the usual warning.
 *
 * The streaming route (`speechify.ttsStream`) takes an `Accept` header and
 * drops the two `wav_*` formats; it is a different endpoint with a different
 * character cap, and the unified surface targets the JSON one.
 */
import {
  applyExtras,
  bitsToKbps,
  EXTRA,
  normalizeAudioFormat,
  resolveAudioFormat,
  resolveVoice,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { AudioContainer, AudioFormatCodec } from "../../core/unified/vocabulary/audio";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  TtsAdapterFor,
  TtsModelParamTable,
  TtsParams,
} from "../../core/unified/vocabulary/tts";
import {
  tts as validator,
  type AudioSpeechBody,
  type SpeechifyAudioFormat,
  type SpeechifyOutputFormat,
} from "./tts";

/** The four Simba rows — the ref union for `speechify/…`. */
const MODELS = ["simba-english", "simba-multilingual", "simba-3.0", "simba-3.2"] as const;

const SPEC_URL = "https://docs.speechify.ai/openapi/api-reference.json";

/** The wire body this adapter compiles to. */
export type SpeechifyTtsWire = AudioSpeechBody;

/** What a unified call to `speechify/…` returns. */
export type SpeechifyTtsResult = ReturnType<typeof validator>;

const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", pcm_s16le: "wav", pcm_mulaw: "ulaw", aac: "aac" },
  containers: {
    mp3: ["mp3"],
    pcm_s16le: ["wav", "raw"],
    pcm_mulaw: ["raw"],
    aac: ["aac"],
  },
  sampleRates: {
    mp3: [22050, 24000],
    // `pcm_*` and `wav_*` publish different rate sets; the composite enum in
    // the provider validator is the authority on which pairs exist.
    pcm_s16le: [8000, 16000, 22050, 24000, 44100, 48000],
    pcm_mulaw: [8000],
    aac: [24000],
  },
  bitrates: { mp3: [32000, 64000, 96000, 128000, 192000] },
  unavailable: { pcm_s16le: ["bitrate"], pcm_mulaw: ["bitrate"], aac: ["bitrate"] },
  defaultsByCodec: { pcm_mulaw: { sampleRate: 8000 } },
  source: SPEC_URL,
};

/**
 * The `audio_format` value for a codec, when there is one.
 *
 * μ-law is the gap: `audio_format` has no spelling for it, so a μ-law request
 * has to go through the composite whether or not the caller named a rate.
 */
function containerFor(
  codec: AudioFormatCodec,
  container: AudioContainer | undefined,
): SpeechifyAudioFormat | undefined {
  if (codec === "mp3") return "mp3";
  if (codec === "aac") return "aac";
  if (codec === "pcm_s16le") return container === "wav" ? "wav" : "pcm";
  return undefined;
}

/**
 * Speechify's per-model surface, and the one model whose language list is one
 * value long.
 *
 * `simba-3.2` is English only — the provider's `checkLanguage` refuses anything
 * that does not start `en`, citing the 400 it would otherwise return — so its
 * row says `languages: ["en"]` and an editor completes exactly that. The other
 * three carry no list: `simba-3.0`'s six extra locales and
 * `simba-multilingual`'s "30+" are documented in prose rather than as an enum,
 * and `checkLanguage` deliberately does not gate them ("the docs say 30+ and do
 * not enumerate"). A completion list with no authority behind it would be a
 * guess dressed as a capability.
 *
 * The two extras are `options`' members, nested through
 * {@link OPTIONS_NESTING}: loudness normalization to −14 LUFS, and the
 * numbers-and-dates text expansion whose *default* differs between this route
 * and the streaming one — which is exactly why it is worth being able to set
 * explicitly.
 */
const SPEECHIFY_EXTRAS = {
  loudness_normalization: EXTRA as boolean,
  text_normalization: EXTRA as boolean,
} as const;

const CODECS = ["mp3", "aac", "pcm_s16le", "pcm_mulaw"] as const;

const SPEECHIFY_TTS_MODEL_PARAMS = {
  "simba-english": { codecs: CODECS, extras: SPEECHIFY_EXTRAS },
  "simba-multilingual": { codecs: CODECS, extras: SPEECHIFY_EXTRAS },
  "simba-3.0": { codecs: CODECS, extras: SPEECHIFY_EXTRAS },
  "simba-3.2": { codecs: CODECS, languages: ["en"], extras: SPEECHIFY_EXTRAS },
} as const satisfies TtsModelParamTable;

/** Both extras live under `options`. */
const OPTIONS_NESTING: Readonly<Record<string, readonly string[]>> = {
  loudness_normalization: ["options"],
  text_normalization: ["options"],
};

export const tts = {
  category: "tts",
  provider: "speechify",
  models: MODELS,
  modelParams: SPEECHIFY_TTS_MODEL_PARAMS,
  unsupported: {
    speed:
      "POST /v1/audio/speech publishes no speaking-rate field — pace is controlled with SSML " +
      "(`<prosody rate>`) inside `input`, which is text rather than a multiplier.",
  },
  compile(
    input: TtsParams,
    ctx: CompileContext<TtsParams>,
  ): CompiledCall<SpeechifyTtsWire, SpeechifyTtsResult> {
    ctx.from(["input"], "text");
    ctx.from(["voice_id"], "voice");
    ctx.from(["output_format"], "outputFormat");
    ctx.from(["audio_format"], "outputFormat");

    const body: SpeechifyTtsWire = { input: input.text, voice_id: "", model: ctx.model };

    if (input.voice !== undefined) {
      const voice = ctx.take(
        resolveVoice(
          input.voice,
          { accepts: ["id"], source: SPEC_URL },
          { path: ["voice"], warn: ctx.warn },
        ),
      );
      if (voice !== undefined) body.voice_id = voice.value;
    }

    if (input.outputFormat !== undefined) {
      // What the CALLER named, as distinct from what the spec fills in: it is
      // the difference between "any rate will do" (a container) and "this
      // rate" (the composite).
      const asked = normalizeAudioFormat(input.outputFormat);
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined) {
        const container = containerFor(format.codec, format.container);
        const namedNumbers = asked.sampleRate !== undefined || asked.bitrate !== undefined;
        if (!namedNumbers && container !== undefined) {
          body.audio_format = container;
        } else if (format.sampleRate !== undefined) {
          const codec =
            format.codec === "pcm_s16le" && format.container === "raw" ? "pcm" : format.wire;
          let composite = `${codec}_${format.sampleRate}`;
          if (format.bitrate !== undefined) {
            const kbps = ctx.take(
              bitsToKbps(format.bitrate, { path: ["outputFormat"], warn: ctx.warn }),
            );
            if (kbps !== undefined) composite = `${composite}_${kbps}`;
          }
          body.output_format = composite as SpeechifyOutputFormat;
        } else {
          // A bitrate with no rate: the composite carries both or neither, and
          // Speechify documents no default rate to complete it with. Refusing
          // is the only alternative to sending an encoding the caller did not
          // ask for and saying nothing.
          ctx.fail({
            code: "invalid_shape",
            path: ["outputFormat"],
            message:
              "`outputFormat.sampleRate` is required alongside a bitrate on this model — " +
              "Speechify carries both in one `output_format` value (`mp3_24000_128`) and " +
              "documents no default rate. Set the sample rate, or drop the bitrate to let " +
              "Speechify pick the encoding.",
            meta: { field: "sampleRate", codec: format.codec, source: SPEC_URL },
          });
        }
      }
    }

    // `language` is BCP-47 with a region ("en-US"), which is what the wire
    // takes — no reduction, no warning.
    if (input.language !== undefined) body.language = input.language;

    applyExtras(input, SPEECHIFY_TTS_MODEL_PARAMS, body, ctx, { nest: OPTIONS_NESTING });

    return { params: body, validate: validator.safe };
  },
} as const satisfies TtsAdapterFor<
  typeof SPEECHIFY_TTS_MODEL_PARAMS,
  SpeechifyTtsWire,
  SpeechifyTtsResult
>;
