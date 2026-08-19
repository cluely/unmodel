import { z } from "zod";
import type { AmazonBedrockModelId } from "../../catalog/amazon-bedrock.gen";

// ---------------------------------------------------------------------------
// Wire leaf for the Bedrock Runtime Converse API: the wire types and the zod
// schema, and nothing else. This module imports only zod and type-only
// catalog ids — no pipeline, no validator, no checks — so retarget/translate
// machinery can depend on the Converse dialect without creating a cycle back
// through ./chat.ts. Enforced by test/import-graph.test.ts.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Wire types — mirror the Converse request body exactly. AWS models most of
// these as tagged UNIONS (exactly one member key set); that is expressed here
// as interfaces of optional members plus a runtime exactly-one check, matching
// the shape users write in JSON.
// ---------------------------------------------------------------------------

/** Prompt-cache checkpoint marker (API_runtime_CachePointBlock). */
export interface BedrockCachePoint {
  type: "default";
  /** Extended-TTL caching; omitted → the model's default (usually 5m). */
  ttl?: "5m" | "1h";
}

/** An object location in S3 (API_runtime_S3Location). */
export interface BedrockS3Location {
  /** Object URI starting with `s3://`. */
  uri: string;
  /** Account id when the bucket belongs to another AWS account. */
  bucketOwner?: string;
}

/**
 * UNION — exactly one of `bytes`/`s3Location`. On the raw wire `bytes` is the
 * base64-encoded file; AWS SDKs also accept raw `Uint8Array` (they encode for
 * you).
 */
export interface BedrockBytesSource {
  bytes?: string | Uint8Array;
  s3Location?: BedrockS3Location;
}

export type BedrockImageFormat = "png" | "jpeg" | "gif" | "webp";

export interface BedrockImageBlock {
  format: BedrockImageFormat;
  source: BedrockBytesSource;
}

export type BedrockVideoFormat =
  | "mkv"
  | "mov"
  | "mp4"
  | "webm"
  | "flv"
  | "mpeg"
  | "mpg"
  | "wmv"
  | "three_gp";

export interface BedrockVideoBlock {
  format: BedrockVideoFormat;
  source: BedrockBytesSource;
}

export type BedrockDocumentFormat =
  | "pdf"
  | "csv"
  | "doc"
  | "docx"
  | "xls"
  | "xlsx"
  | "html"
  | "txt"
  | "md";

/**
 * UNION — exactly one of `bytes`/`s3Location`/`text`/`content`
 * (API_runtime_DocumentSource). `content` entries are DocumentContentBlock
 * objects.
 */
export interface BedrockDocumentSource {
  bytes?: string | Uint8Array;
  s3Location?: BedrockS3Location;
  text?: string;
  content?: Array<Record<string, unknown>>;
}

export interface BedrockDocumentBlock {
  /** Alphanumerics/whitespace/hyphens/parens/brackets only; use a neutral name (prompt-injection surface). */
  name: string;
  source: BedrockDocumentSource;
  /** File format/extension; optional on the wire. */
  format?: BedrockDocumentFormat;
  citations?: { enabled: boolean };
  context?: string;
}

export interface BedrockToolUseBlock {
  toolUseId: string;
  name: string;
  input: unknown;
  type?: "server_tool_use";
}

/** UNION — exactly one member (API_runtime_ToolResultContentBlock). */
export interface BedrockToolResultContent {
  json?: unknown;
  text?: string;
  image?: BedrockImageBlock;
  document?: BedrockDocumentBlock;
  video?: BedrockVideoBlock;
  searchResult?: Record<string, unknown>;
}

export interface BedrockToolResultBlock {
  toolUseId: string;
  content: BedrockToolResultContent[];
  /** Only supported by Amazon Nova and Anthropic Claude models. */
  status?: "success" | "error";
  type?: string;
}

/**
 * UNION — exactly one member key must be set
 * (API_runtime_ContentBlock: "only one of the following members can be
 * specified"). guardContent/reasoningContent/citationsContent/searchResult/
 * audio are passed through unvalidated (their nested shapes are themselves
 * unions; see the API reference).
 */
export interface BedrockContentBlock {
  text?: string;
  image?: BedrockImageBlock;
  document?: BedrockDocumentBlock;
  video?: BedrockVideoBlock;
  toolUse?: BedrockToolUseBlock;
  toolResult?: BedrockToolResultBlock;
  guardContent?: Record<string, unknown>;
  cachePoint?: BedrockCachePoint;
  reasoningContent?: Record<string, unknown>;
  citationsContent?: Record<string, unknown>;
  searchResult?: Record<string, unknown>;
  audio?: Record<string, unknown>;
}

export interface BedrockMessage {
  role: "user" | "assistant" | "system";
  content: BedrockContentBlock[];
}

/** UNION — exactly one of `text`/`guardContent`/`cachePoint` (API_runtime_SystemContentBlock). */
export interface BedrockSystemContentBlock {
  text?: string;
  guardContent?: Record<string, unknown>;
  cachePoint?: BedrockCachePoint;
}

export interface BedrockInferenceConfig {
  /** Min 1; defaults to the model's maximum. */
  maxTokens?: number;
  /** Up to 2500 sequences, each non-empty. */
  stopSequences?: string[];
  /** 0..1. */
  temperature?: number;
  /** 0..1. */
  topP?: number;
}

export interface BedrockToolSpecification {
  /** 1-64 chars matching [a-zA-Z0-9_-]+. */
  name: string;
  /** UNION — the JSON member carries a JSON-Schema object. */
  inputSchema: { json?: unknown };
  description?: string;
  /** Structured-output enforcement of the tool-use response. */
  strict?: boolean;
}

/** UNION — exactly one of `toolSpec`/`cachePoint`/`systemTool` (API_runtime_Tool). */
export interface BedrockTool {
  toolSpec?: BedrockToolSpecification;
  cachePoint?: BedrockCachePoint;
  systemTool?: Record<string, unknown>;
}

/**
 * UNION — exactly one of `auto`/`any`/`tool` (API_runtime_ToolChoice).
 * `tool` (forced tool) is only supported by Anthropic Claude and Amazon Nova
 * models per the API reference.
 */
export interface BedrockToolChoice {
  auto?: Record<string, unknown>;
  any?: Record<string, unknown>;
  tool?: { name: string };
}

export interface BedrockToolConfig {
  /** At least one tool. */
  tools: BedrockTool[];
  toolChoice?: BedrockToolChoice;
}

export interface BedrockGuardrailConfig {
  guardrailIdentifier?: string;
  guardrailVersion?: string;
  trace?: "enabled" | "disabled" | "enabled_full";
}

/** Structured output for the model's text response (API_runtime_OutputFormat). */
export interface BedrockOutputConfig {
  textFormat?: {
    type: "json_schema";
    /** UNION (OutputFormatStructure) — e.g. { jsonSchema: {...} }. */
    structure: Record<string, unknown>;
  };
}

export interface ConverseParams {
  /**
   * Model id ("anthropic.claude-sonnet-4-5-20250929-v1:0"), inference-profile
   * id ("us.anthropic..."), or a model/prompt/provisioned-throughput ARN. On
   * the wire it lives only in the URL path — it is stripped from the
   * enumerable body and interpolated into `.request.url`.
   */
  modelId: AmazonBedrockModelId | (string & {});
  /** Optional on the wire (prompt-management resources carry their own). */
  messages?: BedrockMessage[];
  system?: BedrockSystemContentBlock[];
  inferenceConfig?: BedrockInferenceConfig;
  toolConfig?: BedrockToolConfig;
  guardrailConfig?: BedrockGuardrailConfig;
  /** Model-specific params beyond the base set (e.g. Claude's top_k). Any JSON value. */
  additionalModelRequestFields?: unknown;
  /** Up to 10 JSON-Pointer paths (1-256 chars each). */
  additionalModelResponseFieldPaths?: string[];
  /** Only used when modelId is a Prompt-management prompt ARN. */
  promptVariables?: Record<string, { text: string }>;
  /** Up to 16 string pairs for invocation-log filtering. */
  requestMetadata?: Record<string, string>;
  performanceConfig?: { latency?: "standard" | "optimized" };
  serviceTier?: { type: "priority" | "default" | "flex" | "reserved" };
  outputConfig?: BedrockOutputConfig;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through; the pipeline warns on unknown
// top-level keys by introspecting the shape).
// ---------------------------------------------------------------------------

const looseBlock = z.looseObject({});

const messageSchema = z.looseObject({
  role: z.enum(["user", "assistant", "system"]),
  content: z.array(looseBlock),
});

const CONTENT_BLOCK_MEMBERS = [
  "text",
  "image",
  "document",
  "video",
  "audio",
  "toolUse",
  "toolResult",
  "guardContent",
  "cachePoint",
  "reasoningContent",
  "citationsContent",
  "searchResult",
] as const;

const SYSTEM_BLOCK_MEMBERS = ["text", "guardContent", "cachePoint"] as const;
const TOOL_MEMBERS = ["toolSpec", "cachePoint", "systemTool"] as const;
const TOOL_CHOICE_MEMBERS = ["auto", "any", "tool"] as const;

/**
 * AWS union types require EXACTLY one member. Reports when more than one
 * known member is set, or when the object is empty. An object with only
 * unknown keys passes (a member kind newer than this validator).
 */
function refineUnion(
  ctx: z.core.$RefinementCtx,
  record: Record<string, unknown>,
  members: readonly string[],
  path: Array<string | number>,
  label: string,
): void {
  const set = members.filter((member) => record[member] !== undefined);
  if (set.length > 1) {
    ctx.addIssue({
      code: "custom",
      path,
      message: `${label} is a union — exactly one of ${members.join("/")} may be set; got ${set.join(", ")}.`,
    });
  } else if (set.length === 0 && Object.keys(record).length === 0) {
    ctx.addIssue({
      code: "custom",
      path,
      message: `${label} is a union — exactly one of ${members.join("/")} must be set; got an empty object.`,
    });
  }
}

/** Loose top-level schema for the Converse wire body. */
export const converseSchema = z
  .looseObject({
    modelId: z.string().min(1),
    messages: z.array(messageSchema).optional(),
    system: z.array(looseBlock).optional(),
    inferenceConfig: z
      .looseObject({
        maxTokens: z.int().min(1).optional(),
        stopSequences: z.array(z.string().min(1)).max(2500).optional(),
        temperature: z.number().min(0).max(1).optional(),
        topP: z.number().min(0).max(1).optional(),
      })
      .optional(),
    toolConfig: z
      .looseObject({
        tools: z.array(looseBlock).min(1, "toolConfig.tools requires at least one tool."),
        toolChoice: looseBlock.optional(),
      })
      .optional(),
    guardrailConfig: z
      .looseObject({
        guardrailIdentifier: z.string().optional(),
        guardrailVersion: z.string().optional(),
        trace: z.enum(["enabled", "disabled", "enabled_full"]).optional(),
      })
      .optional(),
    additionalModelRequestFields: z.unknown().optional(),
    additionalModelResponseFieldPaths: z.array(z.string().min(1).max(256)).max(10).optional(),
    promptVariables: z.record(z.string(), looseBlock).optional(),
    requestMetadata: z.record(z.string(), z.string()).optional(),
    performanceConfig: z
      .looseObject({ latency: z.enum(["standard", "optimized"]).optional() })
      .optional(),
    serviceTier: z
      .looseObject({ type: z.enum(["priority", "default", "flex", "reserved"]) })
      .optional(),
    outputConfig: z
      .looseObject({
        textFormat: z
          .looseObject({ type: z.literal("json_schema"), structure: z.looseObject({}) })
          .optional(),
      })
      .optional(),
  })
  .superRefine((params, ctx) => {
    params.messages?.forEach((message, i) => {
      message.content.forEach((block, j) => {
        refineUnion(ctx, block, CONTENT_BLOCK_MEMBERS, ["messages", i, "content", j], "ContentBlock");
      });
    });
    params.system?.forEach((block, i) => {
      refineUnion(ctx, block, SYSTEM_BLOCK_MEMBERS, ["system", i], "SystemContentBlock");
    });
    params.toolConfig?.tools.forEach((tool, i) => {
      refineUnion(ctx, tool, TOOL_MEMBERS, ["toolConfig", "tools", i], "Tool");
    });
    if (params.toolConfig?.toolChoice !== undefined) {
      refineUnion(
        ctx,
        params.toolConfig.toolChoice,
        TOOL_CHOICE_MEMBERS,
        ["toolConfig", "toolChoice"],
        "ToolChoice",
      );
    }
  });

