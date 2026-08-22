/**
 * MiniMax Voice Cloning — POST https://api.minimax.io/v1/voice_clone
 *
 * Wire reference:
 * https://platform.minimax.io/docs/api-reference/voice-cloning-clone
 * (verified 2026-08-22). This is the INTERNATIONAL platform; the China
 * platform (api.minimaxi.com) is out of scope, matching ./tts.
 *
 * - TWO-CALL SHAPE: the reference audio is NOT in this request. Upload it
 *   first — POST /v1/files/upload, multipart, `purpose: "voice_clone"`
 *   (mp3/m4a/wav, 10s–5min, ≤20MB; `purpose: "prompt_audio"` for the <8s
 *   `clone_prompt` sample) — and pass the returned `file.file_id` here.
 *   `toVoiceUploadFormData` builds that upload body.
 * - THE CALLER MINTS THE ID: `voice_id` is a required INPUT, unique per
 *   account — 8–256 characters, starting with an English letter, containing
 *   only letters, digits, `-` and `_`, and not ending with `-` or `_`
 *   (enforced here; the response does not echo it back).
 * - PREVIEW SYNTHESIS: `text` (≤1000 chars) plus `model` — "required when
 *   `text` is provided", one of the eight speech ids — returns a `demo_audio`
 *   URL and "triggers billing". The pipeline's model is therefore the preview
 *   model when one is given (so its per-character rate prices the preview)
 *   and the synthetic catalog id `voice-clone` otherwise — this wire has no
 *   model field of its own.
 * - The exact wire spelling is `need_volume_normalization` ("volume");
 *   third-party samples that spell it `volumn` are wrong per the official
 *   reference table.
 * - Auth is an `Authorization: Bearer <api key>` header — unmodel never
 *   touches keys; add it yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeCharacterCostUSD } from "../../core/cost";
import {
  models as mediaModels,
  SPEECH_MODEL_IDS,
  type MinimaxSpeechModelId,
} from "./models";
import { T2A_LANGUAGE_BOOSTS } from "./models";
import type { MinimaxLanguageBoost } from "./models";

export const VOICE_CLONE_URL = "https://api.minimax.io/v1/voice_clone";
/** Upload target for the reference audio — see {@link toVoiceUploadFormData}. */
export const FILE_UPLOAD_URL = "https://api.minimax.io/v1/files/upload";

const VOICE_CLONE_DOCS = "https://platform.minimax.io/docs/api-reference/voice-cloning-clone";

/**
 * Synthetic catalog id for this route when no preview `model` is given —
 * POST /v1/voice_clone itself has no model field.
 */
export const VOICE_CLONE_MODEL_ID = "voice-clone";

/** "`text`… max 1000 characters; triggers billing." */
export const VOICE_CLONE_TEXT_MAX_CHARACTERS = 1000;
/** "`text_validation`… max 200 chars." */
export const VOICE_CLONE_TEXT_VALIDATION_MAX_CHARACTERS = 200;

/**
 * The documented `voice_id` grammar: "Length 8–256 chars; starts with English
 * letter; contains letters, digits, `-`, `_` only; cannot end with `-` or
 * `_`; must be unique."
 */
export const VOICE_CLONE_VOICE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{6,254}[A-Za-z0-9]$/;

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

export interface MinimaxClonePrompt {
  /** File id (from /v1/files/upload, `purpose: "prompt_audio"`) of a <8s sample. */
  prompt_audio: number;
  /** "Transcript ending with punctuation" of the prompt sample. */
  prompt_text?: string;
}

export interface VoiceCloneParams {
  /**
   * "Audio file ID from File Upload API" (`purpose: "voice_clone"`) —
   * mp3/m4a/wav, 10s–5min, ≤20MB.
   */
  file_id: number;
  /** The CALLER-CHOSEN id of the voice being created (see module JSDoc). */
  voice_id: string;
  /** Example-driven timbre steering from a short prompt sample. */
  clone_prompt?: MinimaxClonePrompt;
  /** Preview text (≤1000 chars); requires `model`; billed. */
  text?: string;
  /** "Required when `text` is provided" — one of the eight speech ids. */
  model?: MinimaxSpeechModelId | (string & {});
  /** Language hint for the preview synthesis, or "auto". */
  language_boost?: MinimaxLanguageBoost | null;
  /** "Expected transcript of the cloning sample audio" (≤200 chars, ASR-checked). */
  text_validation?: string;
  /** "Similarity threshold used by ASR validation." [0,1], default 0.7. */
  accuracy?: number;
  /** Default false. */
  need_noise_reduction?: boolean;
  /** Default false. Exact wire spelling — see module JSDoc. */
  need_volume_normalization?: boolean;
  /** Append an audible watermark tone to the preview. Default false. */
  aigc_watermark?: boolean;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const schema = z.looseObject({
  file_id: z.number().int(),
  voice_id: z.string(),
  clone_prompt: z
    .looseObject({
      prompt_audio: z.number().int(),
      prompt_text: z.string().optional(),
    })
    .optional(),
  text: z
    .string()
    .max(
      VOICE_CLONE_TEXT_MAX_CHARACTERS,
      `text is capped at ${VOICE_CLONE_TEXT_MAX_CHARACTERS} characters`,
    )
    .optional(),
  model: z.string().optional(),
  language_boost: z.string().nullable().optional(),
  text_validation: z
    .string()
    .max(
      VOICE_CLONE_TEXT_VALIDATION_MAX_CHARACTERS,
      `text_validation is capped at ${VOICE_CLONE_TEXT_VALIDATION_MAX_CHARACTERS} characters`,
    )
    .optional(),
  accuracy: z.number().min(0).max(1).optional(),
  need_noise_reduction: z.boolean().optional(),
  need_volume_normalization: z.boolean().optional(),
  aigc_watermark: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const SPEECH_MODEL_ID_SET = new Set<string>(SPEECH_MODEL_IDS);
const LANGUAGE_BOOST_SET = new Set<string>(T2A_LANGUAGE_BOOSTS);

/** The documented `voice_id` grammar, spelled out per rule in the message. */
function checkVoiceId(
  params: VoiceCloneParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const id = params.voice_id;
  if (typeof id !== "string" || VOICE_CLONE_VOICE_ID_PATTERN.test(id)) return;
  ctx.report({
    code: "invalid_shape",
    path: ["voice_id"],
    message: `\`voice_id\` is the caller-chosen id of the new voice: 8–256 characters, starting with an English letter, containing only letters, digits, \`-\` and \`_\`, and not ending with \`-\` or \`_\`; got ${JSON.stringify(id)}.`,
    meta: { pattern: String(VOICE_CLONE_VOICE_ID_PATTERN), value: id, source: VOICE_CLONE_DOCS },
  });
}

/** "`model`… Required when `text` is provided." */
function checkPreviewPairing(
  params: VoiceCloneParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.text === undefined || params.model !== undefined) return;
  ctx.report({
    code: "invalid_shape",
    path: ["model"],
    message: `\`model\` is required when \`text\` is provided — the preview synthesis needs a speech model (${SPEECH_MODEL_IDS.map((id) => `"${id}"`).join(", ")}).`,
    meta: { allowed: [...SPEECH_MODEL_IDS], source: VOICE_CLONE_DOCS },
  });
}

/**
 * The media catalog also carries video ids; a video id as the preview
 * `model` would resolve there, so this gate rejects non-speech ids. Ids
 * unknown to the catalog stay a warning (`unknown_model`).
 */
function checkPreviewModelKind(
  params: VoiceCloneParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model;
  if (model === undefined || info === undefined || SPEECH_MODEL_ID_SET.has(model)) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model"],
    model,
    message: `"${model}" is not a speech model; the voice-clone preview accepts ${SPEECH_MODEL_IDS.map((id) => `"${id}"`).join(", ")}.`,
    meta: { allowed: [...SPEECH_MODEL_IDS], source: VOICE_CLONE_DOCS },
  });
}

function checkLanguageBoost(
  params: VoiceCloneParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const boost = params.language_boost;
  if (boost == null || LANGUAGE_BOOST_SET.has(boost)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["language_boost"],
    message: `\`language_boost\` must be one of the documented languages or "auto"; got ${JSON.stringify(boost)}.`,
    meta: { allowed: [...T2A_LANGUAGE_BOOSTS], value: boost, source: VOICE_CLONE_DOCS },
  });
}

// ---------------------------------------------------------------------------
// Estimation — only the optional preview synthesis is billed per character
// ("`text`… triggers billing"), at the chosen preview model's rate. The
// cloning itself carries no published per-request rate.
// ---------------------------------------------------------------------------

function estimate(
  params: VoiceCloneParams,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  if (params.text === undefined) return {};
  const costUSD = computeCharacterCostUSD(info?.cost, params.text.length);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Upload helper + finalize
// ---------------------------------------------------------------------------

/** The two documented purposes of POST /v1/files/upload in the cloning flow. */
export type MinimaxVoiceUploadPurpose = "voice_clone" | "prompt_audio";

export interface MinimaxVoiceUpload {
  /** `"voice_clone"` for the main sample; `"prompt_audio"` for the <8s prompt. */
  purpose: MinimaxVoiceUploadPurpose;
  /** mp3/m4a/wav. Main sample: 10s–5min, ≤20MB. Prompt sample: <8s. */
  file: Blob;
}

/**
 * Builds the multipart body for the upload prerequisite —
 * `POST {@link FILE_UPLOAD_URL}` — whose response `file.file_id` feeds
 * `file_id` (purpose "voice_clone") or `clone_prompt.prompt_audio` (purpose
 * "prompt_audio") on the clone request.
 *
 * ```ts
 * const upload = await fetch(minimax.FILE_UPLOAD_URL, {
 *   method: "POST",
 *   headers: { authorization: `Bearer ${process.env.MINIMAX_API_KEY!}` },
 *   body: minimax.toVoiceUploadFormData({ purpose: "voice_clone", file: blob }),
 * }).then((res) => res.json());
 * const params = minimax.voiceClone({ file_id: upload.file.file_id, voice_id: "MyVoice01" });
 * ```
 */
export function toVoiceUploadFormData(upload: MinimaxVoiceUpload): FormData {
  const form = new FormData();
  form.append("purpose", upload.purpose);
  form.append("file", upload.file);
  return form;
}

/**
 * SDK targets for `minimax.voiceClone`. MiniMax ships no official JS SDK for
 * this API, so `.toSdk("minimax")` returns the body unchanged. Type alias,
 * not interface — see ./tts.
 */
type VoiceCloneSdkTargets<B> = { minimax: () => B };

function finalize(
  params: VoiceCloneParams,
): Validated<VoiceCloneParams, VoiceCloneSdkTargets<VoiceCloneParams>> {
  return toValidated(
    params,
    { url: VOICE_CLONE_URL, method: "POST", headers: JSON_HEADERS },
    { sdk: { minimax: () => params } },
  );
}

const validator = createValidator<
  VoiceCloneParams,
  Validated<VoiceCloneParams, VoiceCloneSdkTargets<VoiceCloneParams>>
>({
  endpoint: "minimax.voiceClone",
  schema,
  // The preview model when given (its rate prices the preview); the synthetic
  // catalog id otherwise — this wire has no model field of its own.
  modelId: (params) => params.model ?? VOICE_CLONE_MODEL_ID,
  catalog: mediaModels,
  checks: [checkVoiceId, checkPreviewPairing, checkPreviewModelKind, checkLanguageBoost],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for MiniMax `POST /v1/voice_clone`.
 *
 * The returned object's enumerable props are the exact fetch JSON body. The
 * reference audio is uploaded FIRST via POST /v1/files/upload
 * ({@link toVoiceUploadFormData}); this request carries only its `file_id`.
 * `voice_id` is chosen by YOU and is the handle the new voice keeps — the
 * response does not mint one. `.toSdk("minimax")` returns the body unchanged
 * (no official JS SDK). Auth is your job: add
 * `authorization: Bearer <MINIMAX_API_KEY>` when fetching.
 */
export const voiceClone = validator as unknown as {
  <T extends VoiceCloneParams>(
    params: T & ExactKeys<T, VoiceCloneParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, VoiceCloneSdkTargets<T>>;
  safe<T extends VoiceCloneParams>(
    params: T & ExactKeys<T, VoiceCloneParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, VoiceCloneSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
