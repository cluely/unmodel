import { models } from "../../catalog/amazon-bedrock.gen";
import type { AmazonBedrockModelId } from "../../catalog/amazon-bedrock.gen";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS } from "../../core/request";
import type { ExactKeys, RequestMeta, Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo, ModelLimit } from "../../core/catalog-types";
import type { EndpointConstraints, MediaRule } from "../../core/constraint-types";
import { resolveModelInfo } from "../../core/catalog-lookup";
import { computeCostUSD } from "../../core/cost";
import { PER_MESSAGE_TOKEN_OVERHEAD, estimateToolDefinitionTokens } from "../../core/tokens";
import { toBytes } from "../../core/media/bytes";
import { sniffImage } from "../../core/media/image";
import { findMediaDeclaration, reportMediaIssues } from "../../core/media/check";
import { converseSchema } from "./wire";
import type { ConverseParams } from "./wire";

// The wire types and the zod schema live in ./wire.ts (a leaf that imports
// only zod), so translation machinery can reach the Converse dialect without
// pulling in this validator. Re-exported here so the module's public surface
// is unchanged.
export type {
  BedrockCachePoint,
  BedrockS3Location,
  BedrockBytesSource,
  BedrockImageFormat,
  BedrockImageBlock,
  BedrockVideoFormat,
  BedrockVideoBlock,
  BedrockDocumentFormat,
  BedrockDocumentSource,
  BedrockDocumentBlock,
  BedrockToolUseBlock,
  BedrockToolResultContent,
  BedrockToolResultBlock,
  BedrockContentBlock,
  BedrockMessage,
  BedrockSystemContentBlock,
  BedrockInferenceConfig,
  BedrockToolSpecification,
  BedrockTool,
  BedrockToolChoice,
  BedrockToolConfig,
  BedrockGuardrailConfig,
  BedrockOutputConfig,
  ConverseParams,
} from "./wire";

// ---------------------------------------------------------------------------
// unmodel/amazon-bedrock — the Bedrock Runtime Converse API:
// POST https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/converse
//
// URLs are region + model scoped, so validators are built via
// `createAmazonBedrock({ region })`. SigV4 auth (or the bearer-token header)
// is your/your SDK's job — unmodel never touches credentials; `.request`
// carries only the regioned URL, method, and content-type.
//
// Wire shapes verified against the Bedrock Runtime API reference on
// 2026-08-13: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
// ---------------------------------------------------------------------------

export const CONVERSE_DOCS =
  "https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html (checked 2026-08-13)";
const MESSAGE_DOCS =
  "https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Message.html (checked 2026-08-13)";

// ---------------------------------------------------------------------------
// Model resolution — Bedrock ids carry regional prefixes ("us.", "eu."),
// ":<n>" version suffixes, and may arrive as full ARNs. Resolve to the
// canonical catalog id so catalog-dependent checks still apply.
// ---------------------------------------------------------------------------

/**
 * Resolves a Bedrock model id / inference-profile id / ARN against the
 * generated catalog: ARNs are reduced to their trailing resource id, and a
 * trailing ":<digits>" version qualifier is retried without the suffix when
 * the full id has no catalog entry.
 */
export function resolveBedrockModelInfo(modelId: string): ModelInfo | undefined {
  // ARNs end in ".../<model-or-profile-id>".
  const bare = modelId.includes("/") ? modelId.slice(modelId.lastIndexOf("/") + 1) : modelId;
  const direct = resolveModelInfo(catalog, bare);
  if (direct !== undefined) return direct;
  const versionless = bare.replace(/:\d+$/, "");
  return versionless === bare ? undefined : resolveModelInfo(catalog, versionless);
}

function canonicalModelId(modelId: string): string {
  return resolveBedrockModelInfo(modelId)?.id ?? modelId;
}

// ---------------------------------------------------------------------------
// Per-model rules. Keyed by foundation-model id; an inference profile of that
// model (a geo or global prefix — "us.", "global.", … — in front of the id)
// carries the same rules.
// ---------------------------------------------------------------------------

/**
 * Foundation models that reject forced tool choice on Bedrock, each mapped to
 * the page that says so. On Converse, `toolChoice: { auto: {} }` or no
 * `toolChoice` is accepted; `any` and `tool` force a tool call and fail.
 *
 * - Opus 5.5 and Sonnet 5.5: their model cards, checked 2026-11-12, list
 *   "Client-side tool calling ( tool_choice types auto and none only)".
 * - Fable 5.2 and Fable 5.1: their cards carry no tool-calling line, but the
 *   Bedrock forced-tool-use section, checked 2026-11-13, does: "Claude Fable
 *   5.2, Claude Mythos 5.2, Claude Opus 5.5, Claude Fable 5.1, and Claude
 *   Mythos 5.1 do not support forced tool use. … In the Converse API, the
 *   equivalent `toolChoice` settings (`tool` and `any`) surface the same
 *   error." No Mythos id is in the Bedrock catalog.
 */
const AUTO_TOOL_CHOICE_ONLY = {
  "anthropic.claude-fable-5-1":
    "https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-anthropic-claude-messages-tool-use.html#model-parameters-anthropic-claude-forced-tool-use (checked 2026-11-13)",
  "anthropic.claude-fable-5-2":
    "https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-anthropic-claude-messages-tool-use.html#model-parameters-anthropic-claude-forced-tool-use (checked 2026-11-13)",
  "anthropic.claude-opus-5-5":
    "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5-5.html (checked 2026-11-12)",
  "anthropic.claude-sonnet-5-5":
    "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5-5.html (checked 2026-11-12)",
} as const satisfies Partial<Record<AmazonBedrockModelId, string>>;

/**
 * Foundation models whose Bedrock model card fixes the sampling parameters,
 * each mapped to that card. Both cards, checked 2026-11-12: "Sampling
 * parameters: temperature must be 1.0 or unset; top_p must be 0.99 or unset;
 * temperature and top_p cannot be specified together; top_k is not
 * supported".
 *
 * `temperature` other than 1 and `topP` below 0.99 are refused, as
 * `anthropic.chat` refuses them. `topP` above 0.99, and the two sent
 * together, only warn: the card rules both out, but the Anthropic SDK's
 * 0.137.0 JSDoc documents `top_p` >= 0.99 as accepted, and until a live
 * request settles which is right, a refusal could fail a request the API
 * fulfils.
 *
 * Fable 5 is not listed: its card states a different rule ("top_p must be ≥
 * 0.99 and < 1.0, or unset"). The Opus, Sonnet and Haiku 5.5 cards carry no
 * sampling line.
 */
const FIXED_SAMPLING_MODEL_IDS = {
  "anthropic.claude-fable-5-1":
    "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-fable-5-1.html (checked 2026-11-12)",
  "anthropic.claude-fable-5-2":
    "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-fable-5-2.html (checked 2026-11-12)",
} as const satisfies Partial<Record<AmazonBedrockModelId, string>>;

/** The only `temperature` a fixed-sampling model accepts. */
const FIXED_TEMPERATURE = 1;
/** The `topP` a fixed-sampling model's card names. */
const FIXED_TOP_P = 0.99;

/**
 * Foundation models whose Bedrock model card limits Converse content to text
 * and image blocks, each mapped to that card. Every card, checked 2026-11-12:
 * "This model doesn't accept `document` content blocks, and it doesn't
 * accept an `image` content block inside a `toolResult`. A request that
 * includes either is rejected with a `ValidationException`. To send a
 * document to this model, use the Responses API with an `input_file` content
 * part instead." A per-model rule rather than a modality check: models.dev
 * lists `pdf` input for GPT-6 Astra, and `document` blocks carry text formats
 * too.
 */
const CONVERSE_TEXT_AND_IMAGE_ONLY = {
  "openai.gpt-6-astra":
    "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-astra.html (checked 2026-11-12)",
  "openai.gpt-6-luna":
    "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-luna.html (checked 2026-11-12)",
  "openai.gpt-6-sol":
    "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-sol.html (checked 2026-11-12)",
  "openai.gpt-6.1-sol":
    "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-1-sol.html (checked 2026-11-12)",
  "openai.gpt-6.1-terra":
    "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-1-terra.html (checked 2026-11-12)",
} as const satisfies Partial<Record<AmazonBedrockModelId, string>>;

/**
 * Catalog limits a Bedrock model card contradicts, applied over the generated
 * rows (see {@link catalog}) so `over_context` and `over_output_limit` read
 * the card's figure. Delete an entry once a models.dev refresh carries it.
 *
 * - `xai.grok-4.7`: models.dev carries 500,000 for both limits, but the card
 *   (docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-7.html,
 *   checked 2026-11-12) says "Context window: 524,288 tokens, shared between
 *   input and output" and "Max output tokens: 524,288 minus input tokens".
 *   Bedrock serves it only through its `us.` and `global.` profiles, so no
 *   bare row exists and the key is checked by a test, not by the type.
 */
const LIMIT_CORRECTIONS = {
  "xai.grok-4.7": { context: 524_288, output: 524_288 },
} as const satisfies Record<string, ModelLimit>;

/**
 * The generated catalog with {@link LIMIT_CORRECTIONS} applied: the rows the
 * validator, its estimate and `checkChat` resolve against.
 */
const catalog: Record<string, ModelInfo> = withLimitCorrections(models);

function withLimitCorrections(rows: Record<string, ModelInfo>): Record<string, ModelInfo> {
  const corrected: Record<string, ModelInfo> = { ...rows };
  for (const [id, info] of Object.entries(rows)) {
    const limit = ruleFor(LIMIT_CORRECTIONS, id);
    if (limit !== undefined) corrected[id] = { ...info, limit };
  }
  return corrected;
}

/**
 * Foundation models priced by prompt length, each mapped to the prompt size
 * (input + cache reads + cache writes, in tokens) above which a higher rate
 * applies to the whole request. Their catalog rows carry only the lower
 * rates and `ModelCost` has no tier field, so above the threshold estimates
 * and `checkChat` return no `costUSD` rather than a number up to 5x too low.
 *
 * - Claude Haiku 5.5: the committed models.dev snapshot carries the tier on
 *   every Bedrock row (`"tier": { "size": 100000, "type": "context" }`; input
 *   0.5 and output 2.5 on the global row), as Anthropic's pricing page does
 *   (platform.claude.com/docs/en/about-claude/pricing, checked 2026-11-12):
 *   "Claude Haiku 5.5 is priced by prompt length: a request whose prompt is
 *   over 100,000 tokens pays higher prices. A request's prompt length counts
 *   all of its input tokens, including cache reads and cache writes."
 * - GPT-6, GPT-6.1 and GPT-5.6: the snapshot carries
 *   `"tier": { "size": 272000, "type": "context" }` on every openai.gpt-6-*,
 *   gpt-6.1-* and gpt-5.6-* row (input 4 and output 15 on
 *   global.openai.gpt-6-sol, against 2 and 10), as the GPT-6 Sol card does
 *   (docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-sol.html,
 *   checked 2026-11-13): "Long-context rates apply to the full request when
 *   input exceeds 272,000 tokens."
 */
const PROMPT_LENGTH_TIERS = {
  "anthropic.claude-haiku-5-5": 100_000,
  "openai.gpt-6-astra": 272_000,
  "openai.gpt-6-sol": 272_000,
  "openai.gpt-6-luna": 272_000,
  "openai.gpt-6.1-sol": 272_000,
  "openai.gpt-6.1-terra": 272_000,
  "openai.gpt-5.6-sol": 272_000,
  "openai.gpt-5.6-terra": 272_000,
  "openai.gpt-5.6-luna": 272_000,
} as const satisfies Partial<Record<AmazonBedrockModelId, number>>;

/**
 * True when `catalogId`'s catalog rates do not price a prompt of
 * `promptTokens` tokens (see {@link PROMPT_LENGTH_TIERS}).
 */
export function isPastPromptLengthTier(catalogId: string, promptTokens: number): boolean {
  const threshold = ruleFor(PROMPT_LENGTH_TIERS, catalogId);
  return threshold !== undefined && promptTokens > threshold;
}

/** The entry of a per-model table that applies to `catalogId`, if any. */
function ruleFor<T>(table: Readonly<Record<string, T>>, catalogId: string): T | undefined {
  for (const [base, rule] of Object.entries(table)) {
    if (isModelOrProfile(catalogId, base)) return rule;
  }
  return undefined;
}

/** True when `catalogId` is `base` or an inference profile of it. */
function isModelOrProfile(catalogId: string, base: string): boolean {
  return catalogId === base || catalogId.endsWith(`.${base}`);
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

type BlockVisitor = (block: Record<string, unknown>, path: Array<string | number>) => void;

/** Visits every content block, including blocks nested in toolResult content. */
function eachContentBlock(params: ConverseParams, visit: BlockVisitor): void {
  params.messages?.forEach((message, i) => {
    if (!Array.isArray(message.content)) return;
    message.content.forEach((block, j) => {
      if (typeof block !== "object" || block === null) return;
      const record = block as Record<string, unknown>;
      const path: Array<string | number> = ["messages", i, "content", j];
      visit(record, path);
      const toolResult = record["toolResult"];
      if (typeof toolResult === "object" && toolResult !== null) {
        const content = (toolResult as Record<string, unknown>)["content"];
        if (Array.isArray(content)) {
          content.forEach((nested, k) => {
            if (typeof nested !== "object" || nested === null) return;
            visit(nested as Record<string, unknown>, [...path, "toolResult", "content", k]);
          });
        }
      }
    });
  });
}

export function checkCapabilities(
  params: ConverseParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  const model = params.modelId;

  if (params.toolConfig !== undefined && !info.toolCall) {
    ctx.report({
      code: "unsupported_capability",
      path: ["toolConfig"],
      model,
      message: `"${model}" does not support tool calling; remove \`toolConfig\`.`,
    });
  }

  const choice = params.toolConfig?.toolChoice;
  const forced = choice?.any !== undefined ? "any" : choice?.tool !== undefined ? "tool" : undefined;
  const toolChoiceSource = forced === undefined ? undefined : ruleFor(AUTO_TOOL_CHOICE_ONLY, info.id);
  if (forced !== undefined && toolChoiceSource !== undefined) {
    ctx.report({
      code: "unsupported_param",
      path: ["toolConfig", "toolChoice"],
      model,
      message: `toolChoice \`${forced}\` forces a tool call, which "${model}" rejects on Bedrock (400); Bedrock documents automatic tool choice only for it — send \`toolChoice: { auto: {} }\` or omit \`toolChoice\`.`,
      meta: { toolChoice: forced, source: toolChoiceSource },
    });
  }

  const samplingCard = ruleFor(FIXED_SAMPLING_MODEL_IDS, info.id);
  if (samplingCard !== undefined) checkFixedSampling(params, samplingCard, ctx);

  const maxTokens = params.inferenceConfig?.maxTokens;
  const outputLimit = info.limit.output ?? 0;
  if (maxTokens !== undefined && outputLimit > 0 && maxTokens > outputLimit) {
    ctx.report({
      code: "over_output_limit",
      path: ["inferenceConfig", "maxTokens"],
      model,
      message: `inferenceConfig.maxTokens ${maxTokens} exceeds the ${outputLimit}-token output limit of "${model}".`,
      meta: { requested: maxTokens, limit: outputLimit },
    });
  }

  for (const kind of ["image", "video"] as const) {
    if (info.modalities.input.includes(kind)) continue;
    eachContentBlock(params, (block, path) => {
      if (block[kind] === undefined) return;
      ctx.report({
        code: "unsupported_capability",
        path: [...path, kind],
        model,
        message: `"${model}" does not accept ${kind} input; its input modalities are ${info.modalities.input.join(", ")}.`,
        meta: { kind, inputModalities: [...info.modalities.input] },
      });
    });
  }

  const contentCard = ruleFor(CONVERSE_TEXT_AND_IMAGE_ONLY, info.id);
  if (contentCard !== undefined) {
    eachContentBlock(params, (block, path) => {
      if (block["document"] !== undefined) {
        ctx.report({
          code: "unsupported_capability",
          path: [...path, "document"],
          model,
          message: `"${model}" does not accept \`document\` content blocks on Converse (a ValidationException); send the document through the Responses API as an \`input_file\` content part instead.`,
          meta: { kind: "document", source: contentCard },
        });
      }
      if (block["image"] !== undefined && path.includes("toolResult")) {
        ctx.report({
          code: "unsupported_capability",
          path: [...path, "image"],
          model,
          message: `"${model}" does not accept an \`image\` block inside a \`toolResult\` on Converse (a ValidationException); it takes images only as blocks of a user message's own content.`,
          meta: { kind: "image", source: contentCard },
        });
      }
    });
  }
}

/**
 * The fixed-sampling rule (see {@link FIXED_SAMPLING_MODEL_IDS}): values the
 * card and `anthropic.chat` agree are refused are errors; the two cases only
 * the card rules out are warnings.
 */
function checkFixedSampling(params: ConverseParams, card: string, ctx: PipelineContext): void {
  const model = params.modelId;
  const temperature = params.inferenceConfig?.temperature;
  const topP = params.inferenceConfig?.topP;

  if (temperature !== undefined && temperature !== FIXED_TEMPERATURE) {
    ctx.report({
      code: "unsupported_param",
      path: ["inferenceConfig", "temperature"],
      model,
      message: `inferenceConfig.temperature ${temperature} is refused by "${model}" on Bedrock (400); its sampling is fixed, so send ${FIXED_TEMPERATURE} or omit it.`,
      meta: { source: card },
    });
  }
  if (topP !== undefined && topP < FIXED_TOP_P) {
    ctx.report({
      code: "unsupported_param",
      path: ["inferenceConfig", "topP"],
      model,
      message: `inferenceConfig.topP ${topP} is refused by "${model}" on Bedrock (400); its sampling is fixed, so send ${FIXED_TOP_P} or omit it.`,
      meta: { source: card },
    });
  }
  if (topP !== undefined && topP > FIXED_TOP_P) {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["inferenceConfig", "topP"],
      model,
      message: `inferenceConfig.topP ${topP} may be refused by "${model}": its Bedrock model card says top_p "must be 0.99 or unset". Send ${FIXED_TOP_P} or omit it.`,
      meta: { source: card },
    });
  }
  if (temperature !== undefined && topP !== undefined) {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["inferenceConfig"],
      model,
      message: `inferenceConfig sets both temperature and topP, which "${model}" may refuse: its Bedrock model card says "temperature and top_p cannot be specified together". Omit one of them.`,
      meta: { source: card },
    });
  }
}

/** Per-message limits from the Converse Message docs (MESSAGE_DOCS). */
const MAX_IMAGES_PER_MESSAGE = 20;
const MAX_DOCUMENTS_PER_MESSAGE = 5;
/** "Each image's size, height, and width must be no more than 3.75 MB, 8000 px, and 8000 px." */
const IMAGE_RULE: MediaRule = {
  maxBytes: Math.round(3.75 * 1024 * 1024),
  maxWidth: 8000,
  maxHeight: 8000,
  formats: ["png", "jpeg", "gif", "webp"],
};
/** "Each document's size must be no more than 4.5 MB." */
const MAX_DOCUMENT_BYTES = Math.round(4.5 * 1024 * 1024);

/**
 * The documented Message.content restrictions: images/documents only in
 * `user` messages, at most 20 images and 5 documents per message, a document
 * requires an accompanying text block, and per-image size/dimension/format
 * limits (bytes sources are sniffed; s3Location sources are checked against
 * `options.media` declarations).
 */
export function checkMessageContent(
  params: ConverseParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  params.messages?.forEach((message, i) => {
    if (!Array.isArray(message.content)) return;
    let images = 0;
    let documents = 0;
    let hasText = false;

    message.content.forEach((block, j) => {
      if (typeof block !== "object" || block === null) return;
      const record = block as Record<string, unknown>;
      if (record["text"] !== undefined) hasText = true;

      if (record["image"] !== undefined) {
        images += 1;
        const path: Array<string | number> = ["messages", i, "content", j, "image"];
        const source =
          typeof record["image"] === "object" && record["image"] !== null
            ? ((record["image"] as Record<string, unknown>)["source"] as
                | Record<string, unknown>
                | undefined)
            : undefined;
        const bytes = source !== undefined ? toBytes(source["bytes"]) : undefined;
        const sniffed = bytes !== undefined ? sniffImage(bytes) : undefined;
        const declaration = findMediaDeclaration(ctx.options.media, path);
        if (sniffed !== undefined || declaration !== undefined) {
          reportMediaIssues(ctx, {
            kind: "image",
            rule: IMAGE_RULE,
            path,
            model: params.modelId,
            ...(sniffed !== undefined && { sniffed }),
            ...(declaration !== undefined && { declaration }),
            source: MESSAGE_DOCS,
          });
        }
      }

      if (record["document"] !== undefined) {
        documents += 1;
        const documentRecord =
          typeof record["document"] === "object" && record["document"] !== null
            ? (record["document"] as Record<string, unknown>)
            : undefined;
        const source = documentRecord?.["source"] as Record<string, unknown> | undefined;
        const bytes = source !== undefined ? toBytes(source["bytes"]) : undefined;
        if (bytes !== undefined && bytes.length > MAX_DOCUMENT_BYTES) {
          ctx.report({
            code: "media_too_large",
            path: ["messages", i, "content", j, "document"],
            model: params.modelId,
            message: `document is ${bytes.length} bytes; Converse caps each document at ${MAX_DOCUMENT_BYTES} bytes (4.5 MB).`,
            meta: { bytes: bytes.length, limit: MAX_DOCUMENT_BYTES, source: MESSAGE_DOCS },
          });
        }
      }
    });

    if ((images > 0 || documents > 0) && message.role !== "user") {
      ctx.report({
        code: "invalid_shape",
        path: ["messages", i, "content"],
        model: params.modelId,
        message: `message[${i}] has role "${message.role}" but carries image/document blocks; Converse only accepts images and documents in "user" messages.`,
        meta: { role: message.role, source: MESSAGE_DOCS },
      });
    }
    if (images > MAX_IMAGES_PER_MESSAGE) {
      ctx.report({
        code: "invalid_shape",
        path: ["messages", i, "content"],
        model: params.modelId,
        message: `message[${i}] contains ${images} images; Converse accepts at most ${MAX_IMAGES_PER_MESSAGE} images per message.`,
        meta: { images, limit: MAX_IMAGES_PER_MESSAGE, source: MESSAGE_DOCS },
      });
    }
    if (documents > MAX_DOCUMENTS_PER_MESSAGE) {
      ctx.report({
        code: "invalid_shape",
        path: ["messages", i, "content"],
        model: params.modelId,
        message: `message[${i}] contains ${documents} documents; Converse accepts at most ${MAX_DOCUMENTS_PER_MESSAGE} documents per message.`,
        meta: { documents, limit: MAX_DOCUMENTS_PER_MESSAGE, source: MESSAGE_DOCS },
      });
    }
    if (documents > 0 && !hasText) {
      ctx.report({
        code: "invalid_shape",
        path: ["messages", i, "content"],
        model: params.modelId,
        message: `message[${i}] contains a document block but no text block; Converse requires a text block alongside documents.`,
        meta: { source: MESSAGE_DOCS },
      });
    }
  });
}

/** Fields Prompt-management prompt resources reject (Converse API reference). */
const PROMPT_RESOURCE_DENIED = [
  "additionalModelRequestFields",
  "inferenceConfig",
  "system",
  "toolConfig",
] as const;

/**
 * When modelId is a Prompt-management prompt ARN, the API rejects
 * additionalModelRequestFields/inferenceConfig/system/toolConfig — those must
 * be defined on the prompt resource itself.
 */
export function checkPromptResourceParams(
  params: ConverseParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (!params.modelId.startsWith("arn:") || !params.modelId.includes(":prompt/")) return;
  for (const field of PROMPT_RESOURCE_DENIED) {
    if ((params as unknown as Record<string, unknown>)[field] === undefined) continue;
    ctx.report({
      code: "unsupported_param",
      path: [field],
      model: params.modelId,
      message: `\`${field}\` cannot be sent when modelId is a Prompt-management prompt ARN; define it on the prompt resource instead.`,
      meta: { source: CONVERSE_DOCS },
    });
  }
}

// ---------------------------------------------------------------------------
// Estimation
// ---------------------------------------------------------------------------

/**
 * Coarse per-image token constant for estimation. Bedrock hosts many model
 * families with different image tokenizers; this is a heuristic, not a quote.
 */
const IMAGE_TOKENS = 1000;

function estimateConverse(
  params: ConverseParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): ValidateEstimate {
  const tokenizer = ctx.tokenizer;
  let inputTokens = 0;

  const countText = (value: unknown): void => {
    if (typeof value === "string") inputTokens += tokenizer.count(value);
  };

  for (const block of params.system ?? []) {
    countText((block as Record<string, unknown>)["text"]);
  }

  inputTokens += (params.messages?.length ?? 0) * PER_MESSAGE_TOKEN_OVERHEAD;

  eachContentBlock(params, (block) => {
    countText(block["text"]);
    if (block["image"] !== undefined) inputTokens += IMAGE_TOKENS;
    if (block["json"] !== undefined) {
      inputTokens += estimateToolDefinitionTokens(tokenizer, block["json"]);
    }
    const toolUse = block["toolUse"];
    if (typeof toolUse === "object" && toolUse !== null) {
      inputTokens += estimateToolDefinitionTokens(
        tokenizer,
        (toolUse as Record<string, unknown>)["input"],
      );
    }
    const document = block["document"];
    if (typeof document === "object" && document !== null) {
      const source = (document as Record<string, unknown>)["source"];
      if (typeof source === "object" && source !== null) {
        countText((source as Record<string, unknown>)["text"]);
      }
    }
  });

  for (const tool of params.toolConfig?.tools ?? []) {
    inputTokens += estimateToolDefinitionTokens(tokenizer, tool);
  }

  // A prompt-length-tiered model (Haiku 5.5 above 100,000 tokens; GPT-6,
  // GPT-6.1 and GPT-5.6 above 272,000) is priced there at rates the catalog
  // row does not carry, so the estimate's cost is withheld.
  if (info !== undefined && isPastPromptLengthTier(info.id, inputTokens)) return { inputTokens };

  // Worst case: the model fills the requested (or maximum) output budget.
  const outputTokens = params.inferenceConfig?.maxTokens ?? info?.limit.output ?? 0;
  const costUSD = computeCostUSD(info?.cost, { inputTokens, outputTokens });
  return costUSD === undefined ? { inputTokens } : { inputTokens, costUSD };
}

// ---------------------------------------------------------------------------
// Factory — URLs are region + model scoped.
// ---------------------------------------------------------------------------

/**
 * The Converse endpoint URL for one model in one region. The modelId path
 * segment is percent-encoded exactly like the AWS SDK encodes it (":" → %3A,
 * "/" in ARNs → %2F).
 */
export function converseUrl(region: string, modelId: string): string {
  return `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`;
}

export interface AmazonBedrockConfig {
  /** AWS region the requests are signed for, e.g. "us-east-1". */
  region: string;
}

/**
 * The SDK targets this endpoint declares: `@aws-sdk/client-bedrock-runtime`'s
 * `ConverseCommandInput`, which is `{ modelId, ...body }` — the wire body with
 * the URL's model id folded back in.
 *
 * No `.toApi` in v1. Every target in the generated availability data
 * (`anthropic`, `openrouter`, `vercel`, …) is a *different* wire dialect from
 * bedrock-converse, so there is not a single edge the same-dialect path could
 * serve; wiring the table now would buy a type surface whose every member
 * throws. It lands with the bedrock-converse codec, and needs no codegen
 * change when it does — the data is already generated.
 */
export type ChatSdkTargets<T extends ConverseParams = ConverseParams> = {
  "amazon-bedrock": () => T;
};

export interface AmazonBedrockChat {
  <T extends ConverseParams>(
    params: T & ExactKeys<T, ConverseParams>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "modelId">, ChatSdkTargets<T>>;
  safe<T extends ConverseParams>(
    params: T & ExactKeys<T, ConverseParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "modelId">, ChatSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
}

export interface AmazonBedrockProvider {
  /**
   * Validates params for POST /model/{modelId}/converse in this region.
   *
   * The result's enumerable properties are the exact fetch JSON body —
   * `modelId` is stripped, because on the wire it lives only in the URL
   * (`.request.url` has it interpolated). `.toSdk("amazon-bedrock")` returns
   * `{ modelId, ...body }`, the shape of `@aws-sdk/client-bedrock-runtime`'s
   * `ConverseCommandInput` (hand-mirrored, never imported; media `bytes` stay
   * in whatever form you supplied — the SDK wants `Uint8Array`, the raw wire
   * wants base64 strings). Auth is your job: SigV4-sign the request (or use
   * an `authorization: Bearer` token where supported) when fetching.
   */
  chat: AmazonBedrockChat;
  /** The Converse endpoint URL for a model id in this provider's region. */
  converseUrl(modelId: string): string;
  region: string;
}

export function createAmazonBedrock(config: AmazonBedrockConfig): AmazonBedrockProvider {
  const validator = createValidator<ConverseParams, unknown>({
    endpoint: "amazon-bedrock.chat",
    schema: converseSchema,
    // Regional-prefix/version-suffix/ARN forms resolve to the canonical
    // catalog id so model-dependent checks still apply.
    modelId: (params) => canonicalModelId(params.modelId),
    catalog,
    checks: [checkCapabilities, checkMessageContent, checkPromptResourceParams],
    estimate: estimateConverse,
    promptPath: ["messages"],
    finalize: (params) => {
      const { modelId, ...body } = params;
      const request: RequestMeta = {
        url: converseUrl(config.region, modelId),
        method: "POST",
        headers: JSON_HEADERS,
      };
      return toValidated(body, request, {
        sdk: { "amazon-bedrock": () => ({ modelId, ...body }) },
      });
    },
  });

  return {
    chat: validator as unknown as AmazonBedrockChat,
    converseUrl: (modelId) => converseUrl(config.region, modelId),
    region: config.region,
  };
}
