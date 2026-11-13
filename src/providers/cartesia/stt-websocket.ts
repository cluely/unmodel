/**
 * Cartesia realtime Speech-to-Text (Manual) — the SESSION CONFIG of
 * `wss://api.cartesia.ai/stt/websocket`.
 *
 * This socket has no configuration *message*: the session is configured
 * entirely by the query params of the connection URL, and that config object is
 * what this module validates. The audio you then stream (binary frames of raw
 * PCM in the declared `encoding` / `sample_rate`), the `finalize` and `close`
 * text commands, and the `transcript` / `flush_done` / `done` frames coming
 * back are transport and stay out of scope — as is auth (an `Authorization:
 * Bearer <api_key>` header from a server, or an `access_token` query param
 * from a browser; unmodel never touches credentials).
 *
 * Wire notes (verified 2026-08-13 against
 * https://docs.cartesia.ai/2026-03-01/api-reference/stt/websocket, Cartesia-Version
 * 2026-03-01):
 * - VERSIONING DIFFERS FROM REST. Batch POST /stt takes a `Cartesia-Version`
 *   HEADER; this socket takes a required `cartesia_version` QUERY param, which
 *   {@link sttWebsocketUrl} appends for you ({@link CARTESIA_VERSION}).
 * - MODEL GATE, INVERTED VS BATCH. `model` accepts `ink-2` and `ink-whisper`
 *   here, while batch POST /stt (./stt) accepts `ink-whisper` only: `ink-2` is
 *   realtime-only, so the two validators are complements — note that
 *   `ink-whisper` is documented on BOTH surfaces, so only `ink-2` is
 *   socket-exclusive. Sonic (TTS) ids are an error on either.
 * - The per-model knobs are also complementary, and the docs describe them as
 *   scoped rather than refused, so a mismatch is reported as *ignored*
 *   (warning): `min_volume` and `max_silence_duration_secs` are "Used by
 *   `ink-whisper` models only", `keyterm` is "Used by `ink-2` models only".
 *   `ink-preview`, realtime-only and on the socket's 2026-08-14 enum only,
 *   sits on ink-2's side: "Used by `ink-2` and `ink-preview` only." for
 *   `keyterm`, "Used by `ink-whisper` models only." for the silence knobs
 *   (https://docs.cartesia.ai/api-reference/stt/websocket, 2026-11-12).
 * - `keyterm` is a REPEATED query param: "Repeat the `keyterm` query parameter
 *   to pass multiple values, up to 100 keyterms totaling 1200 characters. To
 *   boost one multi-word phrase, join the words with `%20`." The params object
 *   takes a string or an array; {@link sttWebsocketUrl} repeats the key (and
 *   `URLSearchParams` percent-encodes the spaces for you).
 * - `language` publishes a single-value enum (`en`, the default) on the
 *   2026-03-01 reference, with no sentence saying the socket refuses other
 *   codes — and every other source says it takes more: the 2026-08-14
 *   reference of the same socket says "Used by `ink-whisper` models only." and
 *   "See [Older models](/build-with-cartesia/stt/older-models#ink-whisper) for
 *   all options." (the 100 codes batch /stt takes), and the troubleshooting
 *   page for this endpoint says "Be sure to include `?language=xx` (replace
 *   `xx` with an ISO 639-1 language code) as a query param when establishing
 *   your WebSocket connection. This endpoint does not support language
 *   detection yet."
 *   (https://docs.cartesia.ai/use-the-api/stt/troubleshooting/manual). So an
 *   off-list code is only ever a warning: on `ink-whisper`, one outside the 100;
 *   on `ink-2` / `ink-preview`, anything but `en`, since "`ink-2` and
 *   `ink-preview` support English, French, Hindi, Japanese, and Spanish, and
 *   detect the language automatically."
 *   (https://docs.cartesia.ai/use-the-api/stt/compare-endpoints). All read
 *   2026-11-12.
 * - The sibling turn-detection socket (`wss /stt/turns/websocket`, "Realtime
 *   Speech-to-Text (Auto)", with its own `turn_*` thresholds) is a separate
 *   documented surface and is NOT validated here.
 * - There is no `.request`: a WebSocket URL is not fetchable, and unmodel's
 *   `RequestMeta` describes an HTTP POST. Build the address with
 *   {@link sttWebsocketUrl}.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import type { ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { CARTESIA_STT_LANGUAGES, models, type CartesiaSttModelId } from "./models";
import { CARTESIA_VERSION } from "./tts";
import type { CartesiaSttEncoding, CartesiaSttLanguage } from "./stt";

export const STT_WEBSOCKET_URL = "wss://api.cartesia.ai/stt/websocket";

const STT_WEBSOCKET_DOCS = "https://docs.cartesia.ai/2026-03-01/api-reference/stt/websocket";
/** The 2026-08-14 reference — the only one that names `ink-preview`. */
const STT_WEBSOCKET_LATEST_DOCS = "https://docs.cartesia.ai/api-reference/stt/websocket";
const INK_WHISPER_LANGUAGES_DOCS = "https://docs.cartesia.ai/build-with-cartesia/stt/older-models";

/**
 * The `model` enum wss /stt/websocket publishes for Cartesia-Version
 * 2026-03-01. `ink-2` appears here and NOT on batch POST /stt; `ink-whisper`
 * appears on both.
 */
export const STT_WEBSOCKET_MODEL_IDS = [
  "ink-2",
  "ink-whisper",
] as const satisfies readonly CartesiaSttModelId[];

/** "up to 100 keyterms totaling 1200 characters" (STT_WEBSOCKET_DOCS). */
export const STT_WEBSOCKET_KEYTERM_MAX = 100;
/** "up to 100 keyterms totaling 1200 characters" (STT_WEBSOCKET_DOCS). */
export const STT_WEBSOCKET_KEYTERM_TOTAL_CHARACTERS_MAX = 1200;

// ---------------------------------------------------------------------------
// Wire types — the query params of the realtime STT socket.
// ---------------------------------------------------------------------------

/**
 * `en` (the 2026-03-01 enum and the default) and the 100 `ink-whisper` codes,
 * open-tailed: an off-list code is a warning here, never an error (see the
 * module JSDoc and the open-tail rule in ./tts).
 */
export type CartesiaSttWebsocketLanguage = CartesiaSttLanguage | (string & {});

export interface SttWebsocketParams {
  /** REQUIRED. `ink-2` (realtime-only) or `ink-whisper`. */
  model: (typeof STT_WEBSOCKET_MODEL_IDS)[number] | (string & {});
  /** REQUIRED. How the server interprets the raw binary audio you send. */
  encoding: CartesiaSttEncoding;
  /** REQUIRED. Sample rate of the audio in Hz. */
  sample_rate: number;
  /**
   * "The language of the input audio in ISO-639-1 format. Defaults to `en`."
   * The 2026-03-01 enum is `en` alone; the 2026-08-14 reference scopes the
   * field to `ink-whisper` with its 100 codes. Off-list values warn.
   */
  language?: CartesiaSttWebsocketLanguage;
  /**
   * `ink-whisper` only. "Controls what is considered silence for automatic
   * transcript finalization. Range: 0.0-1.0."
   */
  min_volume?: number;
  /**
   * `ink-whisper` only. "Maximum duration of silence (in seconds) before the
   * API automatically finalizes the transcript." No bounds are published.
   */
  max_silence_duration_secs?: number;
  /**
   * `ink-2` only. One keyterm, or up to 100 of them totaling 1200 characters.
   * Rides as a repeated query param.
   */
  keyterm?: string | string[];
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const schema = z.looseObject({
  model: z.string().min(1, "model is required on the STT socket"),
  encoding: z.enum(["pcm_s16le", "pcm_s32le", "pcm_f16le", "pcm_f32le", "pcm_mulaw", "pcm_alaw"]),
  sample_rate: z.number().int().positive(),
  language: z.string().optional(),
  // "Range: 0.0-1.0" (STT_WEBSOCKET_DOCS).
  min_volume: z.number().min(0).max(1).optional(),
  // No range is published for the silence timeout; only non-negative is
  // meaningful for a duration.
  max_silence_duration_secs: z.number().min(0).optional(),
  keyterm: z
    .union([
      z.string(),
      z
        .array(z.string())
        .max(
          STT_WEBSOCKET_KEYTERM_MAX,
          `at most ${STT_WEBSOCKET_KEYTERM_MAX} keyterms are allowed`,
        ),
    ])
    .optional(),
});

// ---------------------------------------------------------------------------
// Constraints — the inverted per-model knobs. Both sides are flagged `ignored`:
// the docs scope these params to one model family ("Used by X models only")
// without saying the socket refuses a connection that carries them.
// ---------------------------------------------------------------------------

const WHISPER_ONLY_KNOBS: EndpointConstraints = {
  deny: {
    min_volume: {
      reason: "`min_volume` is used by `ink-whisper` models only",
      source: STT_WEBSOCKET_DOCS,
      ignored: true,
    },
    max_silence_duration_secs: {
      reason: "`max_silence_duration_secs` is used by `ink-whisper` models only",
      source: STT_WEBSOCKET_DOCS,
      ignored: true,
    },
  },
};

const KEYTERM_MODELS_ONLY: EndpointConstraints = {
  deny: {
    keyterm: {
      reason: "keyterm prompting is used by `ink-2` and `ink-preview` only",
      source: STT_WEBSOCKET_LATEST_DOCS,
      ignored: true,
    },
  },
};

export const sttWebsocketConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  "ink-2": WHISPER_ONLY_KNOBS,
  "ink-preview": WHISPER_ONLY_KNOBS,
  "ink-whisper": KEYTERM_MODELS_ONLY,
  "ink-whisper-2025-06-04": KEYTERM_MODELS_ONLY,
};

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const MODEL_ID_SET = new Set<string>(STT_WEBSOCKET_MODEL_IDS);

/**
 * The realtime counterpart of the batch gate in ./stt. Sonic (TTS) ids are an
 * error; cataloged Ink ids outside the published enum are a warning (the docs
 * neither list them here nor say the socket refuses them); ids unknown to the
 * catalog stay an `unknown_model` warning.
 */
function checkRealtimeSttModel(
  params: SttWebsocketParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  if (info.family === "sonic") {
    ctx.report({
      code: "unsupported_capability",
      path: ["model"],
      model: params.model,
      message: `"${params.model}" is a text-to-speech (Sonic) model; wss /stt/websocket only accepts the Ink family (${STT_WEBSOCKET_MODEL_IDS.map((id) => `"${id}"`).join(", ")}).`,
      meta: { allowed: [...STT_WEBSOCKET_MODEL_IDS], source: STT_WEBSOCKET_DOCS },
    });
    return;
  }
  if (MODEL_ID_SET.has(params.model)) return;
  ctx.report({
    code: "invalid_enum_value",
    severity: "warning",
    path: ["model"],
    model: params.model,
    message: `"${params.model}" is not in the \`model\` enum wss /stt/websocket publishes for Cartesia-Version ${CARTESIA_VERSION} (${STT_WEBSOCKET_MODEL_IDS.map((id) => `"${id}"`).join(", ")}); it may be refused.`,
    meta: { allowed: [...STT_WEBSOCKET_MODEL_IDS], value: params.model, source: STT_WEBSOCKET_DOCS },
  });
}

const STT_LANGUAGE_SET = new Set<string>(CARTESIA_STT_LANGUAGES);

/**
 * `language` never errors here (see the module JSDoc): the 2026-03-01 enum is
 * `en` alone, but no page says the socket refuses another code and every other
 * source says it takes more. `en` (or no value) passes on every model. An
 * `ink-whisper` id — or one the catalog does not know — warns only outside the
 * 100 `ink-whisper` codes; `ink-2` / `ink-preview` warn on anything else, since
 * the field is "Used by `ink-whisper` models only." and they detect the
 * language themselves.
 */
function checkLanguage(
  params: SttWebsocketParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const language = params.language;
  const model = params.model;
  if (language === undefined || language === "en") return;
  if (info === undefined || model === "ink-whisper" || model.startsWith("ink-whisper-")) {
    if (STT_LANGUAGE_SET.has(language)) return;
    ctx.report({
      code: "invalid_enum_value",
      severity: "warning",
      path: ["language"],
      model,
      message: `\`language\` ${JSON.stringify(language)} is not one of the ${CARTESIA_STT_LANGUAGES.length} \`ink-whisper\` codes; it may be refused. (The 2026-03-01 socket reference publishes only "en", while its troubleshooting page says to pass \`?language=xx\` with any ISO 639-1 code.)`,
      meta: { allowed: [...CARTESIA_STT_LANGUAGES], value: language, source: INK_WHISPER_LANGUAGES_DOCS },
    });
    return;
  }
  ctx.report({
    code: "invalid_enum_value",
    severity: "warning",
    path: ["language"],
    model,
    message: `\`language\` is "Used by \`ink-whisper\` models only." on wss /stt/websocket; "${model}" may ignore ${JSON.stringify(language)} — \`ink-2\` and \`ink-preview\` detect English, French, Hindi, Japanese and Spanish automatically.`,
    meta: { allowed: ["en"], value: language, source: STT_WEBSOCKET_LATEST_DOCS },
  });
}

/**
 * The total-character half of "up to 100 keyterms totaling 1200 characters" —
 * the count is capped in the schema, the total is not expressible there.
 */
function checkKeyterms(
  params: SttWebsocketParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const keyterm = params.keyterm;
  if (keyterm === undefined) return;
  const terms = typeof keyterm === "string" ? [keyterm] : keyterm;
  if (!Array.isArray(terms)) return;
  const total = terms.reduce((sum, term) => sum + (typeof term === "string" ? term.length : 0), 0);
  if (total <= STT_WEBSOCKET_KEYTERM_TOTAL_CHARACTERS_MAX) return;
  ctx.report({
    code: "invalid_shape",
    path: ["keyterm"],
    model: params.model,
    message: `\`keyterm\` totals ${total} characters across ${terms.length} terms; wss /stt/websocket accepts up to ${STT_WEBSOCKET_KEYTERM_MAX} keyterms totaling ${STT_WEBSOCKET_KEYTERM_TOTAL_CHARACTERS_MAX} characters.`,
    meta: {
      limit: STT_WEBSOCKET_KEYTERM_TOTAL_CHARACTERS_MAX,
      actual: total,
      source: STT_WEBSOCKET_DOCS,
    },
  });
}

// ---------------------------------------------------------------------------
// Builder — the socket URL.
// ---------------------------------------------------------------------------

/**
 * Builds the realtime STT socket address from validated params, appending the
 * required `cartesia_version` query param (the REST endpoints carry the same
 * value as the `Cartesia-Version` header) and repeating `keyterm` once per
 * term. Auth is deliberately absent — send an `Authorization: Bearer <api_key>`
 * header, or append
 * your own `access_token` query param when connecting from a browser.
 */
export function sttWebsocketUrl(
  params: SttWebsocketParams,
  cartesiaVersion: string = CARTESIA_VERSION,
): string {
  const search = new URLSearchParams();
  search.set("model", params.model);
  search.set("encoding", params.encoding);
  search.set("sample_rate", String(params.sample_rate));
  search.set("cartesia_version", cartesiaVersion);
  if (params.language !== undefined) search.set("language", params.language);
  if (params.min_volume !== undefined) search.set("min_volume", String(params.min_volume));
  if (params.max_silence_duration_secs !== undefined) {
    search.set("max_silence_duration_secs", String(params.max_silence_duration_secs));
  }
  const keyterm = params.keyterm;
  if (typeof keyterm === "string") search.append("keyterm", keyterm);
  else for (const term of keyterm ?? []) search.append("keyterm", term);
  return `${STT_WEBSOCKET_URL}?${search.toString()}`;
}

// ---------------------------------------------------------------------------
// Validator — no `finalize`: there is no HTTP body and no fetchable URL, so
// the validated object is the session config itself (see module JSDoc).
// ---------------------------------------------------------------------------

const validator = createValidator<SttWebsocketParams>({
  endpoint: "cartesia.sttWebsocket",
  schema,
  modelId: (params) => params.model,
  catalog: models,
  constraints: sttWebsocketConstraints,
  checks: [checkRealtimeSttModel, checkLanguage, checkKeyterms],
  // No estimate: Cartesia publishes no USD rate (credits only — see models.ts),
  // and the length of a live session is unknowable at connect time anyway.
});

/**
 * Validates the SESSION CONFIG of the Cartesia realtime STT WebSocket
 * (`wss://api.cartesia.ai/stt/websocket`) — the query params that configure the
 * transcription session, including the `ink-2`-only keyterm prompting and the
 * `ink-whisper`-only silence controls.
 *
 * The result is the validated config; turn it into the socket address with
 * {@link sttWebsocketUrl}. Streaming audio frames, sending `finalize` /
 * `close`, and reading transcripts back is transport and outside unmodel's
 * scope, as is auth.
 *
 * ```ts
 * const session = cartesia.sttWebsocket({
 *   model: "ink-2",
 *   encoding: "pcm_s16le",
 *   sample_rate: 16000,
 *   keyterm: ["Cartesia", "Ink 2"],
 * });
 * const ws = new WebSocket(sttWebsocketUrl(session), {
 *   headers: { Authorization: `Bearer ${process.env.CARTESIA_API_KEY}` },
 * });
 * ```
 */
export const sttWebsocket = validator as unknown as {
  <T extends SttWebsocketParams>(
    params: T & ExactKeys<T, SttWebsocketParams>,
    options?: ValidateOptions<T>,
  ): T;
  safe<T extends SttWebsocketParams>(
    params: T & ExactKeys<T, SttWebsocketParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<T>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
