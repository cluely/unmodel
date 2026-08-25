/**
 * sync. lipsync — POST https://api.sync.so/v2/generate with a VIDEO input.
 *
 * Wire notes (verified against the curated OpenAPI 3.1 document at
 * https://sync.so/docs/openapi.json, the reference page at
 * https://sync.so/docs/api-reference/api/generate-api/create.md and the model
 * page at https://sync.so/docs/models/lipsync.md on 2026-08-25; the SDK types
 * in `@sync.so/sdk@0.3.0` were the tiebreak — see `./shared.ts`):
 *
 * - `model` and `input` are the only required fields.
 * - `input` is an ARRAY, and its arity is a rule rather than a shape: exactly
 *   one visual item and one audio-or-text item. {@link checkInputArity} says so
 *   before the API's `generation_input_too_many_visual` does.
 * - Each media item takes `url` OR `assetId`. The spec spells that as an
 *   `anyOf` over two `required` lists, so both fields are individually optional
 *   and `{ type: "video" }` type-checks — {@link checkInputRefs} is the guard.
 * - `application/json`, not multipart. The curated spec declares only
 *   `multipart/form-data` on this path; the prose docs and the SDK's
 *   `generations.create` both post JSON, and JSON is what unmodel compiles.
 * - Async: responds **201** with a `PENDING` generation; poll
 *   `GET /v2/generate/{id}` until `COMPLETED`, `FAILED` or `REJECTED`, then read
 *   `outputUrl`. Or set `webhookUrl` and be told.
 * - Headers: add `x-api-key: <SYNC_API_KEY>` yourself — unmodel never touches
 *   credentials.
 *
 * ## Why this address and `sync.avatar` are two validators on ONE URL
 *
 * They are the same path and different requests. A lipsync generation carries
 * `{ type: "video" }` and may carry `segments` (which slice a timeline) and
 * `dubParams` (which extract audio from the clip); an avatar generation carries
 * `{ type: "image" }`, narrows `model` to `sync-3`, and can carry neither —
 * there is no timeline to slice and no track to extract. Those are different
 * REQUIRED fields, which is what the library's qualified-address rule is about,
 * and the split is the same one `unmodel/lipsync` and `unmodel/avatar` make one
 * layer up. At fal the same product is two endpoint ids
 * (`fal-ai/sync-lipsync/v3` and `…/v3/image-to-video`) for the same reason; here
 * the fork is in the body rather than the path.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";
import {
  DOCS_BASE,
  GENERATE_URL,
  SYNC_DUB_LANGUAGES,
  SYNC_DUB_SOURCE_LANGUAGES,
  SYNC_HEADERS,
  SYNC_TTS_PROVIDERS,
  audioInputSchema,
  checkDubParams,
  checkImageModel,
  checkInputArity,
  checkInputRefs,
  checkModelGatedOptions,
  checkSegmentRefIds,
  generationCommonSchema,
  optionsSchema,
  ttsInputSchema,
  videoInputSchema,
  type SyncAudioLikeInput,
  type SyncDubParams,
  type SyncGenerationOptions,
  type SyncGenerationSegment,
  type SyncModelId,
  type SyncVideoInput,
} from "./shared";

export { GENERATE_URL } from "./shared";

const SOURCE = `${DOCS_BASE}/api-reference/api/generate-api/create`;

/** The items a lipsync generation's `input` array may hold. */
export type SyncLipsyncInputItem = SyncVideoInput | SyncAudioLikeInput;

export interface SyncLipsyncParams {
  /** Required. One of the five ids in `SYNC_MODELS`. */
  model: SyncModelId | (string & {});
  /**
   * Required. Exactly one `{ type: "video" }` item plus one `{ type: "audio" }`
   * or `{ type: "text" }` item — unless `dubParams` is set, which supplies the
   * voice from the clip's own track and forbids the second item.
   *
   * More than one voice item is legal only alongside `segments`, which is what
   * places them on the timeline.
   */
  input: readonly SyncLipsyncInputItem[];
  /** The six published dials. Four of them are model-gated; see `./shared.ts`. */
  options?: SyncGenerationOptions;
  /** Several voices over one clip, each on its own `[startTime, endTime]`. */
  segments?: readonly SyncGenerationSegment[];
  /** HTTPS. sync. POSTs the finished generation here, signed `Sync-Signature`. */
  webhookUrl?: string;
  /** Up to 255 chars; sync. strips non-alphanumerics and appends `.mp4`. */
  outputFileName?: string;
  /** Dub the clip's own audio into another language, then lip-sync to it. */
  dubParams?: SyncDubParams;
  /** Attach the generation to a Studio project. A foreign id is a 422. */
  projectId?: string;
}

const lipsyncSchema = z.looseObject({
  ...generationCommonSchema,
  input: z.array(z.union([videoInputSchema, audioInputSchema, ttsInputSchema])),
  segments: z
    .array(
      z.looseObject({
        startTime: z.number(),
        endTime: z.number(),
        audioInput: z.looseObject({
          refId: z.string(),
          startTime: z.number().optional(),
          endTime: z.number().optional(),
        }),
        optionsOverride: optionsSchema.optional(),
      }),
    )
    .optional(),
  dubParams: z
    .looseObject({
      providerName: z.enum(SYNC_TTS_PROVIDERS),
      targetLang: z.enum(SYNC_DUB_LANGUAGES),
      sourceLang: z.enum(SYNC_DUB_SOURCE_LANGUAGES).optional(),
      numSpeakers: z.number().int().optional(),
    })
    .optional(),
});

/**
 * Segment time ranges have to be ordered and the crop window comes as a pair.
 *
 * Both are stated on the schema's own field descriptions ("Must be less than or
 * equal to endTime"; "When specified, endTime must also be provided") and
 * neither is expressible in the shape, because both fields are plain numbers.
 */
function checkSegmentTimes(params: SyncLipsyncParams, _info: unknown, ctx: PipelineContext): void {
  const segments = params.segments;
  if (segments === undefined) return;
  segments.forEach((segment, index) => {
    if (segment.startTime > segment.endTime) {
      ctx.report({
        code: "invalid_shape",
        path: ["segments", index, "startTime"],
        model: params.model,
        message:
          `\`segments[${index}]\` runs from ${segment.startTime}s to ${segment.endTime}s, which is backwards. ` +
          "`startTime` must be less than or equal to `endTime`.",
        meta: { source: SOURCE },
      });
    }
    const { startTime, endTime } = segment.audioInput;
    if ((startTime === undefined) !== (endTime === undefined)) {
      ctx.report({
        code: "invalid_shape",
        path: ["segments", index, "audioInput", startTime === undefined ? "startTime" : "endTime"],
        model: params.model,
        message:
          `\`segments[${index}].audioInput\` crops the referenced track and the crop is a PAIR — ` +
          `\`${startTime === undefined ? "endTime" : "startTime"}\` was given without the other. Pass both, or neither.`,
        meta: { source: SOURCE },
      });
    } else if (startTime !== undefined && endTime !== undefined && startTime > endTime) {
      ctx.report({
        code: "invalid_shape",
        path: ["segments", index, "audioInput", "startTime"],
        model: params.model,
        message:
          `\`segments[${index}].audioInput\` crops from ${startTime}s to ${endTime}s, which is backwards.`,
        meta: { source: SOURCE },
      });
    }
  });
}

/**
 * Per-model narrowing, declared as a table rather than expressed in rules.
 *
 * `EndpointConstraints.deny` addresses TOP-LEVEL params, and every one of
 * sync.'s model gates lives one level down under `options` — so the gate is
 * {@link checkModelGatedOptions}, which can name which models DO take the dial.
 * This table exists to declare the roster to the pipeline, which is also what
 * makes `constraintsFor` answer for these ids.
 */
export const lipsyncConstraints = {
  "sync-3": {},
  "lipsync-2": {},
  "lipsync-2-pro": {},
  "lipsync-1.9.0-beta": {},
  "react-1": {},
} as const satisfies Readonly<Partial<Record<string, EndpointConstraints>>>;

/**
 * The one `.toSdk("sync")` target — `@sync.so/sdk`'s
 * `client.generations.create(request)` takes exactly this body, which its
 * generated client posts as `application/json` to `/v2/generate`. Derived from
 * the `sdk` literal in `finalize`; it must stay an object type with no index
 * signature, or `toSdk` would accept any string.
 */
type SyncSdkTargets<B> = { sync: () => B };

function finalize(params: SyncLipsyncParams): unknown {
  const body = { ...params };
  return toValidated(
    body,
    { url: GENERATE_URL, method: "POST", headers: SYNC_HEADERS },
    { sdk: { sync: () => body } },
  );
}

/**
 * No `estimate`, and the reason is worth stating because sync. publishes a
 * per-second rate for every model.
 *
 * The rate is per second of OUTPUT, and the output's duration is the input
 * clip's (or the audio's, depending on `sync_mode`) — neither of which a URL
 * reveals. Multiplying by a guessed duration would produce a number that looks
 * authoritative and is not. sync.'s own `POST /v2/analyze/cost` takes this exact
 * body and answers `{ estimatedFrameCount, estimatedGenerationCost }` in USD;
 * `ANALYZE_COST_URL` is exported for it, and unmodel never calls it.
 */
const validator = createValidator<SyncLipsyncParams, unknown>({
  endpoint: "sync.lipsync",
  schema: lipsyncSchema,
  modelId: (params) => params.model,
  catalog: models,
  constraints: lipsyncConstraints,
  checks: [
    checkInputArity(SOURCE, "video"),
    checkInputRefs(SOURCE),
    checkImageModel(SOURCE),
    checkModelGatedOptions(`${DOCS_BASE}/models/lipsync`),
    checkDubParams(SOURCE),
    checkSegmentRefIds(SOURCE),
    checkSegmentTimes,
  ],
  finalize,
});

/**
 * Validates raw wire params for sync. `POST /v2/generate` with a video input.
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * `.toSdk("sync")` returns it unchanged. Auth is yours to add:
 * `x-api-key: <SYNC_API_KEY>`.
 *
 * ```ts
 * const params = sync.lipsync({
 *   model: "lipsync-2",
 *   input: [
 *     { type: "video", url: "https://example.com/take.mp4" },
 *     { type: "audio", url: "https://example.com/vo.wav" },
 *   ],
 *   options: { sync_mode: "loop" },
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, "x-api-key": process.env.SYNC_API_KEY! },
 *   body: JSON.stringify(params),
 * });
 * const { id, status } = await res.json();   // 201, status "PENDING"
 * ```
 *
 * Then poll `generationUrl(id)` until `status` is `COMPLETED` and read
 * `outputUrl`. Two things to know before writing the loop: `FAILED` and
 * `REJECTED` are both terminal and mean different things (`REJECTED` never ran),
 * and the machine-readable reason is `errorCode` — whose full catalog is
 * `SYNC_ERROR_CODES`, served live and unauthenticated at `ERRORS_URL`.
 */
export const lipsync = validator as unknown as {
  <T extends SyncLipsyncParams>(
    params: T & ExactKeys<T, SyncLipsyncParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, SyncSdkTargets<T>>;
  safe<T extends SyncLipsyncParams>(
    params: T & ExactKeys<T, SyncLipsyncParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, SyncSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
