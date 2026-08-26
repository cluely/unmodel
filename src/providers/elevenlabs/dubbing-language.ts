/**
 * ElevenLabs Dubbing language targets —
 * POST https://api.elevenlabs.io/v1/dubbing/project/{project_id}/language
 *
 * Wire notes (verified against `https://api.elevenlabs.io/openapi.json`
 * — `dubbing_language_create` — https://elevenlabs.io/docs/api-reference/dubbing/project/language/create
 * and `@elevenlabs/elevenlabs-js@2.65.0`, on 2026-08-26):
 *
 * ## This is the call that spends the money
 *
 * `elevenlabs.dub` creates a project — one transcription of one source. THIS
 * route orders a dub, once per language, and the rate is per minute of source
 * media per target. Three languages of a ten-minute video on `dubbing_v2` is
 * 3 × 10 × $2.20.
 *
 * Unlike the project route this one is **JSON**, not multipart: `{
 * target_language, voice_settings?, translations? }`. So "Dubbing is a
 * multipart submit" is only half true — the flow is one multipart POST plus N
 * JSON POSTs.
 *
 * ## `project_id` is a path segment, not a body field
 *
 * It rides in as a pseudo-param and is stripped in `finalize`, interpolated
 * into `.request.url` — the same device `elevenlabs.tts` uses for `voice_id`
 * and `fal.video` for `endpoint`. The validated result carries no `project_id`
 * key, because the body does not.
 *
 * ## There is no `model_id` here, whatever the other page says
 *
 * The project-create reference describes `model_id` as a default "for the
 * project's language targets; a target may override it". **That sentence is
 * stale.** This body has no `model_id` in the OpenAPI or in SDK 2.65.0, and
 * the 2026-08-10 changelog records Python/JS SDK v2.62.0 dropping
 * `model_id`/`modelId` from language-target creation. Per the wire-typing
 * policy the SDK and the changelog resolve the contradiction, so unmodel types
 * the field as absent rather than guessing that the prose is right.
 *
 * A consequence worth knowing: the effective model is the PROJECT's, which
 * this request cannot see. `target_language` is therefore checked against the
 * union of both models' tables here — the per-model narrowing (and the
 * v1-has-no-dialects refusal) happens on `elevenlabs.dub`, where `model_id` is
 * in hand.
 *
 * ## The response, and the third status axis
 *
 * `{ language_id, project_id, target_language, status, model_id, revision,
 * output_revision, outputs, error, warnings, … }`. `status` is
 * `queued|processing|completed|stale|failed` — and a target can be `completed`
 * AND carry a stale output: `outputs` is "kept while 'stale' — compare
 * `output_revision` against `revision` to tell whether the output is up to
 * date". `checkDubbingLanguage` is that comparison. `outputs.lossless_audio`
 * is a signed, time-limited URL for an AUDIO track; there is no video output
 * on this surface.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";
import { checkDubbingTargetLanguage } from "./dubbing";
import type { ElevenlabsDubbingLanguage } from "./dubbing-languages";

/** `POST /v1/dubbing/project/{project_id}/language` — order one dub. */
export function dubbingLanguageUrl(projectId: string): string {
  return `https://api.elevenlabs.io/v1/dubbing/project/${encodeURIComponent(projectId)}/language`;
}

const DUB_LANGUAGE_DOCS_URL =
  "https://elevenlabs.io/docs/api-reference/dubbing/project/language/create";

/** "How strongly the dubbed speakers clone the source voices, 0 to 10." Default 7. */
export const DUBBING_CLONING_STRENGTH_MIN = 0;
export const DUBBING_CLONING_STRENGTH_MAX = 10;
export const DUBBING_CLONING_STRENGTH_DEFAULT = 7;
/** "At most 20000 entries, totalling at most 4 MiB of text." */
export const DUBBING_TRANSLATIONS_MAX_ENTRIES = 20000;
export const DUBBING_TRANSLATIONS_MAX_BYTES = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Wire types — mirror the JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

/** "Voice settings applied to the whole language (e.g. cloning strength)." */
export interface DubbingVoiceSettings {
  /**
   * "How strongly the dubbed speakers clone the source voices, 0 to 10."
   * Default 7 — "Higher values prioritize voice similarity to the original
   * speaker, which can sound less natural across languages with very different
   * phonetic characteristics."
   */
  cloning_strength?: number;
}

export interface DubbingLanguageParams {
  /**
   * PSEUDO-PARAM: the parent project's id. Stripped from the body and
   * interpolated into `.request.url` — it is a path segment on this route.
   */
  project_id: string;
  /**
   * "BCP-47 language tag to dub the project into (e.g. 'fr', 'es-MX'); must be
   * a language the dubbing model supports. A region-qualified tag must be one
   * of the supported dialects."
   */
  target_language: ElevenlabsDubbingLanguage | (string & {});
  voice_settings?: DubbingVoiceSettings | null;
  /**
   * "Enterprise only. Optional translations to use instead of machine
   * translation. A map from each source segment's external_id (or its id, if
   * you supplied none) to the translated text; every source segment must be
   * covered exactly once. At most 20000 entries, totalling at most 4 MiB of
   * text."
   */
  translations?: Record<string, string> | null;
}

/** The body actually sent — `project_id` is a path segment, not a field. */
export type DubbingLanguageBody = Omit<DubbingLanguageParams, "project_id">;

// ---------------------------------------------------------------------------
// SDK view — client.dubbing.project.language.create(projectId, request)
// (x-fern-sdk-group-name ["dubbing", "project", "language"], method "create").
// ---------------------------------------------------------------------------

export interface DubbingLanguageSdkParams {
  targetLanguage: string;
  voiceSettings?: { cloningStrength?: number };
  translations?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const dubbingLanguageSchema = z.looseObject({
  project_id: z.string().min(1, "project_id is the parent project's id and cannot be empty"),
  target_language: z.string().min(1, "target_language is required"),
  voice_settings: z
    .looseObject({
      cloning_strength: z
        .number()
        .int()
        .min(DUBBING_CLONING_STRENGTH_MIN)
        .max(DUBBING_CLONING_STRENGTH_MAX)
        .optional(),
    })
    .nullable()
    .optional(),
  translations: z.record(z.string(), z.string()).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkTargetLanguage(
  params: DubbingLanguageParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  // No `model_id` on this wire — the project owns it, and this request cannot
  // see it. Passing `undefined` checks against the union of both tables.
  checkDubbingTargetLanguage(params.target_language, undefined, ctx, ["target_language"]);
}

/**
 * "At most 20000 entries, totalling at most 4 MiB of text." zod's record type
 * expresses neither: the count is a `maxProperties` the schema has no arm for,
 * and the byte total is a fact about the values.
 */
function checkTranslations(
  params: DubbingLanguageParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const translations = params.translations;
  if (translations == null || typeof translations !== "object") return;
  const entries = Object.entries(translations);
  if (entries.length > DUBBING_TRANSLATIONS_MAX_ENTRIES) {
    ctx.report({
      code: "invalid_shape",
      path: ["translations"],
      message: `\`translations\` carries ${entries.length} entries; ElevenLabs accepts at most ${DUBBING_TRANSLATIONS_MAX_ENTRIES}.`,
      meta: {
        limit: DUBBING_TRANSLATIONS_MAX_ENTRIES,
        actual: entries.length,
        source: DUB_LANGUAGE_DOCS_URL,
      },
    });
  }
  let bytes = 0;
  for (const [, value] of entries) {
    if (typeof value === "string") bytes += new TextEncoder().encode(value).length;
  }
  if (bytes <= DUBBING_TRANSLATIONS_MAX_BYTES) return;
  ctx.report({
    code: "media_too_large",
    path: ["translations"],
    message: `\`translations\` totals ${bytes} bytes of text; ElevenLabs caps it at ${DUBBING_TRANSLATIONS_MAX_BYTES} bytes (4 MiB).`,
    meta: { limit: DUBBING_TRANSLATIONS_MAX_BYTES, bytes, source: DUB_LANGUAGE_DOCS_URL },
  });
}

// No estimate: the rate is per minute of the PROJECT's source media, which
// this request does not carry. `checkDubbingProject` prices it once the
// project GET reports `media.duration_s`.

// ---------------------------------------------------------------------------
// Finalize: body (project_id stripped — it is the path) + .toSdk + .request
// ---------------------------------------------------------------------------

function buildSdkParams(params: DubbingLanguageParams): DubbingLanguageSdkParams {
  const { project_id: _projectId, voice_settings, translations, ...rest } = params;
  const sdk: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value == null) continue;
    sdk[key === "target_language" ? "targetLanguage" : key] = value;
  }
  if (voice_settings != null) {
    const settings: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(voice_settings)) {
      if (value == null) continue;
      settings[key === "cloning_strength" ? "cloningStrength" : key] = value;
    }
    sdk.voiceSettings = settings;
  }
  if (translations != null) sdk.translations = translations;
  return sdk as unknown as DubbingLanguageSdkParams;
}

/**
 * SDK targets for `elevenlabs.dubLanguage`. `"elevenlabs"` camelCases the wire
 * fields into the request object `@elevenlabs/elevenlabs-js`'s
 * `client.dubbing.project.language.create(projectId, request)` takes as its
 * SECOND argument — the project id is the first, and is on `.request.url`.
 * Type alias, not interface: an interface has no implicit index signature and
 * cannot satisfy `SdkFormatters`.
 */
type DubbingLanguageSdkTargets = { elevenlabs: () => DubbingLanguageSdkParams };

function finalize(params: DubbingLanguageParams): unknown {
  const { project_id, ...body } = params;
  return toValidated(
    body as DubbingLanguageBody,
    { url: dubbingLanguageUrl(project_id), method: "POST", headers: JSON_HEADERS },
    { sdk: { elevenlabs: () => buildSdkParams(params) } },
  );
}

const validator = createValidator<DubbingLanguageParams, unknown>({
  endpoint: "elevenlabs.dubLanguage",
  schema: dubbingLanguageSchema,
  // No model field on this wire (see the module JSDoc — the prose that says a
  // target may override the project's model is stale). The project owns it.
  modelId: () => undefined,
  catalog: models,
  checks: [checkTargetLanguage, checkTranslations],
  finalize,
});

/**
 * Validates params for ElevenLabs
 * `POST /v1/dubbing/project/{project_id}/language` — ordering one dubbed
 * language for a project `elevenlabs.dub` created.
 *
 * `project_id` is a pseudo-param: it is stripped from the body and becomes the
 * path segment on `.request.url`, so the validated result carries only
 * `{ target_language, voice_settings?, translations? }`.
 *
 * The response is `{ language_id, status, revision, output_revision, outputs,
 * … }` — poll `GET /v1/dubbing/project/{project_id}/language/{language_id}`
 * until `status` is `"completed"`, then read `outputs.lossless_audio` (a
 * signed, time-limited URL). `checkDubbingLanguage` reads that response back,
 * including the `completed`-but-stale case.
 */
export const dubLanguage = validator as unknown as {
  <T extends DubbingLanguageParams>(
    params: T & ExactKeys<T, DubbingLanguageParams>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "project_id">, DubbingLanguageSdkTargets>;
  safe<T extends DubbingLanguageParams>(
    params: T & ExactKeys<T, DubbingLanguageParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "project_id">, DubbingLanguageSdkTargets>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
