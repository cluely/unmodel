/**
 * Deepgram Text to Speech (REST) — POST https://api.deepgram.com/v1/speak
 *
 * Wire notes (verified against
 * https://developers.deepgram.com/reference/text-to-speech/speak-request,
 * https://developers.deepgram.com/docs/text-to-speech,
 * https://developers.deepgram.com/docs/tts-media-output-settings and
 * https://developers.deepgram.com/docs/tts-voice-controls on 2026-08-13):
 * - Like /v1/listen, every option rides in the QUERY STRING; the JSON body is
 *   exactly `{text}`. `SpeakParams` carries both for ergonomics and
 *   finalize() splits them: `text` becomes the wire body, everything else is
 *   URL-encoded into `.request.url`. Putting `model` in the JSON body (which
 *   an SDK-shaped params object invites) is a silent no-op — you get
 *   aura-asteria-en, the server default.
 * - The voice IS the model: `model=aura-2-thalia-en` picks both. STT ids
 *   (nova-*, whisper-*, flux-*) resolve in the shared Deepgram catalog, so
 *   this endpoint gates on the TTS group and rejects them.
 * - `encoding` decides which of `container` / `sample_rate` / `bit_rate` are
 *   configurable at all, and with which values — the documented "Audio Format
 *   Combinations" table is encoded in AUDIO_FORMATS below and checked whenever
 *   `encoding` is explicit (see checkAudioFormat for why an omitted one is
 *   left alone).
 * - The response is raw audio bytes (or a callback ack when `callback` is
 *   set), never JSON, so there is no response checker.
 * - Auth is an `Authorization: Token <key>` header — unmodel never touches
 *   keys; add it yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeCharacterCostUSD } from "../../core/cost";
import { models, TTS_MODEL_IDS, type DeepgramTtsModelId } from "./models";

export const SPEAK_URL = "https://api.deepgram.com/v1/speak";

const SPEAK_DOCS = "https://developers.deepgram.com/reference/text-to-speech/speak-request";
const MEDIA_DOCS = "https://developers.deepgram.com/docs/tts-media-output-settings";
const VOICE_CONTROLS_DOCS = "https://developers.deepgram.com/docs/tts-voice-controls";
const TTS_MODELS_DOCS = "https://developers.deepgram.com/docs/tts-models";

/**
 * Server-side default when `model` is omitted — "model (enum, optional,
 * default: aura-asteria-en)" (SPEAK_DOCS). Model-dependent checks (character
 * cap, cost) run against this voice when none is given.
 */
export const DEFAULT_SPEAK_MODEL_ID = "aura-asteria-en";

/** Documented `encoding` values; `mp3` is the REST default. */
export const SPEAK_ENCODINGS = [
  "linear16",
  "mulaw",
  "alaw",
  "mp3",
  "opus",
  "flac",
  "aac",
] as const;
export type DeepgramSpeakEncoding = (typeof SPEAK_ENCODINGS)[number];

/**
 * Every `container` the "Audio Format Combinations" table names — the union of
 * all `containers` entries in AUDIO_FORMATS below (MEDIA_DOCS). Which of the
 * three a given request may use depends on `encoding`; that narrowing happens
 * at runtime in checkAudioFormat.
 */
export const SPEAK_CONTAINERS = ["wav", "ogg", "none"] as const;
export type DeepgramSpeakContainer = (typeof SPEAK_CONTAINERS)[number];

/**
 * Every `sample_rate` (Hz) the "Audio Format Combinations" table names — the
 * union of all `sampleRates` entries in AUDIO_FORMATS below (MEDIA_DOCS).
 * Which rates a given request may use depends on `encoding` (and several
 * encodings fix the rate outright); that narrowing happens at runtime in
 * checkAudioFormat.
 */
export const DEEPGRAM_SPEAK_SAMPLE_RATES = [8000, 16000, 22050, 24000, 32000, 48000] as const;
export type DeepgramSpeakSampleRate = (typeof DEEPGRAM_SPEAK_SAMPLE_RATES)[number];

/** Documented `speed` bounds — "Speed values outside the 0.7x–1.5x range will return an error." */
export const SPEAK_SPEED_MIN = 0.7;
export const SPEAK_SPEED_MAX = 1.5;

interface AudioFormatRule {
  /**
   * Allowed `container` values; null = "Not Applicable" for this encoding.
   * Typed against DeepgramSpeakContainer so the table cannot name a container
   * that SPEAK_CONTAINERS (and therefore `SpeakParams["container"]`) omits.
   */
  containers: readonly DeepgramSpeakContainer[] | null;
  /**
   * Allowed `sample_rate` values; null = not configurable (fixed by the
   * codec). Typed against DeepgramSpeakSampleRate for the same reason.
   */
  sampleRates: readonly DeepgramSpeakSampleRate[] | null;
  /** Allowed discrete `bit_rate` values, when the codec publishes a list. */
  bitRates?: readonly number[];
  /** Allowed inclusive `bit_rate` range, when the codec publishes one. */
  bitRateRange?: readonly [number, number];
}

/**
 * The documented "Audio Format Combinations" table (MEDIA_DOCS): which
 * container / sample rate / bit rate each encoding accepts. A field absent
 * from an encoding's rule is not configurable for that encoding — the API
 * fixes it (e.g. mp3 is always 22050 Hz).
 */
export const AUDIO_FORMATS: Readonly<Record<DeepgramSpeakEncoding, AudioFormatRule>> = {
  linear16: { containers: ["wav", "none"], sampleRates: [8000, 16000, 24000, 32000, 48000] },
  mulaw: { containers: ["wav", "none"], sampleRates: [8000, 16000] },
  alaw: { containers: ["wav", "none"], sampleRates: [8000, 16000] },
  mp3: { containers: null, sampleRates: null, bitRates: [32000, 48000] },
  opus: { containers: ["ogg"], sampleRates: null, bitRateRange: [4000, 650000] },
  flac: { containers: null, sampleRates: [8000, 16000, 22050, 32000, 48000] },
  aac: { containers: null, sampleRates: null, bitRateRange: [4000, 192000] },
};

// ---------------------------------------------------------------------------
// Params — the JSON body (`text`) plus every documented query param.
// ---------------------------------------------------------------------------

export interface SpeakParams {
  /** The text to synthesize; becomes the JSON wire body `{text}`. */
  text: string;
  /** Voice id; Deepgram defaults to aura-asteria-en when omitted. */
  model?: DeepgramTtsModelId | (string & {});
  /** Output codec. Default "mp3" on REST. */
  encoding?: DeepgramSpeakEncoding;
  /** File-format wrapper; only some encodings accept one (see AUDIO_FORMATS). */
  container?: DeepgramSpeakContainer;
  /** Output sample rate in Hz; only configurable for some encodings. */
  sample_rate?: DeepgramSpeakSampleRate;
  /**
   * Output bitrate in bits per second; only configurable for some encodings.
   * Deliberately left as `number`: the documented space is mixed, so no single
   * union describes it. mp3 publishes a discrete list ([32000, 48000]) but
   * opus (4000–650000) and aac (4000–192000) publish genuine continuous
   * ranges. checkAudioFormat applies whichever rule the chosen `encoding` has.
   */
  bit_rate?: number;
  /** Speaking-rate multiplier, 0.7–1.5 (Aura-2 control). Default 1. */
  speed?: number;
  /** URL Deepgram calls back when the (asynchronous) request finishes. */
  callback?: string;
  /** HTTP method of the callback request. Default "POST". */
  callback_method?: "POST" | "PUT";
  /** Opt this request out of the Model Improvement Program. Default false. */
  mip_opt_out?: boolean;
  /** Usage-reporting label(s); repeats the key when an array is given. */
  tag?: string | string[];
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with an unknown_param warning).
// ---------------------------------------------------------------------------

const schema = z.looseObject({
  text: z.string(),
  model: z.string().optional(),
  encoding: z.string().optional(),
  container: z.string().optional(),
  sample_rate: z.number().optional(),
  bit_rate: z.number().optional(),
  speed: z.number().optional(),
  callback: z.string().optional(),
  callback_method: z.string().optional(),
  mip_opt_out: z.boolean().optional(),
  tag: z.union([z.string(), z.array(z.string())]).optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const TTS_MODEL_ID_SET = new Set<string>(TTS_MODEL_IDS);

/**
 * The Deepgram catalog carries STT ids (nova-*, whisper-*, flux-*) alongside
 * the Aura voices, so without this gate a transcription model would resolve
 * in the catalog and pass text-to-speech validation unremarked. Ids unknown to
 * the catalog stay a warning (`unknown_model`) — they may be new voices.
 */
function checkSpeakModelKind(
  params: SpeakParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model ?? DEFAULT_SPEAK_MODEL_ID;
  if (info === undefined || TTS_MODEL_ID_SET.has(model)) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model"],
    model,
    message: `"${model}" is not a Deepgram text-to-speech voice; POST /v1/speak accepts the Aura and Aura-2 voices (e.g. "aura-2-thalia-en").`,
    meta: { source: TTS_MODELS_DOCS },
  });
}

const ENCODING_SET = new Set<string>(SPEAK_ENCODINGS);

/**
 * `encoding` enum plus the documented container / sample-rate / bit-rate
 * combinations for the chosen encoding (MEDIA_DOCS).
 *
 * The combination rules are only applied when `encoding` is EXPLICIT: Deepgram's
 * own pages disagree about the REST default — the API reference says
 * "encoding … default: mp3" while MEDIA_DOCS says "REST Defaults encoding:
 * Linear16 container: wav sample_rate: 24000" — and those two defaults accept
 * different sample rates and bitrates. Judging an omitted `encoding` against
 * either guess would fail requests the API fulfils, so unmodel stays out of it.
 */
function checkAudioFormat(
  params: SpeakParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const encoding = params.encoding;
  if (encoding === undefined) return;
  if (!ENCODING_SET.has(encoding)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["encoding"],
      message: `\`encoding\` must be one of ${SPEAK_ENCODINGS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(encoding)}.`,
      meta: { allowed: [...SPEAK_ENCODINGS], value: encoding, source: SPEAK_DOCS },
    });
    return;
  }
  const rule = AUDIO_FORMATS[encoding as DeepgramSpeakEncoding]!;
  const effective = encoding;

  if (params.container !== undefined) {
    if (rule.containers === null) {
      ctx.report({
        code: "unsupported_param",
        path: ["container"],
        message: `\`container\` is not configurable for the "${effective}" encoding — the codec specifies its own container.`,
        meta: { encoding: effective, source: MEDIA_DOCS },
      });
    } else if (!rule.containers.includes(params.container)) {
      ctx.report({
        code: "invalid_enum_value",
        path: ["container"],
        message: `\`container\` must be one of ${rule.containers.map((v) => JSON.stringify(v)).join(", ")} for the "${effective}" encoding; got ${JSON.stringify(params.container)}.`,
        meta: {
          allowed: [...rule.containers],
          value: params.container,
          encoding: effective,
          source: MEDIA_DOCS,
        },
      });
    }
  }

  if (params.sample_rate !== undefined) {
    if (rule.sampleRates === null) {
      ctx.report({
        code: "unsupported_param",
        path: ["sample_rate"],
        message: `\`sample_rate\` is not configurable for the "${effective}" encoding — the codec fixes it.`,
        meta: { encoding: effective, source: MEDIA_DOCS },
      });
    } else if (!rule.sampleRates.includes(params.sample_rate)) {
      ctx.report({
        code: "invalid_enum_value",
        path: ["sample_rate"],
        message: `\`sample_rate\` must be one of ${rule.sampleRates.join(", ")} for the "${effective}" encoding; got ${params.sample_rate}.`,
        meta: {
          allowed: [...rule.sampleRates],
          value: params.sample_rate,
          encoding: effective,
          source: MEDIA_DOCS,
        },
      });
    }
  }

  if (params.bit_rate !== undefined) {
    if (rule.bitRates !== undefined) {
      if (!rule.bitRates.includes(params.bit_rate)) {
        ctx.report({
          code: "invalid_enum_value",
          path: ["bit_rate"],
          message: `\`bit_rate\` must be one of ${rule.bitRates.join(", ")} for the "${effective}" encoding; got ${params.bit_rate}.`,
          meta: {
            allowed: [...rule.bitRates],
            value: params.bit_rate,
            encoding: effective,
            source: MEDIA_DOCS,
          },
        });
      }
    } else if (rule.bitRateRange !== undefined) {
      const [min, max] = rule.bitRateRange;
      if (params.bit_rate < min || params.bit_rate > max) {
        ctx.report({
          code: "invalid_shape",
          path: ["bit_rate"],
          message: `\`bit_rate\` must be between ${min} and ${max} for the "${effective}" encoding; got ${params.bit_rate}.`,
          meta: { min, max, value: params.bit_rate, encoding: effective, source: MEDIA_DOCS },
        });
      }
    } else {
      ctx.report({
        code: "unsupported_param",
        path: ["bit_rate"],
        message: `\`bit_rate\` is not applicable to the "${effective}" encoding — uncompressed formats have no configurable bitrate.`,
        meta: { encoding: effective, source: MEDIA_DOCS },
      });
    }
  }
}

/**
 * `speed` is an Aura-2 control: the range 0.7–1.5 is an error boundary
 * server-side, and the feature matrix lists it for Aura-2 only, so passing it
 * with an Aura-1 voice is reported as a warning (the request still succeeds —
 * it just may not change the pace).
 */
function checkSpeed(params: SpeakParams, info: ModelInfo | undefined, ctx: PipelineContext): void {
  const speed = params.speed;
  if (speed === undefined) return;
  if (speed < SPEAK_SPEED_MIN || speed > SPEAK_SPEED_MAX) {
    ctx.report({
      code: "invalid_shape",
      path: ["speed"],
      message: `\`speed\` is ${speed}; Deepgram documents a range of ${SPEAK_SPEED_MIN}–${SPEAK_SPEED_MAX} and errors outside it.`,
      meta: {
        min: SPEAK_SPEED_MIN,
        max: SPEAK_SPEED_MAX,
        value: speed,
        source: VOICE_CONTROLS_DOCS,
      },
    });
  }
  if (info !== undefined && info.family === "aura") {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["speed"],
      model: params.model,
      message: `\`speed\` is an Aura-2 control; "${params.model ?? DEFAULT_SPEAK_MODEL_ID}" is an Aura-1 voice, which Deepgram does not document it for.`,
      meta: { source: VOICE_CONTROLS_DOCS },
    });
  }
}

const CALLBACK_METHODS = ["POST", "PUT"] as const;

function checkCallback(
  params: SpeakParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const method = params.callback_method;
  if (method === undefined) return;
  if (!CALLBACK_METHODS.includes(method.toUpperCase() as (typeof CALLBACK_METHODS)[number])) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["callback_method"],
      message: `\`callback_method\` must be one of "POST", "PUT"; got ${JSON.stringify(method)}.`,
      meta: { allowed: [...CALLBACK_METHODS], value: method, source: SPEAK_DOCS },
    });
  }
}

/**
 * Per-request character cap on `text` (catalog `limit.characters`, 2000 for
 * every Aura voice). Reported as `over_output_limit` — the code names tokens
 * elsewhere, but the message and meta ({ limitCharacters, actualCharacters })
 * are explicitly about characters; there is no character-specific issue code.
 */
function checkCharacterLimit(
  params: SpeakParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const limit = info?.limit.characters;
  if (limit === undefined) return;
  const actual = params.text.length;
  if (actual <= limit) return;
  const model = params.model ?? DEFAULT_SPEAK_MODEL_ID;
  ctx.report({
    code: "over_output_limit",
    path: ["text"],
    model,
    message: `\`text\` is ${actual} characters; POST /v1/speak caps a single request at ${limit} characters (413 above it).`,
    meta: {
      limitCharacters: limit,
      actualCharacters: actual,
      source: "https://developers.deepgram.com/docs/text-to-speech",
    },
  });
}

// ---------------------------------------------------------------------------
// Estimation — TTS is billed per input character (catalog
// cost.perMillionCharacters); the response's dg-char-count header reports the
// same count Deepgram bills.
// ---------------------------------------------------------------------------

function estimate(params: SpeakParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  const costUSD = computeCharacterCostUSD(info?.cost, params.text.length);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// URL building + finalize
// ---------------------------------------------------------------------------

/**
 * The full request URL: SPEAK_URL plus every param except `text` encoded into
 * the query string. Array values repeat the key (`tag=a&tag=b`), matching
 * Deepgram's documented multi-value form.
 */
export function speakUrl(params: Omit<SpeakParams, "text"> & { text?: string }): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "text" || value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      query.append(key, String(item));
    }
  }
  const qs = query.toString();
  return qs === "" ? SPEAK_URL : `${SPEAK_URL}?${qs}`;
}

/**
 * SDK targets for `deepgram.tts`. `"deepgram"` returns the query-param
 * object without `text` — the options argument of `@deepgram/sdk`'s
 * `speak.request({text}, options)`. Type alias, not interface: an interface
 * has no implicit index signature and so cannot satisfy `SdkFormatters`.
 */
type TtsSdkTargets<B> = { deepgram: () => B };

function finalize(params: SpeakParams): unknown {
  const { text, ...options } = params;
  const body = { text };
  return toValidated(
    body,
    {
      url: speakUrl(params),
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { deepgram: () => options } },
  );
}

const validator = createValidator<SpeakParams, unknown>({
  endpoint: "deepgram.tts",
  schema,
  // model is optional on the wire; checks run against the documented
  // server-side default (aura-asteria-en) when it is omitted.
  modelId: (params) => params.model ?? DEFAULT_SPEAK_MODEL_ID,
  catalog: models,
  checks: [checkSpeakModelKind, checkAudioFormat, checkSpeed, checkCallback, checkCharacterLimit],
  estimate,
  finalize,
});

/**
 * Validates params for Deepgram REST text-to-speech:
 * POST https://api.deepgram.com/v1/speak.
 *
 * Every option rides in the query string, so `.request.url` is the
 * fully-encoded URL and the result's enumerable properties are only the JSON
 * wire body `{text}`. `.toSdk("deepgram")` returns the query-param object without
 * `text` — the options argument of `@deepgram/sdk`'s
 * `speak.request({text}, options)`. Auth is your job: add an
 * `Authorization: Token <DEEPGRAM_API_KEY>` header when fetching.
 *
 * ```ts
 * const params = deepgram.tts({ text: "Hello world", model: "aura-2-thalia-en" });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: {
 *     ...params.request.headers,
 *     Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
 *   },
 *   body: JSON.stringify(params),
 * });
 * const audio = await res.arrayBuffer();
 * ```
 */
export const tts = validator as unknown as {
  <T extends SpeakParams>(
    params: T & ExactKeys<T, SpeakParams>,
    options?: ValidateOptions<T>,
  ): Validated<Pick<T, "text">, TtsSdkTargets<Omit<T, "text">>>;
  safe<T extends SpeakParams>(
    params: T & ExactKeys<T, SpeakParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Pick<T, "text">, TtsSdkTargets<Omit<T, "text">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
