/**
 * Cartesia realtime Speech-to-Text (Manual) — the SESSION CONFIG of
 * `wss://api.cartesia.ai/stt/websocket`.
 *
 * This socket has no configuration *message*: the session is configured
 * entirely by the query params of the connection URL, and that config object is
 * what this module validates. The audio you then stream (binary frames of raw
 * PCM in the declared `encoding` / `sample_rate`), the `finalize` and `close`
 * text commands, and the `transcript` / `flush_done` / `done` frames coming
 * back are transport and stay out of scope — as is auth (`X-API-Key` header
 * from a server, or an `access_token` query param from a browser; unmodel never
 * touches credentials).
 *
 * Wire notes (verified 2026-08-13 against
 * https://docs.cartesia.ai/api-reference/stt/websocket, Cartesia-Version
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
 * - `keyterm` is a REPEATED query param: "Repeat the `keyterm` query parameter
 *   to pass multiple values, up to 100 keyterms totaling 1200 characters. To
 *   boost one multi-word phrase, join the words with `%20`." The params object
 *   takes a string or an array; {@link sttWebsocketUrl} repeats the key (and
 *   `URLSearchParams` percent-encodes the spaces for you).
 * - `language` publishes a single-value enum (`en`, the default) on this
 *   endpoint — a far smaller set than the ~100 codes batch /stt accepts.
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
import { models, type CartesiaSttModelId } from "./models";
import { CARTESIA_VERSION } from "./tts";
import type { CartesiaSttEncoding } from "./stt";

export const STT_WEBSOCKET_URL = "wss://api.cartesia.ai/stt/websocket";

const STT_WEBSOCKET_DOCS = "https://docs.cartesia.ai/api-reference/stt/websocket";

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

/** The only language code this socket publishes; it is also the default. */
export type CartesiaSttWebsocketLanguage = "en";

export interface SttWebsocketParams {
  /** REQUIRED. `ink-2` (realtime-only) or `ink-whisper`. */
  model: (typeof STT_WEBSOCKET_MODEL_IDS)[number] | (string & {});
  /** REQUIRED. How the server interprets the raw binary audio you send. */
  encoding: CartesiaSttEncoding;
  /** REQUIRED. Sample rate of the audio in Hz. */
  sample_rate: number;
  /** ISO-639-1 code; `en` is the only published value and the default. */
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

export const sttWebsocketConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  "ink-2": {
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
  },
  "ink-whisper": {
    deny: {
      keyterm: {
        reason: "keyterm prompting is used by `ink-2` models only",
        source: STT_WEBSOCKET_DOCS,
        ignored: true,
      },
    },
  },
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

/** `language` is a single-value enum on this endpoint (`en`, also the default). */
function checkLanguage(
  params: SttWebsocketParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const language = params.language;
  if (language === undefined || language === "en") return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["language"],
    model: params.model,
    message: `\`language\` must be "en" on wss /stt/websocket (the only code it publishes, and its default); got ${JSON.stringify(language)}. Batch POST /stt accepts the long multilingual list.`,
    meta: { allowed: ["en"], value: language, source: STT_WEBSOCKET_DOCS },
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
 * term. Auth is deliberately absent — send an `X-API-Key` header, or append
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
 *   headers: { "X-API-Key": process.env.CARTESIA_API_KEY! },
 * });
 * ```
 */
export const sttWebsocket = validator as unknown as {
  <T extends SttWebsocketParams>(
    params: T & ExactKeys<T, SttWebsocketParams>,
    options?: ValidateOptions,
  ): T;
  safe<T extends SttWebsocketParams>(
    params: T & ExactKeys<T, SttWebsocketParams>,
    options?: ValidateOptions,
  ): ValidateResult<T>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
