/**
 * `unmodel/tts` → `revana.tts`
 * (POST https://api.revana.si/v1/generations).
 *
 * | canonical | wire (`input.…`) | notes |
 * |---|---|---|
 * | `text` | `text` | the model's `max_characters` is checked on the way out |
 * | `voice` | `voice` | a voice ID — one of the model's `options.voices` |
 * | `speed` | `speed` | the same multiplier; the bounds and which models take it are the validator's |
 * | `language` | `language_code` | see below |
 * | `outputFormat` | — | declared unsupported |
 *
 * # A voice is an id
 *
 * The catalog lists each voice as `{ id, name }` and the wire takes the id, so
 * a bare string and `{ id }` are the same request and `{ name }` is refused —
 * `REVANA_VOICES` on `unmodel/revana/values` is the table that maps one to the
 * other. Each row's `voices` completes the ids; an off-list one is
 * `revana.tts`'s refusal, naming the model's default.
 *
 * # `language` is three different fields, by model
 *
 * Where the model lists languages they are bare primary subtags (`pt`, `fil`),
 * so a BCP-47 tag is sent as its primary subtag and a dropped region is an
 * `approximated_param`. Where it lists none the field takes any code, and the
 * tag goes through as written. Where its list is EMPTY the model "picks the
 * language from the text" and `revana.tts` refuses the field by that sentence.
 *
 * # What the vocabulary does not reach
 *
 * `stability` and `similarity_boost` are per-model extras, on the models the
 * API says take them. `dialogue` — "lines, each with its own voice" — is not
 * reachable from here at all: it REPLACES `text` and `voice` ("not both"), and
 * `text` is the one word this vocabulary requires. It is `revana.tts`'s, by
 * name.
 *
 * The audio is not in the response to this request: see `REVANA_TTS_DELIVERY`.
 */

import { applyExtras, resolveVoice, toPrimaryLanguage } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  TtsAdapterFor,
  TtsModelParams,
  TtsParams,
} from "../../core/unified/vocabulary/tts";
import { REVANA_MODELS_SOURCE } from "./checks";
import { tts as validator } from "./tts";
import { MODELS, REVANA_TTS_DELIVERY, REVANA_TTS_MODEL_PARAMS } from "./tts-params";

const ROWS: Readonly<Partial<Record<string, TtsModelParams>>> = REVANA_TTS_MODEL_PARAMS;

/**
 * `input`, as this adapter writes it and as `providerOptions.revana.input`
 * completes it: `SpeechModelInput` in `./generation-wire.ts`.
 */
export interface RevanaTtsWireInput {
  text?: string;
  voice?: string;
  speed?: number;
  language_code?: string;
  /** Per-model extras, 0–1. */
  stability?: number;
  similarity_boost?: number;
}

/** The wire body this adapter compiles to: `GenerationRequest`, loosely typed. */
export interface RevanaTtsWire {
  model: string;
  input: RevanaTtsWireInput;
  max_cost_usd?: number;
  max_wait_s?: number;
}

/** What a unified speech call to `revana/…` returns — see `RevanaVideoResult` in `./unified-video.ts`. */
export type RevanaTtsResult = ReturnType<typeof validator<string>>;

/** See `RevanaVideoValidate` in `./unified-video.ts`. */
type RevanaTtsValidate = CompiledCall<RevanaTtsWire, RevanaTtsResult>["validate"];

export const tts = {
  category: "tts",
  provider: "revana",
  models: MODELS,
  modelParams: REVANA_TTS_MODEL_PARAMS,
  delivery: REVANA_TTS_DELIVERY,
  unsupported: {
    outputFormat:
      "Revana's speech input has no encoding field — the API names what a speech model takes " +
      "(`text`, `voice`, `dialogue`, `stability`, `similarity_boost`, `speed`, `language_code`) and " +
      "a format is not among them. The audio is the file `output.urls[0]` points at.",
  },
  compile(input: TtsParams, ctx: CompileContext<TtsParams>): CompiledCall<RevanaTtsWire, RevanaTtsResult> {
    const wire: RevanaTtsWireInput = { text: input.text };
    ctx.from(["input", "text"], "text");
    ctx.from(["input", "voice"], "voice");
    ctx.from(["input", "speed"], "speed");
    ctx.from(["input", "language_code"], "language");

    if (input.voice !== undefined) {
      const voice = ctx.take(
        resolveVoice(
          input.voice,
          { accepts: ["id"], source: REVANA_MODELS_SOURCE },
          { path: ["voice"], warn: ctx.warn },
        ),
      );
      if (voice !== undefined) wire.voice = voice.value;
    }
    if (input.speed !== undefined) wire.speed = input.speed;
    applyLanguage(input, wire, ROWS[ctx.model], ctx);

    const body: RevanaTtsWire = { model: ctx.model, input: wire };
    applyExtras(input, REVANA_TTS_MODEL_PARAMS, body, ctx, { at: ["input"] });
    return { params: body, validate: validator.safe as RevanaTtsValidate };
  },
} as const satisfies TtsAdapterFor<typeof REVANA_TTS_MODEL_PARAMS, RevanaTtsWire, RevanaTtsResult>;

/**
 * `language_code`: the primary subtag where the model's row lists languages
 * (its list is bare subtags), the tag as written everywhere else.
 */
function applyLanguage(
  input: TtsParams,
  wire: RevanaTtsWireInput,
  row: TtsModelParams | undefined,
  ctx: CompileContext<TtsParams>,
): void {
  if (input.language === undefined) return;
  if (row?.languages === undefined) {
    wire.language_code = input.language;
    return;
  }
  const language = ctx.take(
    toPrimaryLanguage(input.language, { path: ["language"], warn: ctx.warn }, {
      source: REVANA_MODELS_SOURCE,
    }),
  );
  if (language !== undefined) wire.language_code = language;
}
