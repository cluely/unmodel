/**
 * Rime Text-to-Speech — POST https://users.rime.ai/v1/rime-tts
 *
 * Wire reference: https://docs.rime.ai/api-reference/coda/http,
 * https://docs.rime.ai/api-reference/mistv3/http,
 * https://docs.rime.ai/api-reference/mistv2/http,
 * https://docs.rime.ai/docs/models, https://docs.rime.ai/docs/speed and
 * https://docs.rime.ai/docs/api-cheat-sheet (all verified 2026-08-13).
 * Params mirror the wire body exactly.
 *
 * HOST: `users.rime.ai`, not `api.rime.ai` — "the latter serves internal
 * infrastructure and returns 404 for TTS requests".
 *
 * FORMAT IS A HEADER, NOT A BODY FIELD. Over HTTP the container is chosen
 * with `Accept`; the `audioFormat` field some integrations reach for is a
 * WebSocket query param (`/ws3`) and does nothing here. `accept` therefore
 * rides in the params object for ergonomics and is STRIPPED from the wire
 * body onto `.request.headers.accept`. Mist v2 and Mist v1 publish a narrower
 * Accept list than Coda/Mist v3 (no Opus, no WAV), which is enforced.
 *
 * MODEL DEFAULT: "Requests that omit `modelId`, or send a value the API does
 * not recognize, are served by **Mist v3**. Set `modelId` explicitly; Coda is
 * never served by default." unmodel resolves an omitted `modelId` to `mistv3`
 * so the per-model gates below still apply.
 *
 * SPEED IS DIRECTION-INVERTED ACROSS MODELS and no validator can fix that —
 * it is a correctness trap worth reading before you tune anything:
 * - Coda / Mist v3: `timeScaleFactor` below 1.0 is FASTER (range 0.4–2.5,
 *   silently clamped). They also accept `speedAlpha`, which runs the OTHER
 *   way (above 1.0 is faster).
 * - Mist v2: `speedAlpha` below 1.0 is FASTER.
 * - `inlineSpeedAlpha` (Mist family): below 1.0 is FASTER, even on Mist v3
 *   where `speedAlpha` is the opposite.
 * unmodel does not gate `timeScaleFactor` on the Mist v2 generation: the docs
 * name the parameter per model but never say the others reject it, and a
 * false error is worse than a missing warning.
 *
 * CHARACTER CAP: 1,000 characters per request ("HTTP returns 400 'text is too
 * long' beyond that"). Reported as `over_output_limit` — there is no
 * character-specific issue code, so the message and meta
 * ({ limitCharacters, actualCharacters }) spell out that the limit is in
 * characters, not tokens.
 *
 * `.toSdk("rime")` is the identity: "Rime does not publish an npm or PyPI SDK.
 * Similarly named registry packages are unrelated third-party projects." The
 * response is raw audio bytes, so there is no response checker. Auth is a
 * `Authorization: Bearer …` header — add it yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeCharacterCostUSD } from "../../core/cost";
import { models, type RimeTtsModelId } from "./models";

export const RIME_TTS_URL = "https://users.rime.ai/v1/rime-tts";
/** WebSocket streaming — different protocol and param transport; not validated. */
export const RIME_WS_URL = "wss://users-ws.rime.ai/ws3";

/**
 * "Requests that omit `modelId`, or send a value the API does not recognize,
 * are served by Mist v3."
 */
export const DEFAULT_MODEL_ID = "mistv3";

/** "Character limit per request is 1,000 via the API." */
export const MAX_CHARACTERS = 1000;

const CODA_DOCS = "https://docs.rime.ai/api-reference/coda/http";
const MISTV2_DOCS = "https://docs.rime.ai/api-reference/mistv2/http";
const MODELS_DOCS = "https://docs.rime.ai/docs/models";
const SPEED_DOCS = "https://docs.rime.ai/docs/speed";
const CHEAT_SHEET_DOCS = "https://docs.rime.ai/docs/api-cheat-sheet";

// ---------------------------------------------------------------------------
// Wire types — mirror POST /v1/rime-tts exactly.
// ---------------------------------------------------------------------------

/** RFC media types Coda and Mist v3 accept. */
export const ACCEPT_VALUES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mpeg",
  "audio/wav",
  "audio/L16",
  "audio/PCMU",
] as const;
export type RimeAccept = (typeof ACCEPT_VALUES)[number];

/**
 * "Still accepted for backwards compatibility; new code should use the RFC
 * types above." Mapped to their replacement so unmodel can say which.
 */
export const DEPRECATED_ACCEPT_ALIASES = {
  "audio/mp3": "audio/mpeg",
  "audio/pcm": "audio/L16",
  "audio/x-mulaw": "audio/PCMU",
} as const satisfies Record<string, RimeAccept>;
export type RimeDeprecatedAccept = keyof typeof DEPRECATED_ACCEPT_ALIASES;

/** The three formats the Mist v2 reference documents (no Opus, no WAV). */
export const MIST_V2_ACCEPT_VALUES = [
  "audio/mpeg",
  "audio/L16",
  "audio/PCMU",
] as const satisfies readonly RimeAccept[];

/**
 * Both the ISO 639-1 and the ISO 639-2/3 spelling are accepted for each of the
 * eight documented languages.
 */
export const LANGUAGES = [
  "en",
  "eng",
  "es",
  "spa",
  "fr",
  "fra",
  "pt",
  "por",
  "de",
  "ger",
  "ja",
  "jpn",
  "ar",
  "ara",
  "hi",
  "hin",
] as const;
export type RimeLanguage = (typeof LANGUAGES)[number];

/**
 * "The Mist column reflects Mist v3 and Mist v2, which both serve English,
 * French, German, and Spanish" — Coda serves all eight.
 */
export const MIST_LANGUAGES = [
  "en",
  "eng",
  "es",
  "spa",
  "fr",
  "fra",
  "de",
  "ger",
] as const satisfies readonly RimeLanguage[];

export interface RimeTtsBody {
  /** The text to speak. Capped at 1,000 characters per request. */
  text: string;
  /** Voice name from the Rime catalog; must exist on the chosen model. */
  speaker: string;
  /** Defaults to "mistv3" server-side — Coda is never served by default. */
  modelId?: RimeTtsModelId | (string & {});
  /** Must match the speaker's language. Default "en" (Coda/Mist v3), "eng" (Mist v2). */
  lang?: RimeLanguage;
  /** Output sampling rate in Hz; default 24000. */
  samplingRate?: number;
  /** Coda / Mist v3 speed control. 0.4–2.5, clamped. Above 1.0 SLOWS speech. */
  timeScaleFactor?: number;
  /** Mist v2 speed control (default 1.0). Below 1.0 is FASTER on Mist v2. */
  speedAlpha?: number;
  /** Mist-family per-word speed: comma-separated values for `[bracketed]` words. */
  inlineSpeedAlpha?: string;
  /** Pause on `<200>`-style angle brackets. Mist family only. Default false. */
  pauseBetweenBrackets?: boolean;
  /** Phonemes in `{curly}` brackets. Mist v2 / Mist v1 only. Default false. */
  phonemizeBetweenBrackets?: boolean;
  /** Skip text normalization. "mist/mistv2 only." Default false. */
  noTextNormalization?: boolean;
}

export interface RimeTtsParams extends RimeTtsBody {
  /**
   * HEADER param — stripped from the wire body onto `.request.headers.accept`.
   * Selects the audio container; there is no body field for it over HTTP.
   */
  accept?: RimeAccept | RimeDeprecatedAccept;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

/**
 * The widest documented `samplingRate` window across models: Mist v2 documents
 * 4000–44100 and the cheat sheet documents 8000–96000 for the current models.
 * Per-model narrowing happens in `checkSamplingRate`.
 */
export const SAMPLING_RATE_FLOOR = 4000;
export const SAMPLING_RATE_CEILING = 96000;

const schema = z.looseObject({
  text: z.string().min(1, "text must not be empty."),
  speaker: z.string().min(1, "speaker must not be empty."),
  modelId: z.string().optional(),
  lang: z.enum(LANGUAGES).optional(),
  samplingRate: z.number().int().min(SAMPLING_RATE_FLOOR).max(SAMPLING_RATE_CEILING).optional(),
  timeScaleFactor: z.number().optional(),
  speedAlpha: z.number().optional(),
  inlineSpeedAlpha: z.string().optional(),
  pauseBetweenBrackets: z.boolean().optional(),
  phonemizeBetweenBrackets: z.boolean().optional(),
  noTextNormalization: z.boolean().optional(),
  accept: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Constraints — per-model gates the model matrix documents explicitly.
// ---------------------------------------------------------------------------

const phonemizeDeny = {
  phonemizeBetweenBrackets: {
    reason:
      "inline pronunciation control is available on Mist v2 and Mist v1 only — Mist v3 and Coda do not carry inline phoneme overrides, and no error is raised when they are dropped",
    source: MODELS_DOCS,
  },
} as const;

const noTextNormalizationDeny = {
  noTextNormalization: {
    reason: 'the reference marks it "mist/mistv2 only"',
    source: MISTV2_DOCS,
  },
} as const;

const codaOnlyDenies = {
  ...phonemizeDeny,
  ...noTextNormalizationDeny,
  pauseBetweenBrackets: {
    reason:
      "custom pauses are a Mist-family feature; the model matrix marks them unsupported on Coda",
    source: MODELS_DOCS,
  },
  inlineSpeedAlpha: {
    reason:
      "per-word speed adjustment is a Mist-family feature — \"Coda does not support it\"; use `timeScaleFactor` for the whole response instead",
    source: SPEED_DOCS,
  },
} as const;

export const ttsConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  coda: { deny: codaOnlyDenies },
  mistv3: { deny: { ...phonemizeDeny, ...noTextNormalizationDeny } },
  // Arcana is sunsetting into Coda, and its reference pages are gone; only the
  // two gates the model matrix states model-generically are applied.
  arcana: { deny: { ...phonemizeDeny, ...noTextNormalizationDeny } },
  arcanav2: { deny: { ...phonemizeDeny, ...noTextNormalizationDeny } },
  arcanav3: { deny: { ...phonemizeDeny, ...noTextNormalizationDeny } },
};

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const ACCEPT_SET = new Set<string>(ACCEPT_VALUES);
const MIST_V2_ACCEPT_SET = new Set<string>(MIST_V2_ACCEPT_VALUES);
const MIST_LANGUAGE_SET = new Set<string>(MIST_LANGUAGES);
const MIST_GENERATION = new Set(["mistv3", "mistv2", "mist"]);
const LEGACY_MIST = new Set(["mistv2", "mist"]);

function modelOf(params: RimeTtsParams): string {
  return params.modelId ?? DEFAULT_MODEL_ID;
}

/** Documented 1,000-character `text` cap; 400 "text is too long" beyond it. */
function checkTextLength(
  params: RimeTtsParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const limit = info?.limit.characters ?? MAX_CHARACTERS;
  if (limit <= 0) return;
  const actual = params.text.length;
  if (actual <= limit) return;
  ctx.report({
    code: "over_output_limit",
    path: ["text"],
    model: modelOf(params),
    message: `text is ${actual} characters, over Rime's ${limit}-character per-request limit (this limit is in characters, not tokens); the API answers 400 "text is too long" beyond it.`,
    meta: { limitCharacters: limit, actualCharacters: actual, source: CHEAT_SHEET_DOCS },
  });
}

/**
 * Mist v2 and Mist v1 document 4000–44100 Hz; the current models document
 * 8000–96000 ("values above 24000 are upsampling").
 */
function checkSamplingRate(
  params: RimeTtsParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const rate = params.samplingRate;
  if (rate === undefined || info === undefined) return;
  const model = modelOf(params);
  const legacy = LEGACY_MIST.has(model);
  const min = legacy ? 4000 : 8000;
  const max = legacy ? 44100 : SAMPLING_RATE_CEILING;
  if (rate >= min && rate <= max) return;
  ctx.report({
    code: "invalid_shape",
    path: ["samplingRate"],
    model,
    message: `\`samplingRate\` is ${rate}; "${model}" documents a range of ${min}–${max} Hz.`,
    meta: { min, max, value: rate, source: legacy ? MISTV2_DOCS : CHEAT_SHEET_DOCS },
  });
}

/**
 * "Accepted range is 0.4 to 2.5; values outside it are clamped without an
 * error." A silent clamp is worth surfacing, but it must not fail a request
 * the API fulfils, so it is a warning.
 */
export const TIME_SCALE_FACTOR_MIN = 0.4;
export const TIME_SCALE_FACTOR_MAX = 2.5;

function checkTimeScaleFactor(
  params: RimeTtsParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const value = params.timeScaleFactor;
  if (value === undefined) return;
  if (value >= TIME_SCALE_FACTOR_MIN && value <= TIME_SCALE_FACTOR_MAX) return;
  ctx.report({
    code: "invalid_shape",
    severity: "warning",
    path: ["timeScaleFactor"],
    model: modelOf(params),
    message: `\`timeScaleFactor\` is ${value}; the accepted range is ${TIME_SCALE_FACTOR_MIN}–${TIME_SCALE_FACTOR_MAX} and values outside it are clamped without an error, so the request succeeds at ${value < TIME_SCALE_FACTOR_MIN ? TIME_SCALE_FACTOR_MIN : TIME_SCALE_FACTOR_MAX} instead.`,
    meta: {
      min: TIME_SCALE_FACTOR_MIN,
      max: TIME_SCALE_FACTOR_MAX,
      value,
      source: CODA_DOCS,
    },
  });
}

/** Coda serves eight languages; the Mist family serves English/French/German/Spanish. */
function checkLanguage(
  params: RimeTtsParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const lang = params.lang;
  if (lang === undefined || info === undefined) return;
  const model = modelOf(params);
  if (!MIST_GENERATION.has(model) || MIST_LANGUAGE_SET.has(lang)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["lang"],
    model,
    message: `\`lang\` ${JSON.stringify(lang)} is not served by "${model}" — the Mist models cover English, French, German and Spanish. Use \`modelId: "coda"\` for Arabic, Hindi, Japanese or Portuguese.`,
    meta: { allowed: [...MIST_LANGUAGES], value: lang, source: MODELS_DOCS },
  });
}

/**
 * `accept` must be a documented media type, and Mist v2 / Mist v1 publish only
 * three of the six. Deprecated aliases still work, so they warn rather than
 * fail.
 */
function checkAccept(
  params: RimeTtsParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const accept = params.accept;
  if (accept === undefined) return;
  const alias = (DEPRECATED_ACCEPT_ALIASES as Record<string, RimeAccept>)[accept];
  const canonical = alias ?? accept;

  if (!ACCEPT_SET.has(canonical)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["accept"],
      message: `\`accept\` must be one of ${ACCEPT_VALUES.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(accept)}.`,
      meta: { allowed: [...ACCEPT_VALUES], value: accept, source: CODA_DOCS },
    });
    return;
  }

  if (alias !== undefined) {
    // Deprecated aliases are "still accepted for backwards compatibility", so
    // this must never fail a request the API fulfils.
    ctx.report({
      code: "invalid_enum_value",
      severity: "warning",
      path: ["accept"],
      message: `\`accept: ${JSON.stringify(accept)}\` is a deprecated alias kept for backwards compatibility; new code should send ${JSON.stringify(alias)}.`,
      meta: { replacement: alias, value: accept, source: CODA_DOCS },
    });
  }

  const model = modelOf(params);
  if (info === undefined || !LEGACY_MIST.has(model) || MIST_V2_ACCEPT_SET.has(canonical)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["accept"],
    model,
    message: `\`accept\` ${JSON.stringify(accept)} is not documented for "${model}" — Mist v2 and Mist v1 publish only ${MIST_V2_ACCEPT_VALUES.map((v) => JSON.stringify(v)).join(", ")}. Opus and WAV arrived with Coda and Mist v3.`,
    meta: { allowed: [...MIST_V2_ACCEPT_VALUES], value: accept, source: MISTV2_DOCS },
  });
}

// ---------------------------------------------------------------------------
// Estimation — billed per input character (catalog cost.perMillionCharacters).
// ---------------------------------------------------------------------------

function estimate(
  params: RimeTtsParams,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  const costUSD = computeCharacterCostUSD(info?.cost, params.text.length);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * SDK targets for `rime.tts`. Rime publishes no npm or PyPI SDK, so the single
 * self-named `"rime"` target returns the wire body unchanged; naming it keeps
 * the call site shaped like every other endpoint's and leaves room for a real
 * SDK formatter later. Type alias, not interface: an interface has no implicit
 * index signature and cannot satisfy `SdkFormatters`.
 */
type TtsSdkTargets<B> = { rime: () => B };

function finalize(params: RimeTtsParams): unknown {
  const { accept, ...body } = params;
  return toValidated(
    body,
    {
      url: RIME_TTS_URL,
      method: "POST",
      headers: { ...JSON_HEADERS, ...(accept !== undefined && { accept }) },
    },
    { sdk: { rime: () => body } },
  );
}

const validator = createValidator<RimeTtsParams, unknown>({
  endpoint: "rime.tts",
  schema,
  modelId: (params) => params.modelId ?? DEFAULT_MODEL_ID,
  catalog: models,
  constraints: ttsConstraints,
  checks: [
    checkTextLength,
    checkSamplingRate,
    checkTimeScaleFactor,
    checkLanguage,
    checkAccept,
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Rime `POST /v1/rime-tts`.
 *
 * The result's enumerable properties are the exact fetch JSON body — `accept`
 * is stripped and lives on `.request.headers` instead, because the audio
 * format is a header over HTTP. `.toSdk("rime")` returns the body unchanged (Rime
 * publishes no SDK). Auth is your job: add an `authorization: Bearer …`
 * header.
 *
 * ```ts
 * const params = rime.tts({
 *   text: "Hello from Rime!",
 *   speaker: "astra",
 *   modelId: "coda",
 *   samplingRate: 24000,
 *   accept: "audio/mpeg",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${process.env.RIME_API_KEY!}` },
 *   body: JSON.stringify(params),
 * });
 * const audio = await res.arrayBuffer();
 * ```
 */
export const tts = validator as unknown as {
  <T extends RimeTtsParams>(
    params: T & ExactKeys<T, RimeTtsParams>,
    options?: ValidateOptions,
  ): Validated<Omit<T, "accept">, TtsSdkTargets<Omit<T, "accept">>>;
  safe<T extends RimeTtsParams>(
    params: T & ExactKeys<T, RimeTtsParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<Omit<T, "accept">, TtsSdkTargets<Omit<T, "accept">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
