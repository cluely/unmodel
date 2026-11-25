/**
 * Photoroom's Remove Background API — `POST https://sdk.photoroom.com/v1/segment`.
 *
 * Wire notes (OpenAPI https://image-api.photoroom.com/openapi, schema
 * `remove-background-post-params`, and the docs at https://docs.photoroom.com/,
 * read 2026-11-24; research in docs/research/photoroom-api-2026-11-24.md):
 *
 * - A different HOST from the Image Editing API (`sdk.`, not `image-api.`), a
 *   different error shape (`PhotoroomSegmentError`), and snake_case names: the
 *   route is remove.bg-compatible by design — "the name of the arguments and
 *   the format of the result both stay the same"
 *   (https://docs.photoroom.com/remove-background-api-basic-plan/remove.bg-compatibility.md).
 * - MULTIPART here. Seven fields; `image_file` is the only required one. Send
 *   `.request.url` + `toFormData(validated)`.
 * - `format` is `png` | `jpg` | `webp` — `jpg`, NOT `jpeg`.
 * - `crop` and `despill` are the strings `"true"` / `"false"` in the spec,
 *   which types them as string enums. The JS boolean is taken as well:
 *   `toFormData` writes `true` as the text `true`, so the two are one form
 *   part — the rule `EditParams` states for `/v2/edit`, applied to this route.
 *   What was written is what is validated; nothing is converted.
 * - No URL input: "The Remove Background API requires you to upload the content
 *   of your image file". For a hosted picture, Photoroom's URL-taking route is
 *   `GET /v2/edit`.
 * - None of the `pr-*` feature headers applies: every one of them is documented
 *   on an Image Editing page. `.request.headers` is empty.
 * - 200 is the image bytes. Errors are JSON, and the body is validated BEFORE
 *   the key: a keyless request with no image answers 400 `missing_image`, not
 *   401.
 * - Input: PNG, JPEG, WEBP or HEIC; "Maximum File Size: 50MB"; "Maximum
 *   Resolution: 6,000 pixels on the widest side". EXIF rotation is not applied
 *   — rotate before sending. Only the byte limit can be checked from a `Blob`.
 *
 * NOT here: the JSON body `{"image_file_b64": "<base64>"}`. The docs describe
 * it ("Base64 input is also accepted as JSON") and the server reads it, but it
 * is absent from the OpenAPI document, and whether `format`, `size` and the
 * rest may ride in the same JSON object is not documented anywhere — so there
 * is no body to type.
 */

import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type ValidatedForm } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { PHOTOROOM_OPENAPI_URL, PHOTOROOM_SEGMENT_MAX_BYTES, SEGMENT_URL } from "./constants";
import {
  PHOTOROOM_SEGMENT_FIELD_SCHEMAS,
  PHOTOROOM_SEGMENT_REQUIRED,
} from "./gen/image-edit-remove-background-schema.gen";
import type { PhotoroomSegmentFixedFields } from "./gen/image-edit-remove-background-wire.gen";
import { models } from "./models";
import { checkUnknownFields, fieldTableSchema, type FieldTable } from "./shared";

const FILE_SIZE_URL =
  "https://docs.photoroom.com/remove-background-api-basic-plan/file-size-resolution-and-format.md";
const MIGRATION_URL =
  "https://docs.photoroom.com/tutorials/how-to-migrate-from-remove.bg-api-before-it-shuts-down.md";

/** `POST /v1/segment` multipart form — mirror the wire exactly. snake_case, by design. */
export interface SegmentParams extends PhotoroomSegmentFixedFields {}

const SEGMENT_TABLE: FieldTable = {
  fields: PHOTOROOM_SEGMENT_FIELD_SCHEMAS,
  required: PHOTOROOM_SEGMENT_REQUIRED,
};

const schema = fieldTableSchema(SEGMENT_TABLE);

/** "Maximum File Size: 50MB". */
function checkFileSize(params: SegmentParams, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  const file = params.image_file;
  if (!(file instanceof Blob) || file.size <= PHOTOROOM_SEGMENT_MAX_BYTES) return;
  ctx.report({
    code: "media_too_large",
    path: ["image_file"],
    message:
      `\`image_file\` is ${file.size} bytes and POST /v1/segment takes at most ` +
      `${PHOTOROOM_SEGMENT_MAX_BYTES} (50 MB).`,
    meta: { source: FILE_SIZE_URL, limit: PHOTOROOM_SEGMENT_MAX_BYTES, actual: file.size },
  });
}

/**
 * The route is the remove.bg subset Photoroom lists, plus its own `despill`.
 * A warning, not an error: nothing documents what the server does with a field
 * it does not know.
 */
function describeUnknownField(key: string): string {
  return (
    `\`${key}\` is not a field POST /v1/segment documents. It takes \`image_file\`, \`format\`, ` +
    "`channels`, `bg_color`, `size`, `crop` and `despill` — \"The Remove Background API accepts " +
    "these arguments of Remove.bg: `image_file`, `format`, `channels`, `bg_color`, `size` and " +
    '`crop`", and the rest of remove.bg\'s arguments (`image_url`, `roi`, `scale`, `add_shadow`, …) ' +
    "are not carried over. It was passed through."
  );
}

function estimate(_params: SegmentParams, info: ModelInfo | undefined): ValidateEstimate {
  const perImage = info?.cost?.perImage;
  return perImage === undefined ? {} : { costUSD: perImage };
}

/** See `PhotoroomSdkTargets` in ./image-edit.ts — the same single self-named target. */
type PhotoroomSdkTargets<B> = { photoroom: () => B };

function finalize(params: SegmentParams): unknown {
  const body = { ...params };
  return toValidated(
    body,
    {
      url: SEGMENT_URL,
      method: "POST",
      // Deliberately empty: multipart endpoint — fetch must derive the
      // boundary from the FormData body. Add your own `x-api-key`.
      headers: {},
      body: "form",
    },
    { sdk: { photoroom: () => body } },
  );
}

const validator = createValidator<SegmentParams, unknown>({
  endpoint: "photoroom.imageEditRemoveBackground",
  schema,
  // No `model` wire field — the route is the model.
  modelId: () => "remove-background",
  catalog: models,
  checks: [
    checkUnknownFields(SEGMENT_TABLE, MIGRATION_URL, describeUnknownField),
    checkFileSize,
  ],
  estimate,
  finalize,
});

/**
 * Validates params for `POST https://sdk.photoroom.com/v1/segment` — $0.02 per
 * successful call on the self-serve plans (`PHOTOROOM_PRICING_CAVEAT`), a
 * fifth of what the same cut-out costs through `photoroom.imageEdit`.
 *
 * Multipart endpoint: send `.request.url` + `photoroom.toFormData(validated)`
 * as the body, never `JSON.stringify`, and add your own `x-api-key`. The
 * response is the image bytes.
 *
 * ```ts
 * const req = photoroom.imageEditRemoveBackground({ image_file, format: "webp", crop: "true" });
 * const res = await fetch(req.request.url, {
 *   method: req.request.method,
 *   headers: { "x-api-key": process.env.PHOTOROOM_API_KEY! },
 *   body: photoroom.toFormData(req),
 * });
 * ```
 */
export const imageEditRemoveBackground = validator as unknown as {
  <T extends SegmentParams>(
    params: T & ExactKeys<T, SegmentParams>,
    options?: ValidateOptions<T>,
  ): ValidatedForm<T, PhotoroomSdkTargets<T>>;
  safe<T extends SegmentParams>(
    params: T & ExactKeys<T, SegmentParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<ValidatedForm<T, PhotoroomSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
