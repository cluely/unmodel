/**
 * `higgsfield.characterTrain` — Soul ID: train a reusable character from
 * sample images. `POST https://api.higgsfield.ai/v1/custom-references`,
 * `Authorization: Key <KEY_ID>:<KEY_SECRET>`.
 *
 * ## Not a generation route
 *
 * "Soul ID trains a reusable character reference. This is not an
 * image-generation endpoint; do not POST to /soul-id."
 * (https://docs.higgsfield.ai/docs/models/soul-id/create-character.md). It
 * does not answer the request envelope: there is no `request_id`, no
 * `status_url` and no `images`. It answers a character (`CustomReference`:
 * `id`, `status`, …), which is polled at `customReferenceUrl(id)` until its
 * `status` is `completed` or `failed` (`HIGGSFIELD_CUSTOM_REFERENCE_STATUSES`).
 * A completed character's `id` is what `custom_reference_id` takes on the Soul
 * route of the matching `model_version`. `checkRequestStatus` does not apply.
 *
 * ## Why the address is `characterTrain`
 *
 * No other verb covers "create a reusable identity from sample images", and
 * `docs/decisions.md` §2 has a new category take a new verb, chosen the way
 * the others were: for what the caller does. `voiceClone` is the precedent —
 * a reusable identity made from samples. It is not `soulId` (a product name)
 * and not `customReferences` (the wire path).
 *
 * ## The one hand-typed Higgsfield body
 *
 * The console files this product under the slug `soul-id` with the input
 * schema `{"title":"Soul ID"}`, so only the docs page publishes its body and
 * the generator does not lower it (`data/higgsfield/curation.json`,
 * `handWritten`). `./character-train.test.ts` holds this module to the
 * committed snapshot of that page's schema.
 *
 * The schema declares no `additionalProperties`, so an undeclared key is sent
 * with a warning. There is no `hf_webhook`: Higgsfield documents it for
 * generation requests only. And there is no estimate: no surface states a
 * price for training.
 *
 * Over the training-concurrency limit the API answers `429` with a
 * `Retry-After` header, and "nothing is charged for the rejected request".
 *
 * ```ts
 * const params = higgsfield.characterTrain({
 *   name: "Mara",
 *   model_version: "v2",
 *   input_images: [{ type: "image_url", image_url: "https://example.com/mara-1.jpg" }],
 * });
 * ```
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { CHARACTER_TRAIN_ENDPOINT, characterTrainModels } from "./character-train-models";
import { CUSTOM_REFERENCES_URL, HIGGSFIELD_UPLOAD_HINT, HIGGSFIELD_UPLOAD_SOURCE } from "./urls";

/** Where the body is published. */
export const CHARACTER_TRAIN_SOURCE = "https://docs.higgsfield.ai/docs/models/soul-id/create-character.md";

/** `SoulModelVersion`: "Choose the matching generation family." */
export const SOUL_MODEL_VERSIONS = ["v1", "v2", "cinema"] as const;

/** `name`: `maxLength: 100`. */
const MAX_NAME_LENGTH = 100;
/** `input_images`: `minItems: 1`, `maxItems: 100`. */
const MAX_INPUT_IMAGES = 100;
/** `image_url`: `minLength: 1`, `maxLength: 2083`. */
const MAX_IMAGE_URL_LENGTH = 2083;

/** mirror `ImageUrlInputImageSchema` exactly — https://docs.higgsfield.ai/docs/models/soul-id/create-character.md. */
export interface ImageUrlInputImage {
  /** The constant `"image_url"`. */
  type: "image_url";
  /** A public URL of one sample image, 1–2083 characters. */
  image_url: string;
}

/** mirror `CreateCustomReferenceSchema` exactly — https://docs.higgsfield.ai/docs/models/soul-id/create-character.md. */
export interface CreateCustomReferenceBody {
  /** At most 100 characters. */
  name: string;
  /** 1–100 sample images. */
  input_images: ImageUrlInputImage[];
  /**
   * Which Soul family the character is for. Default: `"v1"`. A character is
   * usable on the generation routes of the family it was trained for.
   */
  model_version?: (typeof SOUL_MODEL_VERSIONS)[number];
}

/** Loose at both levels: neither published object declares `additionalProperties`. */
const characterTrainSchema = z.looseObject({
  name: z.string(),
  input_images: z
    .array(
      z.looseObject({
        type: z.literal("image_url"),
        image_url: z.string().min(1),
      }),
    )
    .min(1)
    .max(MAX_INPUT_IMAGES),
  model_version: z.enum(SOUL_MODEL_VERSIONS).optional(),
});

/**
 * `name` and `image_url` length caps, in code points as JSON Schema's
 * `maxLength` counts them: an emoji is one character, not two UTF-16 units.
 */
function checkLengths(params: CreateCustomReferenceBody, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  const name = [...params.name].length;
  if (name > MAX_NAME_LENGTH) {
    ctx.report({
      code: "invalid_shape",
      path: ["name"],
      model: CHARACTER_TRAIN_ENDPOINT,
      message: `\`name\` must be at most ${MAX_NAME_LENGTH} characters; got ${name}.`,
      meta: { maxLength: MAX_NAME_LENGTH, length: name, source: CHARACTER_TRAIN_SOURCE },
    });
  }
  params.input_images.forEach((image, index) => {
    const length = [...image.image_url].length;
    if (length <= MAX_IMAGE_URL_LENGTH) return;
    ctx.report({
      code: "invalid_shape",
      path: ["input_images", index, "image_url"],
      model: CHARACTER_TRAIN_ENDPOINT,
      message: `\`input_images[${index}].image_url\` must be at most ${MAX_IMAGE_URL_LENGTH} characters; got ${length}.`,
      meta: { maxLength: MAX_IMAGE_URL_LENGTH, length, source: CHARACTER_TRAIN_SOURCE },
    });
  });
}

/** `image_url` is `format: "uri"`: a string that is not a URL at all is refused, and a non-`http(s)` one reported. */
function checkImageUrls(params: CreateCustomReferenceBody, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  params.input_images.forEach((image, index) => {
    let scheme: string | undefined;
    try {
      scheme = new URL(image.image_url).protocol;
    } catch {
      scheme = undefined;
    }
    if (scheme === "https:" || scheme === "http:") return;
    ctx.report({
      code: "invalid_shape",
      ...(scheme !== undefined && { severity: "warning" as const }),
      path: ["input_images", index, "image_url"],
      model: CHARACTER_TRAIN_ENDPOINT,
      message:
        scheme === undefined
          ? `\`input_images[${index}].image_url\` must be a URL Higgsfield can fetch, and this is not a URL. ${HIGGSFIELD_UPLOAD_HINT}`
          : `\`input_images[${index}].image_url\` is a \`${scheme}\` URI. Higgsfield documents its inputs as public HTTPS URLs it fetches; ` +
            `the schema (\`format: "uri"\`) does not refuse this one, so it is sent as written. ${HIGGSFIELD_UPLOAD_HINT}`,
      meta: { hint: HIGGSFIELD_UPLOAD_SOURCE, source: CHARACTER_TRAIN_SOURCE },
    });
  });
}

/**
 * `.toSdk("higgsfield")` — the first argument of `createSoulId(data)` on
 * `@higgsfield/client`'s client, which posts it to `/v1/custom-references`
 * unchanged (`@higgsfield/client@0.2.6`, `dist/client.js`).
 */
type CharacterTrainSdkTargets<B> = { higgsfield: () => B };

function finalize(params: CreateCustomReferenceBody): unknown {
  const body = { ...params };
  return toValidated(body, { url: CUSTOM_REFERENCES_URL, method: "POST", headers: JSON_HEADERS }, { sdk: { higgsfield: () => body } });
}

const validator = createValidator<CreateCustomReferenceBody, unknown>({
  endpoint: "higgsfield.characterTrain",
  schema: characterTrainSchema,
  // Synthetic in one sense only: the body has no route parameter. The id is
  // the real path this address posts to.
  modelId: () => CHARACTER_TRAIN_ENDPOINT,
  catalog: characterTrainModels,
  checks: [checkLengths, checkImageUrls],
  finalize,
});

/**
 * Validates a Soul ID training body.
 *
 * The returned object's enumerable properties are the exact fetch JSON body.
 * The POST answers a `CustomReference`, not the request envelope. Add
 * `Authorization: Key <KEY_ID>:<KEY_SECRET>` yourself.
 */
export const characterTrain = validator as unknown as {
  <T extends CreateCustomReferenceBody>(
    params: T & ExactKeys<T, CreateCustomReferenceBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, CharacterTrainSdkTargets<T>>;
  safe<T extends CreateCustomReferenceBody>(
    params: T & ExactKeys<T, CreateCustomReferenceBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, CharacterTrainSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
