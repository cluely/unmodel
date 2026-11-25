/**
 * `unmodel/higgsfield/types` — every `higgsfield` type, and nothing else.
 *
 * **Zero runtime.** Every export in this module is a `type`, so the emitted
 * JavaScript is an empty module: importing it adds nothing to a bundle. That
 * is pinned, against a real build, by `test/types-entries.test.ts`.
 *
 * Reach for this entry when you want unmodel's request shapes at compile time
 * and are sending the request yourself:
 *
 * ```ts
 * import type { VideoBody } from "unmodel/higgsfield/types";
 *
 * const body = {
 *   prompt: "A fox walks through snow",
 *   resolution: "720p",
 *   duration: 5,
 * } satisfies VideoBody<"bytedance/seedance-2.5/text-to-video">;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** — `HiggsfieldImageBodyById`, `HiggsfieldVideoBodyById`,
 *   `CreateCustomReferenceBody`, `RequestStatus`, `WebhookDelivery`: one body
 *   type per route, keyed by the route's id, and the response shapes under
 *   Higgsfield's own names;
 * - the **uniform category aliases** (`ImageBody`, `ImageEditBody`,
 *   `VideoBody`, `CharacterTrainBody`) — one per endpoint address, named after
 *   the word you already type at `unmodel/higgsfield` and on the CLI. Each of
 *   the three generation aliases takes the route id, because the body a
 *   Higgsfield request carries is chosen by it, and each is the JSON body
 *   itself: `endpoint` and `hf_webhook` are URL parameters and are not in it.
 *
 * Runtime values — the validators, the URL helpers, the status tuples, the
 * catalog, the rates — stay on `unmodel/higgsfield`.
 *
 * Endpoints:
 *
 * - `higgsfield.image` → `ImageBody`
 * - `higgsfield.imageEdit` → `ImageEditBody`
 * - `higgsfield.video` → `VideoBody`
 * - `higgsfield.characterTrain` → `CharacterTrainBody`
 */

import type { CreateCustomReferenceBody } from "./character-train";
import type {
  HiggsfieldEndpointId,
  HiggsfieldImageEditEndpointId,
  HiggsfieldImageEndpointId,
  HiggsfieldVideoEndpointId,
} from "./gen/endpoints.gen";
import type { HiggsfieldImageBodyById, HiggsfieldImageEditBodyById } from "./gen/image-wire.gen";
import type { HiggsfieldVideoBodyById } from "./gen/video-wire.gen";

export type { CreateCustomReferenceBody, ImageUrlInputImage } from "./character-train";

export type { HiggsfieldArm, HiggsfieldBody, HiggsfieldSdkTargets, SubmitValidator } from "./submit";

export type { HiggsfieldRequestStatus, RequestStatusLike } from "./check";

export type {
  AdmissionError,
  AiInfluencerOptions,
  CustomReference,
  CustomReferenceList,
  CustomReferenceStatus,
  DeletedRequest,
  ErrorResponse,
  EstimateResponse,
  GenjutsuRestylePresets,
  MarketingStudioImagePresets,
  MediaOutput,
  ModelsUsage,
  RequestAccepted,
  RequestStatus,
  RequestStatusValue,
  SoulStyle,
  UploadUrlRequest,
  UploadUrlResponse,
  ValidationErrorItem,
  WebhookDelivery,
  WebhookMediaOutput,
} from "./request-wire";

export type {
  HiggsfieldEndpointId,
  HiggsfieldImageEditEndpointId,
  HiggsfieldImageEndpointId,
  HiggsfieldVideoEndpointId,
} from "./gen/endpoints.gen";
export type * from "./gen/image-wire.gen";
export type * from "./gen/video-wire.gen";

export type {
  HiggsfieldCondition,
  HiggsfieldConsequence,
  HiggsfieldConstraint,
  HiggsfieldEndpointShape,
  HiggsfieldPropSpec,
  HiggsfieldPropType,
  HiggsfieldRule,
  HiggsfieldScalar,
} from "./shape-types";
export type { HiggsfieldRate, HiggsfieldRateTable, HiggsfieldUnpricedArm } from "./pricing-types";
export type { HiggsfieldCostContext } from "./pricing";

/**
 * Every Higgsfield catalog id: the generated routes, and the one training
 * route. Spelled from the id unions and not re-exported from `./models`: that
 * module is the merged catalog, and a types entry must not be the thing that
 * reaches it.
 */
export type HiggsfieldModelId = HiggsfieldEndpointId | "v1/custom-references";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type ImageBody<Id extends HiggsfieldImageEndpointId = HiggsfieldImageEndpointId> = HiggsfieldImageBodyById[Id];
export type ImageEditBody<Id extends HiggsfieldImageEditEndpointId = HiggsfieldImageEditEndpointId> =
  HiggsfieldImageEditBodyById[Id];
export type VideoBody<Id extends HiggsfieldVideoEndpointId = HiggsfieldVideoEndpointId> = HiggsfieldVideoBodyById[Id];
export type CharacterTrainBody = CreateCustomReferenceBody;
