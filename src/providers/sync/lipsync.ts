/**
 * sync. lipsync — POST https://api.sync.so/v2/generate with a VIDEO input.
 *
 * Wire notes (verified against the curated OpenAPI 3.1 document at
 * https://sync.so/docs/openapi.json, the reference page at
 * https://sync.so/docs/api-reference/api/generate-api/create.md, the model
 * page at https://sync.so/docs/models/lipsync.md and the guides at
 * https://sync.so/docs/developer-guides/segments.md and
 * https://sync.so/docs/developer-guides/dialogue-editing.md on 2026-11-12; the
 * SDK types in `@sync.so/sdk@0.4.0` are the tiebreak — see `./shared.ts`):
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
  checkReactPrompt,
  checkSegmentRefIds,
  generationCommonSchema,
  optionsSchema,
  ttsInputSchema,
  videoInputSchema,
  type SyncAudioLikeInput,
  type SyncDialogueEditReference,
  type SyncDubParams,
  type SyncGenerationOptions,
  type SyncGenerationSegment,
  type SyncModelId,
  type SyncOutputAudio,
  type SyncVideoInput,
} from "./shared";

export { GENERATE_URL } from "./shared";

const SOURCE = `${DOCS_BASE}/api-reference/api/generate-api/create`;
const SEGMENTS_SOURCE = `${DOCS_BASE}/developer-guides/segments`;
const DIALOGUE_EDIT_SOURCE = `${DOCS_BASE}/developer-guides/dialogue-editing`;

/** The items a lipsync generation's `input` array may hold. */
export type SyncLipsyncInputItem = SyncVideoInput | SyncAudioLikeInput;

export interface SyncLipsyncParams {
  /** Required. One of the five ids in `SYNC_MODELS`. */
  model: SyncModelId | (string & {});
  /**
   * Required. Exactly one `{ type: "video" }` item plus one `{ type: "audio" }`
   * or `{ type: "text" }` item — unless `dubParams` or `dialogueEdit` is set,
   * which supplies the voice itself and forbids the second item.
   *
   * More than one voice item is legal only alongside `segments`, which is what
   * places them on the timeline.
   */
  input: readonly SyncLipsyncInputItem[];
  /** The fifteen published dials. Five of them are model-gated; see `./shared.ts`. */
  options?: SyncGenerationOptions;
  /** Several voices over one clip, each on its own time or frame range. */
  segments?: readonly SyncGenerationSegment[];
  /** One audio input played over the whole output. Needs `segments`. */
  outputAudio?: SyncOutputAudio;
  /** HTTPS. sync. POSTs the finished generation here, signed `Sync-Signature`. */
  webhookUrl?: string;
  /** Up to 255 chars; sync. strips non-alphanumerics and appends `.mp4`. */
  outputFileName?: string;
  /** Dub the clip's own audio into another language, then lip-sync to it. */
  dubParams?: SyncDubParams;
  /** Attach the generation to a Studio project. A foreign id is a 422. */
  projectId?: string;
  /** Lip-sync the clip to a completed dialogue edit. One video input, nothing else. */
  dialogueEdit?: SyncDialogueEditReference;
}

const lipsyncSchema = z.looseObject({
  ...generationCommonSchema,
  input: z.array(z.union([videoInputSchema, audioInputSchema, ttsInputSchema])),
  segments: z
    .array(
      z.looseObject({
        startTime: z.number().optional(),
        endTime: z.number().optional(),
        startFrame: z.number().optional(),
        endFrame: z.number().optional(),
        audioInput: z
          .looseObject({
            refId: z.string(),
            startTime: z.number().optional(),
            endTime: z.number().optional(),
          })
          .optional(),
        lipsync: z.boolean().optional(),
        optionsOverride: optionsSchema.optional(),
      }),
    )
    .optional(),
  outputAudio: z.looseObject({ refId: z.string() }).optional(),
  dubParams: z
    .looseObject({
      providerName: z.enum(SYNC_TTS_PROVIDERS),
      targetLang: z.enum(SYNC_DUB_LANGUAGES),
      sourceLang: z.enum(SYNC_DUB_SOURCE_LANGUAGES).optional(),
      numSpeakers: z.number().int().optional(),
      cloningStrength: z.number().int().min(1).max(10).optional(),
      startTime: z.number().optional(),
      endTime: z.number().optional(),
    })
    .optional(),
  dialogueEdit: z.looseObject({ id: z.string() }).optional(),
});

/**
 * Segment ranges have to be ordered and the crop window comes as a pair.
 *
 * All three are stated on the schema's own field descriptions ("Must be less
 * than or equal to endTime"; "When specified, endTime must also be provided")
 * or on /developer-guides/segments ("`startFrame` must be strictly less than
 * `endFrame`. Unlike time-based segments which allow equal start and end
 * times, frame-based segments require at least one frame of difference"), and
 * none is expressible in the shape, because every field is a plain number.
 */
function checkSegmentTimes(params: SyncLipsyncParams, _info: unknown, ctx: PipelineContext): void {
  const segments = params.segments;
  if (segments === undefined) return;
  segments.forEach((segment, index) => {
    if (
      segment.startTime !== undefined &&
      segment.endTime !== undefined &&
      segment.startTime > segment.endTime
    ) {
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
    if (
      segment.startFrame !== undefined &&
      segment.endFrame !== undefined &&
      segment.startFrame >= segment.endFrame
    ) {
      ctx.report({
        code: "invalid_shape",
        path: ["segments", index, "startFrame"],
        model: params.model,
        message:
          `\`segments[${index}]\` runs from frame ${segment.startFrame} to frame ${segment.endFrame}. Frame ` +
          "bounds must be strictly ordered — `startFrame` less than `endFrame`, at least one frame apart — " +
          "where time bounds may be equal.",
        meta: { source: SEGMENTS_SOURCE },
      });
    }
    if (segment.audioInput === undefined) return;
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
 * A segment is lipsynced unless it says `lipsync: false`, and a lipsynced
 * segment needs a track.
 *
 * Every segment field is optional in the spec, so neither rule is in the shape.
 * Both are 422 `generation_input_segments_invalid` on /developer-guides/segments:
 * "Only a segment with `lipsync: false` can omit `audioInput`", and "Every
 * segment sets lipsync: false, so there is nothing to lipsync".
 */
function checkSegmentLipsync(params: SyncLipsyncParams, _info: unknown, ctx: PipelineContext): void {
  const segments = params.segments;
  if (segments === undefined || segments.length === 0) return;
  segments.forEach((segment, index) => {
    if (segment.lipsync === false || segment.audioInput !== undefined) return;
    ctx.report({
      code: "invalid_shape",
      path: ["segments", index, "audioInput"],
      model: params.model,
      message:
        `\`segments[${index}]\` is lipsynced (\`lipsync\` defaults to true) and names no track. Add ` +
        "`audioInput: { refId }` pointing at an audio or text input, or set `lipsync: false` to keep this " +
        "part of the video exactly as it is.",
      meta: { source: SEGMENTS_SOURCE },
    });
  });
  if (segments.every((segment) => segment.lipsync === false)) {
    ctx.report({
      code: "invalid_shape",
      path: ["segments"],
      model: params.model,
      message:
        "Every segment sets `lipsync: false`, so there is nothing to lipsync. Lipsync at least one " +
        "segment — to keep the whole video unchanged, do not create a generation.",
      meta: { source: SEGMENTS_SOURCE },
    });
  }
}

/**
 * `outputAudio` — the one track played over the whole output — and the rule
 * that makes it necessary.
 *
 * Three 422 `generation_input_segments_invalid` cases from
 * /developer-guides/segments: "outputAudio needs segments"; its `refId` "names
 * no audio input in the request, or names a text-to-speech input"; and a
 * `lipsync: false` segment with `outputAudio` missing when "the request
 * doesn't have exactly one audio input" — the one input that would otherwise
 * play over it.
 */
function checkOutputAudio(params: SyncLipsyncParams, _info: unknown, ctx: PipelineContext): void {
  const outputAudio = params.outputAudio;
  const segments = params.segments;
  if (segments === undefined) {
    if (outputAudio === undefined) return;
    ctx.report({
      code: "invalid_shape",
      path: ["outputAudio"],
      model: params.model,
      message:
        "`outputAudio` needs `segments`. To play one audio input across the whole video, send it as the " +
        "only audio input and omit both `segments` and `outputAudio`.",
      meta: { source: SEGMENTS_SOURCE },
    });
    return;
  }

  const audios = params.input.filter((item) => item.type === "audio");
  if (outputAudio === undefined) {
    if (!segments.some((segment) => segment.lipsync === false) || audios.length === 1) return;
    ctx.report({
      code: "invalid_shape",
      path: ["outputAudio"],
      model: params.model,
      message:
        "A `lipsync: false` segment plays one audio track over the whole output, and with no " +
        `\`outputAudio\` that track is the request's only audio input — this request has ${audios.length}. ` +
        "Set `outputAudio: { refId }` to the audio input that covers the whole video.",
      meta: { source: SEGMENTS_SOURCE, audios: audios.length },
    });
    return;
  }

  const refId = outputAudio.refId;
  if (audios.some((item) => item.refId === refId)) return;
  const known = audios.map((item) => item.refId).filter((id): id is string => id !== undefined);
  const isText = params.input.some((item) => item.type === "text" && item.refId === refId);
  ctx.report({
    code: "invalid_shape",
    path: ["outputAudio", "refId"],
    model: params.model,
    message:
      `\`outputAudio.refId\` is "${refId}", which ${isText ? "names a text input" : "names no input"}; it must ` +
      "name an `audio` input, not a text input. The audio refIds in this request are " +
      `${known.length === 0 ? "none" : known.map((id) => `"${id}"`).join(", ")}.`,
    meta: { source: SEGMENTS_SOURCE, refId, known },
  });
}

/**
 * `dialogueEdit` is a request MODE, like `dubParams`: the completed edit
 * supplies the audio and the edited regions.
 *
 * "Submit `dialogueEdit: { "id": "..." }` with exactly one video input. … Do
 * not add an audio input, image input, `segments`, or `dubParams`."
 * (/developer-guides/dialogue-editing). The one-video half is
 * `checkInputArity`'s, and an image item cannot reach this address at all.
 */
function checkDialogueEdit(params: SyncLipsyncParams, _info: unknown, ctx: PipelineContext): void {
  if (params.dialogueEdit === undefined) return;
  const voices = params.input.filter((item) => item.type === "audio" || item.type === "text");
  const conflicts = [
    ...(voices.length > 0 ? [`${voices.length} audio or text input${voices.length === 1 ? "" : "s"}`] : []),
    ...(params.segments !== undefined ? ["`segments`"] : []),
    ...(params.dubParams !== undefined ? ["`dubParams`"] : []),
  ];
  if (conflicts.length === 0) return;
  ctx.report({
    code: "invalid_shape",
    path: ["dialogueEdit"],
    model: params.model,
    message:
      "`dialogueEdit` takes its audio and edited regions from the completed dialogue edit, so the request " +
      "carries exactly one video input — the original the edit was made from — and nothing else to " +
      `say. This one also has ${conflicts.join(" and ")}; drop ${conflicts.length === 1 ? "it" : "them"}, ` +
      "or drop `dialogueEdit`.",
    meta: { source: DIALOGUE_EDIT_SOURCE, conflicts },
  });
}

/**
 * A dubbed range runs forwards.
 *
 * `dubParams.endTime` "Must be after startTime and within the source video",
 * and "Invalid ranges return 422 generation_input_trim_invalid". The source's
 * length is not in the request; the order is.
 */
function checkDubRange(params: SyncLipsyncParams, _info: unknown, ctx: PipelineContext): void {
  const startTime = params.dubParams?.startTime ?? 0;
  const endTime = params.dubParams?.endTime;
  if (endTime === undefined || endTime > startTime) return;
  ctx.report({
    code: "invalid_shape",
    path: ["dubParams", "endTime"],
    model: params.model,
    message:
      `\`dubParams\` selects ${startTime}s to ${endTime}s of the source; \`endTime\` must be after ` +
      `\`startTime\`${params.dubParams?.startTime === undefined ? ", which defaults to 0" : ""}.`,
    meta: { source: SOURCE },
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
 * The rate is per OUTPUT FRAME, quoted per second at 25 fps, and the output's
 * duration is the input clip's (or the audio's, depending on `sync_mode`) —
 * none of which a URL reveals. Multiplying by a guessed duration would produce
 * a number that looks authoritative and is not. sync.'s own
 * `POST /v2/generations/estimate` answers in USD once you supply the duration
 * (and the fps) yourself — it takes `{ model, duration, fps? }`, not this body;
 * `ESTIMATE_COST_URL` is exported for it, and unmodel never calls it.
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
    checkReactPrompt(`${DOCS_BASE}/models/react`),
    checkDubParams(SOURCE),
    checkDubRange,
    checkDialogueEdit,
    checkSegmentRefIds(SOURCE),
    checkSegmentTimes,
    checkSegmentLipsync,
    checkOutputAudio,
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
