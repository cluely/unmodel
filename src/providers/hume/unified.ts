/**
 * `unmodel/speech` → `hume.speech` (POST /v0/tts).
 *
 * Hume is the one provider whose body has no `text` field: a request is a list
 * of **utterances**, each with its own voice, speed and trailing silence. One
 * canonical `text` is therefore one utterance, and `voice` / `speed` become
 * properties of it — which is why every provenance rule here points into
 * `utterances[0]`.
 *
 * It is also the one provider with no `model` field. Octave is selected with
 * `version` (`"1"` / `"2"`), and the two catalog rows are `octave` and
 * `octave-2`; the ref picks one and the adapter spells it as the version.
 * A ref the catalog does not know leaves `version` unset, which is the
 * documented "let Hume route it" behaviour rather than a guess.
 *
 * `format` carries a container name and nothing else (`mp3` / `wav` / `pcm`),
 * so a sample rate or bitrate is an `unsupported_param` rather than a value
 * dropped on the floor. Multi-generation requests, acting directions
 * (`description`) and prosody context stay available through
 * `providerOptions.hume`.
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
  SpeechAdapterFor,
  SpeechModelParamTable,
  SpeechParams,
} from "../../core/unified/vocabulary/speech";
import {
  speech as validator,
  type HumeAudioFormatType,
  type HumeTimestampType,
  type HumeUtterance,
  type TtsBody,
} from "./speech";

/** The two Octave rows the catalog carries — the ref union for `hume/…`. */
const MODELS = ["octave", "octave-2"] as const;

const SYNTHESIZE_DOCS = "https://dev.hume.ai/reference/text-to-speech-tts/synthesize-json";

/** The wire body this adapter compiles to. */
export type HumeSpeechWire = TtsBody;

/** What a unified call to `hume/…` returns. */
export type HumeSpeechResult = ReturnType<typeof validator>;

const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", pcm_s16le: "pcm" },
  containers: { mp3: ["mp3"], pcm_s16le: ["wav", "raw"] },
  unavailable: ["sampleRate", "bitrate"],
  source: SYNTHESIZE_DOCS,
};

/**
 * Hume's per-model surface, and the one place it splits.
 *
 * Both rows carry the same two codecs (`format.type` is `mp3` / `wav` / `pcm`
 * and nothing else) and the same three body-root knobs. What differs is
 * `include_timestamp_types`: "Only supported for Octave 2 requests", and on
 * `version: "1"` the API **accepts it and returns empty timestamp arrays**.
 * That is the accepted-and-ignored case the loss contract likes least — worse
 * than a refusal, because nothing in the response says the request lost
 * anything — so the key is declared on `octave-2` alone and an editor refuses
 * it on `octave` by name. The provider's own `checkTimestampTypes` still warns
 * for the callers no type reaches.
 *
 * ## The two extras that reach into `utterances[0]`
 *
 * Hume is the provider with no `text` field: `text`, `voice` and `speed`
 * compile into an utterance, and `description` (acting direction) and
 * `trailing_silence` are that utterance's siblings. {@link UTTERANCE_NESTING}
 * places them there, which is what the array-walking half of `applyExtras`'s
 * `place` exists for — the alternative was leaving the single most useful knob
 * on this endpoint reachable only through `providerOptions`.
 *
 * Deliberately absent:
 *
 * - **`utterances[].voice.provider`** (`"HUME_AI" | "CUSTOM_VOICE"`) — the only
 *   spelling a top-level extra could have is `provider`, which is the word this
 *   whole library uses for the other half of a model ref. A key that reads as
 *   `"hume"` and means `"CUSTOM_VOICE"` is worth more confusion than it saves;
 *   it stays on `providerOptions.hume`.
 * - **`num_generations`** — it asks for several takes of the same text, which
 *   is what the canonical `n` would mean if this category had one. Spelling it
 *   as a provider extra would put a word in front of callers that the
 *   vocabulary intends to standardise.
 * - **`context`, `instant_mode`** — the first is a prior-generation reference
 *   with its own request shape, the second is streaming-only transport.
 */
const OCTAVE_EXTRAS = {
  // → utterances[0].*
  description: EXTRA as string | null,
  trailing_silence: EXTRA as number,
  // → body root
  temperature: EXTRA as number | null,
  split_utterances: EXTRA as boolean,
  strip_headers: EXTRA as boolean,
} as const;

const HUME_SPEECH_MODEL_PARAMS = {
  octave: { codecs: ["mp3", "pcm_s16le"], extras: OCTAVE_EXTRAS },
  "octave-2": {
    codecs: ["mp3", "pcm_s16le"],
    extras: { ...OCTAVE_EXTRAS, include_timestamp_types: EXTRA as HumeTimestampType[] },
  },
} as const satisfies SpeechModelParamTable;

/** The two knobs that belong to the utterance rather than to the request. */
const UTTERANCE_NESTING: Readonly<Record<string, readonly string[]>> = {
  description: ["utterances", "0"],
  trailing_silence: ["utterances", "0"],
};

export const speech = {
  category: "speech",
  provider: "hume",
  models: MODELS,
  modelParams: HUME_SPEECH_MODEL_PARAMS,
  unsupported: {
    language:
      "POST /v0/tts has no language field — Octave infers the language from the text and the " +
      "voice, and is steered towards an accent with `description` (an utterance-level acting " +
      "direction, available through `providerOptions.hume`).",
  },
  compile(
    input: SpeechParams,
    ctx: CompileContext<SpeechParams>,
  ): CompiledCall<HumeSpeechWire, HumeSpeechResult> {
    ctx.from(["utterances", 0, "text"], "text");
    ctx.from(["utterances", 0, "voice"], "voice");
    ctx.from(["utterances", 0, "speed"], "speed");
    ctx.from(["version"], "model");
    ctx.from(["format"], "outputFormat");

    const utterance: HumeUtterance = { text: input.text };
    const body: HumeSpeechWire = { utterances: [utterance] };

    // The catalog row is the version. An id neither row names has already
    // drawn `unknown_model`; leaving `version` off is Hume's own documented
    // fallback ("automatically route the request to the most appropriate
    // model"), which beats inventing a version number.
    if (ctx.model === "octave-2") body.version = "2";
    else if (ctx.model === "octave") body.version = "1";

    if (input.voice !== undefined) {
      const voice = ctx.take(
        resolveVoice(
          input.voice,
          { accepts: ["name", "id"], source: SYNTHESIZE_DOCS },
          { path: ["voice"], warn: ctx.warn },
        ),
      );
      // Hume takes either spelling and cannot tell them apart from the string,
      // so a bare string is read as a name — the Voice Library lists names.
      if (voice !== undefined) {
        utterance.voice = voice.kind === "id" ? { id: voice.value } : { name: voice.value };
      }
    }

    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined) {
        const type: HumeAudioFormatType =
          format.codec === "mp3" ? "mp3" : format.container === "wav" ? "wav" : "pcm";
        body.format = { type };
      }
    }

    if (input.speed !== undefined) {
      const speed = ctx.take(
        toSpeed(
          input.speed,
          { min: 0.5, max: 2, source: SYNTHESIZE_DOCS },
          { path: ["speed"], warn: ctx.warn },
        ),
      );
      if (speed !== undefined) utterance.speed = speed;
    }

    applyExtras(input, HUME_SPEECH_MODEL_PARAMS, body, ctx, { nest: UTTERANCE_NESTING });

    return { params: body, validate: validator.safe };
  },
} as const satisfies SpeechAdapterFor<
  typeof HUME_SPEECH_MODEL_PARAMS,
  HumeSpeechWire,
  HumeSpeechResult
>;
