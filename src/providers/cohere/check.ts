import type { Issue } from "../../core/issues";
import type { ResponseReport, UsageReport } from "../../core/report";
import type { ModelInfo } from "../../core/catalog-types";
import { resolveModelInfo } from "../../core/catalog-lookup";
import { computeCostUSD } from "../../core/cost";
import { models } from "../../catalog/cohere.gen";

/**
 * The `usage` object of a v2 chat response: `billed_units` are the counts
 * Cohere charges for; `tokens` are the raw model token counts.
 */
export interface ChatUsageLike {
  billed_units?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    search_units?: number | null;
    classifications?: number | null;
  } | null;
  tokens?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
  } | null;
  /** Prompt tokens served from the inference cache. */
  cached_tokens?: number | null;
}

/** Structural subset of a POST /v2/chat response — works with SDK and raw fetch shapes. */
export interface ChatResponseLike {
  finish_reason?: string | null;
  usage?: ChatUsageLike | null;
}

const catalog = models as Record<string, ModelInfo>;

/**
 * Post-generation report for a v2 chat response: truncation/failure warnings,
 * normalized usage, and actual cost priced from `billed_units` (falling back
 * to raw `tokens`) against catalog rates. Never throws.
 *
 * The v2 chat response carries no model id, so pass the `model` you requested
 * to get `costUSD`; without it only warnings and usage are reported.
 */
export function checkChat(response: ChatResponseLike, modelId?: string): ResponseReport {
  const warnings: Issue[] = [];
  const finishReason = response.finish_reason ?? undefined;

  if (finishReason === "MAX_TOKENS") {
    warnings.push({
      severity: "warning",
      code: "over_output_limit",
      path: [],
      message:
        'The response was truncated: finish_reason is "MAX_TOKENS". Raise `max_tokens` to get the full answer.',
      ...(modelId !== undefined && { model: modelId }),
      meta: { finishReason },
    });
  }
  if (finishReason === "ERROR" || finishReason === "TIMEOUT") {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: [],
      message: `Generation did not complete: finish_reason is "${finishReason}". The message content is unreliable; retry the request.`,
      ...(modelId !== undefined && { model: modelId }),
      meta: { finishReason },
    });
  }

  const raw = response.usage ?? {};
  const tokens = raw.tokens ?? {};
  const billed = raw.billed_units ?? {};
  const inputTokens = tokens.input_tokens ?? undefined;
  const outputTokens = tokens.output_tokens ?? undefined;
  const cachedInputTokens = raw.cached_tokens ?? undefined;

  const usage: UsageReport = {};
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;
  if (cachedInputTokens !== undefined) usage.cachedInputTokens = cachedInputTokens;
  if (inputTokens !== undefined || outputTokens !== undefined) {
    usage.totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0);
  }

  // Price from billed_units when present — those are the counts Cohere
  // charges for (cache discounts etc. already applied); raw token counts are
  // only a fallback. search_units/classifications have no catalog rate and
  // are not priced.
  const info = modelId === undefined ? undefined : resolveModelInfo(catalog, modelId);
  const costUSD = computeCostUSD(info?.cost, {
    inputTokens: billed.input_tokens ?? inputTokens,
    outputTokens: billed.output_tokens ?? outputTokens,
  });

  return {
    warnings,
    ...(finishReason !== undefined && { finishReason }),
    usage,
    ...(costUSD !== undefined && { costUSD }),
  };
}
