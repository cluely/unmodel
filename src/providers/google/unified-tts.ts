/**
 * `unmodel/tts` → `google.tts` (POST models/{model}:generateContent with
 * `responseModalities: ["AUDIO"]`).
 *
 * # The endpoint that is not a speech endpoint
 *
 * Gemini has no `/audio/speech` route. Synthesis is an ordinary
 * `generateContent` call whose `generationConfig` asks for audio, so every
 * canonical word here compiles two or three levels down — `voice` lands at
 * `generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName` —
 * and every `ctx.from` below points at that depth. A finding the provider
 * raises about a voice name has to reach the caller as `voice`, or it names a
 * path nobody using this surface has ever typed.
 *
 * `responseModalities: ["AUDIO"]` is written on **every** request, unasked.
 * It is not compiled from anything: it is the difference between a TTS call and
 * a chat call on the same URL, and "an absent or empty list is equivalent to
 * requesting only text", which these models cannot produce.
 *
 * # The three canonical words, and the one that has no field
 *
 * | canonical | wire | class |
 * |---|---|---|
 * | `text` | `contents[0].parts[0].text` | a rename, two levels down |
 * | `voice` | `…voiceConfig.prebuiltVoiceConfig.voiceName` | a **name**, one of 30 |
 * | `language` | `…speechConfig.languageCode` | primary subtag only |
 * | `outputFormat` | `generationConfig.responseFormat.audio` | an object, not an enum |
 * | `speed` | — | no field exists; a declared gap |
 *
 * **`voice` is a name here, not an id.** `prebuiltVoiceConfig.voiceName` takes
 * one of the thirty published presets and there is no cloned-voice form on this
 * message at all, so `resolveVoice` is given `accepts: ["name"]` — a bare
 * string is read as a name, and `{ id }` is an `invalid_shape` saying so rather
 * than a UUID sent to a field that looks up names. The list is the same
 * `GEMINI_TTS_VOICES` the wire type is built from and `checkVoiceName`
 * enforces, so the three surfaces that mention a Gemini voice — `google.chat`,
 * `google.tts` and this one — complete exactly the same thirty names.
 *
 * **`language` is a primary subtag.** The guide's table is `"pt"`, `"cmn"`,
 * `"fil"` — bare subtags under a column header that says "BCP-47" — so a
 * canonical `"pt-BR"` goes out as `"pt"` with the `approximated_param`
 * `toPrimaryLanguage` always raises for a dropped region. The row's 78-entry
 * `languages` list therefore **completes without gating**, exactly like the
 * open `LanguageOf` tail it produces: the wire check that follows is a WARNING
 * (the table states which languages the models speak, not which strings the
 * field accepts), and a type stricter than that would be a false compile error.
 *
 * **`speed` is the gap, and it is not a rounding problem.** There is no rate,
 * no scale and no percentage anywhere in `SpeechConfig` — the guide steers pace
 * with natural-language direction inside the prompt ("Say the following in a
 * calm, slow voice: …"). Compiling `speed: 1.5` into an English sentence would
 * be inventing a request; the gap is declared instead, and the message says
 * where the control actually is.
 *
 * # `outputFormat` is an object with two homes for PCM
 *
 * `responseFormat.audio` carries `mimeType` + `sampleRate` + `bitRate` rather
 * than one composite enum, so the {@link FORMAT} spec below is unusually plain.
 * Two things in it are load-bearing:
 *
 * - **`pcm_s16le` has two spellings**, the same split OpenAI's `wav`/`pcm` pair
 *   has: `AUDIO_WAV` when the caller wants the WAV header (the canonical
 *   default container) and `AUDIO_L16` for the bare 16-bit stream. Both carry
 *   the same samples, so neither is an approximation.
 * - **`bitRate` is refused on the uncompressed formats** — "Only applicable for
 *   compressed formats (MP3, Opus)" — which is declared here as `unavailable`
 *   so the refusal names `outputFormat.bitrate` at compile time, and re-checked
 *   by `checkAudioResponseFormat` for everyone the type cannot reach.
 *
 * There is deliberately **no `sampleRates` and no `bitrates` list**: the REST
 * reference enumerates neither, and a list invented here would refuse requests
 * the API fulfils. The one number that *is* documented — 24 kHz native — is the
 * spec's `defaults.sampleRate`, so filling it in warns like every other value
 * chosen on a caller's behalf.
 */
import {
  applyExtras,
  EXTRA,
  resolveAudioFormat,
  resolveVoice,
  toPrimaryLanguage,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { AudioFormatCodec } from "../../core/unified/vocabulary/audio";
import type {
  TtsAdapterFor,
  TtsModelParamTable,
  TtsParams,
} from "../../core/unified/vocabulary/tts";
// The import-free leaf, never `./constraints` — which reads the generated
// catalog and the Veo rows. `unmodel/tts`'s bundle budget asserts the pack
// carries ZERO catalogs, which one edge from here would break outright.
import {
  GEMINI_SPEECH_NATIVE_SAMPLE_RATE,
  GEMINI_TTS_DOCS_URL,
  GEMINI_TTS_LANGUAGE_CODES,
  GEMINI_TTS_MODEL_IDS,
  type GeminiCompressedAudioMimeType,
  type GeminiUncompressedAudioMimeType,
} from "./tts-constraints";
import {
  tts as validator,
  type GoogleTtsContent,
  type GoogleTtsMultiSpeakerVoiceConfig,
  type GoogleTtsResponseFormatConfig,
  type GoogleTtsSingleSpeakerConfig,
  type GoogleTtsSpeechConfig,
} from "./tts";
// `GEMINI_TTS_VOICES` lives on the wire leaf because `voiceName` is typed from
// it (see the note there); this is the same array the wire check reads, so the
// unified surface completes exactly what the wire surface accepts.
import { GEMINI_TTS_VOICES, type GoogleThinkingConfig } from "./wire";

/** The three ids the speech-generation guide tabulates — the `google/…` refs. */
const MODELS = GEMINI_TTS_MODEL_IDS;

/**
 * `responseFormat.audio` — five canonical codecs, and the PCM split.
 *
 * `AUDIO_WAV` is absent from `codecs` on purpose: it is not a sixth codec, it
 * is `pcm_s16le` **in a container**, and the compile step below picks between
 * it and `AUDIO_L16` from the resolved container. Putting it in the map would
 * make the codec list six long and give `pcm_s16le` two entries that a caller
 * could not tell apart.
 */
const FORMAT: AudioFormatSpec = {
  codecs: {
    mp3: "AUDIO_MP3",
    opus: "AUDIO_OGG_OPUS",
    pcm_s16le: "AUDIO_L16",
    pcm_alaw: "AUDIO_ALAW",
    pcm_mulaw: "AUDIO_MULAW",
  },
  containers: { opus: ["ogg"], pcm_s16le: ["wav", "raw"] },
  // "`bitRate` … Only applicable for compressed formats (MP3, Opus)" — stated
  // per codec rather than endpoint-wide, because MP3 and Ogg-Opus DO take one.
  unavailable: {
    pcm_s16le: ["bitrate"],
    pcm_alaw: ["bitrate"],
    pcm_mulaw: ["bitrate"],
  },
  // The only rate Google publishes for this surface: "raw PCM bytes (24kHz,
  // 1-channel, 16-bit)". A default, never a bound — the reference enumerates no
  // allowed rates at all, so no `sampleRates` list appears above.
  defaults: { sampleRate: GEMINI_SPEECH_NATIVE_SAMPLE_RATE },
  source: GEMINI_TTS_DOCS_URL,
};

/** The five codecs {@link FORMAT} names, in canonical spelling. */
const CODECS = ["mp3", "opus", "pcm_s16le", "pcm_alaw", "pcm_mulaw"] as const;

/**
 * Whether this codec's Gemini spelling takes a `bitRate` — read back off
 * {@link FORMAT} rather than written out again, so the compile-time refusal and
 * the arm the body is built in cannot disagree about which formats compress.
 */
function takesBitRate(codec: AudioFormatCodec): boolean {
  const perCodec = FORMAT.unavailable as Readonly<
    Partial<Record<AudioFormatCodec, readonly string[]>>
  >;
  return perCodec[codec]?.includes("bitrate") !== true;
}

/**
 * The knobs `generationConfig` has that the vocabulary has no word for.
 *
 * All three are shared by the three models; `thinkingConfig` is not, and that
 * asymmetry is the reason this is a per-**model** table. `gemini-3.1-flash-tts-preview`
 * is the one reasoning TTS model — `ttsModels`' own `reasoning: true` flag says
 * so, `./tts.ts` states it in the type system as `thinkingConfig?: never` on the
 * other two arms, and `checkGenerationCapabilities` reports it at runtime. This
 * row is that same fact a third time, in the one place a *unified* caller can
 * see it.
 *
 * `multiSpeakerVoiceConfig` is here rather than in the vocabulary because the
 * canonical `voice` is one voice: a two-speaker dialogue needs a speaker **name
 * per voice**, matched to names inside the prompt, which is a request shape no
 * other provider in the category has. It is typed as `./tts.ts`'s bounded
 * 1-or-2 tuple, so an editor refuses a third speaker at the call site and
 * `checkSpeechConfig` refuses it again for everyone else — and it nests under
 * `generationConfig.speechConfig` ({@link EXTRA_NESTING}), beside the
 * `voiceConfig` compiled from `voice`, where the wire's own XOR check then sees
 * both and says exactly that.
 */
const SHARED_EXTRAS = {
  multiSpeakerVoiceConfig: EXTRA as GoogleTtsMultiSpeakerVoiceConfig,
  temperature: EXTRA as number,
  maxOutputTokens: EXTRA as number,
} as const;

const GOOGLE_TTS_MODEL_PARAMS = {
  "gemini-3.1-flash-tts-preview": {
    codecs: CODECS,
    languages: GEMINI_TTS_LANGUAGE_CODES,
    voices: GEMINI_TTS_VOICES,
    extras: { ...SHARED_EXTRAS, thinkingConfig: EXTRA as GoogleThinkingConfig },
  },
  "gemini-2.5-flash-preview-tts": {
    codecs: CODECS,
    languages: GEMINI_TTS_LANGUAGE_CODES,
    voices: GEMINI_TTS_VOICES,
    extras: SHARED_EXTRAS,
  },
  "gemini-2.5-pro-preview-tts": {
    codecs: CODECS,
    languages: GEMINI_TTS_LANGUAGE_CODES,
    voices: GEMINI_TTS_VOICES,
    extras: SHARED_EXTRAS,
  },
} as const satisfies TtsModelParamTable;

/**
 * Where each extra lands. Everything is a `generationConfig` key except the
 * multi-speaker block, which belongs beside `voiceConfig` one level further in.
 */
const EXTRA_NESTING: Readonly<Record<string, readonly string[]>> = {
  multiSpeakerVoiceConfig: ["generationConfig", "speechConfig"],
};

/**
 * `generationConfig` as this adapter builds it — the members it can write, not
 * the whole Tier-A arm.
 *
 * The ~20 `?: never` keys of `GoogleTtsGenerationConfigBase` are absent rather
 * than restated: a compiled body simply never has them, and an absent optional
 * `never` satisfies the arm this is handed to.
 */
export interface GoogleTtsWireGenerationConfig {
  /** Pinned on every request; see the module header. */
  responseModalities: ["AUDIO"];
  speechConfig?: GoogleTtsSpeechConfig;
  responseFormat?: GoogleTtsResponseFormatConfig;
  temperature?: number;
  maxOutputTokens?: number;
  thinkingConfig?: GoogleThinkingConfig;
}

/** The wire body this adapter compiles to — the loose arm of `GenerateTtsBody`. */
export interface GoogleTtsWire {
  model: string;
  contents: GoogleTtsContent[];
  generationConfig: GoogleTtsWireGenerationConfig;
}

/** What a unified speech call to `google/…` returns: `google.tts`'s `Validated`. */
export type GoogleTtsResult = ReturnType<
  typeof validator<GoogleTtsWire["model"], GoogleTtsWire>
>;

export const tts = {
  category: "tts",
  provider: "google",
  models: MODELS,
  modelParams: GOOGLE_TTS_MODEL_PARAMS,
  unsupported: {
    speed:
      "Gemini TTS has no rate field — the guide steers pace through natural-language style " +
      "prompts in `text` itself (\"Say the following in a calm, slow voice: …\"), and " +
      "`generationConfig.speechConfig` has no multiplier, scale or percentage anywhere in it. " +
      "Write the direction into `text` rather than have unmodel invent a sentence for you.",
  },
  compile(
    input: TtsParams,
    ctx: CompileContext<TtsParams>,
  ): CompiledCall<GoogleTtsWire, GoogleTtsResult> {
    ctx.from(["contents", 0, "parts", 0, "text"], "text");
    ctx.from(
      ["generationConfig", "speechConfig", "voiceConfig", "prebuiltVoiceConfig", "voiceName"],
      "voice",
    );
    ctx.from(["generationConfig", "speechConfig", "languageCode"], "language");
    // Four exact rules rather than one: `canonicalPath` matches the whole path
    // or the head segment, and the head here is `generationConfig` — which is
    // where the extras live too, so claiming it would misattribute every one of
    // their findings to `outputFormat`.
    for (const leaf of [[], ["mimeType"], ["sampleRate"], ["bitRate"]]) {
      ctx.from(["generationConfig", "responseFormat", "audio", ...leaf], "outputFormat");
    }

    const body: GoogleTtsWire = {
      model: ctx.model,
      contents: [{ parts: [{ text: input.text }] }],
      generationConfig: { responseModalities: ["AUDIO"] },
    };

    // Written as the single-speaker arm: it is the only one this adapter
    // compiles into. The multi-speaker block arrives as an extra and is merged
    // in by `applyExtras`, which is exactly when the wire's XOR check has
    // something to report.
    const speechConfig: GoogleTtsSingleSpeakerConfig = {};

    if (input.voice !== undefined) {
      const voice = ctx.take(
        resolveVoice(
          input.voice,
          // Names only: `prebuiltVoiceConfig` is preset-by-construction, and a
          // cloned voice has no wire form on this message at all.
          { accepts: ["name"], source: GEMINI_TTS_DOCS_URL },
          { path: ["voice"], warn: ctx.warn },
        ),
      );
      if (voice !== undefined) {
        // `voiceName` is typed as the closed 30-name union, and a compiled
        // value is a `string` — the same shape `checkVoiceName` re-checks, and
        // the reason that check exists.
        speechConfig.voiceConfig = {
          prebuiltVoiceConfig: {
            voiceName: voice.value as (typeof GEMINI_TTS_VOICES)[number],
          },
        };
      }
    }

    if (input.language !== undefined) {
      const language = ctx.take(
        toPrimaryLanguage(input.language, { path: ["language"], warn: ctx.warn }, {
          source: GEMINI_TTS_DOCS_URL,
        }),
      );
      if (language !== undefined) speechConfig.languageCode = language;
    }

    if (Object.keys(speechConfig).length > 0) body.generationConfig.speechConfig = speechConfig;

    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined) {
        const rate = format.sampleRate !== undefined && { sampleRate: format.sampleRate };
        // The two arms of `AudioResponseFormat` are a real discriminated union
        // — `bitRate?: never` is how "compressed formats only" is stated in the
        // type system — so the branch is on the same fact `FORMAT.unavailable`
        // declares, read back rather than written twice.
        body.generationConfig.responseFormat = {
          audio: takesBitRate(format.codec)
            ? {
                mimeType: format.wire as GeminiCompressedAudioMimeType,
                ...rate,
                ...(format.bitrate !== undefined && { bitRate: format.bitrate }),
              }
            : {
                // The PCM split: same samples, different header. `AUDIO_WAV` is
                // what the canonical default container asks for; `"raw"` is the
                // bare stream `FORMAT.codecs` already spells `AUDIO_L16`.
                mimeType: (format.codec === "pcm_s16le" && format.container === "wav"
                  ? "AUDIO_WAV"
                  : format.wire) as GeminiUncompressedAudioMimeType,
                ...rate,
              },
        };
      }
    }

    applyExtras(input, GOOGLE_TTS_MODEL_PARAMS, body, ctx, {
      at: ["generationConfig"],
      nest: EXTRA_NESTING,
    });

    return { params: body, validate: validator.safe };
  },
} as const satisfies TtsAdapterFor<
  typeof GOOGLE_TTS_MODEL_PARAMS,
  GoogleTtsWire,
  GoogleTtsResult
>;
