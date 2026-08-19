/**
 * OpenAI Realtime GA session configuration.
 *
 * `realtimeSession` validates the SESSION CONFIG OBJECT (`type: "realtime"`)
 * — the same shape the GA API accepts in two places (verified 2026-08-13
 * against the OpenAPI-generated openai@7.4.0
 * `resources/realtime/{realtime,client-secrets}.d.ts` types and
 * https://developers.openai.com/api/docs/guides/realtime):
 * - as the `session` field of `POST /v1/realtime/client_secrets` (the REST
 *   surface that mints ephemeral client keys — "Use POST
 *   /v1/realtime/client_secrets to create ephemeral credentials for browser
 *   or mobile clients"), and
 * - as the `session` payload of the `session.update` WebSocket client event.
 *
 * unmodel validates the config object, not a transport: the enumerable props
 * of the result are the session object itself. To mint a client secret,
 * wrap it — `body: JSON.stringify({ session: params })` against
 * `.request.url` — which is what `.toSdk("openai")` returns for
 * `client.realtime.clientSecrets.create(...)`. The WebSocket/WebRTC
 * connection that actually runs the conversation is transport and out of
 * unmodel's scope.
 *
 * Wire notes:
 * - `output_modalities` defaults to `["audio"]`; requesting both `"text"`
 *   and `"audio"` at once is documented as impossible and reported here.
 * - Audio formats are objects: `{ type: "audio/pcm", rate: 24000 }`,
 *   `{ type: "audio/pcmu" }`, `{ type: "audio/pcma" }`.
 * - `audio.output.voice` accepts the documented built-in voices, any plain
 *   string, or a custom voice object `{ id: "voice_1234" }` — unknown
 *   strings are NOT rejected (custom voices are legal), so there is no
 *   per-model voice constraint.
 * - `reasoning` and `parallel_tool_calls` are documented for
 *   reasoning-capable Realtime models only; for catalog-known models this is
 *   enforced via the catalog's `reasoning` flag.
 * - The generated catalog currently tracks only `gpt-realtime-2.1`; other
 *   documented ids (gpt-realtime, gpt-realtime-mini, ...) validate with an
 *   unknown_model warning until models.dev catches up.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { estimateToolDefinitionTokens } from "../../core/tokens";
import { models } from "../../catalog/openai.gen";

/**
 * The REST surface that accepts a session config: it returns an ephemeral
 * client secret (`ek_...`) plus the effective session object.
 */
export const REALTIME_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";

// ---------------------------------------------------------------------------
// Wire types — mirror the GA session object exactly (openai@7.4.0
// RealtimeSessionCreateRequest). Explicit `null` means "turn off" on the
// nullable fields (turn_detection, noise_reduction, transcription, tracing).
// ---------------------------------------------------------------------------

/**
 * Realtime model ids the GA API documents (openai@7.4.0 model union, plus
 * `gpt-realtime-translate`, which the realtime guide and the pricing page
 * both list — "$0.034 / minute" — while the SDK union omits it; re-audited
 * 2026-08-13 against
 * https://developers.openai.com/api/docs/guides/realtime and
 * https://developers.openai.com/api/docs/pricing).
 */
export type OpenaiRealtimeModelId =
  | "gpt-realtime"
  | "gpt-realtime-1.5"
  | "gpt-realtime-2"
  | "gpt-realtime-2.1"
  | "gpt-realtime-2.1-mini"
  | "gpt-realtime-translate"
  | "gpt-realtime-2025-08-28"
  | "gpt-realtime-mini"
  | "gpt-realtime-mini-2025-10-06"
  | "gpt-realtime-mini-2025-12-15"
  | "gpt-4o-realtime-preview"
  | "gpt-4o-realtime-preview-2024-10-01"
  | "gpt-4o-realtime-preview-2024-12-17"
  | "gpt-4o-realtime-preview-2025-06-03"
  | "gpt-4o-mini-realtime-preview"
  | "gpt-4o-mini-realtime-preview-2024-12-17"
  | "gpt-audio-1.5"
  | "gpt-audio-mini"
  | "gpt-audio-mini-2025-10-06"
  | "gpt-audio-mini-2025-12-15";

/** Built-in voices; custom voices ride as plain ids or `{ id }` objects. */
export type RealtimeVoice =
  | "alloy"
  | "ash"
  | "ballad"
  | "coral"
  | "echo"
  | "sage"
  | "shimmer"
  | "verse"
  | "marin"
  | "cedar";

/** PCM is 24kHz only; pcmu/pcma are the G.711 telephone formats. */
export type RealtimeAudioFormat =
  | { type?: "audio/pcm"; rate?: 24000 }
  | { type: "audio/pcmu" }
  | { type: "audio/pcma" };

export interface RealtimeNoiseReduction {
  /** `near_field` for close mics (headsets), `far_field` for room mics. */
  type?: "near_field" | "far_field";
}

export interface RealtimeTranscription {
  /** Emission delay; only supported with gpt-realtime-whisper in GA sessions. */
  delay?: "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Guidance keywords; supported by gpt-transcribe / gpt-live-transcribe. */
  keywords?: string[];
  /** ISO-639-1 input language, improves accuracy and latency. */
  language?: string;
  /** Possible input languages (gpt-transcribe / gpt-live-transcribe). */
  languages?: string[];
  model?:
    | "whisper-1"
    | "gpt-transcribe"
    | "gpt-live-transcribe"
    | "gpt-4o-mini-transcribe"
    | "gpt-4o-mini-transcribe-2025-12-15"
    | "gpt-4o-transcribe"
    | "gpt-4o-transcribe-diarize"
    | "gpt-realtime-whisper"
    | (string & {});
  /** Style guidance; not supported with gpt-realtime-whisper in GA sessions. */
  prompt?: string;
}

export interface RealtimeServerVad {
  type: "server_vad";
  create_response?: boolean;
  /** Auto-response timeout after model audio finishes; server_vad only. */
  idle_timeout_ms?: number | null;
  interrupt_response?: boolean;
  /** Audio included before detected speech, ms. Default 300. */
  prefix_padding_ms?: number;
  /** Silence that ends a turn, ms. Default 500. */
  silence_duration_ms?: number;
  /** VAD activation threshold 0.0–1.0. Default 0.5. */
  threshold?: number;
}

export interface RealtimeSemanticVad {
  type: "semantic_vad";
  create_response?: boolean;
  /** Max-timeout eagerness; `auto` (default) is equivalent to `medium`. */
  eagerness?: "low" | "medium" | "high" | "auto";
  interrupt_response?: boolean;
}

export type RealtimeTurnDetection = RealtimeServerVad | RealtimeSemanticVad;

export interface RealtimeAudioInput {
  format?: RealtimeAudioFormat;
  /** `null` turns noise reduction off. */
  noise_reduction?: RealtimeNoiseReduction | null;
  /** Async transcription of input audio; defaults to off, `null` turns off. */
  transcription?: RealtimeTranscription | null;
  /** `null` turns VAD off — the client must trigger responses manually. */
  turn_detection?: RealtimeTurnDetection | null;
}

export interface RealtimeAudioOutput {
  format?: RealtimeAudioFormat;
  /** Playback speed multiple, 0.25–1.5. Default 1.0. */
  speed?: number;
  /** A built-in voice, a custom voice id string, or `{ id: "voice_1234" }`. */
  voice?: RealtimeVoice | (string & {}) | { id: string };
}

export interface RealtimeAudioConfig {
  input?: RealtimeAudioInput;
  output?: RealtimeAudioOutput;
}

export interface RealtimeFunctionTool {
  type?: "function";
  name?: string;
  description?: string;
  /** Parameters of the function in JSON Schema. */
  parameters?: unknown;
}

export interface RealtimeMcpToolFilter {
  read_only?: boolean;
  tool_names?: string[];
}

/** Remote MCP server tool; one of server_url/connector_id/tunnel_id required. */
export interface RealtimeMcpTool {
  type: "mcp";
  server_label: string;
  allowed_callers?: Array<"direct" | "programmatic"> | null;
  allowed_tools?: string[] | RealtimeMcpToolFilter | null;
  authorization?: string;
  connector_id?:
    | "connector_dropbox"
    | "connector_gmail"
    | "connector_googlecalendar"
    | "connector_googledrive"
    | "connector_microsoftteams"
    | "connector_outlookcalendar"
    | "connector_outlookemail"
    | "connector_sharepoint";
  defer_loading?: boolean;
  headers?: Record<string, string> | null;
  require_approval?:
    | { always?: RealtimeMcpToolFilter; never?: RealtimeMcpToolFilter }
    | "always"
    | "never"
    | null;
  server_description?: string;
  server_url?: string;
  tunnel_id?: string;
}

export type RealtimeTool = RealtimeFunctionTool | RealtimeMcpTool;

export type RealtimeToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; name: string }
  | { type: "mcp"; server_label: string; name?: string | null };

export type RealtimeTracing =
  | "auto"
  | { group_id?: string; metadata?: unknown; workflow_name?: string };

export type RealtimeTruncation =
  | "auto"
  | "disabled"
  | {
      type: "retention_ratio";
      /** Fraction of post-instruction tokens to retain, 0.0–1.0. */
      retention_ratio: number;
      token_limits?: { post_instructions?: number };
    };

/** Reference to a stored prompt template and its variables. */
export interface RealtimePrompt {
  id: string;
  variables?: Record<string, unknown> | null;
  version?: string | null;
}

export interface RealtimeReasoning {
  /** Reasoning-capable Realtime models only. */
  effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
}

/** The GA realtime session configuration object. */
export interface RealtimeSessionBody {
  /** Always "realtime" for the Realtime API (transcription sessions differ). */
  type: "realtime";
  audio?: RealtimeAudioConfig;
  include?: Array<"item.input_audio_transcription.logprobs">;
  instructions?: string;
  /** Integer 1–4096, or "inf" (the default) for the model maximum. */
  max_output_tokens?: number | "inf";
  model?: OpenaiRealtimeModelId | (string & {});
  /** Defaults to ["audio"]; text+audio together is not possible. */
  output_modalities?: Array<"text" | "audio">;
  /** Reasoning Realtime models only. */
  parallel_tool_calls?: boolean;
  prompt?: RealtimePrompt | null;
  reasoning?: RealtimeReasoning;
  tool_choice?: RealtimeToolChoice;
  tools?: RealtimeTool[];
  /** `null` disables tracing; "auto" traces with default metadata. */
  tracing?: RealtimeTracing | null;
  truncation?: RealtimeTruncation;
}

/** `.toSdk("openai")` shape: `client.realtime.clientSecrets.create({ session })`. */
export interface RealtimeSessionSdkParams<T extends RealtimeSessionBody = RealtimeSessionBody> {
  session: T;
}

// ---------------------------------------------------------------------------
// Schema — loose; unknown keys pass through with a warning.
// ---------------------------------------------------------------------------

const audioFormatSchema = z.looseObject({
  type: z.enum(["audio/pcm", "audio/pcmu", "audio/pcma"]).optional(),
  rate: z.literal(24000).optional(),
});

const turnDetectionSchema = z.discriminatedUnion("type", [
  z.looseObject({
    type: z.literal("server_vad"),
    create_response: z.boolean().optional(),
    idle_timeout_ms: z.number().nullable().optional(),
    interrupt_response: z.boolean().optional(),
    prefix_padding_ms: z.number().optional(),
    silence_duration_ms: z.number().optional(),
    threshold: z.number().min(0).max(1).optional(),
  }),
  z.looseObject({
    type: z.literal("semantic_vad"),
    create_response: z.boolean().optional(),
    eagerness: z.enum(["low", "medium", "high", "auto"]).optional(),
    interrupt_response: z.boolean().optional(),
  }),
]);

const audioSchema = z.looseObject({
  input: z
    .looseObject({
      format: audioFormatSchema.optional(),
      noise_reduction: z
        .looseObject({ type: z.enum(["near_field", "far_field"]).optional() })
        .nullable()
        .optional(),
      transcription: z
        .looseObject({
          delay: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
          keywords: z.array(z.string()).optional(),
          language: z.string().optional(),
          languages: z.array(z.string()).optional(),
          model: z.string().optional(),
          prompt: z.string().optional(),
        })
        .nullable()
        .optional(),
      turn_detection: turnDetectionSchema.nullable().optional(),
    })
    .optional(),
  output: z
    .looseObject({
      format: audioFormatSchema.optional(),
      // 0.25 minimum, 1.5 maximum (GA session docs).
      speed: z.number().min(0.25).max(1.5).optional(),
      voice: z.union([z.string(), z.looseObject({ id: z.string() })]).optional(),
    })
    .optional(),
});

const realtimeSessionSchema = z.looseObject({
  type: z.literal("realtime"),
  audio: audioSchema.optional(),
  include: z.array(z.literal("item.input_audio_transcription.logprobs")).optional(),
  instructions: z.string().optional(),
  // "an integer between 1 and 4096 ... or `inf`" (GA session docs).
  max_output_tokens: z.union([z.number().int().min(1).max(4096), z.literal("inf")]).optional(),
  model: z.string().optional(),
  output_modalities: z.array(z.enum(["text", "audio"])).optional(),
  parallel_tool_calls: z.boolean().optional(),
  prompt: z
    .looseObject({
      id: z.string(),
      variables: z.record(z.string(), z.unknown()).nullable().optional(),
      version: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  reasoning: z
    .looseObject({
      effort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
    })
    .optional(),
  tool_choice: z
    .union([
      z.enum(["none", "auto", "required"]),
      z.looseObject({ type: z.literal("function"), name: z.string() }),
      z.looseObject({
        type: z.literal("mcp"),
        server_label: z.string(),
        name: z.string().nullable().optional(),
      }),
    ])
    .optional(),
  tools: z.array(z.looseObject({ type: z.string().optional() })).optional(),
  tracing: z
    .union([
      z.literal("auto"),
      z.looseObject({
        group_id: z.string().optional(),
        metadata: z.unknown().optional(),
        workflow_name: z.string().optional(),
      }),
    ])
    .nullable()
    .optional(),
  truncation: z
    .union([
      z.enum(["auto", "disabled"]),
      z.looseObject({
        type: z.literal("retention_ratio"),
        retention_ratio: z.number().min(0).max(1),
        token_limits: z.looseObject({ post_instructions: z.number().optional() }).optional(),
      }),
    ])
    .optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * "It is not possible to request both `text` and `audio` at the same time"
 * (GA session docs, openai@7.4.0 output_modalities docstring).
 */
function checkOutputModalities(
  params: RealtimeSessionBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const modalities = params.output_modalities;
  if (!Array.isArray(modalities)) return;
  if (modalities.includes("text") && modalities.includes("audio")) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["output_modalities"],
      message:
        '`output_modalities` cannot request both "text" and "audio" at the same time; use ["audio"] (which includes a transcript) or ["text"].',
      meta: { value: [...modalities] },
    });
  }
}

/**
 * `reasoning` and `parallel_tool_calls` are documented for reasoning-capable
 * Realtime models only; enforced when the catalog knows the model.
 */
function checkReasoningCapability(
  params: RealtimeSessionBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined || info.reasoning) return;
  for (const param of ["reasoning", "parallel_tool_calls"] as const) {
    if (params[param] != null) {
      ctx.report({
        code: "unsupported_capability",
        path: [param],
        model: params.model,
        message: `\`${param}\` is only supported by reasoning-capable Realtime models; "${params.model}" is not reasoning-capable per the catalog.`,
      });
    }
  }
}

/**
 * MCP tools require `server_label` and one of `server_url`, `connector_id`,
 * or `tunnel_id` ("One of server_url, connector_id, or tunnel_id must be
 * provided" — openai@7.4.0 MCP tool docstring).
 */
function checkMcpTools(
  params: RealtimeSessionBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (!Array.isArray(params.tools)) return;
  params.tools.forEach((tool, index) => {
    if (tool == null || (tool as { type?: string }).type !== "mcp") return;
    const mcp = tool as Partial<RealtimeMcpTool>;
    if (typeof mcp.server_label !== "string" || mcp.server_label.length === 0) {
      ctx.report({
        code: "invalid_shape",
        path: ["tools", index, "server_label"],
        message: "MCP tools require a non-empty `server_label`.",
      });
    }
    if (mcp.server_url == null && mcp.connector_id == null && mcp.tunnel_id == null) {
      ctx.report({
        code: "invalid_shape",
        path: ["tools", index],
        message:
          "MCP tools require one of `server_url`, `connector_id`, or `tunnel_id`.",
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Estimation — instructions + tool definitions are the only up-front text;
// audio usage is unknowable before the session, so no cost estimate.
// ---------------------------------------------------------------------------

function estimate(
  params: RealtimeSessionBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): ValidateEstimate {
  let inputTokens = 0;
  if (typeof params.instructions === "string") {
    inputTokens += ctx.tokenizer.count(params.instructions);
  }
  if (Array.isArray(params.tools)) {
    for (const tool of params.tools) {
      inputTokens += estimateToolDefinitionTokens(ctx.tokenizer, tool);
    }
  }
  return inputTokens > 0 ? { inputTokens } : {};
}

// ---------------------------------------------------------------------------
// Finalize — the enumerable props ARE the session config object;
// `.toSdk("openai")` wraps it the way both the SDK and the raw client_secrets
// body expect.
// ---------------------------------------------------------------------------

/**
 * SDK targets for `openai.realtimeSession`. Only `"openai"`: the realtime
 * session config has no AI SDK counterpart, so no other target is declared.
 * Type alias, not interface — an interface has no implicit index signature and
 * cannot satisfy `SdkFormatters`.
 */
type RealtimeSessionSdkTargets<T extends RealtimeSessionBody> = {
  openai: () => RealtimeSessionSdkParams<T>;
};

function finalize(params: RealtimeSessionBody): unknown {
  const body = { ...params };
  return toValidated(
    body,
    {
      url: REALTIME_CLIENT_SECRETS_URL,
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { openai: () => ({ session: body }) } },
  );
}

const validator = createValidator<RealtimeSessionBody, unknown>({
  endpoint: "openai.realtimeSession",
  schema: realtimeSessionSchema,
  // `model` is optional (client_secrets applies a server default we cannot
  // verify); model-dependent checks are skipped when it is omitted.
  modelId: (params) => params.model,
  catalog: models,
  checks: [checkOutputModalities, checkReasoningCapability, checkMcpTools],
  estimate,
  finalize,
});

/**
 * Validates a GA Realtime SESSION CONFIG OBJECT (`type: "realtime"`) — not
 * an HTTP body. The same object is accepted as the `session` field of
 * `POST /v1/realtime/client_secrets` (which `.request` points at) and as the
 * `session` payload of the `session.update` WebSocket client event; the
 * WebSocket/WebRTC conversation itself is transport, out of unmodel's scope.
 *
 * The result's enumerable props are the session object; wrap it to mint an
 * ephemeral client key. `.toSdk("openai")` returns `{ session }` for
 * `client.realtime.clientSecrets.create(...)`.
 *
 * ```ts
 * const session = openai.realtimeSession({
 *   type: "realtime",
 *   model: "gpt-realtime-2.1",
 *   instructions: "You are a concise voice assistant.",
 *   audio: { output: { voice: "marin", speed: 1.1 } },
 * });
 * const secret = await fetch(session.request.url, {
 *   method: session.request.method,
 *   headers: { ...session.request.headers, authorization: `Bearer ${key}` },
 *   body: JSON.stringify({ session }),
 * }).then((r) => r.json());
 * ```
 */
export const realtimeSession = validator as unknown as {
  <T extends RealtimeSessionBody>(
    params: T & ExactKeys<T, RealtimeSessionBody>,
    options?: ValidateOptions,
  ): Validated<T, RealtimeSessionSdkTargets<T>>;
  safe<T extends RealtimeSessionBody>(
    params: T & ExactKeys<T, RealtimeSessionBody>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, RealtimeSessionSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
