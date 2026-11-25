/**
 * Higgsfield's response and auxiliary-request shapes — TYPE ONLY.
 *
 * Hand-transcribed 2026-11-24 from the docs pages named on each interface
 * (`docs/research/higgsfield-api-2026-11-24.md` §1 and §7). Nothing here was
 * exercised against a live key: every shape is the published contract.
 *
 * Wire-shaped names keep Higgsfield's own spelling (`docs/decisions.md` §2).
 *
 * Where the sources disagree the model's own docs page wins, as Higgsfield
 * itself says ("Treat `/docs/openapi.json` as supplementary reference, not the
 * authoritative model catalog", https://docs.higgsfield.ai/docs/llms.txt). That
 * is why {@link MediaOutput} is open and {@link RequestStatus} has `errors`:
 * the shared OpenAPI document declares `MediaOutput` closed with `url` alone,
 * and the Ads Studio page shows an `index` beside it.
 */

import type {
  HIGGSFIELD_CUSTOM_REFERENCE_STATUSES,
  HIGGSFIELD_REQUEST_STATUSES,
  HIGGSFIELD_UPLOAD_CONTENT_TYPES,
  HIGGSFIELD_WEBHOOK_STATUSES,
} from "./statuses";

/** mirror `RequestStatus.status` exactly — https://docs.higgsfield.ai/docs/openapi.json, https://docs.higgsfield.ai/docs/concepts/requests.md. */
export type RequestStatusValue = (typeof HIGGSFIELD_REQUEST_STATUSES)[number];

/**
 * One output file. `index` is the zero-based batch slot on Ads Studio ("Use
 * its zero-based `index` to identify its batch slot and inspect `errors` for
 * unsuccessful slots",
 * https://docs.higgsfield.ai/docs/models/ads-studio/generate.md).
 */
export interface MediaOutput {
  url: string;
  index?: number;
}

/**
 * What a submit answers — mirror the "Accepted" sample exactly
 * (https://docs.higgsfield.ai/docs/concepts/requests.md).
 *
 * `expires_after` is seconds of retention after the request finishes; it is
 * absent from the quickstart's and the model pages' samples, so it is
 * optional. A replayed idempotent submit "can contain `"status": "queued"`
 * even when the original request has already finished"
 * (https://docs.higgsfield.ai/docs/concepts/idempotency.md).
 */
export interface RequestAccepted {
  status: "queued";
  request_id: string;
  status_url: string;
  cancel_url: string;
  expires_after?: number;
}

/**
 * What `GET /requests/{request_id}/status` answers — mirror `RequestStatus`
 * exactly (https://docs.higgsfield.ai/docs/openapi.json), plus what the pages
 * add to it.
 *
 * Image routes answer `images`, video routes `video`; "Some video and 3D
 * operations can return additional artifacts such as `zip`, `mov`, `jsx`,
 * `fbx`, or `ply`." `errors` is Ads Studio's list of failed batch slots; its
 * item type is not published.
 */
export interface RequestStatus {
  status: RequestStatusValue;
  request_id: string;
  status_url?: string;
  cancel_url?: string;
  /** On `failed`. The `nsfw` status carries none. */
  error?: string | null;
  images?: MediaOutput[];
  video?: MediaOutput;
  audio?: MediaOutput;
  audios?: MediaOutput[];
  zip?: MediaOutput;
  mov?: MediaOutput;
  jsx?: MediaOutput;
  fbx?: MediaOutput;
  ply?: MediaOutput;
  /** ISO date-time at which the files are deleted. "Present once the request has finished." */
  expires_at?: string | null;
  errors?: unknown[];
}

/** What `DELETE /requests/{request_id}` answers. */
export interface DeletedRequest {
  request_id: string;
  status: "deleted";
}

/**
 * What `POST /estimate/<endpoint>` answers: `{ "usd": "0.094" }`, a decimal
 * string (https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md).
 */
export interface EstimateResponse {
  usd: string;
}

/** mirror the body of `POST /files/generate-upload-url` exactly — https://docs.higgsfield.ai/docs/concepts/file-uploads.md. */
export interface UploadUrlRequest {
  content_type: (typeof HIGGSFIELD_UPLOAD_CONTENT_TYPES)[number];
}

/**
 * What `POST /files/generate-upload-url` answers. "Send the file to
 * `upload_url` with every header returned in `upload_headers`." Optional
 * because Higgsfield's own Python client falls back when it is absent.
 */
export interface UploadUrlResponse {
  public_url: string;
  upload_url: string;
  content_type: string;
  upload_headers?: Record<string, string>;
}

/** A file in a webhook delivery: the status shape's `{ url }` plus its media type. */
export interface WebhookMediaOutput {
  url: string;
  content_type: string;
}

/**
 * What Higgsfield POSTs to an `hf_webhook` — mirror the delivery samples
 * exactly (https://docs.higgsfield.ai/docs/how-to/webhooks.md).
 *
 * NOT the status shape: the output is nested under `payload`, which is `null`
 * on `failed` and `nsfw`. "Some video and 3D operations can also include
 * `zip`, `mov`, `jsx`, `fbx`, or `ply` artifacts", whose item shape is not
 * published.
 */
export interface WebhookDelivery {
  request_id: string;
  status: (typeof HIGGSFIELD_WEBHOOK_STATUSES)[number];
  error: string | null;
  expires_at?: string;
  payload: null | {
    images?: WebhookMediaOutput[];
    video?: WebhookMediaOutput;
    audio?: WebhookMediaOutput;
    [artifact: string]: unknown;
  };
}

/** One entry of a validation error's `detail` list. */
export interface ValidationErrorItem {
  loc: (string | number)[];
  msg: string;
  type: string;
}

/**
 * `detail` on a `429` or `503`: the queue would not admit the request
 * (https://docs.higgsfield.ai/docs/concepts/rate-limits.md). `code` is
 * `account_queue_full` or `admission_control_unavailable` in the published
 * samples.
 */
export interface AdmissionError {
  code: string;
  message: string;
  retryable: boolean;
  limit?: number;
  retry_after_seconds?: number;
}

/**
 * A non-2xx body. `detail` is a sentence, a validation list, or the admission
 * object (https://docs.higgsfield.ai/docs/concepts/errors.md).
 */
export interface ErrorResponse {
  detail: string | ValidationErrorItem[] | AdmissionError;
}

/** mirror the character `status` values exactly — https://docs.higgsfield.ai/docs/models/soul-id/create-character.md. */
export type CustomReferenceStatus = (typeof HIGGSFIELD_CUSTOM_REFERENCE_STATUSES)[number];

/**
 * A Soul ID character: what `POST /v1/custom-references` and
 * `GET /v1/custom-references/{id}` answer. "The response is a character
 * reference with `id`, `name`, `model_version`, `status`, `thumbnail_url`,
 * `created_at`, `in_progress_at` and `fail_reason`."
 *
 * `fail_reason`'s type is not published, so it is `unknown`. `reference_media`
 * is on the `GET` by id only.
 */
export interface CustomReference {
  id: string;
  name: string;
  status: CustomReferenceStatus;
  created_at: string;
  thumbnail_url: string | null;
  in_progress_at: string | null;
  model_version?: "v1" | "v2" | "cinema";
  fail_reason?: unknown;
  reference_media?: { id: string; media_url: string }[];
}

/** What `GET /v1/custom-references/list?page&page_size` answers. */
export interface CustomReferenceList {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  items: CustomReference[];
}

/** One item of `GET /v1/text2image/soul-styles` (and `/v2`): what a `style_id` names. */
export interface SoulStyle {
  id: string;
  name: string;
  description: string | null;
  preview_url: string;
}

/** What `GET /models/higgsfield/genjutsu/restyle/v1.0/presets` answers: what a `preset_id` names. */
export interface GenjutsuRestylePresets {
  model: string;
  items: { id: string; name: string; preview_url: string }[];
}

/** What `GET /marketing-studio/image/presets` answers. `cursor` is `null` on the last page. */
export interface MarketingStudioImagePresets {
  total: number;
  cursor: number | null;
  items: {
    id: string;
    type: string;
    name: string;
    cover_image: string | null;
    metadata: { aspect_ratio: string; group_name: string };
    format_slugs: string[];
  }[];
}

/**
 * What `GET /models/higgsfield/ai-influencer/options` answers: the catalog
 * `higgsfield/ai-influencer`'s `selection` keys and values come from (read
 * live, keyless, 2026-11-24).
 */
export interface AiInfluencerOptions {
  config_revision: string;
  categories: {
    key: string;
    label: string;
    tiers: string[];
    max: number;
    options: {
      key: string;
      label: string;
      img: string | null;
      color: string | null;
      tiers: string[] | null;
      slot: string | null;
      exclusive: boolean;
    }[];
  }[];
}

/**
 * What `GET /models/usage` answers — usage analytics, "not a billing record".
 * `quantity`, `unit_price` and `cost` are decimal strings
 * (https://docs.higgsfield.ai/docs/enterprise/usage-and-billing.md).
 */
export interface ModelsUsage {
  time_series: {
    bucket: string;
    results: {
      model: string;
      unit: string;
      quantity: string;
      unit_price: string;
      cost: string;
      currency: string;
      auth_method?: string;
    }[];
  }[];
  total: number;
  page: number;
  limit: number;
}
