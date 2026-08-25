/**
 * Lyria 3 music generation — the Interactions API, seen through a music-shaped
 * window.
 * POST https://generativelanguage.googleapis.com/v1beta/interactions
 *
 * **Which surface serves batch Lyria, and why it is not `models/{id}:…`.**
 * Audited 2026-08-24 against the music-generation guide, the Interactions API
 * REST reference and @google/genai@2.17.0:
 * - The guide's only REST example is `POST /v1beta/interactions` with
 *   `{ "model": "lyria-3-clip-preview", "input": "…" }` — no `:predict` (that
 *   was Vertex Lyria 2's route) and no `:generateContent` form is documented
 *   for these ids anywhere on the page.
 * - The SDK agrees: its `Model` union for `ai.interactions.create()` lists
 *   both `lyria-3-clip-preview` and `lyria-3-pro-preview`, and its
 *   music-generation surface elsewhere is only the realtime `LiveMusic`
 *   WebSocket class.
 * Unlike every `models/{model}:{method}` route in this directory, the model id
 * therefore rides **in the body**, not the URL — `musicInteractionUrl()` is a
 * constant, and the validated result keeps `model` enumerable.
 *
 * Wire notes (same sources):
 * - `input` is a string prompt or an array of typed content blocks; the music
 *   window admits `text` and `image` blocks only ("you can provide up to 10
 *   images alongside your text prompt"). Audio/video/document blocks are chat
 *   shapes on this shared route and have no documented meaning for Lyria.
 * - `response_format: { type: "audio", … }` switches Pro's output from the MP3
 *   default to WAV — "This WAV format option is available for Lyria 3 Pro
 *   only", so Clip's arm types it `never` and the runtime check says why.
 * - There are NO structured music knobs: no bpm/density/brightness/scale
 *   fields, no negative prompt, no duration field (Clip is fixed 30 s, Pro's
 *   ~2-minute length is steered "using prompt"). Those exist only on the
 *   realtime `lyria-realtime-exp` WebSocket surface, which this module rejects
 *   by name — see `LYRIA_REALTIME_MODEL_ID`.
 * - "Music generation is a single-turn process" — `previous_interaction_id`
 *   has no meaning here and is refused with that quote.
 * - The response is an Interaction: its `steps` carry a `model_output` step
 *   whose `content` blocks are `{ type: "audio", data: <base64> }` plus the
 *   generated lyrics/structure as text ("The response always includes the
 *   generated lyrics and song structure alongside the audio"). Every result
 *   carries a SynthID audio watermark unconditionally.
 * - Auth is your job: add an `x-goog-api-key` header (or `?key=`) when
 *   fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import {
  JSON_HEADERS,
  toValidated,
  type ExactKeys,
  type RequestMeta,
  type Validated,
} from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { FutureModelId, ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
// `./model-path` supplies only the id normalization here — the URL itself is
// NOT `models/{id}:{method}`-shaped, so `googleModelUrl` has no business on
// this route (see the module header).
import { stripModelsPrefix } from "./model-path";
import {
  INTERACTIONS_API_DOCS_URL,
  LYRIA_MAX_INPUT_IMAGES,
  LYRIA_MUSIC_DOCS_URL,
  LYRIA_REALTIME_MODEL_ID,
  type GoogleLyriaModelId,
} from "./music-params";
import { LYRIA_PRICE_PER_SONG_USD, musicModels } from "./lyria-models";

/** The one URL every interaction rides; the model id lives in the body. */
export const CREATE_INTERACTION_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

/**
 * Endpoint URL. Takes no model on purpose — the Interactions API has exactly
 * one create route and addresses the model through the body — but keeps the
 * builder shape its `models/{id}:{method}` siblings have, so call sites read
 * alike across the provider.
 */
export function musicInteractionUrl(): string {
  return CREATE_INTERACTION_URL;
}

// ---------------------------------------------------------------------------
// Wire types — Tier A: one arm per documented model id. The only per-model
// difference the guide states is `response_format`: "This WAV format option is
// available for Lyria 3 Pro only", and its model table lists no output-format
// control for Clip at all.
// ---------------------------------------------------------------------------

/** The image mime types the Interactions reference enumerates for image blocks. */
export type GoogleInteractionImageMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/heic"
  | "image/heif"
  | "image/gif"
  | "image/bmp"
  | "image/tiff";

/** `resolution` on an image block — a token knob on chat models; passed through. */
export type GoogleInteractionMediaResolution = "low" | "medium" | "high" | "ultra_high";

/**
 * A text content block. The other block kinds' keys are spelled `?: never`
 * rather than omitted so the editor says *which* key is refused (same
 * intersection finding as `./tts.ts`'s parts).
 */
export interface GoogleLyriaTextBlock {
  type: "text";
  text: string;
  mime_type?: never;
  data?: never;
  uri?: never;
  resolution?: never;
}

/**
 * An image block — "up to 10 images alongside your text prompt". `data` is
 * base64; `uri` is the File-API alternative the reference documents.
 */
export interface GoogleLyriaImageBlock {
  type: "image";
  mime_type?: GoogleInteractionImageMimeType;
  data?: string;
  uri?: string;
  /** Undocumented on the music guide; an Interactions image-block field, passed through. */
  resolution?: GoogleInteractionMediaResolution;
  text?: never;
}

export type GoogleLyriaContentBlock = GoogleLyriaTextBlock | GoogleLyriaImageBlock;

/** A bare prompt, or text + image blocks. */
export type GoogleLyriaInput = string | GoogleLyriaContentBlock[];

/**
 * The two output formats the guide documents for Lyria 3. The reference's
 * generic `AudioResponseFormat` mime union is wider (`audio/ogg_opus`,
 * `audio/l16`, …), but the guide names exactly MP3 and WAV for these models,
 * so the others are refused with a citation rather than sent on hope.
 */
export type GoogleLyriaAudioMimeType = "audio/mp3" | "audio/wav";

/**
 * `response_format` — the audio variant of the Interactions `ResponseFormat`
 * union, which is the only variant with a meaning on a music model. The
 * guide's own example is the bare `{ "type": "audio" }`, which selects WAV.
 */
export interface GoogleLyriaAudioResponseFormat {
  type: "audio";
  mime_type?: GoogleLyriaAudioMimeType;
  /** Hz. The reference enumerates no allowed rates, so none are invented here. */
  sample_rate?: number;
  /** Bits per second. "Only applicable for compressed formats (MP3, Opus)." */
  bit_rate?: number;
  /** Where the audio lands: base64 in the step content (default) or a URI. */
  delivery?: "inline" | "uri";
}

/** `service_tier` — the four values the Interactions reference enumerates. */
export type GoogleInteractionServiceTier = "flex" | "standard" | "priority" | "deferred";

/**
 * `generation_config`, music-window view: the two model-agnostic knobs the
 * reference documents that are not chat-only. The chat/agent members
 * (`thinking_level`, `tool_choice`, `speech_config`, `transcription_config`,
 * `video_config`, `stop_sequences`, `image_config`) are spelled `?: never` —
 * they configure capabilities Lyria does not have.
 */
export interface GoogleLyriaGenerationConfig {
  /** "Seed used in decoding for reproducibility." Undocumented on the music guide; passed through. */
  seed?: number;
  max_output_tokens?: number;
  thinking_level?: never;
  thinking_summaries?: never;
  tool_choice?: never;
  speech_config?: never;
  transcription_config?: never;
  video_config?: never;
  stop_sequences?: never;
  image_config?: never;
}

interface CreateMusicInteractionBase {
  /** The prompt — style, mood, structure — or text + up to 10 image blocks. */
  input: GoogleLyriaInput;
  /** SSE streaming (`?alt=sse` semantics ride on this flag at the API). */
  stream?: boolean;
  /** Whether to persist the interaction for later `GET /interactions/{id}`. */
  store?: boolean;
  /** Run asynchronously; poll the returned interaction id. */
  background?: boolean;
  service_tier?: GoogleInteractionServiceTier;
  labels?: Record<string, string>;
  generation_config?: GoogleLyriaGenerationConfig;
  /** "Music generation is a single-turn process. Iterative editing … is not supported." */
  previous_interaction_id?: never;
  /** Chat-model steering; the music guide documents prompt-only control. */
  system_instruction?: never;
  /** Lyria calls no tools. */
  tools?: never;
  /** Agent-interaction members; this is a model interaction. */
  agent?: never;
  environment?: never;
  /** Deprecated on the surface itself ("migrate away"); never valid here. */
  response_modalities?: never;
  response_mime_type?: never;
}

/** Pro: full songs, and the one arm with an output-format control. */
export interface LyriaProBody extends CreateMusicInteractionBase {
  model: "lyria-3-pro-preview";
  response_format?: GoogleLyriaAudioResponseFormat;
}

/** Clip: fixed 30-second MP3s. "This WAV format option is available for Lyria 3 Pro only." */
export interface LyriaClipBody extends CreateMusicInteractionBase {
  model: "lyria-3-clip-preview";
  response_format?: never;
}

/** Escape hatch for models unmodel doesn't know yet (unknown_model warning). */
export interface UnknownLyriaBody<Model extends string> extends CreateMusicInteractionBase {
  model: FutureModelId<Model, keyof CreateMusicBodyByModel>;
  response_format?: GoogleLyriaAudioResponseFormat;
}

/**
 * Closed over documented Lyria models by default. Supply a future model
 * literal to opt into the loose arm: `CreateMusicInteractionBody<"lyria-4">`.
 */
export type CreateMusicInteractionBody<FutureModel extends string = never> =
  | LyriaProBody
  | LyriaClipBody
  | UnknownLyriaBody<FutureModel>;

interface CreateMusicBodyByModel {
  "lyria-3-pro-preview": LyriaProBody;
  "lyria-3-clip-preview": LyriaClipBody;
}

/** Resolves a model id literal to its exact Tier-A arm. */
export type GoogleLyriaArm<M extends string> = M extends keyof CreateMusicBodyByModel
  ? CreateMusicBodyByModel[M]
  : UnknownLyriaBody<M>;

/** Runtime implementation type; the public alias stays closed by default. */
type AnyCreateMusicBody = CreateMusicInteractionBody<string>;
type LyriaModelInput = keyof CreateMusicBodyByModel | (string & {});

// ---------------------------------------------------------------------------
// SDK view — @google/genai's `ai.interactions.create()` takes the wire body
// verbatim (its `CreateModelInteraction` is snake_case, exactly this shape),
// so `.toSdk("google")` is the body plus the normalized model id — a
// pass-through, kept so google surfaces read alike. The SDK's params types are
// not exported from the package, hence no named annotation to cite.
// ---------------------------------------------------------------------------

export type CreateMusicSdkParams<T extends AnyCreateMusicBody = CreateMusicInteractionBody> = T;

export type MusicSdkTargets<T extends AnyCreateMusicBody = CreateMusicInteractionBody> = {
  google: () => CreateMusicSdkParams<T>;
};

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through; the pipeline warns on unknown
// top-level keys by introspecting the shape).
// ---------------------------------------------------------------------------

const schema = z.looseObject({
  model: z.string(),
  input: z.union([
    z.string().min(1, "input must not be empty"),
    z
      .array(z.looseObject({ type: z.string() }))
      .min(1, "input must carry at least one content block"),
  ]),
  stream: z.boolean().optional(),
  store: z.boolean().optional(),
  background: z.boolean().optional(),
  service_tier: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  generation_config: z
    .looseObject({
      seed: z.number().int().optional(),
      max_output_tokens: z.number().int().optional(),
    })
    .optional(),
  response_format: z.looseObject({ type: z.string() }).optional(),
  // Known to the shape so the refusal below is the precise single-turn quote
  // rather than a generic unknown_param.
  previous_interaction_id: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * `/v1beta/interactions` serves every Gemini model, but THIS window validates
 * music requests: a model that does not output audio belongs on `google.chat`,
 * and the realtime Lyria id has no batch surface at all.
 */
function checkMusicModel(
  params: AnyCreateMusicBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model;
  if (stripModelsPrefix(model) === LYRIA_REALTIME_MODEL_ID) {
    ctx.report({
      code: "unsupported_capability",
      path: ["model"],
      model,
      message:
        `"${model}" is realtime-only: it streams over the Live API WebSocket ` +
        `(@google/genai's \`ai.live.music.connect()\` / BidiGenerateMusic) and has no batch ` +
        `REST surface — POST /v1beta/interactions serves lyria-3-pro-preview and ` +
        `lyria-3-clip-preview.`,
      meta: { source: LYRIA_MUSIC_DOCS_URL },
    });
    return;
  }
  if (info === undefined || info.modalities.output.includes("audio")) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model"],
    model,
    message:
      `"${model}" does not generate audio (output modalities: ` +
      `${info.modalities.output.join(", ")}); google.music validates the music window of ` +
      `POST /v1beta/interactions.`,
    meta: { outputModalities: [...info.modalities.output], source: LYRIA_MUSIC_DOCS_URL },
  });
}

/**
 * Block-form input: text and image blocks only, at most 10 images, and a
 * missing text prompt is flagged (as a warning — the guide's phrasing "images
 * alongside your text prompt" implies text, but does not state a refusal).
 */
function checkInputBlocks(
  params: AnyCreateMusicBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const input = params.input;
  if (!Array.isArray(input)) return;
  let images = 0;
  let texts = 0;
  input.forEach((block, i) => {
    const type = (block as { type?: unknown }).type;
    if (type === "image") images += 1;
    else if (type === "text") texts += 1;
    else {
      ctx.report({
        code: "invalid_shape",
        path: ["input", i, "type"],
        model: params.model,
        message:
          `\`input[${i}].type\` ${JSON.stringify(type)} has no meaning on a music model: ` +
          `Lyria 3 takes "text" and "image" blocks (audio/video/document blocks are chat ` +
          `shapes on this route).`,
        meta: { allowed: ["text", "image"], value: type, source: LYRIA_MUSIC_DOCS_URL },
      });
    }
  });
  if (images > LYRIA_MAX_INPUT_IMAGES) {
    ctx.report({
      code: "invalid_shape",
      path: ["input"],
      model: params.model,
      message:
        `${images} image blocks exceed the documented maximum: "you can provide up to 10 ` +
        `images alongside your text prompt".`,
      meta: { count: images, limit: LYRIA_MAX_INPUT_IMAGES, source: LYRIA_MUSIC_DOCS_URL },
    });
  }
  if (images > 0 && texts === 0) {
    ctx.report({
      code: "invalid_shape",
      severity: "warning",
      path: ["input"],
      model: params.model,
      message:
        `\`input\` carries images but no text block; the guide describes images as arriving ` +
        `"alongside your text prompt", and an image-only request is undocumented.`,
      meta: { source: LYRIA_MUSIC_DOCS_URL },
    });
  }
}

/**
 * `response_format`: Pro-only, audio-only, MP3-or-WAV, and `bit_rate` is for
 * compressed formats. Also the single-turn refusal, which shares the check
 * because both are per-request wire facts with a documented quote behind them.
 */
function checkResponseFormat(
  params: AnyCreateMusicBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model;
  if ((params as { previous_interaction_id?: unknown }).previous_interaction_id != null) {
    ctx.report({
      code: "unsupported_param",
      path: ["previous_interaction_id"],
      model,
      message:
        `\`previous_interaction_id\` has no meaning on Lyria: "Music generation is a ` +
        `single-turn process. Iterative editing or refining a generated clip through ` +
        `multiple prompts is not supported."`,
      meta: { source: LYRIA_MUSIC_DOCS_URL },
    });
  }

  const format = (params as { response_format?: GoogleLyriaAudioResponseFormat }).response_format;
  if (format == null) return;

  if (stripModelsPrefix(model) === "lyria-3-clip-preview") {
    ctx.report({
      code: "unsupported_param",
      path: ["response_format"],
      model,
      message:
        `\`response_format\` is not supported by "${model}": Clip always emits 30-second ` +
        `MP3s — "This WAV format option is available for Lyria 3 Pro only."`,
      meta: { source: LYRIA_MUSIC_DOCS_URL },
    });
    return;
  }

  if (format.type !== "audio") {
    ctx.report({
      code: "invalid_enum_value",
      path: ["response_format", "type"],
      model,
      message:
        `\`response_format.type\` must be "audio" on a music model; got ` +
        `${JSON.stringify(format.type)}. The json_schema/text/image variants are chat and ` +
        `image shapes on this shared route.`,
      meta: { allowed: ["audio"], value: format.type, source: LYRIA_MUSIC_DOCS_URL },
    });
    return;
  }

  const mime = format.mime_type;
  if (mime !== undefined && mime !== "audio/mp3" && mime !== "audio/wav") {
    ctx.report({
      code: "invalid_enum_value",
      path: ["response_format", "mime_type"],
      model,
      message:
        `\`response_format.mime_type\` must be "audio/mp3" or "audio/wav" — the two output ` +
        `formats the music-generation guide documents for Lyria 3; got ${JSON.stringify(mime)}.`,
      meta: { allowed: ["audio/mp3", "audio/wav"], value: mime, source: LYRIA_MUSIC_DOCS_URL },
    });
  }
  if (format.bit_rate != null && mime === "audio/wav") {
    ctx.report({
      code: "unsupported_param",
      path: ["response_format", "bit_rate"],
      model,
      message:
        `\`response_format.bit_rate\` does not apply to WAV: "Bit rate in bits per second ` +
        `(bps). Only applicable for compressed formats (MP3, Opus)."`,
      meta: { source: INTERACTIONS_API_DOCS_URL },
    });
  }
}

// ---------------------------------------------------------------------------
// Estimation — Lyria bills a flat per-song rate ("$0.04 per song" Clip,
// "$0.08 per song" Pro; paid tier only), independent of duration and tokens.
// Source: https://ai.google.dev/gemini-api/docs/pricing
// ---------------------------------------------------------------------------

function estimate(
  params: AnyCreateMusicBody,
  _info: ModelInfo | undefined,
  _ctx: PipelineContext,
) {
  const rate =
    LYRIA_PRICE_PER_SONG_USD[stripModelsPrefix(params.model) as GoogleLyriaModelId];
  return rate === undefined ? {} : { costUSD: rate };
}

// ---------------------------------------------------------------------------
// Finalize: wire body (model KEPT — on this route it rides the body, not the
// URL) + .toSdk(target) + .request
// ---------------------------------------------------------------------------

function finalize(params: AnyCreateMusicBody): unknown {
  // Normalized to the bare id: both docs and SDK spell the interactions
  // `model` field without the `models/` prefix (the catalog-canonical form).
  const body = { ...params, model: stripModelsPrefix(params.model) };
  const request: RequestMeta = {
    url: CREATE_INTERACTION_URL,
    method: "POST",
    headers: JSON_HEADERS,
  };
  return toValidated(body, request, { sdk: { google: () => ({ ...body }) } });
}

const validator = createValidator<AnyCreateMusicBody, unknown>({
  endpoint: "google.music",
  schema,
  modelId: (params) => stripModelsPrefix(params.model),
  catalog: musicModels,
  checks: [checkMusicModel, checkInputBlocks, checkResponseFormat],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Lyria 3 music generation —
 * `POST /v1beta/interactions`.
 *
 * The returned object's enumerable props are the exact fetch JSON body —
 * `model` is KEPT (normalized to the bare id), because the Interactions API
 * addresses the model through the body; `.request.url` is the constant
 * interactions route. `.toSdk("google")` hands the same body to
 * `@google/genai`'s `ai.interactions.create()`. Auth is your job: add an
 * `x-goog-api-key` header (or `?key=`) when fetching.
 *
 * ```ts
 * const params = google.music({
 *   model: "lyria-3-pro-preview",
 *   input: "An upbeat synthwave track with a driving bassline",
 *   response_format: { type: "audio", mime_type: "audio/wav" },
 * });
 * const interaction = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, "x-goog-api-key": process.env.GEMINI_API_KEY! },
 *   body: JSON.stringify(params),
 * }).then((r) => r.json());
 * // The model_output step's content holds { type: "audio", data: <base64> }
 * // plus the generated lyrics/structure as text.
 * ```
 */
export const music = validator as unknown as {
  <M extends LyriaModelInput, T extends GoogleLyriaArm<M>>(
    params: T & GoogleLyriaArm<M> & { model: M } & ExactKeys<T, GoogleLyriaArm<M>>,
    options?: ValidateOptions<T>,
  ): Validated<T, MusicSdkTargets<T>>;
  safe<M extends LyriaModelInput, T extends GoogleLyriaArm<M>>(
    params: T & GoogleLyriaArm<M> & { model: M } & ExactKeys<T, GoogleLyriaArm<M>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, MusicSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

export type { GoogleLyriaModelId };
