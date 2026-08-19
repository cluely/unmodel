/**
 * `unmodel/speech` → `minimax.speech` (POST /v1/t2a_v2).
 *
 * A three-field audio object (`audio_setting.{format,sample_rate,bitrate}`)
 * and a voice/prosody object (`voice_setting.{voice_id,speed}`), so this
 * adapter is mostly nesting — with one genuine translation.
 *
 * **`language_boost` is spelled in English words**, not language codes:
 * `"Portuguese"`, `"Chinese,Yue"`, `"auto"`. The canonical `language` is
 * BCP-47, so the table below is the mapping, and a tag MiniMax has no word for
 * is an `invalid_enum_value` naming the ones it does — never a dropped hint,
 * because a request that silently loses its language hint comes back in the
 * wrong accent with nothing to point at.
 *
 * `bitrate` exists for mp3 only ("it is ignored for other formats" — the
 * provider validator warns), so it is declared unavailable for every other
 * codec here and the error arrives before the request is sent.
 */
import {
  resolveAudioFormat,
  resolveVoice,
  toPrimaryLanguage,
  toSpeed,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall, UnifiedAdapter } from "../../core/unified/types";
import type { SpeechParams } from "../../core/unified/vocabulary/speech";
import {
  speech as validator,
  type MinimaxAudioFormat,
  type MinimaxLanguageBoost,
  type T2aParams,
} from "./speech";

/** The eight T2A v2 model ids — the ref union for `minimax/…`. */
const MODELS = [
  "speech-2.8-hd",
  "speech-2.8-turbo",
  "speech-2.6-hd",
  "speech-2.6-turbo",
  "speech-02-hd",
  "speech-02-turbo",
  "speech-01-hd",
  "speech-01-turbo",
] as const;

const T2A_DOCS = "https://platform.minimax.io/docs/api-reference/speech-t2a-http";

/** The wire body this adapter compiles to. */
export type MinimaxSpeechWire = T2aParams;

/** What a unified call to `minimax/…` returns. */
export type MinimaxSpeechResult = ReturnType<typeof validator>;

const SAMPLE_RATES = [8000, 16000, 22050, 24000, 32000, 44100] as const;

const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", flac: "flac", opus: "opus", pcm_s16le: "pcm", pcm_mulaw: "pcmu_raw" },
  containers: {
    mp3: ["mp3"],
    flac: ["flac"],
    opus: ["ogg"],
    pcm_s16le: ["wav", "raw"],
    pcm_mulaw: ["wav", "raw"],
  },
  sampleRates: {
    mp3: SAMPLE_RATES,
    flac: SAMPLE_RATES,
    opus: SAMPLE_RATES,
    pcm_s16le: SAMPLE_RATES,
    pcm_mulaw: SAMPLE_RATES,
  },
  bitrates: { mp3: [32000, 64000, 128000, 256000] },
  unavailable: {
    flac: ["bitrate"],
    opus: ["bitrate"],
    pcm_s16le: ["bitrate"],
    pcm_mulaw: ["bitrate"],
  },
  source: T2A_DOCS,
};

/**
 * BCP-47 primary subtag → MiniMax's own word for that language.
 *
 * Transcribed from the `language_boost` enum in `./speech`. Two spellings map
 * onto one word where the wire has only one (`tl`/`fil` → Filipino,
 * `no`/`nb` → Norwegian); Cantonese has its own entry because MiniMax gives it
 * one (`"Chinese,Yue"`).
 */
const LANGUAGE_BOOSTS: Readonly<Record<string, MinimaxLanguageBoost>> = {
  af: "Afrikaans",
  ar: "Arabic",
  bg: "Bulgarian",
  ca: "Catalan",
  cs: "Czech",
  da: "Danish",
  de: "German",
  el: "Greek",
  en: "English",
  es: "Spanish",
  fa: "Persian",
  fi: "Finnish",
  fil: "Filipino",
  fr: "French",
  he: "Hebrew",
  hi: "Hindi",
  hr: "Croatian",
  hu: "Hungarian",
  id: "Indonesian",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  ms: "Malay",
  nb: "Norwegian",
  nl: "Dutch",
  nn: "Nynorsk",
  no: "Norwegian",
  pl: "Polish",
  pt: "Portuguese",
  ro: "Romanian",
  ru: "Russian",
  sk: "Slovak",
  sl: "Slovenian",
  sv: "Swedish",
  ta: "Tamil",
  th: "Thai",
  tl: "Filipino",
  tr: "Turkish",
  uk: "Ukrainian",
  vi: "Vietnamese",
  yue: "Chinese,Yue",
  zh: "Chinese",
};

export const speech = {
  category: "speech",
  provider: "minimax",
  models: MODELS,
  compile(
    input: SpeechParams,
    ctx: CompileContext<SpeechParams>,
  ): CompiledCall<MinimaxSpeechWire, MinimaxSpeechResult> {
    ctx.from(["voice_setting", "voice_id"], "voice");
    ctx.from(["voice_setting", "speed"], "speed");
    ctx.from(["audio_setting"], "outputFormat");
    ctx.from(["language_boost"], "language");

    const body: MinimaxSpeechWire = { model: ctx.model, text: input.text };

    if (input.voice !== undefined) {
      const voice = ctx.take(
        resolveVoice(
          input.voice,
          { accepts: ["id"], source: T2A_DOCS },
          { path: ["voice"], warn: ctx.warn },
        ),
      );
      if (voice !== undefined) body.voice_setting = { voice_id: voice.value };
    }

    if (input.speed !== undefined) {
      const speed = ctx.take(
        toSpeed(
          input.speed,
          { min: 0.5, max: 2, source: T2A_DOCS },
          { path: ["speed"], warn: ctx.warn },
        ),
      );
      if (speed !== undefined) body.voice_setting = { ...body.voice_setting, speed };
    }

    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined) {
        // `pcm`/`pcmu_raw` are bare streams; the WAV-wrapped spellings are
        // separate enum members rather than a container field.
        const wire: MinimaxAudioFormat =
          format.container === "wav" && format.codec === "pcm_s16le"
            ? "wav"
            : format.container === "wav" && format.codec === "pcm_mulaw"
              ? "pcmu_wav"
              : (format.wire as MinimaxAudioFormat);
        body.audio_setting = {
          format: wire,
          ...(format.sampleRate !== undefined && {
            sample_rate: format.sampleRate as (typeof SAMPLE_RATES)[number],
          }),
          ...(format.bitrate !== undefined && {
            bitrate: format.bitrate as 32000 | 64000 | 128000 | 256000,
          }),
        };
      }
    }

    if (input.language !== undefined) {
      const primary = ctx.take(
        toPrimaryLanguage(input.language, { path: ["language"], warn: ctx.warn }, { source: T2A_DOCS }),
      );
      if (primary !== undefined) {
        const boost = LANGUAGE_BOOSTS[primary];
        if (boost === undefined) {
          ctx.fail({
            code: "invalid_enum_value",
            path: ["language"],
            message:
              `\`language\` ${JSON.stringify(input.language)} has no \`language_boost\` on this ` +
              `model — MiniMax names languages in English words, and covers ` +
              `${Object.keys(LANGUAGE_BOOSTS).join(", ")}.`,
            meta: {
              allowed: Object.keys(LANGUAGE_BOOSTS),
              value: input.language,
              source: T2A_DOCS,
            },
          });
        } else {
          body.language_boost = boost;
        }
      }
    }

    return { params: body, validate: validator.safe };
  },
} as const satisfies UnifiedAdapter<SpeechParams, MinimaxSpeechWire, MinimaxSpeechResult>;
