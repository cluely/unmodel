import { models } from "../../catalog/anthropic.gen";
import { createValidator, constraintsFor as constraintsForModel } from "../../core/pipeline";
import type { PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS } from "../../core/request";
import type { Validated, ExactKeys, RequestMeta } from "../../core/request";
import { createToApi } from "../../core/translate/retarget";
import { targetValidationFor } from "../../retarget/target-constraints";
import type { AiSdkChatResult } from "../../core/translate/ai-sdk";
import { createAiSdkChat } from "../../core/translate/ai-sdk";
import type { ChatIR } from "../../core/translate/ir";
import { encodeAnthropic } from "./interop";
// Rule 3 of the import graph in action: an endpoint module may reach another
// provider's `interop.ts` and NOTHING else of theirs. This pulls in the
// openai-chat codec and its type-only wire imports — not openai-compatible's
// zod schema, catalog or checks.
import { decodeOpenAIChat } from "../openai-compatible/interop";
import { availability } from "../../catalog/availability/anthropic.gen";
import type { AnthropicAvailability } from "../../catalog/availability/anthropic.gen";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo, ModelsWhereFalse } from "../../core/catalog-types";
import type { EndpointConstraints, MediaRule } from "../../core/constraint-types";
import { PER_MESSAGE_TOKEN_OVERHEAD, estimateToolDefinitionTokens } from "../../core/tokens";
import { computeCostUSD } from "../../core/cost";
import { toBytes } from "../../core/media/bytes";
import { sniffImage } from "../../core/media/image";
import type { SniffedImage } from "../../core/media/image";
import { findMediaDeclaration, reportMediaIssues } from "../../core/media/check";
import type { MediaDeclaration } from "../../core/options";
import {
  BETWEEN_TOOLS_MODEL_IDS,
  chatConstraints,
  chatFamilyRules,
  COMPUTER_TOOLSET_ONLY_MODEL_IDS,
  ERRORS_DOCS,
  FAST_MODE_DOCS,
  FAST_MODE_IGNORED_MODEL_IDS,
  FAST_MODE_MODEL_IDS,
  FORCED_TOOL_USE_REMOVED_MODEL_IDS,
  GEN_4_7_PLUS_MODEL_IDS,
  isListed,
  PREFILL_REMOVED_MODEL_IDS,
  PROMPT_LENGTH_TIER_THRESHOLD,
  PROMPT_LENGTH_TIERED_MODEL_IDS,
  REMOVED_COMPUTER_TOOL_TYPES,
  THINKING_ALWAYS_ON_MODEL_IDS,
  THINKING_DOCS,
  THINKING_OFF_CAPPED_AT_HIGH_MODEL_IDS,
  VISION_DOCS,
} from "./constraints";
import type {
  BetweenToolsModelId,
  FastModeModelId,
  ForcedToolUseRemovedModelId,
  Gen47PlusModelId,
  ThinkingAlwaysOnModelId,
} from "./constraints";
import type { AnthropicModelId } from "../../catalog/anthropic.gen";
import { messagesSchema } from "./wire";
import type { MessagesBody, ThinkingConfig } from "./wire";
import type {
  ValidatorProviderCarrier,
  ValidatorResultKind,
  ValidatorResultKindCarrier,
} from "../../core/validator-result-kind";

// The wire types and the zod schema live in ./wire.ts (a leaf that imports
// only zod), so translation machinery can reach the dialect without pulling
// in this validator. Re-exported here so the module's public surface is
// unchanged.
export type {
  CacheControlEphemeral,
  TextBlock,
  ImageMediaType,
  Base64ImageSource,
  UrlImageSource,
  FileImageSource,
  ImageSource,
  ImageBlock,
  DocumentSource,
  DocumentBlock,
  ToolUseBlock,
  ToolResultBlock,
  ThinkingBlock,
  RedactedThinkingBlock,
  ContentBlock,
  MessageParam,
  CustomTool,
  ServerTool,
  Tool,
  ToolChoice,
  ThinkingConfig,
  MessagesBody,
} from "./wire";

export const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
/** Required `anthropic-version` header value. */
export const ANTHROPIC_VERSION = "2023-06-01";

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const constraintSpec = { constraints: chatConstraints, familyRules: chatFamilyRules };

type BlockVisitor = (block: Record<string, unknown>, path: Array<string | number>) => void;

/** Visits every content block, including blocks nested in tool_result content. */
function eachBlock(params: MessagesBody, visit: BlockVisitor): void {
  const visitList = (blocks: unknown[], prefix: Array<string | number>): void => {
    blocks.forEach((block, index) => {
      if (typeof block !== "object" || block === null) return;
      const record = block as Record<string, unknown>;
      visit(record, [...prefix, index]);
      if (record["type"] === "tool_result" && Array.isArray(record["content"])) {
        visitList(record["content"], [...prefix, index, "content"]);
      }
    });
  };
  params.messages.forEach((message, i) => {
    if (Array.isArray(message.content)) visitList(message.content, ["messages", i, "content"]);
  });
}

export function checkCapabilities(
  params: MessagesBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  const model = params.model;

  if (params.tools !== undefined && params.tools.length > 0 && !info.toolCall) {
    // Named, not just counted: a request assembled from a tool registry can
    // carry tools the call site never mentions.
    const names = params.tools.map((tool) => tool.name);
    ctx.report({
      code: "unsupported_capability",
      path: ["tools"],
      model,
      message: `"${model}" does not support tool calling, and ${names.length} tool(s) were supplied (${names.join(", ")}); remove \`tools\`.`,
      meta: { tools: names },
    });
  }

  if (params.thinking !== undefined && params.thinking.type !== "disabled" && !info.reasoning) {
    ctx.report({
      code: "unsupported_capability",
      path: ["thinking"],
      model,
      message: `"${model}" does not support thinking; remove \`thinking\`.`,
    });
  }

  // Sampling params were removed on `temperature: false` model generations,
  // but the documented DEFAULTS remain accepted for backwards compatibility:
  // temperature 1.0 and top_p >= 0.99 pass, everything else returns a 400
  // (API reference deprecation notes). top_k rejects ANY value and is
  // enforced via the constraints deny table.
  if (params.temperature !== undefined && params.temperature !== 1 && info.temperature === false) {
    ctx.report({
      code: "unsupported_param",
      path: ["temperature"],
      model,
      message: `\`temperature\` is not supported by "${model}": sampling parameters were removed on this model generation; only the default 1.0 is accepted for backwards compatibility, other values return a 400.`,
      meta: { source: THINKING_DOCS },
    });
  }

  if (params.top_p !== undefined && params.top_p < 0.99 && info.temperature === false) {
    ctx.report({
      code: "unsupported_param",
      path: ["top_p"],
      model,
      message: `\`top_p\` is not supported by "${model}": sampling parameters were removed on this model generation; only values >= 0.99 are accepted for backwards compatibility, other values return a 400.`,
      meta: { source: THINKING_DOCS },
    });
  }

  const outputLimit = info.limit.output ?? 0;
  if (outputLimit > 0 && params.max_tokens > outputLimit) {
    ctx.report({
      code: "over_output_limit",
      path: ["max_tokens"],
      model,
      message: `max_tokens ${params.max_tokens} exceeds the ${outputLimit}-token output limit of "${model}".`,
      meta: { requested: params.max_tokens, limit: outputLimit },
    });
  }

  if (!info.modalities.input.includes("image")) {
    eachBlock(params, (block, path) => {
      if (block["type"] !== "image") return;
      ctx.report({
        code: "unsupported_capability",
        path,
        model,
        message: `"${model}" does not accept image input; remove the image block.`,
      });
    });
  }

  if (!info.modalities.input.includes("pdf")) {
    eachBlock(params, (block, path) => {
      if (block["type"] !== "document") return;
      const source = block["source"];
      const sourceType =
        typeof source === "object" && source !== null
          ? (source as Record<string, unknown>)["type"]
          : undefined;
      // text/content document sources carry plain text, not PDF input.
      if (sourceType !== "base64" && sourceType !== "url" && sourceType !== "file") return;
      ctx.report({
        code: "unsupported_capability",
        path,
        model,
        message: `"${model}" does not accept PDF (document) input; remove the document block.`,
      });
    });
  }
}

/**
 * Thinking compatibility rules: while thinking is on, `temperature` and
 * `top_k` are rejected and `top_p` must be within [0.95, 1]; manual extended
 * thinking additionally rejects forced tool use (`tool_choice` any/tool).
 * Per-model rules (the id lists in ./constraints.ts carry the sources):
 * manual extended thinking (`enabled`) is gone on Claude 4.7+; `disabled` is
 * refused outright where thinking is always on, refused in favour of
 * `between_tools` on Sonnet 5.5, and refused at effort xhigh/max on Opus 5 and
 * Haiku 5.5; `between_tools` is Sonnet 5.5-only and capped at effort high.
 */
export function checkThinkingCompatibility(
  params: MessagesBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const thinking = params.thinking;
  if (thinking === undefined) return;
  const model = params.model;
  const effort = params.output_config?.effort;
  const alwaysOn = isListed(model, THINKING_ALWAYS_ON_MODEL_IDS);

  if (thinking.type === "enabled" && isListed(model, GEN_4_7_PLUS_MODEL_IDS)) {
    ctx.report({
      code: "unsupported_param",
      path: ["thinking"],
      model,
      message: `thinking.type "enabled" (manual extended thinking) is not supported by "${model}": Claude 4.7 and later models return a 400; use \`thinking: {type: "adaptive"}\` and \`output_config.effort\` to control thinking.`,
      meta: { source: ERRORS_DOCS },
    });
    return;
  }

  if (thinking.type === "between_tools") {
    if (isListed(model, BETWEEN_TOOLS_MODEL_IDS)) {
      if (effort === "xhigh" || effort === "max") {
        ctx.report({
          code: "unsupported_param",
          path: ["thinking"],
          model,
          message: `thinking.type "between_tools" is not supported at output_config.effort "${effort}" on "${model}"; use effort "high" or below, or \`thinking: {type: "adaptive"}\`.`,
          meta: { source: THINKING_DOCS },
        });
      }
    } else if (info !== undefined) {
      const offers = alwaysOn
        ? '`thinking: {type: "adaptive"}` with a lower `output_config.effort`'
        : '`thinking: {type: "adaptive"}` or `{type: "disabled"}`';
      ctx.report({
        code: "unsupported_param",
        path: ["thinking"],
        model,
        message: `thinking.type "between_tools" is not supported by "${model}": only claude-sonnet-5-5 accepts it; use ${offers}.`,
        meta: { source: ERRORS_DOCS },
      });
    }
    return;
  }

  if (thinking.type === "disabled") {
    if (alwaysOn) {
      ctx.report({
        code: "unsupported_param",
        path: ["thinking"],
        model,
        message: `thinking cannot be turned off on "${model}": adaptive thinking is always on, at every effort level; remove \`thinking: {type: "disabled"}\` and control depth with \`output_config.effort\`.`,
        meta: { source: THINKING_DOCS },
      });
    } else if (isListed(model, BETWEEN_TOOLS_MODEL_IDS)) {
      ctx.report({
        code: "unsupported_param",
        path: ["thinking"],
        model,
        message: `thinking.type "disabled" is not supported by "${model}"; send \`thinking: {type: "between_tools"}\` to turn off up-front thinking (accepted at output_config.effort "high" or below).`,
        meta: { source: THINKING_DOCS },
      });
    } else if (
      isListed(model, THINKING_OFF_CAPPED_AT_HIGH_MODEL_IDS) &&
      (effort === "xhigh" || effort === "max")
    ) {
      ctx.report({
        code: "unsupported_param",
        path: ["thinking"],
        model,
        message: `thinking cannot be turned off at output_config.effort "${effort}" on "${model}"; use effort "high" or below, or remove \`thinking: {type: "disabled"}\`.`,
        meta: { source: THINKING_DOCS },
      });
    }
    return;
  }

  // On sampling-removed generations (catalog temperature: false) the
  // temperature/top_p rules are value-dependent and enforced by
  // checkCapabilities regardless of thinking; skip them here to avoid
  // duplicate issues on the same path.
  const samplingRemoved = info?.temperature === false;

  if (params.temperature !== undefined && !samplingRemoved) {
    ctx.report({
      code: "unsupported_param",
      path: ["temperature"],
      model,
      message: "`temperature` cannot be modified while thinking is on; Anthropic rejects the request.",
      meta: { source: THINKING_DOCS },
    });
  }

  // Skip when the constraints deny table already rejects top_k outright on
  // this model, to avoid a duplicate issue on the same path.
  const topKDenied = constraintsForModel(constraintSpec, model).some(
    (c) => c.deny?.["top_k"] !== undefined,
  );
  if (params.top_k !== undefined && !topKDenied) {
    ctx.report({
      code: "unsupported_param",
      path: ["top_k"],
      model,
      message: "`top_k` cannot be modified while thinking is on; Anthropic rejects the request.",
      meta: { source: THINKING_DOCS },
    });
  }

  if (
    params.top_p !== undefined &&
    !samplingRemoved &&
    (params.top_p < 0.95 || params.top_p > 1)
  ) {
    ctx.report({
      code: "unsupported_param",
      path: ["top_p"],
      model,
      message: `\`top_p\` must be between 0.95 and 1 while thinking is on; got ${params.top_p}.`,
      meta: { source: THINKING_DOCS },
    });
  }

  const choice = params.tool_choice?.type;
  if (thinking.type === "enabled" && (choice === "any" || choice === "tool")) {
    ctx.report({
      code: "unsupported_param",
      path: ["tool_choice"],
      model,
      message: `tool_choice "${choice}" forces tool use, which is incompatible with manual extended thinking; use "auto"/"none" or adaptive thinking.`,
      meta: { source: THINKING_DOCS },
    });
  }
}

/**
 * Forced tool use is refused outright on the generations that removed it —
 * unlike the thinking-scoped rule above, which only applies while manual
 * extended thinking is on.
 */
export function checkForcedToolUse(
  params: MessagesBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const choice = params.tool_choice?.type;
  if (choice !== "any" && choice !== "tool") return;
  const model = params.model;
  if (!isListed(model, FORCED_TOOL_USE_REMOVED_MODEL_IDS)) return;
  ctx.report({
    code: "unsupported_param",
    path: ["tool_choice"],
    model,
    message: `tool_choice "${choice}" forces tool use, which "${model}" does not support; use "auto"/"none" with \`strict: true\` on the tool, or structured outputs.`,
    meta: { source: ERRORS_DOCS },
  });
}

/**
 * Response prefill (a trailing assistant message) is refused on Claude 4.6+
 * whether or not thinking is on. The wire schema already refuses it while
 * thinking is on for every model, and a shape failure ends validation before
 * the checks run, so this only ever fires with thinking off or absent.
 */
export function checkPrefill(
  params: MessagesBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const last = params.messages[params.messages.length - 1];
  if (last === undefined || last.role !== "assistant") return;
  const model = params.model;
  if (!isListed(model, PREFILL_REMOVED_MODEL_IDS)) return;
  ctx.report({
    code: "unsupported_param",
    path: ["messages", params.messages.length - 1, "role"],
    model,
    message: `the final message has role "assistant" (response prefill), which "${model}" does not support with thinking on or off; end the conversation with a "user" message and steer the response with \`system\` or structured outputs.`,
    meta: { source: ERRORS_DOCS },
  });
}

/**
 * Computer-use tool versions the model returns a 400 for on the Claude API;
 * `computer_toolset_20260801` is what these models accept.
 */
export function checkToolTypes(
  params: MessagesBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model;
  if (params.tools === undefined || !isListed(model, COMPUTER_TOOLSET_ONLY_MODEL_IDS)) return;
  params.tools.forEach((tool, index) => {
    const type = tool.type;
    if (typeof type !== "string" || !REMOVED_COMPUTER_TOOL_TYPES.includes(type)) return;
    ctx.report({
      code: "unsupported_param",
      path: ["tools", index, "type"],
      model,
      message: `"${model}" does not support tool type "${type}" on the Claude API; use "computer_toolset_20260801" (no beta header) for computer use.`,
      meta: { source: ERRORS_DOCS, toolType: type },
    });
  });
}

/**
 * `speed: "fast"` outside the fast-mode models is an error on the wire; on
 * Opus 4.6 it is accepted and runs at standard speed, which is reported as a
 * warning (the request is fulfilled). Uncataloged ids are left alone.
 */
export function checkSpeed(
  params: MessagesBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.speed !== "fast" || info === undefined) return;
  const model = params.model;
  if (isListed(model, FAST_MODE_MODEL_IDS)) return;
  if (isListed(model, FAST_MODE_IGNORED_MODEL_IDS)) {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["speed"],
      model,
      message: `\`speed: "fast"\` is silently ignored by the API for "${model}": the request runs at standard speed (usage.speed reports "standard"), and only with the fast-mode-2026-02-01 beta header. Fast mode is served on claude-fable-5-2 and claude-opus-5-5.`,
      meta: { source: FAST_MODE_DOCS, ignored: true },
    });
    return;
  }
  ctx.report({
    code: "unsupported_param",
    path: ["speed"],
    model,
    message: `\`speed: "fast"\` is not supported by "${model}": fast mode is served on claude-fable-5-2 and claude-opus-5-5 (no beta header), and on claude-opus-5 and claude-opus-4-8 with the fast-mode-2026-02-01 beta header; remove \`speed\` or use one of those models.`,
    meta: { source: FAST_MODE_DOCS },
  });
}

/**
 * Requests with more than 20 images get a stricter per-image dimension limit
 * whose exact figure the vision docs withhold ("Images exceeding the stricter
 * limit are rejected with an `invalid_request_error` whose message references
 * “many-image requests” and states the current limit in pixels"); 3,000 px is
 * the documented safe bound ("resize each image so that neither dimension
 * exceeds 3,000 px, or keep the request to 20 or fewer image and document
 * blocks"). Above it the issue is a WARNING: the real limit may be higher, and
 * refusing a request the API fulfils is the one failure this library must
 * never have.
 */
const MANY_IMAGE_THRESHOLD = 20;
const MANY_IMAGE_SAFE_DIMENSION = 3000;

interface ImagePart {
  path: Array<string | number>;
  sniffed?: SniffedImage;
  encodedBytes?: number;
  declaration?: MediaDeclaration;
}

/**
 * Enforces the image media rules (format allowlist, size, dimensions) via the
 * shared reporter. Base64 sources are sniffed; URL/file sources are checked
 * against `options.media` declarations. Also enforces the request-level
 * vision limits: the stricter per-dimension limit on requests with more than
 * 20 images (a warning above the documented 3,000 px safe bound), and the
 * per-request image count cap (100 for 200k-context models, 600 otherwise).
 */
export function checkImageMedia(
  params: MessagesBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const rules = constraintsForModel(constraintSpec, params.model)
    .map((c) => c.media?.image)
    .filter((rule): rule is MediaRule => rule !== undefined);
  if (rules.length === 0) return;

  const parts: ImagePart[] = [];
  eachBlock(params, (block, path) => {
    if (block["type"] !== "image") return;
    const source = block["source"];
    if (typeof source !== "object" || source === null) return;
    const record = source as Record<string, unknown>;
    const declaration = findMediaDeclaration(ctx.options.media, path);

    let sniffed: SniffedImage | undefined;
    let encodedBytes: number | undefined;
    if (record["type"] === "base64" && typeof record["data"] === "string") {
      // Anthropic's 10MB per-image limit applies to the BASE64-ENCODED
      // payload, so the byte fact carried into the shared reporter is the
      // encoded length, not the decoded size.
      encodedBytes = record["data"].length;
      const bytes = toBytes(record["data"]);
      const raw = bytes !== undefined ? sniffImage(bytes) : undefined;
      sniffed = raw === undefined ? undefined : { ...raw, bytes: encodedBytes };
    }

    parts.push({
      path,
      ...(sniffed !== undefined && { sniffed }),
      ...(encodedBytes !== undefined && { encodedBytes }),
      ...(declaration !== undefined && { declaration }),
    });
  });
  if (parts.length === 0) return;

  for (const part of parts) {
    for (const rule of rules) {
      reportMediaIssues(ctx, {
        kind: "image",
        rule,
        path: part.path,
        model: params.model,
        ...(part.sniffed !== undefined && { sniffed: part.sniffed }),
        ...(part.encodedBytes !== undefined && { encodedBytes: part.encodedBytes }),
        ...(part.declaration !== undefined && { declaration: part.declaration }),
        source: VISION_DOCS,
      });
    }
  }

  if (parts.length > MANY_IMAGE_THRESHOLD) {
    for (const part of parts) {
      const dims = part.sniffed ?? part.declaration;
      const width = dims?.width;
      const height = dims?.height;
      const tooWide = width !== undefined && width > MANY_IMAGE_SAFE_DIMENSION;
      const tooTall = height !== undefined && height > MANY_IMAGE_SAFE_DIMENSION;
      if (!tooWide && !tooTall) continue;
      ctx.report({
        code: "media_dimensions_exceeded",
        severity: "warning",
        path: part.path,
        model: params.model,
        message: `Image is ${width ?? "?"}x${height ?? "?"} px in a request with ${parts.length} images; requests with more than ${MANY_IMAGE_THRESHOLD} images apply a stricter per-dimension limit the vision docs leave unstated — ${MANY_IMAGE_SAFE_DIMENSION} px is documented as safe on all platforms. Resize to ${MANY_IMAGE_SAFE_DIMENSION} px or keep the request to ${MANY_IMAGE_THRESHOLD} or fewer image and document blocks.`,
        meta: {
          ...(width !== undefined && { width }),
          ...(height !== undefined && { height }),
          maxWidth: MANY_IMAGE_SAFE_DIMENSION,
          maxHeight: MANY_IMAGE_SAFE_DIMENSION,
          images: parts.length,
          source: VISION_DOCS,
        },
      });
    }
  }

  if (info !== undefined && info.limit.context > 0) {
    const cap = info.limit.context <= 200_000 ? 100 : 600;
    if (parts.length > cap) {
      ctx.report({
        code: "invalid_shape",
        path: ["messages"],
        model: params.model,
        message: `Request contains ${parts.length} images; "${params.model}" accepts at most ${cap} images per request.`,
        meta: { images: parts.length, limit: cap, source: VISION_DOCS },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Estimation
// ---------------------------------------------------------------------------

const DEFAULT_IMAGE_TOKENS = 1568;

function imageTokensFor(modelId: string): number {
  for (const constraints of constraintsForModel(constraintSpec, modelId)) {
    if (constraints.imageTokens !== undefined) return constraints.imageTokens;
  }
  return DEFAULT_IMAGE_TOKENS;
}

function estimateMessages(
  params: MessagesBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): ValidateEstimate {
  const tokenizer = ctx.tokenizer;
  const imageTokens = imageTokensFor(params.model);
  let inputTokens = 0;

  const countText = (value: unknown): void => {
    if (typeof value === "string") inputTokens += tokenizer.count(value);
  };

  // The loose schema only validates block.type, so every payload field access
  // must be guarded: a malformed block (e.g. {type:"text"} without text)
  // contributes 0 tokens — estimation must never throw.
  const countBlocks = (blocks: unknown[]): void => {
    for (const block of blocks) {
      if (typeof block !== "object" || block === null) continue;
      const record = block as Record<string, unknown>;
      switch (record["type"]) {
        case "text":
          countText(record["text"]);
          break;
        case "image":
          inputTokens += imageTokens;
          break;
        case "thinking":
          countText(record["thinking"]);
          break;
        case "tool_use":
          inputTokens += estimateToolDefinitionTokens(tokenizer, record["input"]);
          break;
        case "tool_result": {
          const content = record["content"];
          if (typeof content === "string") inputTokens += tokenizer.count(content);
          else if (Array.isArray(content)) countBlocks(content);
          break;
        }
        case "document": {
          const source = record["source"];
          if (typeof source === "object" && source !== null) {
            const sourceRecord = source as Record<string, unknown>;
            if (sourceRecord["type"] === "text") countText(sourceRecord["data"]);
          }
          break;
        }
        default:
          break;
      }
    }
  };

  if (typeof params.system === "string") {
    inputTokens += tokenizer.count(params.system) + PER_MESSAGE_TOKEN_OVERHEAD;
  } else if (Array.isArray(params.system)) {
    inputTokens += PER_MESSAGE_TOKEN_OVERHEAD;
    countBlocks(params.system);
  }

  for (const message of params.messages) {
    inputTokens += PER_MESSAGE_TOKEN_OVERHEAD;
    if (typeof message.content === "string") inputTokens += tokenizer.count(message.content);
    else if (Array.isArray(message.content)) countBlocks(message.content);
  }

  for (const tool of params.tools ?? []) {
    inputTokens += estimateToolDefinitionTokens(tokenizer, tool);
  }

  // A prompt-length-tiered model above its threshold is priced at rates the
  // catalog row does not carry (see PROMPT_LENGTH_TIERED_MODEL_IDS), so the
  // estimate is withheld there rather than stated 5x too low.
  if (
    isListed(params.model, PROMPT_LENGTH_TIERED_MODEL_IDS) &&
    inputTokens > PROMPT_LENGTH_TIER_THRESHOLD
  ) {
    return { inputTokens };
  }

  // Worst case: the model spends the whole max_tokens budget on output.
  const costUSD = computeCostUSD(info?.cost, { inputTokens, outputTokens: params.max_tokens });
  return costUSD === undefined ? { inputTokens } : { inputTokens, costUSD };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * The SDK targets this endpoint declares. The `@anthropic-ai/sdk`
 * `MessageCreateParams` are wire-shaped, so the formatter is the identity —
 * assignability is asserted in `test/types/anthropic.test-d.ts`, which is why
 * `src/` never imports the SDK.
 *
 * Written as a `type` (not an `interface`) and kept in lockstep with the
 * object literal in `finalize`: an `interface extends Record<string, …>` would
 * inherit a string index signature and collapse `keyof` to `string`, making
 * `.toSdk("anything")` type-check. See `SdkFormatters` in core/request.ts.
 */
export type ChatSdkTargets<T extends MessagesBody = MessagesBody> = {
  anthropic: () => T;
  "ai-sdk": () => AiSdkChatResult;
};

/**
 * `.toApi(provider)` for `anthropic.chat`, built once from the generated
 * availability table.
 *
 * Every static target anthropic's availability data names (openrouter,
 * vercel) speaks the OpenAI chat-completions dialect, so this endpoint
 * declares exactly one decoder — which is the flagship path:
 * `chat({ model: "claude-opus-5", … }).toApi("openrouter")` respells the
 * id to `anthropic/claude-opus-5`, translates the body to chat-completions,
 * and lists what the crossing cost on `.warnings`.
 *
 * `amazon-bedrock` is in the data too but is factory-configured (it needs a
 * region), so it is excluded from the one-argument `.toApi` union; the
 * bedrock-converse codec is deferred with it.
 */
const retargetMessages = createToApi<MessagesBody, ChatIR>({
  from: "anthropic-messages",
  endpoint: "anthropic.chat",
  modelId: (body) => body.model,
  availability,
  encode: encodeAnthropic,
  decoders: { "openai-chat": decodeOpenAIChat },
  // Layers 1 + 3 against the TARGET (design-types §4.4): a retargeted body
  // carrying a param the destination denies is a named error here rather than
  // a 400 on the wire. Layers 2 and 4 need the target's catalog and stay out.
  targetValidation: targetValidationFor,
});

/** `.toSdk("ai-sdk")`: the same encoder, decoded to `generateText` options. */
const toAiSdk = createAiSdkChat<MessagesBody>({
  endpoint: "anthropic.chat",
  provider: "anthropic",
  encode: encodeAnthropic,
});

function finalize(params: MessagesBody): Validated<MessagesBody, ChatSdkTargets> {
  const body = { ...params };
  const request: RequestMeta = {
    url: MESSAGES_URL,
    method: "POST",
    headers: { ...JSON_HEADERS, "anthropic-version": ANTHROPIC_VERSION },
  };
  return toValidated(body, request, {
    sdk: { anthropic: () => body, "ai-sdk": () => toAiSdk(body) },
    api: retargetMessages(body),
  });
}

const validator = createValidator<MessagesBody, Validated<MessagesBody, ChatSdkTargets>>({
  endpoint: "anthropic.chat",
  schema: messagesSchema,
  modelId: (params) => params.model,
  catalog: models,
  constraints: chatConstraints,
  familyRules: chatFamilyRules,
  checks: [
    checkCapabilities,
    checkThinkingCompatibility,
    checkForcedToolUse,
    checkPrefill,
    checkToolTypes,
    checkSpeed,
    checkImageMedia,
  ],
  estimate: estimateMessages,
  promptPath: ["messages"],
  finalize,
});

// ---------------------------------------------------------------------------
// Per-model narrowing (Tier A)
//
// Five fields this endpoint already refuses values of at call time, moved to
// compile time. Each is DERIVED — from the deny table, from the catalog, or
// from the same id list the run-time check reads — so no hand-copied id list
// exists to drift, and `chat.test.ts` pins the resolved unions so a `bun run
// codegen` that flips a flag surfaces as a test diff rather than as a silent
// break in a caller's code.
//
// Deliberately NOT narrowed:
//
// - `top_p`. The rule is `>= 0.99`, and a numeric lower bound has no honest
//   literal type: `0.99 | 1` would refuse documented values.
// - `tools` / `thinking` off `toolCall: false` / `reasoning: false`. Both flags
//   are `false` for zero models in the Anthropic catalog today, so an arm keyed
//   on them would be dead code dressed as a guarantee.
// - `tools[].type` (the computer-use versions `checkToolTypes` refuses).
//   `ServerTool.type` is `string` because Anthropic-defined tool types are an
//   open set; a literal exclusion on an open string has no honest spelling.
// - prefill. A fact about the shape of `messages`, not a field value.
//
// The one false positive worth knowing about: a shared base object widens
// `temperature: 1` to `number`, so `chat({ ...base, model: "claude-opus-5" })`
// needs `1 as const`. Accepted knowingly — the alternative is not catching the
// literal case either.
// ---------------------------------------------------------------------------

/** Models the catalog marks `temperature: false` — only the default 1.0 is accepted. */
type FixedSamplingModelId = ModelsWhereFalse<typeof models, "temperature">;

/**
 * The `thinking` values `checkThinkingCompatibility` accepts for one model id,
 * most specific generation first (Opus 5.5 is both always-on and 4.7+). A
 * catalog id outside every list still loses `between_tools` (Sonnet 5.5-only);
 * an id the catalog does not know keeps the whole union, exactly as the
 * run-time check leaves uncataloged ids alone.
 */
type ThinkingArm<M extends string> = M extends ThinkingAlwaysOnModelId
  ? Extract<ThinkingConfig, { type: "adaptive" }>
  : M extends BetweenToolsModelId
    ? Extract<ThinkingConfig, { type: "adaptive" } | { type: "between_tools" }>
    : M extends Gen47PlusModelId
      ? Extract<ThinkingConfig, { type: "adaptive" } | { type: "disabled" }>
      : M extends AnthropicModelId
        ? Exclude<ThinkingConfig, { type: "between_tools" }>
        : ThinkingConfig;

/**
 * `MessagesBody` with the five per-model fields replaced for one model id.
 *
 * A **replacement**, not an intersection: intersecting `temperature?: 1` with
 * the base's `temperature?: number` gives `number`, which is the whole
 * narrowing discharged. Refusals are spelled `never` rather than omitted so
 * the spread/composition idiom (`{ ...base, model }`) keeps working — the key
 * still completes, it simply refuses every value.
 */
export type MessagesArm<M extends string> = Omit<
  MessagesBody,
  "model" | "temperature" | "top_k" | "thinking" | "tool_choice" | "speed"
> & {
  model: M;
  temperature?: M extends FixedSamplingModelId ? 1 : number;
  top_k?: M extends Gen47PlusModelId ? never : number;
  thinking?: ThinkingArm<M>;
  tool_choice?: M extends ForcedToolUseRemovedModelId
    ? Exclude<NonNullable<MessagesBody["tool_choice"]>, { type: "any" } | { type: "tool" }>
    : MessagesBody["tool_choice"];
  speed?: M extends FastModeModelId
    ? MessagesBody["speed"]
    : M extends AnthropicModelId
      ? Exclude<MessagesBody["speed"], "fast">
      : MessagesBody["speed"];
};

/** Registry-instantiable form of this endpoint's generic result. */
export interface AnthropicChatResultKind extends ValidatorResultKind {
  // `& MessagesArm<…>` is what keeps the composition idiom compiling: without
  // it, a params object built by `unmodel/chat`'s registry no longer satisfies
  // the arm and the whole result collapses. Verified: 3 spurious errors → 0.
  //
  // `stream` is omitted from the arm so the INPUT decides it. The arm is the
  // declared body, whose `stream?: boolean` is correct wire truth and wrong
  // about any particular request; `unmodel/chat` knows whether the caller wrote
  // one (`ProviderParamsFor` in src/chat/factory.ts) and an intersection would
  // widen its answer straight back to `boolean`. That width is what made
  // `client.messages.create(chat({…}).toSdk("anthropic"))` need a cast: `stream`
  // is the discriminant of the SDK's params union.
  readonly output: this["input"] extends MessagesBody
    ? Validated<
        this["input"] & Omit<MessagesArm<this["input"]["model"] & string>, "stream">,
        ChatSdkTargets<this["input"]>,
        AnthropicAvailability,
        this["input"]["model"] & string
      >
    : never;
}

/**
 * Validates params for POST /v1/messages. The result's enumerable properties
 * are the exact fetch body; `.toSdk("anthropic")` returns the wire-shaped body
 * (the official SDK's params are wire-shaped — assignability is asserted in
 * test/types/anthropic.test-d.ts, so src never imports the SDK) and
 * `.request` carries url/method/static headers — including the required
 * `anthropic-version` header, pinned to `2023-06-01`, the API version these
 * rules describe (`/v1/messages` rejects a request without one). Auth is your
 * job: the Claude API accepts the key either bare in an `x-api-key` header or
 * as `Authorization: Bearer <key>`, which is what the current SDKs send.
 *
 * `.toSdk("ai-sdk")` returns the Vercel AI SDK's `generateText` options
 * (no `model` — you supply the provider instance; wrap tool schemas with
 * `withJsonSchemaTools` from `unmodel/ai-sdk`).
 *
 * `.toApi(provider)` offers exactly the providers the models.dev catalog says
 * serve this model — `.toApi("openai")` on a Claude request is a compile
 * error — and translates the body into the target's dialect, listing what the
 * crossing cost on the non-enumerable `.warnings`.
 */
export const chat = validator as unknown as {
  <M extends MessagesBody["model"], T extends MessagesArm<M>>(
    params: T & { model: M } & ExactKeys<T, MessagesBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, ChatSdkTargets<T & { model: M }>, AnthropicAvailability, M & string>;
  safe<M extends MessagesBody["model"], T extends MessagesArm<M>>(
    params: T & { model: M } & ExactKeys<T, MessagesBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<
    Validated<T, ChatSdkTargets<T & { model: M }>, AnthropicAvailability, M & string>
  >;
  constraintsFor(modelId: string): EndpointConstraints[];
} & ValidatorResultKindCarrier<AnthropicChatResultKind> & ValidatorProviderCarrier<"anthropic">;
