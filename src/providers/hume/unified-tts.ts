/**
 * `unmodel/tts` → `hume.tts` (POST /v0/tts).
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
import { applyExtras, resolveAudioFormat, resolveVoice, toSpeed } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { TtsAdapterFor, TtsParams } from "../../core/unified/vocabulary/tts";
import {
  tts as validator,
  type HumeAudioFormatType,
  type HumeUtterance,
  type TtsBody,
} from "./tts";
import {
  FORMAT,
  HUME_TTS_DELIVERY,
  HUME_TTS_MODEL_PARAMS,
  MODELS,
  SYNTHESIZE_DOCS,
} from "./tts-params";

/** The wire body this adapter compiles to. */
export type HumeTtsWire = TtsBody;

/** What a unified call to `hume/…` returns. */
export type HumeTtsResult = ReturnType<typeof validator>;

/** The two knobs that belong to the utterance rather than to the request. */
const UTTERANCE_NESTING: Readonly<Record<string, readonly string[]>> = {
  description: ["utterances", "0"],
  trailing_silence: ["utterances", "0"],
};

export const tts = {
  category: "tts",
  provider: "hume",
  models: MODELS,
  modelParams: HUME_TTS_MODEL_PARAMS,
  delivery: HUME_TTS_DELIVERY,
  unsupported: {
    language:
      "POST /v0/tts has no language field — Octave infers the language from the text and the " +
      "voice, and is steered towards an accent with `description` (an utterance-level acting " +
      "direction, available through `providerOptions.hume`).",
  },
  compile(
    input: TtsParams,
    ctx: CompileContext<TtsParams>,
  ): CompiledCall<HumeTtsWire, HumeTtsResult> {
    ctx.from(["utterances", 0, "text"], "text");
    ctx.from(["utterances", 0, "voice"], "voice");
    ctx.from(["utterances", 0, "speed"], "speed");
    ctx.from(["version"], "model");
    ctx.from(["format"], "outputFormat");

    const utterance: HumeUtterance = { text: input.text };
    const body: HumeTtsWire = { utterances: [utterance] };

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

    applyExtras(input, HUME_TTS_MODEL_PARAMS, body, ctx, { nest: UTTERANCE_NESTING });

    return { params: body, validate: validator.safe };
  },
} as const satisfies TtsAdapterFor<
  typeof HUME_TTS_MODEL_PARAMS,
  HumeTtsWire,
  HumeTtsResult
>;
