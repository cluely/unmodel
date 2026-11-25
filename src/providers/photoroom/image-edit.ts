/**
 * Photoroom's Image Editing API — `POST https://image-api.photoroom.com/v2/edit`.
 *
 * One route that does forty things: background removal, AI backgrounds,
 * shadows, relighting, text removal, expand, uncrop, upscale, beautify,
 * ironing, flat lay, ghost mannequin, virtual model, templating, and
 * prompt-driven editing ("Edit With AI"). "Edits can be combined in a single
 * call", and every call costs the same.
 *
 * Wire notes (OpenAPI https://image-api.photoroom.com/openapi and the docs at
 * https://docs.photoroom.com/, read 2026-11-24; research in
 * docs/research/photoroom-api-2026-11-24.md):
 *
 * - MULTIPART, and only multipart: "all parameters must be passed via the
 *   request body using multipart/form-data encoding. Parameters must not be
 *   passed using the query string." A JSON body is a 400. Send `.request.url` +
 *   `toFormData(validated)`.
 * - The form is FLAT. Structure is spelled in the field NAME, with dots:
 *   `background.blur.radius`, `virtualModel.model.preset.name`. So the params
 *   here are an object whose keys are those dotted names, quoted — nothing is
 *   nested, because nothing is nested on the wire.
 * - The field table is GENERATED (`./gen/image-edit-*.gen.ts`) from the
 *   committed OpenAPI snapshot. The document types the POST body with names
 *   and descriptions only; the enums, ranges and defaults are on the same
 *   names under `GET /v2/edit`, and the generator joins the two.
 * - Five request HEADERS select a model or a mode and are in no schema at all
 *   (`./constants.ts`). They are params here, under their own header names,
 *   and `finalize` moves them onto `.request.headers` — which therefore carries
 *   `pr-*` headers and nothing else. Never a `content-type`: `fetch` derives
 *   the multipart boundary.
 * - `removeBackground` defaults to **`true`**. Every whole-picture feature in
 *   the docs (upscale, relight, text removal, expand, ironing, Edit With AI)
 *   sends `removeBackground=false`, because the default returns a cutout of the
 *   result.
 * - An unknown field is NOT refused by the server today. It answers 200 and
 *   lists the field in the `pr-unsupported-attributes` response header, which
 *   is "[Temporary] … Soon to be replaced by a 400 Bad Request response." So an
 *   unknown key is a warning here, and it is the warning this validator exists
 *   for: the typo is billed and silently ignored.
 * - Nothing is `required` in the spec. The server needs a picture from
 *   somewhere — `imageFile`, a prompt to generate one from
 *   (`imageFromPrompt.prompt`) or a template (`templateId`) — and says so only
 *   in prose.
 * - 200 is the image bytes (`image/png`, or what `export.format` asks for).
 *   Errors are JSON, `{ error: { message } }` (`PhotoroomEditError`).
 * - Input: PNG, JPEG, WEBP or AVIF; "Maximum File Size: 30MB"; "Maximum
 *   Resolution: 5,000 pixels on the widest side", above which the image is
 *   "resized down". Only the byte limit can be checked from a `Blob`.
 *
 * ## The cross-field rules, and why most are warnings
 *
 * The spec's descriptions carry a dozen "can only be provided if" sentences.
 * One of them is demonstrably false: `referenceBox` "Can't be provided if
 * `removeBackground` is set to `false`", yet nine of Photoroom's own feature
 * pages send exactly that pair. A sentence of that class is therefore evidence
 * that a combination is pointless, not that it is refused — and a validator
 * that refuses a request the API fulfils has failed at the one thing it must
 * not. So a rule is an ERROR here only where a source says the request is
 * rejected (a stated 400, a stated mutual exclusion, a stated cap), and a
 * WARNING where the source says "can only", "requires" or "will fail or be
 * ignored". Each check below cites which.
 *
 * Deliberately NOT checked:
 * - `referenceBox` with `removeBackground: false` — the docs' own examples.
 * - Colour syntax on `background.color` / `outline.color`: the description says
 *   "hex color without the hash sign" and `background.color`'s own example is
 *   `#FF0000`.
 * - A numeric bound on `padding` / `margin`: the description says "between 0
 *   and 0.49", the positioning page says "strictly less than `0.5`", and the
 *   schema states neither. The real rule is per axis, server-side.
 * - JPEG export with a transparent background (a documented 400): detecting
 *   transparency needs the colour syntax above.
 * - Pixel limits (upscale's "maximum 1,000,000 input pixels", relight's
 *   3,500×3,500): not readable from a `Blob` without decoding it.
 * - `ironing.mode` without its header: what that does is undocumented.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type ValidatedForm } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import {
  EDIT_URL,
  PHOTOROOM_EDIT_MAX_BYTES,
  PHOTOROOM_EDIT_WITH_AI_MAX_ADDITIONAL_IMAGES,
  PHOTOROOM_OPENAPI_URL,
  PHOTOROOM_REQUEST_HEADERS,
  type PhotoroomRequestHeader,
  type PhotoroomRequestHeaders,
} from "./constants";
import { PHOTOROOM_EDIT_FAMILIES } from "./gen/image-edit-fields.gen";
import {
  PHOTOROOM_EDIT_FAMILY_SCHEMAS,
  PHOTOROOM_EDIT_FIELD_SCHEMAS,
} from "./gen/image-edit-schema.gen";
import type {
  PhotoroomEditFamilyFields,
  PhotoroomEditFixedFields,
} from "./gen/image-edit-wire.gen";
import type { PhotoroomFamilySpec } from "./field-types";
import { models } from "./models";
import { checkUnknownFields, familySlot, fieldTableSchema, type FieldTable } from "./shared";

const AGENT_PROMPT_URL =
  "https://docs.photoroom.com/getting-started/integrating-with-claude-code-codex-or-cursor.md";
const EDIT_WITH_AI_URL = "https://docs.photoroom.com/image-editing-api-plus-plan/edit-with-ai.md";
const FILE_SIZE_URL =
  "https://docs.photoroom.com/image-editing-api-plus-plan/file-size-resolution-and-format.md";

// ---------------------------------------------------------------------------
// Wire type
// ---------------------------------------------------------------------------

/**
 * `POST /v2/edit` multipart form — mirror the wire exactly. The keys ARE the
 * form field names, dots included, so a nested feature is written flat:
 *
 * ```ts
 * photoroom.imageEdit({
 *   imageFile,
 *   removeBackground: false,
 *   "editWithAI.mode": "ai.auto",
 *   "editWithAI.prompt": "make it winter",
 * });
 * ```
 *
 * The three open-keyed families (`editWithAI.additionalImages.<name>.…`,
 * `layers.<id>.…`, `virtualModel.additionalProductImages….…`) are typed as
 * template-literal keys, so a literal key is checked like any other. A key
 * built at run time cannot be written inside an object literal — TypeScript
 * widens a computed key to `string` — so assign it instead:
 *
 * ```ts
 * const params: EditParams = { imageFile, "editWithAI.mode": "ai.auto", "editWithAI.prompt": prompt };
 * for (const [name, blob] of references) {
 *   params[`editWithAI.additionalImages.${name}.imageFile`] = blob;
 * }
 * photoroom.imageEdit(params);
 * ```
 *
 * The five `pr-*` keys are request HEADERS, not form fields: the validated
 * result carries them on `.request.headers` and not on the body.
 *
 * ## Which JS values a field takes
 *
 * Every scalar is text once it is a form part, so `300` and `"300"` are the
 * same bytes, and Photoroom's sources write both spellings of each kind:
 *
 * - A boolean takes `true` and `"true"`: the OpenAPI document types
 *   `removeBackground` as a JSON boolean, and the docs say "Booleans are the
 *   strings `true`/`false`".
 * - A number takes `300` and `"300"`: the document types `maxWidth` as a
 *   number and gives `"200"` as its example (ten number-typed parameters carry
 *   a quoted example), and every docs cURL sends the text. A bound applies to
 *   the number the text spells — `"export.dpi": "50"` is refused like `50`.
 *
 * `padding` and `margin` take any string as well: the document itself types
 * them as a ratio or a `"30%"` / `"100px"` string.
 */
export interface EditParams
  extends PhotoroomEditFixedFields,
    PhotoroomEditFamilyFields,
    PhotoroomRequestHeaders {}

// ---------------------------------------------------------------------------
// Schema — the generated leaves, plus the five header params
// ---------------------------------------------------------------------------

const headerValue = z.string({ error: "must be a string" }).min(1, { error: "must not be empty" });

const EDIT_TABLE: FieldTable = {
  fields: {
    ...PHOTOROOM_EDIT_FIELD_SCHEMAS,
    ...Object.fromEntries(PHOTOROOM_REQUEST_HEADERS.map((name) => [name, headerValue])),
  },
  families: PHOTOROOM_EDIT_FAMILIES,
  familySchemas: PHOTOROOM_EDIT_FAMILY_SCHEMAS,
};

const schema = fieldTableSchema(EDIT_TABLE);

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** `false`, in either of the two spellings a form boolean has. */
function isFalse(value: unknown): boolean {
  return value === false || value === "false";
}

/** Whether a field was given a value that reaches the wire. */
function has(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/** The keys of `params` that reach the wire and satisfy `match`. */
function presentKeys(params: EditParams, match: (key: string) => boolean): string[] {
  return Object.entries(params)
    .filter(([key, value]) => has(value) && match(key))
    .map(([key]) => key);
}

/**
 * "If `background.prompt` is provided, neither `background.imageUrl` nor
 * `background.imageFile` can be provided, and vice versa." — stated on all
 * three fields. An error: a stated mutual exclusion.
 */
function checkBackgroundSource(params: EditParams, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  if (!has(params["background.prompt"])) return;
  const images = (["background.imageFile", "background.imageUrl"] as const).filter((field) =>
    has(params[field]),
  );
  if (images.length === 0) return;
  ctx.report({
    code: "unsupported_param",
    path: ["background.prompt"],
    message:
      `\`background.prompt\` and \`${images.join("` / `")}\` were both given, and Photoroom takes one ` +
      "background source: a prompt GENERATES the background, an image IS the background. To steer a " +
      "generated background with a picture, use `background.guidance.imageFile` instead — that one " +
      "combines with a prompt.",
    meta: { source: PHOTOROOM_OPENAPI_URL, conflicts: [...images] },
  });
}

/**
 * `background.scaling` "Can only be provided if `background.imageUrl` or
 * `background.imageFile` is provided". A warning: a "can only" sentence, with
 * no stated rejection.
 */
function checkBackgroundScaling(params: EditParams, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  if (!has(params["background.scaling"])) return;
  if (has(params["background.imageFile"]) || has(params["background.imageUrl"])) return;
  ctx.report({
    code: "unsupported_param",
    path: ["background.scaling"],
    severity: "warning",
    message:
      "`background.scaling` says how a background IMAGE fits the output, and this request has no " +
      "`background.imageFile` or `background.imageUrl`. The OpenAPI document says it \"Can only be " +
      "provided if\" one of them is; whether the server refuses or ignores it is not stated, so it " +
      "was passed through.",
    meta: { source: PHOTOROOM_OPENAPI_URL },
  });
}

/**
 * A background image needs a removed background to sit behind.
 *
 * `background.imageFile` / `background.imageUrl` are an ERROR: the spec says
 * "Can't be provided if `removeBackground` is set to `false`" and Photoroom's
 * agent prompt independently lists the combination as a 400 ("invalid
 * parameter or incompatible combination (e.g. … background.imageUrl with
 * removeBackground=false)").
 *
 * `background.guidance.*` is a WARNING: it rests on the "Can't be provided"
 * sentence alone, and that is the sentence the docs contradict for
 * `referenceBox`.
 */
function checkBackgroundNeedsRemoval(params: EditParams, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  if (!isFalse(params.removeBackground)) return;
  for (const field of ["background.imageFile", "background.imageUrl"] as const) {
    if (!has(params[field])) continue;
    ctx.report({
      code: "unsupported_param",
      path: [field],
      message:
        `\`${field}\` replaces the background, and \`removeBackground\` is \`false\` — the original ` +
        "background is being kept. Photoroom answers 400 to this pair. Drop `removeBackground` (it " +
        "defaults to `true`) or drop the background image.",
      meta: { source: AGENT_PROMPT_URL },
    });
  }
  for (const field of ["background.guidance.imageFile", "background.guidance.imageUrl"] as const) {
    if (!has(params[field])) continue;
    ctx.report({
      code: "unsupported_param",
      path: [field],
      severity: "warning",
      message:
        `\`${field}\` guides a GENERATED background, and \`removeBackground\` is \`false\` — the ` +
        "original background is being kept. The OpenAPI document says the field \"Can't be provided " +
        "if `removeBackground` is set to `false`\"; whether the server refuses or ignores it is not " +
        "stated, so it was passed through.",
      meta: { source: PHOTOROOM_OPENAPI_URL },
    });
  }
}

/** `1000x1000` — the one `outputSize` form that fixes both dimensions. */
const EXPLICIT_OUTPUT_SIZE = /^\d+x\d+$/;

/**
 * `maxWidth` / `maxHeight` "Can only be provided if `outputSize` is
 * `originalImage` or `croppedSubject`". Unset and `auto` are fine too — `auto`
 * "behave[s] like `originalImage` when templateId isn't defined", and the AI
 * Relight page sends `maxWidth=2000` with no `outputSize` at all. So only an
 * explicit `WxH` draws this, and as a warning: a "can only" sentence.
 */
function checkMaxDimensions(params: EditParams, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  const outputSize = params.outputSize;
  if (typeof outputSize !== "string" || !EXPLICIT_OUTPUT_SIZE.test(outputSize)) return;
  for (const field of ["maxWidth", "maxHeight"] as const) {
    if (!has(params[field])) continue;
    ctx.report({
      code: "unsupported_param",
      path: [field],
      severity: "warning",
      message:
        `\`${field}\` caps an output whose size follows the picture, and \`outputSize\` is the fixed ` +
        `\`${outputSize}\`. The OpenAPI document says it "Can only be provided if \`outputSize\` is ` +
        "`originalImage` or `croppedSubject`\"; whether the server refuses or ignores it is not " +
        "stated, so it was passed through.",
      meta: { source: PHOTOROOM_OPENAPI_URL },
    });
  }
}

const SHADOW_OVERRIDES = [
  "shadow.directionOverride",
  "shadow.intensityOverride",
  "shadow.softnessOverride",
  "shadow.spreadOverride",
  "shadow.subjectPoseOverride",
] as const;

/** `shadow.mode` values that exist only on the model the shadows header selects. */
const HEADER_ONLY_SHADOW_MODES: readonly string[] = [
  "ai.auto-with-overrides",
  "ai.preset-soft",
  "ai.preset-hard",
];
/** `shadow.mode` values the model the shadows header selects does not have. */
const LEGACY_SHADOW_MODES: readonly string[] = ["ai.soft", "ai.hard", "ai.floating"];

const SHADOWS_HEADER = "pr-ai-shadows-model-version";

/**
 * The shadow rules. All warnings, on Photoroom's own wording: "sending
 * shadow.*Override parameters without the shadows header, or ai.soft with the
 * header, will fail or be ignored."
 *
 * - every `shadow.*Override` "requires setting `shadow.mode` to
 *   `ai.auto-with-overrides`";
 * - `ai.auto-with-overrides`, `ai.preset-soft`, `ai.preset-hard` and the
 *   overrides are "Only compatible with the `2026-04-15` AI Shadows model",
 *   which the header selects;
 * - `ai.soft` / `ai.hard` are "Only compatible with legacy AI Shadows models"
 *   and `ai.floating` is "Not compatible with the `2026-04-15` AI Shadows
 *   model".
 *
 * This is the one check that reads a header param, which is why the headers
 * are params: it runs before `finalize` lifts them off the body.
 */
function checkShadows(params: EditParams, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  const mode = params["shadow.mode"];
  const header = params[SHADOWS_HEADER];
  const overrides = SHADOW_OVERRIDES.filter((field) => has(params[field]));

  if (mode !== "ai.auto-with-overrides") {
    for (const field of overrides) {
      ctx.report({
        code: "unsupported_param",
        path: [field],
        severity: "warning",
        message:
          `\`${field}\` adjusts the shadow that \`shadow.mode: "ai.auto-with-overrides"\` generates, ` +
          `and \`shadow.mode\` is ${!has(mode) ? "not set" : `"${mode}"`}. Photoroom says a ` +
          "mismatch here \"will fail or be ignored\"; it was passed through.",
        meta: { source: AGENT_PROMPT_URL },
      });
    }
  }

  if (!has(header)) {
    const needsHeader =
      typeof mode === "string" && HEADER_ONLY_SHADOW_MODES.includes(mode)
        ? "shadow.mode"
        : overrides[0];
    if (needsHeader !== undefined) {
      ctx.report({
        code: "unsupported_param",
        path: [needsHeader],
        severity: "warning",
        message:
          `\`${needsHeader}\`${needsHeader === "shadow.mode" ? ` "${String(mode)}"` : ""} belongs to ` +
          `the AI Shadows model that the request header \`${SHADOWS_HEADER}: 2026-04-15\` selects, ` +
          "and the header is not set — without it only `ai.soft`, `ai.hard` and `ai.floating` work. " +
          `Pass \`"${SHADOWS_HEADER}": "2026-04-15"\` as a param; it is sent as a header. Photoroom ` +
          "says a mismatch here \"will fail or be ignored\"; the request was passed through.",
        meta: { source: AGENT_PROMPT_URL },
      });
    }
    return;
  }

  if (typeof mode === "string" && LEGACY_SHADOW_MODES.includes(mode)) {
    ctx.report({
      code: "unsupported_param",
      path: ["shadow.mode"],
      severity: "warning",
      message:
        `\`shadow.mode: "${mode}"\` is a legacy AI Shadows mode, and \`${SHADOWS_HEADER}\` selects ` +
        "the new model, which has `ai.auto-with-overrides`, `ai.preset-soft` and `ai.preset-hard` " +
        "instead. Drop the header to keep the legacy mode, or switch the mode. Photoroom says a " +
        "mismatch here \"will fail or be ignored\"; it was passed through.",
      meta: { source: AGENT_PROMPT_URL },
    });
  }
}

const ADDITIONAL_IMAGE_FAMILIES = [
  PHOTOROOM_EDIT_FAMILIES["editWithAI.additionalImages.{key}.imageFile"],
  PHOTOROOM_EDIT_FAMILIES["editWithAI.additionalImages.{key}.imageUrl"],
] as const;

/**
 * Edit With AI.
 *
 * - `editWithAI.mode` and `editWithAI.prompt` are the documented switch, in
 *   every example together. Either alone is a WARNING, in both directions: no
 *   source says the server rejects it, and a prompt without the mode is most
 *   plausibly ignored — in which case the call succeeds, is billed, and returns
 *   the default operation (a cutout).
 * - "up to 5 total images per request, including the main input image … up to
 *   4 additional reference images". An error: a stated cap.
 * - each additional image "must contain exactly one of `imageFile` (for local
 *   file uploads) or `imageUrl` (for remote URLs)". An error: a stated shape.
 *
 * Entries are counted by their SLOT, normalised, so one image written
 * `[0].imageFile` and `.0.imageFile` is one image.
 */
function checkEditWithAI(params: EditParams, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  const mode = has(params["editWithAI.mode"]);
  const prompt = has(params["editWithAI.prompt"]);
  if (mode !== prompt) {
    const [present, missing] = mode
      ? (["editWithAI.mode", "editWithAI.prompt"] as const)
      : (["editWithAI.prompt", "editWithAI.mode"] as const);
    ctx.report({
      code: "invalid_shape",
      path: [missing],
      severity: "warning",
      message:
        `\`${present}\` was given without \`${missing}\`. Edit With AI is switched on by the pair — ` +
        '`"editWithAI.mode": "ai.auto"` and an `editWithAI.prompt` — in every example Photoroom ' +
        "publishes, and what one alone does is not documented. If it is ignored, the call still " +
        "succeeds and is billed, and returns the route's default operation instead of the edit.",
      meta: { source: EDIT_WITH_AI_URL },
    });
  }

  const sources = new Map<string, string[]>();
  for (const [key, value] of Object.entries(params)) {
    if (!has(value)) continue;
    for (const family of ADDITIONAL_IMAGE_FAMILIES) {
      const slot = familySlot(family, key);
      if (slot === undefined) continue;
      sources.set(slot, [...(sources.get(slot) ?? []), key]);
    }
  }

  for (const [slot, keys] of sources) {
    if (keys.length < 2) continue;
    ctx.report({
      code: "invalid_shape",
      path: [keys[1] as string],
      message:
        `The additional image "${slot}" was given ${keys.length} sources (\`${keys.join("`, `")}\`). ` +
        "Each reference image \"must contain exactly one of `imageFile` (for local file uploads) or " +
        "`imageUrl` (for remote URLs)\".",
      meta: { source: EDIT_WITH_AI_URL, keys },
    });
  }

  if (sources.size > PHOTOROOM_EDIT_WITH_AI_MAX_ADDITIONAL_IMAGES) {
    const first = [...sources.values()][PHOTOROOM_EDIT_WITH_AI_MAX_ADDITIONAL_IMAGES]?.[0];
    ctx.report({
      code: "invalid_shape",
      path: [first ?? "editWithAI.mode"],
      message:
        `${sources.size} additional images were given and Edit With AI takes at most ` +
        `${PHOTOROOM_EDIT_WITH_AI_MAX_ADDITIONAL_IMAGES}: "up to 5 total images per request, ` +
        'including the main input image".',
      meta: {
        source: EDIT_WITH_AI_URL,
        max: PHOTOROOM_EDIT_WITH_AI_MAX_ADDITIONAL_IMAGES,
        given: sources.size,
      },
    });
  }
}

/** `preserveMetadata` values the spec calls "EXIF-subset … modes". */
const EXIF_SUBSET_MODES: readonly string[] = ["exifSubset", "exifSubsetWithXmpCompatibility"];

/**
 * `colorSpace: "original"` is "Only valid when the request is a background
 * removal with PNG output … Combining `original` with any other operation
 * (background, shadow, other geometry changes, non-PNG export, `export.dpi`,
 * `keepExistingAlphaChannel: "auto"`, EXIF-subset `preserveMetadata` modes,
 * ...) returns a 400 error naming the conflicting parameter." An error: a
 * stated 400.
 *
 * Only the parameters the sentence NAMES are checked. `background.color:
 * "transparent"` is spared: it is the documented default, so sending it is not
 * "a background" — and so is an 8-digit hex that may be fully transparent
 * ({@link MAYBE_TRANSPARENT_HEX}). "other geometry changes" is not checked at
 * all — the same sentence allows `padding` and an explicit `outputSize`, and
 * does not say which of the remaining positioning fields count.
 */
function checkColorSpace(params: EditParams, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  if (params.colorSpace !== "original") return;
  const conflicts = presentKeys(params, (key) => {
    if (key === "background.color") return !isTransparentColor(params[key]);
    if (key.startsWith("background.") || key.startsWith("shadow.")) return true;
    if (key === "export.format") return params[key] !== "png";
    if (key === "export.dpi") return true;
    if (key === "keepExistingAlphaChannel") return params[key] === "auto";
    if (key === "preserveMetadata") return EXIF_SUBSET_MODES.includes(String(params[key]));
    return false;
  });
  for (const field of conflicts) {
    ctx.report({
      code: "unsupported_param",
      path: [field],
      message:
        `\`${field}\` cannot be combined with \`colorSpace: "original"\`, which is only valid for a ` +
        "plain background removal with PNG output (`padding`, `referenceBox` and an explicit " +
        "`outputSize` are allowed). Photoroom answers 400 naming the conflicting parameter. Drop " +
        '`colorSpace` — `"sRGB"` is the default — or drop this field.',
      meta: { source: PHOTOROOM_OPENAPI_URL },
    });
  }
}

/**
 * An 8-digit hex colour with `00` at either end, hash or no hash. The spec
 * documents the 8-digit form by one example (`FF0000EE`) and never says which
 * pair is the alpha, so a `00` at either end MAY be a fully transparent colour
 * — the same thing as the default — and an error must not rest on a guess
 * about which.
 */
const MAYBE_TRANSPARENT_HEX = /^#?(?:00[0-9a-f]{6}|[0-9a-f]{6}00)$/i;

/** Whether a `background.color` is, or may be, no background at all. */
function isTransparentColor(color: unknown): boolean {
  return color === "transparent" || (typeof color === "string" && MAYBE_TRANSPARENT_HEX.test(color));
}

/**
 * `beautify.onSubjectMismatch: "error"` — "the request is rejected with HTTP
 * 400 … for any other mode, because the check is not supported there." An
 * error: a stated 400 — but only when `beautify.mode` is set to something
 * other than `ai.food`. With no `beautify.mode` at all the beautifier is off
 * and nothing says the field is read, so that case is left alone.
 */
function checkBeautifySubject(params: EditParams, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  if (params["beautify.onSubjectMismatch"] !== "error") return;
  const mode = params["beautify.mode"];
  if (!has(mode) || mode === "ai.food") return;
  ctx.report({
    code: "unsupported_param",
    path: ["beautify.onSubjectMismatch"],
    message:
      `\`beautify.onSubjectMismatch: "error"\` asks Photoroom to check the subject, and that check ` +
      `exists only for \`beautify.mode: "ai.food"\` — with "${mode}" the request is rejected with ` +
      'HTTP 400 "because the check is not supported there". Use `"ignore"` (the default) or drop it.',
    meta: { source: PHOTOROOM_OPENAPI_URL, allowed: ["ai.food"] },
  });
}

/**
 * A request has to say WHAT picture, and the schema does not: nothing on this
 * route is `required`. The picture comes from `imageFile`, from a prompt
 * (`imageFromPrompt.prompt` — "Required unless imageFromPrompt.prompt is
 * used") or from a template (`templateId`).
 *
 * `imageUrl` counts as an input here even though it is not a POST field: it
 * draws its own unknown-field warning, and whether the server really rejects
 * it in a form has not been confirmed — an unconfirmed exclusion must not
 * become a hard refusal by way of this check.
 */
function checkInput(params: EditParams, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  const untyped = params as { imageUrl?: unknown };
  if (
    has(params.imageFile) ||
    has(params["imageFromPrompt.prompt"]) ||
    has(params.templateId) ||
    has(untyped.imageUrl)
  ) {
    return;
  }
  ctx.report({
    code: "invalid_shape",
    path: ["imageFile"],
    message:
      "A Photoroom edit needs a picture: pass `imageFile` (a Blob, sent as the multipart file part), " +
      "`imageFromPrompt.prompt` (Photoroom generates the picture) or `templateId` (a template " +
      "supplies it).",
    meta: { source: AGENT_PROMPT_URL },
  });
}

/** Every file field whose description states "The maximum size of the image is 30MB." */
const SIZED_FILE_FIELDS: readonly string[] = [
  "imageFile",
  "background.imageFile",
  "background.guidance.imageFile",
];
/** The one family whose file field states it: `layers.<id>.image.imageFile`. */
const SIZED_FILE_FAMILY: PhotoroomFamilySpec = PHOTOROOM_EDIT_FAMILIES["layers.{key}.image.imageFile"];

/** "Maximum File Size: 30MB" — the one input limit a `Blob` can be checked against. */
function checkFileSize(params: EditParams, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  for (const [field, file] of Object.entries(params)) {
    if (!SIZED_FILE_FIELDS.includes(field) && familySlot(SIZED_FILE_FAMILY, field) === undefined) continue;
    if (!(file instanceof Blob) || file.size <= PHOTOROOM_EDIT_MAX_BYTES) continue;
    ctx.report({
      code: "media_too_large",
      path: [field],
      message:
        `\`${field}\` is ${file.size} bytes and POST /v2/edit takes at most ` +
        `${PHOTOROOM_EDIT_MAX_BYTES} (30 MB) per image.`,
      meta: { source: FILE_SIZE_URL, limit: PHOTOROOM_EDIT_MAX_BYTES, actual: file.size },
    });
  }
}

/**
 * A family the spec caps with `maxItems` (`virtualModel.additionalProductImages`,
 * "maxItems": 4) fills one array: every member field — `imageFile`, `imageUrl` —
 * names an entry by its slot, and the distinct slots are the entries sent.
 * `[0]` and `.0` count once, so the count never exceeds what the server reads.
 */
function checkFamilyCaps(params: EditParams, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  const families: readonly PhotoroomFamilySpec[] = Object.values(PHOTOROOM_EDIT_FAMILIES);
  const arrays = new Map<string, { max: number; slots: Set<string>; last: string }>();
  for (const [key, value] of Object.entries(params)) {
    if (!has(value)) continue;
    for (const family of families) {
      if (family.maxItems === undefined) continue;
      const slot = familySlot(family, key);
      if (slot === undefined) continue;
      const entry = arrays.get(family.prefix) ?? { max: family.maxItems, slots: new Set<string>(), last: key };
      entry.slots.add(slot);
      entry.last = key;
      arrays.set(family.prefix, entry);
    }
  }
  for (const [prefix, { max, slots, last }] of arrays) {
    if (slots.size <= max) continue;
    ctx.report({
      code: "invalid_shape",
      path: [last],
      message: `\`${prefix}\` takes at most ${max} entries on POST /v2/edit; the request sends ${slots.size}.`,
      meta: { source: PHOTOROOM_OPENAPI_URL, maxItems: max, count: slots.size },
    });
  }
}

function describeUnknownField(key: string): string {
  if (key === "imageUrl") {
    return (
      "`imageUrl` is the GET endpoint's field, not a POST form field: \"The POST endpoint accepts " +
      "`imageFile` only. … If you want to send the URL of an image, please instead use the GET " +
      "endpoint with the argument `imageUrl`.\" Whether POST reads it anyway has not been " +
      "confirmed, so it was passed through; to be sure, fetch the picture and pass it as `imageFile`."
    );
  }
  return (
    `\`${key}\` is not a field POST /v2/edit documents. Photoroom does not refuse an unknown field ` +
    "today — the request succeeds, is billed, and the field is listed in the " +
    "`pr-unsupported-attributes` response header (\"[Temporary] … Soon to be replaced by a 400 Bad " +
    'Request response"). It was passed through.'
  );
}

// ---------------------------------------------------------------------------
// Estimation + finalize
// ---------------------------------------------------------------------------

/** `virtualModel.quality` values with no published price — see `./models.ts`. */
const UNPRICED_QUALITIES: readonly string[] = ["advanced", "premium"];

/**
 * The flat per-call rate — except for `virtualModel.quality` above `standard`,
 * where it returns nothing. Those are 2K and 4K outputs, "available for
 * Enterprise plans", and no source prices them; quoting the 1K rate for a 4K
 * image would be a guess (`PHOTOROOM_PRICING_CAVEAT`).
 */
function estimate(params: EditParams, info: ModelInfo | undefined): ValidateEstimate {
  const quality = params["virtualModel.quality"];
  if (typeof quality === "string" && UNPRICED_QUALITIES.includes(quality)) return {};
  const perImage = info?.cost?.perImage;
  return perImage === undefined ? {} : { costUSD: perImage };
}

/**
 * The one `.toSdk("photoroom")` target — Photoroom ships no SDK ("no SDK is
 * required"), so this is the multipart source. It must stay an object type with
 * no index signature, or `toSdk` would accept any string.
 */
type PhotoroomSdkTargets<B> = { photoroom: () => B };

function finalize(params: EditParams): unknown {
  const body: Record<string, unknown> = {};
  const headers: Record<string, string> = {};
  const headerNames: readonly string[] = PHOTOROOM_REQUEST_HEADERS;
  for (const [key, value] of Object.entries(params)) {
    if (headerNames.includes(key)) {
      if (has(value)) headers[key] = String(value);
    } else {
      body[key] = value;
    }
  }
  return toValidated(
    body,
    {
      url: EDIT_URL,
      method: "POST",
      // The `pr-*` feature headers and nothing else. No `content-type`: this
      // is a multipart endpoint and fetch must derive the boundary. Add your
      // own `x-api-key`.
      headers,
      body: "form",
    },
    { sdk: { photoroom: () => body } },
  );
}

const validator = createValidator<EditParams, unknown>({
  endpoint: "photoroom.imageEdit",
  schema,
  // No `model` wire field. The catalog row is the documented MODE the request
  // switches on — see the header of ./models.ts for why this route has two.
  modelId: (params) => (has(params["editWithAI.mode"]) ? "edit-with-ai" : "image-editing"),
  catalog: models,
  checks: [
    checkUnknownFields(EDIT_TABLE, PHOTOROOM_OPENAPI_URL, describeUnknownField),
    checkInput,
    checkFileSize,
    checkFamilyCaps,
    checkBackgroundSource,
    checkBackgroundScaling,
    checkBackgroundNeedsRemoval,
    checkMaxDimensions,
    checkShadows,
    checkEditWithAI,
    checkColorSpace,
    checkBeautifySubject,
  ],
  estimate,
  finalize,
});

/** The validated body: the params without the five keys that became headers. */
type EditBody<T> = Omit<T, PhotoroomRequestHeader>;

/** The form's fields alone — `EditParams` without the five header params. */
export interface EditFields extends PhotoroomEditFixedFields, PhotoroomEditFamilyFields {}

/**
 * What `imageEdit` returns for a request typed as the whole form:
 * `ReturnType<typeof imageEdit>`, over an interface instead of an `Omit` of
 * more than a hundred keys. The same type, named for the callers that have to
 * state it — the unified adapter beside this module is one — and cheaper for
 * the compiler to carry than the mapped spelling.
 */
export type EditValidated = ValidatedForm<EditFields, PhotoroomSdkTargets<EditFields>>;

/**
 * Validates params for `POST https://image-api.photoroom.com/v2/edit` — $0.10
 * per successful call on the self-serve plans, whatever the call combines
 * (`PHOTOROOM_PRICING_CAVEAT`).
 *
 * Multipart endpoint: send `.request.url` + `photoroom.toFormData(validated)`
 * as the body, never `JSON.stringify`. The five `pr-*` params come back on
 * `.request.headers`, not on the body; add your own `x-api-key`. The response
 * is the image bytes.
 *
 * ```ts
 * const req = photoroom.imageEdit({
 *   imageFile,
 *   "background.color": "FFFFFF",
 *   padding: 0.15,
 *   "shadow.mode": "ai.auto-with-overrides",
 *   "pr-ai-shadows-model-version": "2026-04-15",
 * });
 * const res = await fetch(req.request.url, {
 *   method: req.request.method,
 *   headers: { ...req.request.headers, "x-api-key": process.env.PHOTOROOM_API_KEY! },
 *   body: photoroom.toFormData(req),
 * });
 * const image = await res.blob();
 * ```
 */
export const imageEdit = validator as unknown as {
  <T extends EditParams>(
    params: T & ExactKeys<T, EditParams>,
    options?: ValidateOptions<T>,
  ): ValidatedForm<EditBody<T>, PhotoroomSdkTargets<EditBody<T>>>;
  safe<T extends EditParams>(
    params: T & ExactKeys<T, EditParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<ValidatedForm<EditBody<T>, PhotoroomSdkTargets<EditBody<T>>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
