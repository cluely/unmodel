/**
 * ElevenLabs Dubbing — POST https://api.elevenlabs.io/v1/dubbing/project
 *
 * Wire notes (verified against `https://api.elevenlabs.io/openapi.json`
 * — `dubbing_project_create` — the reference page at
 * https://elevenlabs.io/docs/api-reference/dubbing/project/create, the
 * capabilities page at
 * https://elevenlabs.io/docs/overview/capabilities/dubbing, and
 * `@elevenlabs/elevenlabs-js@2.65.0`, on 2026-08-26):
 *
 * ## The reference you found is probably the wrong one
 *
 * `elevenlabs.io/docs/api-reference/dubbing/create` **308-redirects** to
 * `/docs/api-reference/legacy/dubbing/create`, and legacy `POST /v1/dubbing`
 * has **no `model_id` field at all** — "Dubbing v2" is unreachable from it.
 * `dubbing_v1` / `dubbing_v2` exist only as the `model_id` enum of THIS route.
 * unmodel serves the project surface and deliberately not the legacy one: two
 * addresses for one verb, where one of them cannot reach the current model.
 *
 * ## This is multipart, and the file is OPTIONAL
 *
 * `Content-Type: multipart/form-data`, with two `format: binary` parts (`file`
 * and `transcript`). The validated output's enumerable props are the validated
 * params (including the Blobs) — do NOT JSON.stringify them. The raw-fetch
 * path is `.request.url` + {@link dubToFormData} as the body; fetch derives the
 * multipart content-type (with boundary) from the FormData, which is why
 * `.request.headers` is empty.
 *
 * Unlike every other `body: "form"` endpoint in the tree, the Blob is not
 * required: `source_url` is the documented alternative ("Provide this or
 * file"), so this validator is CLI-reachable and lives in `REGISTRY` rather
 * than `MULTIPART_ONLY` — the `ideogram.image` precedent.
 *
 * ## The flow, and the trap in it
 *
 * One multipart POST here creates a PROJECT (transcription), then N JSON POSTs
 * to `POST /v1/dubbing/project/{project_id}/language` order the actual dubs —
 * `./dubbing-language.ts`, `elevenlabs.dubLanguage`. Polling is two-level:
 * project `queued|preparing|processing|ready|failed`, then per target
 * `queued|processing|completed|stale|failed`. A target can be `completed` AND
 * `stale`: compare `output_revision` against `revision` to know whether the
 * signed URL you hold is current. `webhook_ids` (at most 3) is the documented
 * alternative to polling both levels. unmodel validates the two POSTs and
 * nothing else — polling and downloads stay with your transport code.
 *
 * ## The only v2 output is an AUDIO track
 *
 * `DubbingLanguageOutputs` has exactly one field, `lossless_audio`: "Signed URL
 * of the dubbed lossless audio track." A dubbed VIDEO comes only from the
 * legacy `GET /v1/dubbing/{dubbing_id}/audio/{language_code}` route or from the
 * Studio render route, neither of which this surface reaches.
 *
 * ## A stale sentence in ElevenLabs' own docs
 *
 * `model_id`'s description says the model is a default "for the project's
 * language targets; **a target may override it**". That is not reachable: the
 * language-target create body has no `model_id` in the OpenAPI or in SDK
 * 2.65.0, and the 2026-08-10 changelog records that SDK v2.62.0 stopped
 * accepting `model_id`/`modelId` there. Per the wire-typing policy the SDK and
 * the changelog resolve the ambiguity: `model_id` is project-level only.
 *
 * ## Auth and hosts
 *
 * `xi-api-key` header — unmodel never touches keys; add it yourself. Five
 * residency hosts exist (`api.us`, `api.eu.residency`, `api.in.residency`,
 * `api.sg.residency` alongside the default `api.elevenlabs.io`); swap the
 * origin yourself, the same as the two realtime modules already say.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type ValidatedForm } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models, DUBBING_MODEL_IDS, type ElevenlabsDubbingModelId } from "./models";
import {
  checkKeytermRules,
  KEYTERMS_MAX,
  KEYTERM_DISALLOWED_CHARACTERS,
} from "./keyterms";
import {
  DUBBING_TARGET_LANGUAGES,
  DUBBING_V1_LANGUAGES,
  DUBBING_V2_DIALECTS,
  DUBBING_V2_LANGUAGES,
  type ElevenlabsDubbingLanguage,
} from "./dubbing-languages";

export const DUBBING_PROJECT_URL = "https://api.elevenlabs.io/v1/dubbing/project";

const DUBBING_DOCS_URL = "https://elevenlabs.io/docs/api-reference/dubbing/project/create";
const DUBBING_LANGUAGES_DOCS_URL = "https://elevenlabs.io/docs/overview/capabilities/dubbing";

/** "Optional free-form string (max 500 characters) to identify the project on your end." */
export const DUBBING_REFERENCE_MAX_CHARACTERS = 500;
/** "At most 3; each must be a webhook configured in your workspace." */
export const DUBBING_WEBHOOK_IDS_MAX = 3;

// ---------------------------------------------------------------------------
// Wire types — mirror the multipart form fields exactly (snake_case).
// ---------------------------------------------------------------------------

export interface DubbingProjectParams {
  /** "The source media file to dub. Provide this or source_url." */
  file?: Blob;
  /** "Public URL to fetch the source media from. Provide this or file." */
  source_url?: string | null;
  /** "Optional free-form string (max 500 characters) to identify the project on your end." */
  reference?: string | null;
  /**
   * "BCP-47 language tag of the source media; must be a language the
   * transcription model supports. Any region or script subtag is ignored,
   * since transcription is per-language. Omit to auto-detect."
   *
   * Required when `transcript` is provided.
   */
  source_language?: string | null;
  /**
   * "Default dubbing model id ('dubbing_v1' or 'dubbing_v2') for the project's
   * language targets… Omit to use the system default."
   *
   * The system default is not documented, so omitting this degrades rather
   * than resolving to an invented id: no catalog row, no cost estimate, and
   * `target_language` is checked against the union of both models' tables.
   */
  model_id?: ElevenlabsDubbingModelId | (string & {}) | null;
  /**
   * "Key terms to bias transcription/translation toward (e.g. product or brand
   * names). At most 1000 terms; each term at most 50 characters and 5 words;
   * the characters `<>{}[]\` are not allowed."
   */
  keyterms?: string[];
  /**
   * "Ids of workspace webhooks to notify when this project becomes ready or
   * fails, and when any of its languages completes or fails. At most 3."
   */
  webhook_ids?: string[];
  /**
   * "Optional shortcut: also create a language target in this BCP-47 language,
   * queued to start once the project is ready." Narrowed per `model_id` —
   * Dubbing v1 has no dialects.
   */
  target_language?: ElevenlabsDubbingLanguage | (string & {}) | null;
  /**
   * "Enterprise only. Optional JSON transcript to use instead of automatic
   * transcription. When provided, source_language is required." A `format:
   * binary` part, so a Blob — not an object.
   */
  transcript?: Blob;
}

// ---------------------------------------------------------------------------
// SDK view — @elevenlabs/elevenlabs-js's client.dubbing.project.create(request)
// (x-fern-sdk-group-name ["dubbing", "project"], method "create") takes the
// same fields camelCased.
// ---------------------------------------------------------------------------

export interface DubbingProjectSdkParams {
  file?: Blob;
  sourceUrl?: string;
  reference?: string;
  sourceLanguage?: string;
  modelId?: string;
  keyterms?: string[];
  webhookIds?: string[];
  targetLanguage?: string;
  transcript?: Blob;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const dubbingSchema = z.looseObject({
  file: z.instanceof(Blob).optional(),
  source_url: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
  source_language: z.string().nullable().optional(),
  model_id: z.string().nullable().optional(),
  keyterms: z
    .array(z.string())
    .max(KEYTERMS_MAX, `at most ${KEYTERMS_MAX} keyterms are allowed`)
    .optional(),
  webhook_ids: z
    .array(z.string())
    .max(DUBBING_WEBHOOK_IDS_MAX, `at most ${DUBBING_WEBHOOK_IDS_MAX} webhook ids are allowed`)
    .optional(),
  target_language: z.string().nullable().optional(),
  transcript: z.instanceof(Blob).optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * "Provide this or file" / "Provide this or source_url" — the OpenAPI leaves
 * both individually optional (each is `anyOf[…, null]`), so the requirement is
 * only expressible here. Both together is not a documented combination.
 */
function checkSource(
  params: DubbingProjectParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const hasFile = params.file != null;
  const hasUrl = params.source_url != null && params.source_url !== "";
  if (hasFile && hasUrl) {
    ctx.report({
      code: "invalid_shape",
      path: ["source_url"],
      message:
        "`file` and `source_url` are alternatives — \"Provide this or file\" — and sending both leaves it to ElevenLabs which one it reads.",
      meta: { provided: ["file", "source_url"], source: DUBBING_DOCS_URL },
    });
    return;
  }
  if (hasFile || hasUrl) return;
  ctx.report({
    code: "invalid_shape",
    message: "a dubbing project needs its source media: provide either `file` (a Blob) or `source_url`.",
    meta: { provided: [], source: DUBBING_DOCS_URL },
  });
}

/** "When provided, source_language is required." */
function checkTranscriptPairing(
  params: DubbingProjectParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.transcript == null) return;
  if (params.source_language != null && params.source_language !== "") return;
  ctx.report({
    code: "invalid_shape",
    path: ["source_language"],
    message:
      "`transcript` replaces automatic transcription, and ElevenLabs cannot infer the language of a transcript it did not make: `source_language` is required when `transcript` is provided.",
    meta: { source: DUBBING_DOCS_URL },
  });
}

/** "max 500 characters" — a cap the string schema deliberately leaves to the check battery. */
function checkReference(
  params: DubbingProjectParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const reference = params.reference;
  if (typeof reference !== "string" || reference.length <= DUBBING_REFERENCE_MAX_CHARACTERS) return;
  ctx.report({
    code: "invalid_shape",
    path: ["reference"],
    message: `\`reference\` is ${reference.length} characters; ElevenLabs caps it at ${DUBBING_REFERENCE_MAX_CHARACTERS}.`,
    meta: {
      limit: DUBBING_REFERENCE_MAX_CHARACTERS,
      actual: reference.length,
      source: DUBBING_DOCS_URL,
    },
  });
}

function checkKeyterms(
  params: DubbingProjectParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  checkKeytermRules(params.keyterms, ctx, {
    source: DUBBING_DOCS_URL,
    disallowedCharacters: KEYTERM_DISALLOWED_CHARACTERS,
  });
}

const DUBBING_MODEL_ID_SET = new Set<string>(DUBBING_MODEL_IDS);

/**
 * The catalog carries every ElevenLabs model id, and a tts/stt/music id
 * resolves in it — so without this gate `model_id: "eleven_v3"` would pass
 * unremarked on a dubbing request. Ids unknown to the catalog stay a warning
 * from the pipeline's own `unknown_model` check.
 */
function checkDubbingModelKind(
  params: DubbingProjectParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model_id;
  if (info === undefined || model == null || DUBBING_MODEL_ID_SET.has(model)) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model_id"],
    model,
    message: `"${model}" is not a dubbing model; POST /v1/dubbing/project accepts ${DUBBING_MODEL_IDS.map((id) => `"${id}"`).join(", ")}.`,
    meta: { allowed: [...DUBBING_MODEL_IDS], source: DUBBING_DOCS_URL },
  });
}

const V2_LANGUAGE_SET = new Set<string>(DUBBING_V2_LANGUAGES);
const V1_LANGUAGE_SET = new Set<string>(DUBBING_V1_LANGUAGES);
const DIALECT_SET = new Set<string>(DUBBING_V2_DIALECTS);

/**
 * Validates one `target_language` tag against the model's published table.
 * Shared with `./dubbing-language.ts`, which asks the same question about the
 * same field on the JSON route.
 *
 * Three outcomes, and the middle one is the reason this is worth typing:
 * - unknown to both tables → `invalid_enum_value`, naming the count;
 * - a v2 dialect on `dubbing_v1` → `invalid_enum_value` naming the BASE tag as
 *   the fix, because "Dubbing v1 does not support dialects";
 * - `model_id` omitted (the undocumented system default) → checked against the
 *   union only, since which table applies is not knowable from the request.
 */
export function checkDubbingTargetLanguage(
  tag: unknown,
  modelId: string | null | undefined,
  ctx: PipelineContext,
  path: readonly (string | number)[],
): void {
  if (typeof tag !== "string" || tag === "") return;
  const table = modelId == null ? undefined : DUBBING_TARGET_LANGUAGES[modelId];
  if (table === undefined) {
    // Either no model was named, or it is not a dubbing id (the model-kind
    // check has already said so). Fall back to the union: refuse only tags
    // neither model has ever accepted.
    if (V2_LANGUAGE_SET.has(tag) || V1_LANGUAGE_SET.has(tag)) return;
    ctx.report({
      code: "invalid_enum_value",
      path: [...path],
      message: `"${tag}" is not a language ElevenLabs Dubbing supports; neither the Dubbing v2 table (${DUBBING_V2_LANGUAGES.length} tags) nor the Dubbing v1 table (${DUBBING_V1_LANGUAGES.length} tags) carries it.`,
      meta: { value: tag, source: DUBBING_LANGUAGES_DOCS_URL },
    });
    return;
  }
  if (table.includes(tag)) return;
  if (modelId === "dubbing_v1" && DIALECT_SET.has(tag)) {
    const base = tag.split("-")[0] ?? tag;
    ctx.report({
      code: "invalid_enum_value",
      path: [...path],
      message: `"${tag}" is a Dubbing v2 dialect; Dubbing v1 does not support dialects — use the base tag "${base}".`,
      meta: { value: tag, suggestion: base, source: DUBBING_LANGUAGES_DOCS_URL },
    });
    return;
  }
  ctx.report({
    code: "invalid_enum_value",
    path: [...path],
    message: `"${tag}" is not one of the ${table.length} languages ${modelId} dubs into.`,
    meta: { value: tag, model: modelId, source: DUBBING_LANGUAGES_DOCS_URL },
  });
}

function checkTargetLanguage(
  params: DubbingProjectParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  checkDubbingTargetLanguage(params.target_language, params.model_id, ctx, ["target_language"]);
}

// No estimate. The body carries a Blob or a URL and never a duration, and the
// rate is per minute of source media per language target — so a request-time
// number would be a guess. The duration arrives later, as `media.duration_s`
// on the project GET, which is where `checkDubbingProject` prices it.

// ---------------------------------------------------------------------------
// FormData helper + finalize
// ---------------------------------------------------------------------------

/** Array fields appended item-by-item under the same key (the STT precedent). */
const REPEATED_FIELDS = new Set<string>(["keyterms", "webhook_ids"]);

/**
 * Builds the multipart/form-data body for `POST /v1/dubbing/project` from
 * validated params. `file` and `transcript` are binary parts; `keyterms` and
 * `webhook_ids` are appended item-by-item; everything else is stringified.
 * Null/undefined fields are omitted.
 *
 * ```ts
 * const project = elevenlabs.dub({ source_url: "https://example.com/promo.mp4", model_id: "dubbing_v2" });
 * await fetch(project.request.url, {
 *   method: "POST",
 *   headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
 *   body: elevenlabs.dubToFormData(project),
 * });
 * ```
 */
export function dubToFormData(params: DubbingProjectParams): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (value instanceof Blob) {
      form.append(key, value);
      continue;
    }
    if (Array.isArray(value)) {
      if (REPEATED_FIELDS.has(key)) {
        for (const item of value) {
          form.append(key, typeof item === "string" ? item : JSON.stringify(item));
        }
      } else {
        form.append(key, JSON.stringify(value));
      }
      continue;
    }
    form.append(key, String(value));
  }
  return form;
}

/** Wire snake_case → SDK camelCase. */
const SDK_KEY_MAP: Record<string, string> = {
  file: "file",
  source_url: "sourceUrl",
  reference: "reference",
  source_language: "sourceLanguage",
  model_id: "modelId",
  keyterms: "keyterms",
  webhook_ids: "webhookIds",
  target_language: "targetLanguage",
  transcript: "transcript",
};

function buildSdkParams(params: DubbingProjectParams): DubbingProjectSdkParams {
  const sdk: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue; // null → omitted for the SDK
    sdk[SDK_KEY_MAP[key] ?? key] = value; // unknown params pass through unchanged
  }
  return sdk as unknown as DubbingProjectSdkParams;
}

/**
 * SDK targets for `elevenlabs.dub`. `"elevenlabs"` camelCases the wire fields
 * into the request object `@elevenlabs/elevenlabs-js`'s
 * `client.dubbing.project.create(request)` takes. Type alias, not interface: an
 * interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type DubbingSdkTargets = { elevenlabs: () => DubbingProjectSdkParams };

function finalize(params: DubbingProjectParams): unknown {
  return toValidated(
    params,
    {
      url: DUBBING_PROJECT_URL,
      method: "POST",
      // Deliberately NOT application/json: this is a multipart endpoint, and
      // fetch must derive the multipart boundary from the FormData body itself.
      headers: {},
      body: "form",
    },
    { sdk: { elevenlabs: () => buildSdkParams(params) } },
  );
}

const validator = createValidator<DubbingProjectParams, unknown>({
  endpoint: "elevenlabs.dub",
  schema: dubbingSchema,
  // Degrades on omission: the system default is undocumented, so there is no
  // honest id to substitute. No model → no catalog row, no cost, and the
  // language table falls back to the union of both.
  modelId: (params) => params.model_id ?? undefined,
  catalog: models,
  checks: [
    checkSource,
    checkTranscriptPairing,
    checkReference,
    checkKeyterms,
    checkDubbingModelKind,
    checkTargetLanguage,
  ],
  finalize,
});

/**
 * Validates params for ElevenLabs `POST /v1/dubbing/project` — the project
 * half of Dubbing v2 (the language targets that order the actual dubs are
 * `elevenlabs.dubLanguage`).
 *
 * This is a multipart endpoint: the validated output's enumerable props are
 * the validated params (including the `file`/`transcript` Blobs), and the
 * raw-fetch path is `.request.url` + `dubToFormData(validated)` as the body —
 * never `JSON.stringify`. `.toSdk("elevenlabs")` returns the camelCase request
 * object for `client.dubbing.project.create(request)`.
 *
 * The response is `{ project_id, status, model_id, language_ids, revision, … }`
 * — poll `GET /v1/dubbing/project/{project_id}` until `status` is `"ready"`,
 * then create language targets. `checkDubbingProject` reads that response back.
 */
export const dub = validator as unknown as {
  <T extends DubbingProjectParams>(
    params: T & ExactKeys<T, DubbingProjectParams>,
    options?: ValidateOptions<T>,
  ): ValidatedForm<T, DubbingSdkTargets>;
  safe<T extends DubbingProjectParams>(
    params: T & ExactKeys<T, DubbingProjectParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<ValidatedForm<T, DubbingSdkTargets>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
