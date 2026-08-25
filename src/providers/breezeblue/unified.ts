/**
 * `unmodel/tts` → `breezeblue.tts` (POST /v1/text-to-speech/{voice_id}).
 *
 * A small surface: the body is five fields, the format is a bare codec name
 * in a QUERY param, and the two knobs with no canonical word (`instructions`,
 * `guidance_scale`) ride in as extras — the latter nested under
 * `voice_settings`, the only place the wire accepts it.
 *
 * - **`voice` becomes `voice_id`**, which the validator relocates into the
 *   URL path — it is still a params key, so provenance is declared for it and
 *   a missing or empty voice is reported at `voice`. Only the id spelling
 *   (`voc_…`, from GET /v1/voices) is accepted: the API takes no voice name.
 * - **`outputFormat` compiles to a bare codec.** There is no sample-rate or
 *   bitrate field anywhere on the HTTP API, so a canonical `sampleRate` or
 *   `bitrate` is an error rather than a value dropped (`FORMAT.unavailable`).
 *   `pcm_s16le` picks its wire word from the container: `wav` with the RIFF
 *   header, `pcm` for the bare stream.
 * - **`speed` does not exist here** — declared `unsupported`, not dropped.
 * - **`language` → `language_code`** (ISO 639-1 primary subtag). Which codes
 *   a model serves is runtime data (GET /v1/models `languages`), so the
 *   two-letter shape is checked by the provider validator and the pairing is
 *   the API's to refuse.
 * - **`delivery` stays off the canonical surface**: it selects the response
 *   contract (bytes vs 202 job), which the delivery spec describes; set it
 *   through `providerOptions.breezeblue` when you want the async job.
 */
import { applyExtras, resolveAudioFormat, resolveVoice, toPrimaryLanguage } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { TtsAdapterFor, TtsParams } from "../../core/unified/vocabulary/tts";
import { tts as validator, type TtsParams as BreezeblueWireParams } from "./tts";
import {
  BREEZEBLUE_TTS_DELIVERY,
  BREEZEBLUE_TTS_MODEL_PARAMS,
  FORMAT,
  MODELS,
  TTS_DOCS,
} from "./tts-params";

/** The wire params this adapter compiles to (voice_id + query params included). */
export type BreezeblueTtsWire = BreezeblueWireParams;

/** What a unified call to `breezeblue/…` returns. */
export type BreezeblueTtsResult = ReturnType<typeof validator<BreezeblueTtsWire>>;

/** `guidance_scale` lives under `voice_settings`, not at the body root. */
const VOICE_SETTINGS_NESTING: Readonly<Record<string, readonly string[]>> = {
  guidance_scale: ["voice_settings"],
};

export const tts = {
  category: "tts",
  provider: "breezeblue",
  models: MODELS,
  modelParams: BREEZEBLUE_TTS_MODEL_PARAMS,
  delivery: BREEZEBLUE_TTS_DELIVERY,
  unsupported: {
    speed:
      "POST /v1/text-to-speech/{voice_id} has no speech-rate field — delivery is directed with the `instructions` extra (free-text performance direction) and `guidance_scale` (how strongly generation follows it, 1.0–10.0).",
  },
  compile(
    input: TtsParams,
    ctx: CompileContext<TtsParams>,
  ): CompiledCall<BreezeblueTtsWire, BreezeblueTtsResult> {
    // `voice_id` is a URL path param the validator strips out of the body; it
    // is still a params key, so the provenance below is what makes "voice_id
    // must be a non-empty voice id" arrive at `voice`.
    const body: BreezeblueTtsWire = { voice_id: "", text: input.text, model_id: ctx.model };
    ctx.from(["model_id"], "model");
    ctx.from(["voice_id"], "voice");
    ctx.from(["output_format"], "outputFormat");
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
      if (format !== undefined) {
        // The wire word for 16-bit PCM depends on the container: "wav" is the
        // RIFF-framed spelling, "pcm" (FORMAT.codecs' value) the bare stream.
        body.output_format = (
          format.codec === "pcm_s16le" && format.container === "wav" ? "wav" : format.wire
        ) as BreezeblueWireParams["output_format"];
      }
    }

    if (input.language !== undefined) {
      const language = ctx.take(
        toPrimaryLanguage(
          input.language,
          { path: ["language"], warn: ctx.warn },
          { source: TTS_DOCS },
        ),
      );
      if (language !== undefined) body.language_code = language;
    }

    applyExtras(input, BREEZEBLUE_TTS_MODEL_PARAMS, body, ctx, { nest: VOICE_SETTINGS_NESTING });

    return { params: body, validate: validator.safe };
  },
} as const satisfies TtsAdapterFor<
  typeof BREEZEBLUE_TTS_MODEL_PARAMS,
  BreezeblueTtsWire,
  BreezeblueTtsResult
>;
