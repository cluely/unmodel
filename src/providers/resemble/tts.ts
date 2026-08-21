/**
 * Resemble AI synthesis — POST https://f.cluster.resemble.ai/synthesize (`tts`)
 *                         POST https://f.cluster.resemble.ai/stream     (`ttsStream`)
 *
 * Wire reference:
 * https://docs.resemble.ai/voice-generation/text-to-speech/synchronous and
 * https://docs.resemble.ai/voice-generation/text-to-speech/streaming-http
 * (verified 2026-08-13). Params mirror the wire bodies exactly.
 *
 * - SYNTHESIS HOST ≠ API HOST. Resemble runs two origins: the REST API at
 *   `https://app.resemble.ai/api/v2` (projects, clips, voices) and the
 *   synthesis cluster at `https://f.cluster.resemble.ai`, which is what
 *   these endpoints target. The streaming docs are explicit: "Streaming
 *   requests target dedicated synthesis hosts (see your streaming endpoint
 *   in the dashboard). Do not send them to `app.resemble.ai`." If your
 *   dashboard shows a dedicated host, swap the origin on `.request.url`.
 * - NO `model` FIELD, BY DESIGN. "The synthesis API automatically uses the
 *   model associated with your `voice_uuid`, so you do not need to select a
 *   model in the request. … Do not pass it as a `model` field." These
 *   validators therefore resolve no model id: there is no catalog gate, no
 *   `unknown_model` warning, and no cost estimate (Resemble publishes no
 *   public per-unit TTS rate either — see models.ts).
 * - CHARACTER CAP: "Text or SSML to synthesize (≤ 2,000 characters)" on both
 *   routes. A breach is reported as `over_output_limit` — there is no
 *   character-specific issue code, so the message and meta
 *   ({ limitCharacters, actualCharacters }) spell out that the limit is in
 *   characters, not tokens.
 * - `precision` "Applies to WAV output", so pairing it with
 *   `output_format: "mp3"` is a silent no-op and is flagged as such.
 * - The synchronous route answers with JSON (base64 `audio_content`,
 *   `duration`, `audio_timestamps`, `success`, `issues`) — pass it to
 *   `checkTts` from `./check`. The streaming route answers with a
 *   chunked WAV stream, so it has no checker.
 * - Auth is an `Authorization: Bearer <API_KEY>` header on both origins —
 *   unmodel never touches keys; add it yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import type { ValidateResult } from "../../core/result";
import { models, RESEMBLE_MAX_CHARACTERS } from "./models";

export const SYNTHESIZE_URL = "https://f.cluster.resemble.ai/synthesize";
export const SYNTHESIZE_STREAM_URL = "https://f.cluster.resemble.ai/stream";
/** REST API origin — projects, clips, voices. Not a synthesis host. */
export const API_BASE_URL = "https://app.resemble.ai/api/v2";

const SYNC_DOCS = "https://docs.resemble.ai/voice-generation/text-to-speech/synchronous";
const STREAM_DOCS = "https://docs.resemble.ai/voice-generation/text-to-speech/streaming-http";

/** "wav (default) or mp3." Synchronous route only. */
export const OUTPUT_FORMATS = ["wav", "mp3"] as const;
export type ResembleOutputFormat = (typeof OUTPUT_FORMATS)[number];

/** "8000, 16000, 22050, 32000, 44100, or 48000. Defaults to 48000." */
export const SAMPLE_RATES = [8000, 16000, 22050, 32000, 44100, 48000] as const;
export type ResembleSampleRate = (typeof SAMPLE_RATES)[number];

/** "MULAW, PCM_16, PCM_24, PCM_32 (default). Applies to WAV output." */
export const PRECISIONS = ["MULAW", "PCM_16", "PCM_24", "PCM_32"] as const;
export type ResemblePrecision = (typeof PRECISIONS)[number];

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/** Fields both synthesis routes share. */
interface SynthesizeCommon {
  /** Voice identifier for synthesis; also selects the model (see module JSDoc). */
  voice_uuid: string;
  /** "Text or SSML to synthesize (≤ 2,000 characters)." */
  data: string;
  /** Project the resulting clip is stored under. */
  project_uuid?: string;
  /** Hz; default 48000. */
  sample_rate?: ResembleSampleRate;
  /** WAV output only; default "PCM_32". */
  precision?: ResemblePrecision;
  /** "Enables higher-definition synthesis with a small latency trade-off." Default false. */
  use_hd?: boolean;
  /** Apply your team's custom pronunciations to matching words. Default false. */
  apply_custom_pronunciations?: boolean;
}

export interface SynthesizeBody extends SynthesizeCommon {
  /** Label for the saved clip. */
  title?: string;
  /** "wav (default) or mp3." */
  output_format?: ResembleOutputFormat;
}

/**
 * The streaming route documents neither `output_format` (it always answers
 * with a chunked WAV stream) nor `title`.
 */
export type SynthesizeStreamBody = SynthesizeCommon;

// ---------------------------------------------------------------------------
// Schemas (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const commonShape = {
  voice_uuid: z.string().min(1, "voice_uuid must not be empty."),
  data: z.string().min(1, "data must not be empty."),
  project_uuid: z.string().optional(),
  // Closed lists, not ranges.
  sample_rate: z.literal(SAMPLE_RATES).optional(),
  precision: z.literal(PRECISIONS).optional(),
  use_hd: z.boolean().optional(),
  apply_custom_pronunciations: z.boolean().optional(),
};

const synthesizeSchema = z.looseObject({
  ...commonShape,
  title: z.string().optional(),
  output_format: z.literal(OUTPUT_FORMATS).optional(),
});

const synthesizeStreamSchema = z.looseObject(commonShape);

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * Per-request character cap on `data`. The cap is documented at the endpoint
 * level and no model id is resolved for these routes, so the constant is the
 * only source. See module JSDoc for the issue-code decision.
 */
function checkCharacterLimit(
  params: SynthesizeCommon,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
  source: string,
): void {
  const actual = params.data.length;
  if (actual <= RESEMBLE_MAX_CHARACTERS) return;
  ctx.report({
    code: "over_output_limit",
    path: ["data"],
    message: `\`data\` is ${actual} characters; Resemble caps a synthesis request at ${RESEMBLE_MAX_CHARACTERS} characters (this limit is in characters, not tokens). Split the input into multiple requests.`,
    meta: {
      limitCharacters: RESEMBLE_MAX_CHARACTERS,
      actualCharacters: actual,
      source,
    },
  });
}

function checkSynthesizeLimit(
  params: SynthesizeBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  checkCharacterLimit(params, info, ctx, SYNC_DOCS);
}

function checkStreamLimit(
  params: SynthesizeStreamBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  checkCharacterLimit(params, info, ctx, STREAM_DOCS);
}

/**
 * "`precision` … Applies to WAV output." Requesting MP3 with an explicit
 * precision is accepted and the precision is dropped, so the caller silently
 * gets a different encoding than asked for — a warning, not an error.
 */
function checkPrecisionFormatPairing(
  params: SynthesizeBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.precision === undefined) return;
  if ((params.output_format ?? "wav") === "wav") return;
  ctx.report({
    code: "unsupported_param",
    severity: "warning",
    path: ["precision"],
    message: `\`precision\` applies to WAV output only; \`output_format\` is ${JSON.stringify(params.output_format)}, so it is ignored.`,
    meta: { ignored: true, output_format: params.output_format, source: SYNC_DOCS },
  });
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * SDK targets shared by both Resemble synthesis endpoints. `@resemble/node`
 * takes wire-shaped params, so the single `"resemble"` formatter is the
 * identity. Type alias, not interface: an interface has no implicit index
 * signature and cannot satisfy `SdkFormatters`.
 */
type TtsSdkTargets<B> = { resemble: () => B };

function finalizeFor(url: string) {
  return <B extends object>(params: B): Validated<B, TtsSdkTargets<B>> => {
    const body = { ...params };
    return toValidated(
      body,
      { url, method: "POST", headers: JSON_HEADERS },
      { sdk: { resemble: () => body } },
    );
  };
}

const synthesizeValidator = createValidator<
  SynthesizeBody,
  Validated<SynthesizeBody, TtsSdkTargets<SynthesizeBody>>
>({
  endpoint: "resemble.tts",
  schema: synthesizeSchema,
  // No model id on the wire — the voice picks the model (see module JSDoc).
  modelId: () => undefined,
  catalog: models,
  checks: [checkSynthesizeLimit, checkPrecisionFormatPairing],
  finalize: finalizeFor(SYNTHESIZE_URL),
});

const synthesizeStreamValidator = createValidator<
  SynthesizeStreamBody,
  Validated<SynthesizeStreamBody, TtsSdkTargets<SynthesizeStreamBody>>
>({
  endpoint: "resemble.ttsStream",
  schema: synthesizeStreamSchema,
  modelId: () => undefined,
  catalog: models,
  checks: [checkStreamLimit],
  finalize: finalizeFor(SYNTHESIZE_STREAM_URL),
});

/**
 * Validates params for Resemble `POST https://f.cluster.resemble.ai/synthesize`
 * — the synchronous route, which returns the whole clip as JSON
 * (base64 `audio_content`, `duration`, `audio_timestamps`, `success`,
 * `issues`). Pass that response to `checkTts`.
 *
 * The result's enumerable properties are the exact fetch JSON body;
 * `.toSdk("resemble")` returns it unchanged (`@resemble/node` takes wire-shaped
 * params) and `.request` carries the URL, method and `content-type`. Auth is
 * your job: add an `authorization: Bearer …` header.
 *
 * ```ts
 * const params = resemble.tts({
 *   voice_uuid: "55592656",
 *   data: "Hello world",
 *   output_format: "mp3",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${process.env.RESEMBLE_API_KEY!}` },
 *   body: JSON.stringify(params),
 * });
 * const { audio_content, duration } = await res.json();
 * ```
 */
export const tts = synthesizeValidator as unknown as {
  <T extends SynthesizeBody>(
    params: T & ExactKeys<T, SynthesizeBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, TtsSdkTargets<T>>;
  safe<T extends SynthesizeBody>(
    params: T & ExactKeys<T, SynthesizeBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, TtsSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

/**
 * Validates params for Resemble `POST https://f.cluster.resemble.ai/stream` —
 * the chunked-WAV streaming route. `output_format` and `title` are
 * deliberately absent from the params type: the streaming docs document
 * neither, and the response is always a WAV stream.
 *
 * ```ts
 * const params = resemble.ttsStream({ voice_uuid: "55592656", data: "Hello" });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${process.env.RESEMBLE_API_KEY!}` },
 *   body: JSON.stringify(params),
 * });
 * for await (const chunk of res.body!) { /* play chunk *\/ }
 * ```
 */
export const ttsStream = synthesizeStreamValidator as unknown as {
  <T extends SynthesizeStreamBody>(
    params: T & ExactKeys<T, SynthesizeStreamBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, TtsSdkTargets<T>>;
  safe<T extends SynthesizeStreamBody>(
    params: T & ExactKeys<T, SynthesizeStreamBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, TtsSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
