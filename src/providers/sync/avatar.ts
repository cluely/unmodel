/**
 * sync. avatar — POST https://api.sync.so/v2/generate with an IMAGE input.
 *
 * The same URL as {@link ../lipsync}, a different request. sync-3 is the only
 * model that takes a still ("sync-3 is the only model that supports image
 * input" — https://sync.so/docs/models/sync-3.md, 2026-08-25), and a still
 * request cannot carry the two fields a clip request can:
 *
 * - **no `segments`** — segments cut a video timeline into `[startTime,
 *   endTime]` ranges and give each one its own track; a still has no timeline.
 * - **no `dubParams`** — dubbing extracts the source audio from the video and
 *   translates it; a still has no audio to extract.
 *
 * Different required fields and two fields that cannot appear is a route fork
 * in everything but the path, which is why this is its own address. `@sync.so/sdk@0.3.0`
 * does not model image input at all (its `Input` union is `Video | Audio | Tts`
 * and it ships no `Image.d.ts`) — the curated OpenAPI document and sync-3's own
 * model page do, and a tiebreaker settles a disagreement rather than an absence.
 *
 * Wire notes:
 * - `{ type: "image", url }` or `{ type: "image", assetId }`. JPEG, PNG, WebP.
 * - `options.sync_mode` is IGNORED — a still has no duration to mismatch.
 * - `options.active_speaker_detection.auto_detect` is NOT SUPPORTED. For a
 *   still with several faces, point at one: `coordinates: [x, y]` in the
 *   image's native pixel space with `frame_number: 0`.
 * - Async and 201-then-poll, exactly as the clip route. `x-api-key` is yours.
 */

import { z } from "zod";
import { createValidator } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";
import {
  DOCS_BASE,
  GENERATE_URL,
  SYNC_HEADERS,
  audioInputSchema,
  checkImageModel,
  checkImageOptions,
  checkInputArity,
  checkInputRefs,
  checkModelGatedOptions,
  generationCommonSchema,
  imageInputSchema,
  ttsInputSchema,
  type SyncAudioLikeInput,
  type SyncGenerationOptions,
  type SyncImageInput,
  type SyncImageModelId,
} from "./shared";

const SOURCE = `${DOCS_BASE}/models/sync-3`;
const CREATE_SOURCE = `${DOCS_BASE}/api-reference/api/generate-api/create`;

/** The items an avatar generation's `input` array may hold. */
export type SyncAvatarInputItem = SyncImageInput | SyncAudioLikeInput;

export interface SyncAvatarParams {
  /**
   * Required, and narrowed: `"sync-3"` is the only model that accepts a still.
   * The wide `string` tail is kept because sync. ships models faster than this
   * catalog does, and a new image-capable id should not be a compile error.
   */
  model: SyncImageModelId | (string & {});
  /** Required. Exactly one `{ type: "image" }` item plus one audio or text item. */
  input: readonly SyncAvatarInputItem[];
  /**
   * The six published dials, minus the two a still ignores in practice —
   * `sync_mode` (no duration to mismatch) and `auto_detect` (unsupported for
   * images). Both are still typed, and both are reported: see
   * `checkImageOptions`.
   */
  options?: SyncGenerationOptions;
  /** HTTPS. sync. POSTs the finished generation here, signed `Sync-Signature`. */
  webhookUrl?: string;
  /** Up to 255 chars; sync. strips non-alphanumerics and appends `.mp4`. */
  outputFileName?: string;
  /** Attach the generation to a Studio project. A foreign id is a 422. */
  projectId?: string;
}

const avatarSchema = z.looseObject({
  ...generationCommonSchema,
  input: z.array(z.union([imageInputSchema, audioInputSchema, ttsInputSchema])),
});

/**
 * One model, and the table says so.
 *
 * The image formats are a real per-model media rule rather than prose:
 * sync-3's page names JPEG, PNG and WebP, and a caller who declares an
 * attached still through `ValidateOptions.media` gets the format checked here
 * rather than at the API's `generation_input_image_inaccessible`.
 */
export const avatarConstraints = {
  "sync-3": {
    media: { image: { formats: ["jpeg", "jpg", "png", "webp"] } },
  },
} as const satisfies Readonly<Partial<Record<string, EndpointConstraints>>>;

/** See `./lipsync.ts` — one SDK target, and it takes the same body. */
type SyncSdkTargets<B> = { sync: () => B };

function finalize(params: SyncAvatarParams): unknown {
  const body = { ...params };
  return toValidated(
    body,
    { url: GENERATE_URL, method: "POST", headers: SYNC_HEADERS },
    { sdk: { sync: () => body } },
  );
}

const validator = createValidator<SyncAvatarParams, unknown>({
  endpoint: "sync.avatar",
  schema: avatarSchema,
  modelId: (params) => params.model,
  catalog: models,
  constraints: avatarConstraints,
  checks: [
    checkInputArity(CREATE_SOURCE, "image"),
    checkInputRefs(CREATE_SOURCE),
    checkImageModel(CREATE_SOURCE),
    checkModelGatedOptions(`${DOCS_BASE}/models/lipsync`),
    checkImageOptions(SOURCE),
  ],
  finalize,
});

/**
 * Validates raw wire params for sync. `POST /v2/generate` with an image input.
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * `.toSdk("sync")` returns it unchanged. Auth is yours to add:
 * `x-api-key: <SYNC_API_KEY>`.
 *
 * ```ts
 * const params = sync.avatar({
 *   model: "sync-3",
 *   input: [
 *     { type: "image", url: "https://example.com/headshot.jpg" },
 *     { type: "audio", url: "https://example.com/vo.wav" },
 *   ],
 * });
 * ```
 *
 * The output's length is the audio's — there is no `duration` here and no
 * `sync_mode` that means anything, because a still has no length of its own to
 * reconcile. Poll `generationUrl(id)` exactly as for the clip route.
 */
export const avatar = validator as unknown as {
  <T extends SyncAvatarParams>(
    params: T & ExactKeys<T, SyncAvatarParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, SyncSdkTargets<T>>;
  safe<T extends SyncAvatarParams>(
    params: T & ExactKeys<T, SyncAvatarParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, SyncSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
