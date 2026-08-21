/**
 * ElevenLabs Eleven Music — POST https://api.elevenlabs.io/v1/music
 *
 * Wire notes (verified against
 * https://elevenlabs.io/docs/api-reference/music/compose and the machine
 * readable https://api.elevenlabs.io/openapi.json on 2026-08-13):
 * - `output_format` is a QUERY param, not a body field: it is stripped from
 *   the wire body and appended to `.request.url`. Sending it in the JSON body
 *   is a silent no-op, and its default ("auto") resolves per model
 *   (mp3_44100_128 for v1, mp3_48000_192 for v2).
 * - `prompt` and `composition_plan` are mutually exclusive, and the plan's
 *   SHAPE is model-specific: `music_v1` takes the sections plan
 *   ({positive_global_styles, negative_global_styles, sections}) and
 *   `music_v2` takes the chunks plan ({chunks}) — "Using this field with any
 *   other model will result in an error" is the API's own wording for both.
 * - `music_length_ms` (3000–600000) and `force_instrumental` apply to
 *   prompt-based generation only; with a composition plan the section/chunk
 *   durations decide the length.
 * - `finetune_strength` (0 < x ≤ 2, default 1) and `use_phonetic_names`
 *   (boolean, default false) are real body fields on the served spec but are
 *   flagged `x-fern-ignore: true`, so they are absent from both the rendered
 *   docs page and the generated `@elevenlabs/elevenlabs-js` client. unmodel
 *   validates them anyway — they are accepted on the wire — and `.toSdk("elevenlabs")`
 *   passes them through under their WIRE names, because the SDK has no
 *   camelCase counterpart to map them to.
 * - The endpoint responds with raw audio bytes, not JSON, so there is no
 *   response checker for music.
 * - Auth is an `xi-api-key` header — unmodel never touches keys; add it
 *   yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeAudioMinutesCostUSD, minutesFromMilliseconds } from "../../core/cost";
import { models, MUSIC_MODEL_IDS, type ElevenlabsMusicModelId } from "./models";

export const MUSIC_URL = "https://api.elevenlabs.io/v1/music";

const MUSIC_DOCS_URL = "https://elevenlabs.io/docs/api-reference/music/compose";

/**
 * The spec the API itself serves — the only published source for the two
 * `x-fern-ignore` body fields (`finetune_strength`, `use_phonetic_names`),
 * which the rendered docs page above omits.
 */
const MUSIC_OPENAPI_URL = "https://api.elevenlabs.io/openapi.json#/paths/~1v1~1music/post";

/**
 * Server-side default when `model_id` is omitted —
 * "model_id … default: music_v1" (MUSIC_DOCS_URL). Model-dependent checks
 * (plan shape, cost) run against this model when none is given.
 */
export const DEFAULT_MUSIC_MODEL_ID = "music_v1";

/**
 * `output_format` query values ("codec_sample_rate_bitrate"), plus "auto" —
 * MUSIC_DOCS_URL. Some are plan-gated; unmodel cannot see your plan, so all
 * documented values pass.
 */
export const MUSIC_OUTPUT_FORMATS = [
  "auto",
  "mp3_22050_32",
  "mp3_24000_48",
  "mp3_44100_32",
  "mp3_44100_64",
  "mp3_44100_96",
  "mp3_44100_128",
  "mp3_44100_192",
  "mp3_48000_128",
  "mp3_48000_192",
  "mp3_48000_240",
  "mp3_48000_320",
  "pcm_8000",
  "pcm_16000",
  "pcm_22050",
  "pcm_24000",
  "pcm_32000",
  "pcm_44100",
  "pcm_48000",
  "ulaw_8000",
  "alaw_8000",
  "opus_48000_32",
  "opus_48000_64",
  "opus_48000_96",
  "opus_48000_128",
  "opus_48000_192",
] as const;
export type ElevenlabsMusicOutputFormat = (typeof MUSIC_OUTPUT_FORMATS)[number];

/** Documented bounds of `music_length_ms` ("between 3000ms and 600000ms"). */
export const MUSIC_LENGTH_MS_MIN = 3000;
export const MUSIC_LENGTH_MS_MAX = 600000;
/** Documented bounds of a section / chunk `duration_ms`. */
export const MUSIC_SECTION_MS_MIN = 3000;
export const MUSIC_SECTION_MS_MAX = 120000;
/** "Max 30 lines per section and max 200 characters per line." */
export const MUSIC_MAX_SECTIONS = 30;
export const MUSIC_MAX_LINES_PER_SECTION = 30;
export const MUSIC_MAX_STYLES = 50;
/** `prompt` maxLength on the compose body. */
export const MUSIC_PROMPT_MAX_CHARACTERS = 4100;
/**
 * `finetune_strength` bounds — `"exclusiveMinimum": 0, "maximum": 2` on
 * https://api.elevenlabs.io/openapi.json#/paths/~1v1~1music/post. 0 itself is
 * NOT accepted; 2 is.
 */
export const MUSIC_FINETUNE_STRENGTH_MIN_EXCLUSIVE = 0;
export const MUSIC_FINETUNE_STRENGTH_MAX = 2;

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

/** A time range inside a previously generated song (inpainting sources). */
export interface ElevenlabsMusicTimeRange {
  start_ms?: number;
  end_ms?: number;
}

export interface ElevenlabsMusicSectionSource {
  song_id: string;
  range: ElevenlabsMusicTimeRange;
  negative_ranges?: ElevenlabsMusicTimeRange[];
}

/** One section of a `music_v1` composition plan. */
export interface ElevenlabsMusicSection {
  /** 1–100 characters. */
  section_name: string;
  positive_local_styles: string[];
  negative_local_styles: string[];
  /** 3000–120000 ms. */
  duration_ms: number;
  /** Up to 30 lines, each up to 200 characters. */
  lines: string[];
  /** Source section to extract from an existing song (inpainting). */
  source_from?: ElevenlabsMusicSectionSource | null;
}

/** A `music_v1` composition plan: global styles plus sections. */
export interface ElevenlabsMusicSectionsPlan {
  positive_global_styles: string[];
  negative_global_styles: string[];
  sections: ElevenlabsMusicSection[];
}

/** An audio reference into an existing song (a `music_v2` chunk conditioner). */
export interface ElevenlabsMusicAudioRef {
  song_id: string;
  range: ElevenlabsMusicTimeRange;
}

/** One chunk of a `music_v2` composition plan. */
export interface ElevenlabsMusicChunk {
  /** Section markers in [square brackets], lyrics, {inline directions}. */
  text?: string;
  /** 3000–120000 ms. */
  duration_ms?: number;
  positive_styles?: string[];
  negative_styles?: string[];
  /** How closely this chunk follows its neighbours. Default "high". */
  context_adherence?: "low" | "medium" | "high";
  /** Audio reference conditioning this chunk. */
  conditioning_ref?: ElevenlabsMusicAudioRef | null;
}

/** A `music_v2` composition plan: up to 30 chunks. */
export interface ElevenlabsMusicChunksPlan {
  chunks: Array<ElevenlabsMusicChunk | ElevenlabsMusicAudioRef>;
}

export type ElevenlabsCompositionPlan = ElevenlabsMusicSectionsPlan | ElevenlabsMusicChunksPlan;

export interface MusicParams {
  /**
   * A simple text prompt to generate a song from (up to 4100 characters).
   * Cannot be combined with `composition_plan`.
   */
  prompt?: string | null;
  /**
   * A detailed composition plan. Shape is model-specific: sections for
   * music_v1, chunks for music_v2. Cannot be combined with `prompt`.
   */
  composition_plan?: ElevenlabsCompositionPlan | null;
  /** Track length in ms (3000–600000). Prompt-based generation only. */
  music_length_ms?: number | null;
  /** Defaults to "music_v1" server-side. */
  model_id?: ElevenlabsMusicModelId | (string & {});
  /** Deterministic-ish sampling seed, 0–2147483647. */
  seed?: number | null;
  /** Guarantee an instrumental track. Prompt-based generation only. Default false. */
  force_instrumental?: boolean;
  /** Id of a music finetune to generate with (up to 100 characters). */
  finetune_id?: string | null;
  /**
   * How strongly the finetune influences the generation — greater than 0 and
   * at most 2, default 1.0 (full strength). "Only meaningful when
   * `finetune_id` is also provided." Hidden from the generated SDK
   * (`x-fern-ignore`); see the module JSDoc.
   */
  finetune_strength?: number;
  /**
   * Phonetically spell proper names from the prompt in the lyrics so the music
   * model pronounces them better; the original names are restored in the word
   * timestamps. Default false. Hidden from the generated SDK (`x-fern-ignore`).
   */
  use_phonetic_names?: boolean;
  /**
   * How strictly plan section durations are enforced. `music_v1` only —
   * `music_v2` always enforces them and ignores this. Default true.
   */
  respect_sections_durations?: boolean;
  /** Store the generated song so it can be inpainted later. Default false. */
  store_for_inpainting?: boolean;
  /** Sign the generated song with C2PA (mp3 only). Default false. */
  sign_with_c2pa?: boolean;
  /**
   * QUERY param — stripped from the wire body and appended to `.request.url`
   * as `?output_format=…`. Default "auto".
   *
   * Closed: MUSIC_OUTPUT_FORMATS is the complete documented list and
   * checkOutputFormat hard-errors (`invalid_enum_value`) on anything else, so
   * there is no `(string & {})` escape to widen it — the same treatment
   * `TextToSpeechParams.output_format` already gets.
   */
  output_format?: ElevenlabsMusicOutputFormat;
}

// ---------------------------------------------------------------------------
// SDK view — @elevenlabs/elevenlabs-js is camelCase:
// client.music.compose({ prompt, musicLengthMs, modelId, ... }).
// ---------------------------------------------------------------------------

export interface MusicSdkParams {
  prompt?: string;
  compositionPlan?: ElevenlabsCompositionPlan;
  musicLengthMs?: number;
  modelId?: string;
  seed?: number;
  forceInstrumental?: boolean;
  finetuneId?: string;
  /**
   * `x-fern-ignore: true` on the served spec: the generated client has no
   * camelCase counterpart for these two, so `.toSdk("elevenlabs")` leaves them under their
   * wire names. If the SDK drops them, send the wire body with `fetch`.
   */
  finetune_strength?: number;
  use_phonetic_names?: boolean;
  respectSectionsDurations?: boolean;
  storeForInpainting?: boolean;
  signWithC2pa?: boolean;
  outputFormat?: ElevenlabsMusicOutputFormat;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const timeRangeSchema = z.looseObject({
  start_ms: z.number().optional(),
  end_ms: z.number().optional(),
});

const sectionSchema = z.looseObject({
  section_name: z.string().min(1).max(100),
  positive_local_styles: z.array(z.string()).max(MUSIC_MAX_STYLES).optional(),
  negative_local_styles: z.array(z.string()).max(MUSIC_MAX_STYLES).optional(),
  duration_ms: z.number().int().min(MUSIC_SECTION_MS_MIN).max(MUSIC_SECTION_MS_MAX).optional(),
  lines: z.array(z.string().max(200)).max(MUSIC_MAX_LINES_PER_SECTION).optional(),
  source_from: z
    .looseObject({
      song_id: z.string(),
      range: timeRangeSchema,
      negative_ranges: z.array(timeRangeSchema).max(10).optional(),
    })
    .nullable()
    .optional(),
});

const chunkSchema = z.looseObject({
  text: z.string().max(6000).optional(),
  duration_ms: z.number().int().min(MUSIC_SECTION_MS_MIN).max(MUSIC_SECTION_MS_MAX).optional(),
  positive_styles: z.array(z.string()).max(MUSIC_MAX_STYLES).optional(),
  negative_styles: z.array(z.string()).max(MUSIC_MAX_STYLES).optional(),
  context_adherence: z.enum(["low", "medium", "high"]).optional(),
  conditioning_ref: z
    .looseObject({ song_id: z.string(), range: timeRangeSchema })
    .nullable()
    .optional(),
});

const compositionPlanSchema = z.union([
  z.looseObject({
    positive_global_styles: z.array(z.string()).max(MUSIC_MAX_STYLES).optional(),
    negative_global_styles: z.array(z.string()).max(MUSIC_MAX_STYLES).optional(),
    sections: z.array(sectionSchema).max(MUSIC_MAX_SECTIONS),
  }),
  z.looseObject({ chunks: z.array(chunkSchema).max(MUSIC_MAX_SECTIONS) }),
]);

const musicSchema = z.looseObject({
  prompt: z.string().max(MUSIC_PROMPT_MAX_CHARACTERS).nullable().optional(),
  composition_plan: compositionPlanSchema.nullable().optional(),
  music_length_ms: z
    .number()
    .int()
    .min(MUSIC_LENGTH_MS_MIN, `music_length_ms must be between ${MUSIC_LENGTH_MS_MIN} and ${MUSIC_LENGTH_MS_MAX}`)
    .max(MUSIC_LENGTH_MS_MAX, `music_length_ms must be between ${MUSIC_LENGTH_MS_MIN} and ${MUSIC_LENGTH_MS_MAX}`)
    .nullable()
    .optional(),
  model_id: z.string().optional(),
  seed: z.number().int().min(0).max(2147483647).nullable().optional(),
  force_instrumental: z.boolean().optional(),
  finetune_id: z.string().max(100).nullable().optional(),
  finetune_strength: z
    .number()
    .gt(
      MUSIC_FINETUNE_STRENGTH_MIN_EXCLUSIVE,
      `finetune_strength must be greater than ${MUSIC_FINETUNE_STRENGTH_MIN_EXCLUSIVE} (exclusive) and at most ${MUSIC_FINETUNE_STRENGTH_MAX}`,
    )
    .max(
      MUSIC_FINETUNE_STRENGTH_MAX,
      `finetune_strength must be greater than ${MUSIC_FINETUNE_STRENGTH_MIN_EXCLUSIVE} (exclusive) and at most ${MUSIC_FINETUNE_STRENGTH_MAX}`,
    )
    .optional(),
  use_phonetic_names: z.boolean().optional(),
  respect_sections_durations: z.boolean().optional(),
  store_for_inpainting: z.boolean().optional(),
  sign_with_c2pa: z.boolean().optional(),
  output_format: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const MUSIC_MODEL_ID_SET = new Set<string>(MUSIC_MODEL_IDS);
const OUTPUT_FORMAT_SET = new Set<string>(MUSIC_OUTPUT_FORMATS);

function isChunksPlan(plan: ElevenlabsCompositionPlan): plan is ElevenlabsMusicChunksPlan {
  return Array.isArray((plan as ElevenlabsMusicChunksPlan).chunks);
}

function isSectionsPlan(plan: ElevenlabsCompositionPlan): plan is ElevenlabsMusicSectionsPlan {
  return Array.isArray((plan as ElevenlabsMusicSectionsPlan).sections);
}

/**
 * The catalog carries every documented ElevenLabs model id, so a TTS or STT id
 * would otherwise resolve and pass music validation unremarked. Ids unknown to
 * the catalog stay a warning (`unknown_model`) — they may be new music models.
 */
function checkMusicModelKind(
  params: MusicParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model_id ?? DEFAULT_MUSIC_MODEL_ID;
  if (info === undefined || MUSIC_MODEL_ID_SET.has(model)) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model_id"],
    model,
    message: `"${model}" is not a music model; POST /v1/music accepts ${MUSIC_MODEL_IDS.map((id) => `"${id}"`).join(", ")}.`,
    meta: { allowed: [...MUSIC_MODEL_IDS], source: MUSIC_DOCS_URL },
  });
}

/**
 * `prompt` and `composition_plan` are mutually exclusive ("Cannot be used in
 * conjunction with…" on both fields — an error). The prompt-only params
 * (`music_length_ms`, `force_instrumental`) are documented as "used only in
 * conjunction with `prompt`" without a stated rejection, so alongside a plan
 * they are reported as ignored (warning severity): worth surfacing, but they
 * must not fail a request the API fulfils.
 */
function checkPromptPlanExclusivity(
  params: MusicParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const hasPrompt = params.prompt != null;
  const hasPlan = params.composition_plan != null;
  if (hasPrompt && hasPlan) {
    ctx.report({
      code: "invalid_shape",
      path: ["composition_plan"],
      message:
        "`composition_plan` cannot be used in conjunction with `prompt` — send one or the other.",
      meta: { source: MUSIC_DOCS_URL },
    });
  }
  if (!hasPlan) return;
  if (params.music_length_ms != null) {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["music_length_ms"],
      message:
        "`music_length_ms` is used only in conjunction with `prompt`; with a `composition_plan` the section/chunk durations set the length.",
      meta: { ignored: true, source: MUSIC_DOCS_URL },
    });
  }
  if (params.force_instrumental === true) {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["force_instrumental"],
      message: "`force_instrumental` can only be used with `prompt`, not with a `composition_plan`.",
      meta: { ignored: true, source: MUSIC_DOCS_URL },
    });
  }
}

/**
 * Plan shape is model-specific — "Composition plan for the `music_v2` model.
 * Using this field with any other model will result in an error" (chunks) and
 * the same sentence for `music_v1` (sections).
 */
function checkPlanShapeMatchesModel(
  params: MusicParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const plan = params.composition_plan;
  if (plan == null) return;
  const model = params.model_id ?? DEFAULT_MUSIC_MODEL_ID;
  if (isChunksPlan(plan) && model !== "music_v2") {
    ctx.report({
      code: "unsupported_param",
      path: ["composition_plan", "chunks"],
      model,
      message: `A chunks composition plan is only accepted by "music_v2"; "${model}" takes the sections plan ({positive_global_styles, negative_global_styles, sections}).`,
      meta: { source: MUSIC_DOCS_URL },
    });
  }
  if (isSectionsPlan(plan) && model !== "music_v1") {
    ctx.report({
      code: "unsupported_param",
      path: ["composition_plan", "sections"],
      model,
      message: `A sections composition plan is only accepted by "music_v1"; "${model}" takes the chunks plan ({chunks}).`,
      meta: { source: MUSIC_DOCS_URL },
    });
  }
}

/**
 * Params the API accepts and then ignores, which is worth surfacing but must
 * not fail a request the API fulfils — hence explicit warning severity:
 * - `respect_sections_durations` is "only applies to `music_v1`; for
 *   `music_v2` section durations are always enforced and this is ignored".
 * - `seed` is documented "Cannot be used in conjunction with prompt". The
 *   docs publish no error for the combination (unlike prompt +
 *   composition_plan, which they call out), so this stays a warning rather
 *   than rejecting a request that may well succeed.
 * - `finetune_strength` is "Only meaningful when `finetune_id` is also
 *   provided" — the spec states no rejection, so on its own it is a no-op.
 */
function checkIgnoredParams(
  params: MusicParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model_id ?? DEFAULT_MUSIC_MODEL_ID;
  if (params.respect_sections_durations !== undefined && model === "music_v2") {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["respect_sections_durations"],
      model,
      message:
        '`respect_sections_durations` applies to "music_v1" only; "music_v2" always enforces plan section durations and ignores it.',
      meta: { ignored: true, source: MUSIC_DOCS_URL },
    });
  }
  if (params.seed != null && params.prompt != null) {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["seed"],
      message:
        "`seed` is documented as unusable in conjunction with `prompt` — it is honoured for composition-plan generations.",
      meta: { ignored: true, source: MUSIC_DOCS_URL },
    });
  }
  if (params.finetune_strength !== undefined && params.finetune_id == null) {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["finetune_strength"],
      message:
        "`finetune_strength` is only meaningful when `finetune_id` is also provided; without a finetune there is nothing for it to weight.",
      meta: { ignored: true, source: MUSIC_OPENAPI_URL },
    });
  }
}

function checkOutputFormat(
  params: MusicParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const format = params.output_format;
  if (format === undefined || OUTPUT_FORMAT_SET.has(format)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["output_format"],
    message: `\`output_format\` must be one of ${MUSIC_OUTPUT_FORMATS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(format)}.`,
    meta: { allowed: [...MUSIC_OUTPUT_FORMATS], value: format, source: MUSIC_DOCS_URL },
  });
}

// ---------------------------------------------------------------------------
// Estimation — music is billed per minute of GENERATED audio, so the length
// comes from `music_length_ms` or, for a composition plan, the sum of its
// section/chunk durations. Neither present (the model picks a length) → no
// estimate.
// ---------------------------------------------------------------------------

/** Total milliseconds a request asks for, when the request states it. */
export function requestedDurationMs(params: MusicParams): number | undefined {
  if (params.music_length_ms != null) return params.music_length_ms;
  const plan = params.composition_plan;
  if (plan == null) return undefined;
  const parts: Array<{ duration_ms?: number }> = isChunksPlan(plan)
    ? (plan.chunks as Array<{ duration_ms?: number }>)
    : isSectionsPlan(plan)
      ? plan.sections
      : [];
  let total = 0;
  for (const part of parts) {
    if (typeof part?.duration_ms !== "number") return undefined;
    total += part.duration_ms;
  }
  return total === 0 ? undefined : total;
}

function estimate(params: MusicParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  const ms = requestedDurationMs(params);
  if (ms === undefined) return {};
  const costUSD = computeAudioMinutesCostUSD(info?.cost, minutesFromMilliseconds(ms));
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Finalize: wire body (output_format stripped — it lives in the URL)
// + .toSdk("elevenlabs") + .request
// ---------------------------------------------------------------------------

/** Endpoint URL with the documented `output_format` query param appended. */
export function musicUrl(outputFormat?: ElevenlabsMusicOutputFormat): string {
  return outputFormat === undefined
    ? MUSIC_URL
    : `${MUSIC_URL}?${new URLSearchParams({ output_format: outputFormat }).toString()}`;
}

/**
 * Wire snake_case → SDK camelCase for top-level body keys. `finetune_strength`
 * and `use_phonetic_names` are deliberately absent: they are `x-fern-ignore`
 * on the served spec, so the generated SDK declares no counterpart and there is
 * no camelCase name to map them to — they fall through unchanged like any
 * unknown param.
 */
const SDK_KEY_MAP: Record<string, string> = {
  prompt: "prompt",
  composition_plan: "compositionPlan",
  music_length_ms: "musicLengthMs",
  model_id: "modelId",
  seed: "seed",
  force_instrumental: "forceInstrumental",
  finetune_id: "finetuneId",
  respect_sections_durations: "respectSectionsDurations",
  store_for_inpainting: "storeForInpainting",
  sign_with_c2pa: "signWithC2pa",
};

function buildSdkParams(
  outputFormat: ElevenlabsMusicOutputFormat | undefined,
  body: object,
): MusicSdkParams {
  const request: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value == null) continue; // null = provider default → omitted for the SDK
    request[SDK_KEY_MAP[key] ?? key] = value; // unknown params pass through unchanged
  }
  if (outputFormat !== undefined) request.outputFormat = outputFormat;
  return request as MusicSdkParams;
}

/**
 * SDK targets for `elevenlabs.music`. `"elevenlabs"` camelCases the wire body
 * into the request object `@elevenlabs/elevenlabs-js`'s
 * `client.music.compose(request)` takes. Type alias, not interface: an
 * interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type MusicSdkTargets = { elevenlabs: () => MusicSdkParams };

function finalize(params: MusicParams): unknown {
  const { output_format, ...body } = params;
  return toValidated(
    body,
    {
      url: musicUrl(output_format),
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { elevenlabs: () => buildSdkParams(output_format, body) } },
  );
}

const validator = createValidator<MusicParams, unknown>({
  endpoint: "elevenlabs.music",
  schema: musicSchema,
  // model_id is optional on the wire; checks run against the documented
  // server-side default (music_v1).
  modelId: (params) => params.model_id ?? DEFAULT_MUSIC_MODEL_ID,
  catalog: models,
  checks: [
    checkMusicModelKind,
    checkPromptPlanExclusivity,
    checkPlanShapeMatchesModel,
    checkIgnoredParams,
    checkOutputFormat,
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for ElevenLabs `POST /v1/music` (Eleven Music).
 *
 * The returned object's enumerable props are the exact fetch JSON body —
 * `output_format` is a query param and lives in `.request.url` instead.
 * `.toSdk("elevenlabs")` returns the camelCased params object for
 * `@elevenlabs/elevenlabs-js`'s `client.music.compose(request)`. Auth is your
 * job: add an `xi-api-key` header when fetching.
 *
 * Cost is estimated at $0.15 per minute of generated audio whenever the
 * request states a length (`music_length_ms`, or the summed durations of a
 * composition plan).
 *
 * ```ts
 * const params = elevenlabs.music({
 *   prompt: "An uplifting synthwave track with driving drums",
 *   music_length_ms: 30000,
 *   model_id: "music_v2",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, "xi-api-key": process.env.ELEVENLABS_API_KEY! },
 *   body: JSON.stringify(params),
 * });
 * const track = await res.arrayBuffer();
 * ```
 */
export const music = validator as unknown as {
  <T extends MusicParams>(
    params: T & ExactKeys<T, MusicParams>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "output_format">, MusicSdkTargets>;
  safe<T extends MusicParams>(
    params: T & ExactKeys<T, MusicParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "output_format">, MusicSdkTargets>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
