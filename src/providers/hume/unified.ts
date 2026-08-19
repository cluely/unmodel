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
  resolveAudioFormat,
  resolveVoice,
  toSpeed,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall, UnifiedAdapter } from "../../core/unified/types";
import type { SpeechParams } from "../../core/unified/vocabulary/speech";
import {
  speech as validator,
  type HumeAudioFormatType,
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

export const speech = {
  category: "speech",
  provider: "hume",
  models: MODELS,
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

    return { params: body, validate: validator.safe };
  },
} as const satisfies UnifiedAdapter<SpeechParams, HumeSpeechWire, HumeSpeechResult>;
