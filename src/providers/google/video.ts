/**
 * Google Veo video generation — the Gemini API long-running route
 * POST https://generativelanguage.googleapis.com/v1beta/models/{model}:predictLongRunning
 *
 * Wire notes (verified against https://ai.google.dev/gemini-api/docs/veo and
 * @google/genai@2.17.0's Gemini-API ("mldev") request converters on
 * 2026-08-13):
 * - Body is `{ instances: [{ prompt, image?, lastFrame?, referenceImages?,
 *   video? }], parameters: {...}, webhookConfig? }` — exactly ONE instance;
 *   `parameters.sampleCount` controls how many videos come back.
 * - Image shape: the docs page's REST example serializes images as
 *   `{ inlineData: { mimeType, data } }` while @google/genai's mldev
 *   converter emits `{ bytesBase64Encoded, mimeType }` — both are observed
 *   in first-party sources, so BOTH shapes are accepted here (gcsUri stays
 *   out: Vertex-only).
 * - The extension `video` rides as `{ uri?, encodedVideo?, encoding? }` on
 *   this API (Vertex uses gcsUri/bytesBase64Encoded/mimeType instead).
 * - Vertex-only knobs have NO Gemini-API wire form at all — @google/genai
 *   throws client-side on outputGcsUri, fps, pubsubTopic, generateAudio,
 *   mask, compressionQuality, labels and resizeMode — so this module's wire
 *   types deliberately omit them (Veo 3.x audio is always on; Veo 2 is always
 *   silent). `seed` is the one exception: the SDK throws on it too, but the
 *   Veo docs state "the seed parameter is also available for Veo 3 models",
 *   and the docs win — so it is accepted on the wire and, like generateContent's
 *   `store`, deliberately left out of `.toSdk("google")` (passing it to @google/genai
 *   would throw; use `.request` + fetch).
 * - The response is a long-running Operation ({ name, done, ... }); POLLING IS
 *   OUT OF SCOPE for unmodel — poll GET /v1beta/{operation.name} (SDK:
 *   `ai.operations.getVideosOperation({ operation })`) yourself.
 * - Auth is your job: add an `x-goog-api-key` header (or `?key=`) when
 *   fetching.
 *
 * Constraints encoded per model (see videoConstraints in
 * ./constraints): resolution/durationSeconds/personGeneration/sampleCount/
 * aspectRatio allow-lists, Veo-2 resolution deny, and the documented pairing
 * rules (1080p/4k need 8s; extension caps at 720p; image-driven modes forbid
 * personGeneration "allow_all"; lastFrame needs image; referenceImages need a
 * prompt). Docs-ambiguous quirks stay out of code: the feature table's "1080p
 * is 16:9-only on Veo 3" note conflicts with its parameters table, and
 * whether Veo 3.1 Lite takes referenceImages is stated both ways on the same
 * page — the ambiguous Lite case is treated PERMISSIVELY (no error), and the
 * 1080p/16:9 note is not enforced.
 *
 * `gemini-omni-flash-preview` is the one catalogued video-output model that is
 * not a Veo id, so it carries its own entry (3-10s, 720p, 16:9 / 9:16 — see
 * GEMINI_OMNI_FLASH_DOCS_URL). Its native surface is the Interactions API, not
 * predictLongRunning, so only the `parameters` bounds map across; the
 * instance/pairing rules below stay `veo-`-gated. Any OTHER catalogued
 * video-output model with no constraints at all gets an explicit
 * `unsupported_capability` warning rather than validating anything.
 */

import { z } from "zod";
import { constraintsFor, createValidator, type PipelineContext } from "../../core/pipeline";
import {
  JSON_HEADERS,
  toValidated,
  type ExactKeys,
  type RequestMeta,
  type Validated,
} from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import type { GoogleVideoModelId } from "../../catalog/google.gen";
// `./model-path`, not `./chat` — see the note in ./image.ts: the
// shared id normalization is a leaf, so this entry pays for Veo and nothing
// else.
import { GOOGLE_MODELS_BASE_URL, googleModelUrl, stripModelsPrefix } from "./model-path";
import {
  videoConstraints,
  videoDocsUrl,
  videoFamilyRules,
  VEO_DOCS_URL,
} from "./constraints";
import { videoModels, type GoogleVeoSupplementModelId } from "./veo-models";

export const GENERATE_VIDEOS_BASE_URL = GOOGLE_MODELS_BASE_URL;

// ---------------------------------------------------------------------------
// Wire types — mirror the raw REST body of models.{model}:predictLongRunning
// exactly (camelCase JSON). Reference: https://ai.google.dev/gemini-api/docs/veo
// and @google/genai@2.17.0's mldev converters. NOTE: this differs from the
// @google/genai SDK shape — the SDK takes { model, prompt, image, video,
// config } and re-nests everything itself; `.toSdk("google")` performs that
// re-shaping.
// ---------------------------------------------------------------------------

/**
 * An image input (first frame, last frame, or reference). Two first-party
 * wire spellings exist — the docs' REST example uses
 * `{ inlineData: { mimeType, data } }` while the @google/genai converter
 * emits `{ bytesBase64Encoded, mimeType }` — so both are accepted. `gcsUri`
 * is Vertex AI-only and has no wire form here.
 */
export type GoogleVeoImage =
  | {
      /** Base64-encoded image bytes (SDK-converter spelling). */
      bytesBase64Encoded: string;
      /** IANA MIME type, e.g. "image/png", "image/jpeg". */
      mimeType?: string;
      inlineData?: never;
    }
  | {
      /** Docs-REST-example spelling. */
      inlineData: { data: string; mimeType?: string };
      bytesBase64Encoded?: never;
      mimeType?: never;
    };

/** Base64 payload of either accepted image spelling. */
export function veoImageData(image: GoogleVeoImage): string {
  return image.bytesBase64Encoded !== undefined ? image.bytesBase64Encoded : image.inlineData.data;
}

/**
 * The input video for extension (Veo 3.1 / 3.1 Fast). On this API the wire
 * fields are `uri` / `encodedVideo` / `encoding` — typically you pass the
 * `video.uri` returned by a previous generation.
 */
export interface GoogleVeoVideo {
  /** URI of a previously generated video (2-day server-side retention). */
  uri?: string;
  /** Base64-encoded video bytes. */
  encodedVideo?: string;
  /** Video MIME type, e.g. "video/mp4". */
  encoding?: string;
}

/**
 * A style/asset reference image (Veo 3.1 / 3.1 Fast, up to 3). The REST docs
 * write `referenceType` lowercase ("asset"); @google/genai's enum uses
 * uppercase ("ASSET") and passes it through verbatim — both are accepted here.
 */
export interface GoogleVeoReferenceImage {
  image: GoogleVeoImage;
  referenceType: "asset" | "style" | "ASSET" | "STYLE";
}

/**
 * One generation request. At least one of prompt / image / video must be set
 * (prompt is optional only when an image or video drives the generation).
 */
export interface GoogleVeoInstance {
  /** Text prompt; Veo 3.x prompts may include audio cues. */
  prompt?: string;
  /** First frame for image-to-video. */
  image?: GoogleVeoImage;
  /** Final frame for interpolation; requires `image` as well. */
  lastFrame?: GoogleVeoImage;
  /** Up to 3 asset/style references; requires `prompt` as well. */
  referenceImages?: GoogleVeoReferenceImage[];
  /** Video to extend (Veo 3.1 / 3.1 Fast only). */
  video?: GoogleVeoVideo;
}

export interface GoogleVeoParameters {
  /** "16:9" (default) or "9:16". */
  aspectRatio?: "16:9" | "9:16";
  /** What should NOT appear in the video. */
  negativePrompt?: string;
  /**
   * People policy. Veo 3.x: "allow_all" (text-to-video/extension) or
   * "allow_adult" (image-driven modes; forced in EU/UK/CH/MENA). Veo 2 also
   * accepts "dont_allow".
   */
  personGeneration?: "allow_all" | "allow_adult" | "dont_allow";
  /** Clip length in seconds. Veo 3.x: 4, 6, or 8 (default 8); Veo 2: 5-8. */
  durationSeconds?: number;
  /** "720p" (default), "1080p", or "4k" — model-dependent; not on Veo 2. */
  resolution?: "720p" | "1080p" | "4k";
  /** Videos per request: 1 on Veo 3.x, 1-2 on Veo 2. SDK: numberOfVideos. */
  sampleCount?: number;
  /** Prompt-rewriting opt-in/out where the model supports toggling it. */
  enhancePrompt?: boolean;
  /**
   * "Note that the seed parameter is also available for Veo 3 models. It
   * doesn't guarantee determinism, but slightly improves it." Wire-only:
   * @google/genai@2.17.0's mldev converter throws on `config.seed`, so
   * `.toSdk("google")` drops it — fetch `.request` directly to use it.
   */
  seed?: number;
}

/**
 * Raw wire body for predictLongRunning plus `model`. On the wire the model id
 * lives ONLY in the URL path — the validated output strips `model` from the
 * enumerable body and interpolates it into `.request.url` instead.
 *
 * This is the WIDE form — every documented value of every model. A call whose
 * `model` is a literal gets {@link VeoBodyArm} instead, which narrows
 * `parameters` to that model's own row; this alias is what a run-time model id
 * falls back to, and what the checks below are written against.
 */
export interface GenerateVideosBody {
  model: GoogleVideoModelId | GoogleVeoSupplementModelId | (string & {});
  /** Exactly one instance; use parameters.sampleCount for multiple videos. */
  instances: GoogleVeoInstance[];
  parameters?: GoogleVeoParameters;
  /** Completion-webhook config (SDK: config.webhookConfig). */
  webhookConfig?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Per-model `parameters` value space.
//
// One table, read twice: the types below narrow `parameters` per model from
// it, and ./unified-video builds `GOOGLE_VIDEO_MODEL_PARAMS` — the rows that
// type the canonical `duration` / `resolution` / `aspectRatio` — out of the
// same rows. Before this existed the two disagreed: `unmodel/video` refused
// `resolution: "1080p"` on Veo 2 at compile time while THIS surface, the one
// it compiles down to, accepted `resolution: "4k"` there. A wire-exact
// validator that is looser than the unified layer above it inverts
// docs/decisions.md #1, so the narrowing lives here and the unified row is
// derived, never the other way round.
//
// WHERE THE VALUES COME FROM. Every list below is the one ./constraints
// already transcribes for the RUNTIME check — `videoConstraints` (per model)
// and `videoFamilyRules` (the `veo-`-prefixed families) — from the "Veo API
// parameters and specifications" table on VEO_DOCS_URL and, for the one
// non-Veo id, GEMINI_OMNI_FLASH_DOCS_URL. Two of them are deliberately
// PERMISSIVE readings of pages that disagree with themselves, and stay that
// way here so the type cannot refuse a request the check would allow:
// Veo 2's `durationSeconds` (parameters table says 5/6/8, feature table says
// "5-8") and Veo 3's `4k` (the feature-comparison table omits it).
//
// WHERE THE DOCS ARE THE WEAKER SOURCE, said plainly rather than papered over:
//
// - `personGeneration` on `gemini-omni-flash-preview`. Google publishes no
//   list for it — the Veo enum rules are `veo-`-prefix-gated and its own pages
//   are silent — so the row carries no `personGeneration` at all and the field
//   keeps the wide documented union. Narrowing it would be inventing an
//   allowed-value space; widening it to `string` (which is what the unified
//   row says, and correctly, because that row can only speak about what the
//   *table* proves) would advertise values no page names.
// - `sampleCount` is NOT narrowed. `videoConstraints` does bound it (1 on
//   Veo 3.x, 1-2 on Veo 2), but the unified table has no row field for it, so
//   there is nothing here to keep the two in step; the runtime enum owns it
//   alone, and `test/types/google.test-d.ts` pins that as a deliberate gap.
// - Pairing rules stay runtime-only, unchanged: 1080p/4k needing 8s, and
//   `allow_all` being refused on an image-driven request, are rules about TWO
//   fields, which a per-field union cannot state (see `checkParameterPairings`
//   and the same note in ./unified-video).
// ---------------------------------------------------------------------------

/**
 * One model's `parameters` value space.
 *
 * An EMPTY list is a positive statement — "this model has no such parameter" —
 * and types the field `never` (Veo 2 takes no `resolution` at all, which
 * `videoConstraints` states as a deny). An ABSENT `personGeneration` is the
 * other statement: no published list, so the field keeps its wide union.
 */
export interface VeoParameterSpace {
  readonly durations: readonly number[];
  readonly resolutions: readonly NonNullable<GoogleVeoParameters["resolution"]>[];
  readonly ratios: readonly NonNullable<GoogleVeoParameters["aspectRatio"]>[];
  readonly personGeneration?: readonly NonNullable<GoogleVeoParameters["personGeneration"]>[];
}

/** Veo 3 and Veo 3.1, standard and fast — one row, four ids. */
const VEO_3_SPACE = {
  durations: [4, 6, 8],
  resolutions: ["720p", "1080p", "4k"],
  ratios: ["16:9", "9:16"],
  personGeneration: ["allow_all", "allow_adult"],
} as const satisfies VeoParameterSpace;

/** The rows. Every id `videoConstraints` / `videoFamilyRules` bound, and no other. */
export const VEO_PARAMETER_SPACE = {
  "veo-3.1-generate-preview": VEO_3_SPACE,
  "veo-3.1-fast-generate-preview": VEO_3_SPACE,
  /** Lite stops at 1080p — "Veo 3.1 Lite" column of the parameters table. */
  "veo-3.1-lite-generate-preview": {
    durations: [4, 6, 8],
    resolutions: ["720p", "1080p"],
    ratios: ["16:9", "9:16"],
    personGeneration: ["allow_all", "allow_adult"],
  },
  "veo-3.0-generate-001": VEO_3_SPACE,
  "veo-3.0-fast-generate-001": VEO_3_SPACE,
  /** No `resolution` parameter at all (output is 720p); the only family with `dont_allow`. */
  "veo-2.0-generate-001": {
    durations: [5, 6, 7, 8],
    resolutions: [],
    ratios: ["16:9", "9:16"],
    personGeneration: ["allow_all", "allow_adult", "dont_allow"],
  },
  /** "Output video: 3s-10s (720p, 24 FPS)"; 16:9 default, 9:16 portrait. */
  "gemini-omni-flash-preview": {
    durations: [3, 4, 5, 6, 7, 8, 9, 10],
    resolutions: ["720p"],
    ratios: ["16:9", "9:16"],
  },
} as const satisfies Readonly<Record<string, VeoParameterSpace>>;

/** A model id {@link VEO_PARAMETER_SPACE} carries a row for. */
export type VeoParameterModelId = keyof typeof VEO_PARAMETER_SPACE;

type VeoSpaceOf<M extends VeoParameterModelId> = (typeof VEO_PARAMETER_SPACE)[M];

/**
 * `parameters` as ONE model accepts them.
 *
 * The four narrowed keys are removed from the wide shape and restated rather
 * than intersected with it: intersecting a wide union with a narrow one is how
 * the `& {}` tails elsewhere in this repo get discharged, and the completion
 * list dies while tsc stays green (see the `SizingArms` note in
 * `src/core/unified/vocabulary/model-params.ts`).
 */
export type VeoParametersArm<M extends VeoParameterModelId> = Omit<
  GoogleVeoParameters,
  "aspectRatio" | "durationSeconds" | "personGeneration" | "resolution"
> & {
  /** "Every Veo model generates 16:9 or 9:16" — and so does Omni. */
  aspectRatio?: VeoSpaceOf<M>["ratios"][number];
  /** This model's own closed clip lengths. */
  durationSeconds?: VeoSpaceOf<M>["durations"][number];
  /** This model's own tiers; `never` where the model has no `resolution` field. */
  resolution?: VeoSpaceOf<M>["resolutions"][number];
  /** The model's published list, or the wide documented union where it has none. */
  personGeneration?: VeoSpaceOf<M> extends { personGeneration: readonly (infer P)[] }
    ? P
    : GoogleVeoParameters["personGeneration"];
};

/**
 * Resolves a model id literal to its exact Tier-A body — the same
 * `ImagesArm<M>` shape ./image and openai/image use. A non-literal id (or one
 * with no row) keeps the wide {@link GenerateVideosBody}, which is the
 * degraded arm a run-time-discovered model deserves: no per-model table means
 * no per-model narrowing, exactly as `unknown_model` says at run time.
 */
export type VeoBodyArm<M extends string> = M extends VeoParameterModelId
  ? Omit<GenerateVideosBody, "model" | "parameters"> & {
      model: M;
      parameters?: VeoParametersArm<M>;
    }
  : GenerateVideosBody;

type VideoModelInput = VeoParameterModelId | GenerateVideosBody["model"];

// ---------------------------------------------------------------------------
// SDK view — @google/genai's ai.models.generateVideos({ model, prompt, image,
// video, config }): instances[0] fields become top-level prompt/image/video
// (image bytes rename bytesBase64Encoded → imageBytes; video renames
// uri/encodedVideo/encoding → uri/videoBytes/mimeType), lastFrame and
// referenceImages move under config, and parameters.* becomes config.* with
// sampleCount renamed numberOfVideos. Caveat: the SDK declares a TS enum for
// referenceType (VideoGenerationReferenceType), so toSdk("google") output carrying
// referenceImages needs a cast at the SDK call site — same pattern as the
// generateContent safety enums.
// ---------------------------------------------------------------------------

export interface GenerateVideosSdkImage {
  imageBytes?: string;
  mimeType?: string;
}

export interface GenerateVideosSdkVideo {
  uri?: string;
  videoBytes?: string;
  mimeType?: string;
}

export interface GenerateVideosSdkReferenceImage {
  image?: GenerateVideosSdkImage;
  referenceType?: "asset" | "style" | "ASSET" | "STYLE";
}

interface GenerateVideosSdkConfigBase {
  numberOfVideos?: number;
  durationSeconds?: number;
  aspectRatio?: string;
  resolution?: string;
  personGeneration?: string;
  negativePrompt?: string;
  enhancePrompt?: boolean;
  lastFrame?: GenerateVideosSdkImage;
  webhookConfig?: Record<string, unknown>;
}

/**
 * `referenceImages` only appears in the config type when the caller's
 * instance actually carried them — its wire referenceType literal is the one
 * leaf nominally incompatible with the SDK's TS enum, so keeping it out of
 * reference-free requests lets those assign to GenerateVideosParameters
 * without a cast.
 */
export type GenerateVideosSdkConfig<T extends GenerateVideosBody = GenerateVideosBody> =
  GenerateVideosSdkConfigBase &
    (T["instances"][number] extends { referenceImages: readonly GoogleVeoReferenceImage[] }
      ? { referenceImages: GenerateVideosSdkReferenceImage[] }
      : {});

export type GenerateVideosSdkParams<T extends GenerateVideosBody = GenerateVideosBody> = {
  model: T["model"];
  prompt?: string;
  image?: GenerateVideosSdkImage;
  video?: GenerateVideosSdkVideo;
  config?: GenerateVideosSdkConfig<T>;
};

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through; the pipeline warns on unknown
// top-level keys by introspecting the shape).
// ---------------------------------------------------------------------------

const veoImageSchema = z.union([
  z.looseObject({
    bytesBase64Encoded: z.string(),
    mimeType: z.string().optional(),
  }),
  z.looseObject({
    inlineData: z.looseObject({ data: z.string(), mimeType: z.string().optional() }),
  }),
]);

const veoVideoSchema = z.looseObject({
  uri: z.string().optional(),
  encodedVideo: z.string().optional(),
  encoding: z.string().optional(),
});

const veoInstanceSchema = z.looseObject({
  prompt: z.string().optional(),
  image: veoImageSchema.optional(),
  lastFrame: veoImageSchema.optional(),
  referenceImages: z
    .array(z.looseObject({ image: veoImageSchema, referenceType: z.string() }))
    .max(3, "at most 3 referenceImages are allowed per request")
    .optional(),
  video: veoVideoSchema.optional(),
});

const veoParametersSchema = z.looseObject({
  aspectRatio: z.string().optional(),
  negativePrompt: z.string().optional(),
  personGeneration: z.string().optional(),
  durationSeconds: z.number().int().positive().optional(),
  resolution: z.string().optional(),
  sampleCount: z.number().int().min(1).optional(),
  enhancePrompt: z.boolean().optional(),
  seed: z.number().int().optional(),
});

const schema = z.looseObject({
  model: z.string(),
  instances: z
    .array(veoInstanceSchema)
    .min(1, "instances must contain exactly one instance")
    .max(1, "Veo takes exactly one instance per request; use parameters.sampleCount for multiple videos"),
  parameters: veoParametersSchema.optional(),
  webhookConfig: z.looseObject({}).optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const VIDEO_RULES = {
  constraints: videoConstraints,
  familyRules: videoFamilyRules,
} as const;

/**
 * Applies the deny/enum constraint tables to the nested `parameters` object.
 * The pipeline's generic Layer-3 pass only sees top-level keys, which for
 * this body are model/instances/parameters/webhookConfig — so the tables are
 * re-applied here at their real depth.
 */
function checkVeoParameters(
  params: GenerateVideosBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  const record = (params.parameters ?? {}) as Record<string, unknown>;
  const model = params.model;
  const source = videoDocsUrl(stripModelsPrefix(model));
  for (const constraints of constraintsFor(VIDEO_RULES, stripModelsPrefix(model))) {
    for (const [param, rule] of Object.entries(constraints.deny ?? {})) {
      if (record[param] != null) {
        ctx.report({
          code: "unsupported_param",
          path: ["parameters", param],
          model,
          message: `\`parameters.${param}\` is not supported by "${model}": ${rule.reason}`,
          meta: { source: rule.source },
        });
      }
    }
    for (const [param, allowed] of Object.entries(constraints.enums ?? {})) {
      const value = record[param];
      if (value != null && !allowed.includes(value as string | number)) {
        ctx.report({
          code: "invalid_enum_value",
          path: ["parameters", param],
          model,
          message: `\`parameters.${param}\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")} for "${model}"; got ${JSON.stringify(value)}.`,
          meta: { allowed: [...allowed], value, source },
        });
      }
    }
  }
}

/**
 * Fails visibly when a catalogued video-output model has NO applicable
 * constraint entry at all. The deny/enum tables are per-model plus two
 * `veo-`-prefixed family rules, so a video model outside that prefix without
 * its own entry silently accepts any durationSeconds/aspectRatio/resolution/
 * sampleCount — which is exactly how `gemini-omni-flash-preview` slipped
 * through. A warning (not an error) keeps requests the API fulfils passing
 * while making the unchecked surface visible.
 */
function checkParameterBoundsCoverage(
  params: GenerateVideosBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined || !info.modalities.output.includes("video")) return;
  if (params.parameters === undefined) return;
  const id = stripModelsPrefix(params.model);
  if (constraintsFor(VIDEO_RULES, id).length > 0) return;
  ctx.report({
    code: "unsupported_capability",
    severity: "warning",
    path: ["parameters"],
    model: params.model,
    message: `no documented \`parameters\` bounds are encoded for "${params.model}", so durationSeconds/aspectRatio/resolution/sampleCount are unchecked on this request.`,
    meta: { source: VEO_DOCS_URL },
  });
}

/** predictLongRunning serves video-output (Veo) models only. */
function checkVideoModality(
  params: GenerateVideosBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined || info.modalities.output.includes("video")) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model"],
    model: params.model,
    message: `"${params.model}" does not generate video (output modalities: ${info.modalities.output.join(", ")}); models.{model}:predictLongRunning serves Veo video models.`,
    meta: { outputModalities: [...info.modalities.output], source: VEO_DOCS_URL },
  });
}

/** Instance features only some Veo generations support (docs feature table). */
const REFERENCE_IMAGES_MODELS = new Set<string>([
  "veo-3.1-generate-preview",
  "veo-3.1-fast-generate-preview",
  // The docs state Lite's referenceImages support both ways on one page;
  // treated permissively per the header policy (no error on Lite).
  "veo-3.1-lite-generate-preview",
]);
const VIDEO_EXTENSION_MODELS = new Set<string>([
  "veo-3.1-generate-preview",
  "veo-3.1-fast-generate-preview",
]);

function checkInstanceFeatures(
  params: GenerateVideosBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  const model = params.model;
  const id = stripModelsPrefix(model);
  if (!id.startsWith("veo-")) return;
  const instance = params.instances?.[0];
  if (instance === undefined) return;

  if (instance.referenceImages !== undefined && instance.referenceImages.length > 0 && !REFERENCE_IMAGES_MODELS.has(id)) {
    ctx.report({
      code: "unsupported_capability",
      path: ["instances", 0, "referenceImages"],
      model,
      message: `"${model}" does not support reference images; the Veo docs list them for Veo 3.1 and Veo 3.1 Fast only.`,
      meta: { source: VEO_DOCS_URL },
    });
  }
  if (instance.video !== undefined && !VIDEO_EXTENSION_MODELS.has(id)) {
    ctx.report({
      code: "unsupported_capability",
      path: ["instances", 0, "video"],
      model,
      message: `"${model}" does not support video extension; the Veo docs list it for Veo 3.1 and Veo 3.1 Fast only.`,
      meta: { source: VEO_DOCS_URL },
    });
  }
}

/**
 * Model-independent pairing rules from the Veo docs:
 * - each instance needs at least one of prompt / image / video;
 * - lastFrame "must be used in combination with the `image` parameter";
 * - referenceImages require a text prompt.
 */
function checkInstancePairings(
  params: GenerateVideosBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  params.instances?.forEach((instance, i) => {
    if (instance.prompt === undefined && instance.image === undefined && instance.video === undefined) {
      ctx.report({
        code: "invalid_shape",
        path: ["instances", i],
        model: params.model,
        message: "each instance needs at least one of `prompt`, `image`, or `video`.",
        meta: { source: VEO_DOCS_URL },
      });
    }
    if (instance.lastFrame !== undefined && instance.image === undefined) {
      ctx.report({
        code: "invalid_shape",
        path: ["instances", i, "lastFrame"],
        model: params.model,
        message: "`lastFrame` must be used in combination with `image` (interpolation needs both frames).",
        meta: { source: VEO_DOCS_URL },
      });
    }
    if (instance.referenceImages !== undefined && instance.referenceImages.length > 0 && instance.prompt === undefined) {
      ctx.report({
        code: "invalid_shape",
        path: ["instances", i, "referenceImages"],
        model: params.model,
        message: "`referenceImages` require a text `prompt` as well.",
        meta: { source: VEO_DOCS_URL },
      });
    }
  });
}

/**
 * Documented per-model input caps that are not `parameters` enums:
 * - Veo 2's "Image input: Any image resolution and aspect ratio up to 20MB
 *   file size" (constraints table `media.image.maxBytes`). The cap is on the
 *   uploaded file, and the JSON body carries base64, so the encoded length is
 *   the measure that can actually be over.
 * - Veo 3.x's "Text input: 1,024 tokens" (catalog `limit.input`; models.dev
 *   carries a stale 480, so ./veo-models restates the documented value).
 */
function checkInstanceLimits(
  params: GenerateVideosBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  const model = params.model;
  const id = stripModelsPrefix(model);

  let imageMaxBytes: number | undefined;
  for (const constraints of constraintsFor(VIDEO_RULES, id)) {
    if (imageMaxBytes === undefined) imageMaxBytes = constraints.media?.image?.maxBytes;
  }

  params.instances?.forEach((instance, i) => {
    if (imageMaxBytes !== undefined) {
      for (const key of ["image", "lastFrame"] as const) {
        const image = instance?.[key];
        if (image === undefined) continue;
        const encoded = veoImageData(image).length;
        if (encoded <= imageMaxBytes) continue;
        ctx.report({
          code: "media_too_large",
          path: ["instances", i, key],
          model,
          message: `input image is ${encoded} bytes encoded; "${model}" caps input images at ${imageMaxBytes} bytes.`,
          meta: { bytes: encoded, limit: imageMaxBytes, source: VEO_DOCS_URL },
        });
      }
    }

    const promptLimit = info.limit.input;
    const prompt = instance?.prompt;
    if (promptLimit === undefined || promptLimit <= 0 || typeof prompt !== "string") return;
    const tokens = ctx.tokenizer.count(prompt);
    if (tokens <= promptLimit) return;
    ctx.report({
      code: "over_context",
      path: ["instances", i, "prompt"],
      model,
      message: `~${tokens} estimated prompt tokens exceed the ${promptLimit}-token text input limit of "${model}"; the estimate is heuristic.`,
      meta: { estimated: tokens, limit: promptLimit, source: VEO_DOCS_URL },
    });
  });
}

/**
 * Mode-dependent Veo 3.x rules the enum tables cannot express:
 * - 1080p and 4k output require durationSeconds 8 (as do extension and
 *   reference images);
 * - video extension outputs 720p only;
 * - image-driven modes (image / lastFrame / referenceImages) only accept
 *   personGeneration "allow_adult" — never "allow_all" (Veo 2 likewise limits
 *   image-to-video to allow_adult/dont_allow).
 */
function checkParameterPairings(
  params: GenerateVideosBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  const model = params.model;
  const id = stripModelsPrefix(model);
  if (!id.startsWith("veo-")) return;
  const instance = params.instances?.[0];
  const parameters = params.parameters;

  const imageDriven =
    instance !== undefined &&
    (instance.image !== undefined ||
      instance.lastFrame !== undefined ||
      (instance.referenceImages !== undefined && instance.referenceImages.length > 0));
  if (imageDriven && parameters?.personGeneration === "allow_all") {
    ctx.report({
      code: "invalid_enum_value",
      path: ["parameters", "personGeneration"],
      model,
      message: `\`parameters.personGeneration\` cannot be "allow_all" when the generation is image-driven; use "allow_adult".`,
      meta: { value: "allow_all", allowed: ["allow_adult"], source: VEO_DOCS_URL },
    });
  }

  if (!id.startsWith("veo-3")) return;
  const duration = parameters?.durationSeconds;
  const resolution = parameters?.resolution;
  if (duration !== undefined && duration !== 8) {
    const needsEight: string[] = [];
    if (resolution === "1080p" || resolution === "4k") needsEight.push(`${resolution} resolution`);
    if (instance?.video !== undefined) needsEight.push("video extension");
    if (instance?.referenceImages !== undefined && instance.referenceImages.length > 0) {
      needsEight.push("reference images");
    }
    if (needsEight.length > 0) {
      ctx.report({
        code: "invalid_enum_value",
        path: ["parameters", "durationSeconds"],
        model,
        message: `\`parameters.durationSeconds\` must be 8 when using ${needsEight.join(", ")}; got ${duration}.`,
        meta: { value: duration, allowed: [8], source: VEO_DOCS_URL },
      });
    }
  }
  if (instance?.video !== undefined && resolution !== undefined && resolution !== "720p") {
    ctx.report({
      code: "invalid_enum_value",
      path: ["parameters", "resolution"],
      model,
      message: `\`parameters.resolution\` must be "720p" when extending a video; got ${JSON.stringify(resolution)}.`,
      meta: { value: resolution, allowed: ["720p"], source: VEO_DOCS_URL },
    });
  }
}

// ---------------------------------------------------------------------------
// Estimation — Veo bills per second of generated video; some rates vary by
// resolution. The catalog carries the flat/720p rate (cost.perVideoSecond);
// non-720p rates live here. Worst case: default duration 8s, all sampleCount
// videos generated. Source: https://ai.google.dev/gemini-api/docs/pricing
// (verified 2026-08-13).
// ---------------------------------------------------------------------------

/** Default clip length when durationSeconds is omitted (worst case). */
const VEO_DEFAULT_DURATION_SECONDS = 8;

/**
 * USD per second at non-720p resolutions where the rate differs from the
 * catalog's 720p rate. Veo 3.1: $0.60 at 4k. Fast: $0.12 at 1080p, $0.30 at
 * 4k. Lite: $0.08 at 1080p. Veo 3 Fast (deprecated) matches 3.1 Fast; Veo 3
 * standard and Veo 2 are flat-rate.
 */
export const VEO_RESOLUTION_RATE_OVERRIDES: Readonly<
  Partial<Record<string, Partial<Record<string, number>>>>
> = {
  "veo-3.1-generate-preview": { "4k": 0.6 },
  "veo-3.1-fast-generate-preview": { "1080p": 0.12, "4k": 0.3 },
  "veo-3.1-lite-generate-preview": { "1080p": 0.08 },
  "veo-3.0-fast-generate-001": { "1080p": 0.12, "4k": 0.3 },
};

function estimate(params: GenerateVideosBody, info: ModelInfo | undefined, _ctx: PipelineContext) {
  const id = stripModelsPrefix(params.model);
  const resolution = params.parameters?.resolution ?? "720p";
  const rate = VEO_RESOLUTION_RATE_OVERRIDES[id]?.[resolution] ?? info?.cost?.perVideoSecond;
  if (rate === undefined) return {};
  const seconds = params.parameters?.durationSeconds ?? VEO_DEFAULT_DURATION_SECONDS;
  const count = params.parameters?.sampleCount ?? 1;
  // No inputTokens: Veo is not a token-context model, so the pipeline's
  // context-window checks stay out of the way.
  return { costUSD: rate * seconds * count };
}

// ---------------------------------------------------------------------------
// Finalize: wire body (model stripped — it lives in the URL) + .toSdk(target) + .request
// ---------------------------------------------------------------------------

/**
 * Endpoint URL for a model id. Accepts both the bare id
 * ("veo-3.1-generate-preview") and the REST-documented "models/…" form —
 * both yield the same URL.
 */
export function generateVideosUrl(model: string): string {
  return googleModelUrl(model, "predictLongRunning");
}

function toSdkImage(image: GoogleVeoImage): GenerateVideosSdkImage {
  const mimeType = image.bytesBase64Encoded !== undefined ? image.mimeType : image.inlineData.mimeType;
  return {
    imageBytes: veoImageData(image),
    ...(mimeType !== undefined && { mimeType }),
  };
}

function buildSdkParams(
  model: string,
  body: Omit<GenerateVideosBody, "model">,
): GenerateVideosSdkParams {
  const instance = body.instances[0] ?? {};
  const config: GenerateVideosSdkConfigBase & {
    referenceImages?: GenerateVideosSdkReferenceImage[];
  } = {};
  const parameters = body.parameters ?? {};
  if (parameters.sampleCount !== undefined) config.numberOfVideos = parameters.sampleCount;
  if (parameters.durationSeconds !== undefined) config.durationSeconds = parameters.durationSeconds;
  if (parameters.aspectRatio !== undefined) config.aspectRatio = parameters.aspectRatio;
  if (parameters.resolution !== undefined) config.resolution = parameters.resolution;
  if (parameters.personGeneration !== undefined) config.personGeneration = parameters.personGeneration;
  if (parameters.negativePrompt !== undefined) config.negativePrompt = parameters.negativePrompt;
  if (parameters.enhancePrompt !== undefined) config.enhancePrompt = parameters.enhancePrompt;
  if (instance.lastFrame !== undefined) config.lastFrame = toSdkImage(instance.lastFrame);
  if (instance.referenceImages !== undefined) {
    config.referenceImages = instance.referenceImages.map((ref) => ({
      image: toSdkImage(ref.image),
      referenceType: ref.referenceType,
    }));
  }
  if (body.webhookConfig !== undefined) config.webhookConfig = body.webhookConfig;

  const sdk: GenerateVideosSdkParams = { model };
  if (instance.prompt !== undefined) sdk.prompt = instance.prompt;
  if (instance.image !== undefined) sdk.image = toSdkImage(instance.image);
  if (instance.video !== undefined) {
    sdk.video = {
      ...(instance.video.uri !== undefined && { uri: instance.video.uri }),
      ...(instance.video.encodedVideo !== undefined && { videoBytes: instance.video.encodedVideo }),
      ...(instance.video.encoding !== undefined && { mimeType: instance.video.encoding }),
    };
  }
  if (Object.keys(config).length > 0) sdk.config = config;
  return sdk;
}

/**
 * The SDK targets this endpoint declares: `@google/genai`'s
 * `ai.models.generateVideos()` only.
 *
 * No `"ai-sdk"`: the AI SDK's video primitive is still
 * `experimental_generateVideo` (checked 2026-08-13), and a target that exists
 * but produces params no AI SDK provider accepts is worse than no target. No
 * `.toApi` either — media retargeting is not derivable from the catalog
 * (design-translate §4), so `Avail` stays `never` and `.toApi` does not exist
 * on the result at all.
 */
export type VideoSdkTargets<T extends GenerateVideosBody = GenerateVideosBody> = {
  google: () => GenerateVideosSdkParams<T>;
};

function finalize(params: GenerateVideosBody): unknown {
  const { model, ...body } = params;
  const request: RequestMeta = {
    url: generateVideosUrl(model),
    method: "POST",
    headers: JSON_HEADERS,
  };
  return toValidated(body, request, { sdk: { google: () => buildSdkParams(model, body) } });
}

const validator = createValidator<GenerateVideosBody, unknown>({
  endpoint: "google.video",
  schema,
  modelId: (params) => stripModelsPrefix(params.model),
  catalog: videoModels,
  constraints: videoConstraints,
  familyRules: videoFamilyRules,
  checks: [
    checkVideoModality,
    checkVeoParameters,
    checkParameterBoundsCoverage,
    checkInstanceFeatures,
    checkInstancePairings,
    checkInstanceLimits,
    checkParameterPairings,
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Gemini `models.{model}:predictLongRunning`
 * (Veo video generation).
 *
 * The returned object's enumerable props are the exact fetch JSON body —
 * `model` is stripped, because on the wire it lives only in the URL
 * (`.request.url` already has it interpolated). `.toSdk("google")` re-shapes
 * the body for `@google/genai`'s `ai.models.generateVideos()`. The response is a
 * long-running Operation; polling it is out of unmodel's scope. Auth is your
 * job: add an `x-goog-api-key` header (or `?key=`) when fetching.
 *
 * ```ts
 * const params = google.video({
 *   model: "veo-3.1-generate-preview",
 *   instances: [{ prompt: "a hummingbird in slow motion" }],
 *   parameters: { aspectRatio: "16:9", durationSeconds: 8 },
 * });
 * const operation = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, "x-goog-api-key": process.env.GEMINI_API_KEY! },
 *   body: JSON.stringify(params),
 * }).then((r) => r.json());
 * // Poll GET /v1beta/{operation.name} until done — out of unmodel's scope.
 * ```
 */
export const video = validator as unknown as {
  <M extends VideoModelInput, T extends VeoBodyArm<M>>(
    params: T & VeoBodyArm<M> & { model: M } & ExactKeys<T, VeoBodyArm<M>>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "model">, VideoSdkTargets<T & GenerateVideosBody>>;
  safe<M extends VideoModelInput, T extends VeoBodyArm<M>>(
    params: T & VeoBodyArm<M> & { model: M } & ExactKeys<T, VeoBodyArm<M>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "model">, VideoSdkTargets<T & GenerateVideosBody>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
