import type { Issue } from "../../core/issues";
import type { ResponseReport, UsageReport } from "../../core/report";
import type { ModelInfo } from "../../core/catalog-types";
import { resolveModelInfo } from "../../core/catalog-lookup";
import { computeCostUSD } from "../../core/cost";
import { models } from "../../catalog/anthropic.gen";

/** The `usage` object of a /v1/messages response. */
export interface MessageUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Structural subset of a /v1/messages response — works with SDK and raw fetch shapes. */
export interface MessageLike {
  model?: string;
  stop_reason?: string | null;
  usage?: MessageUsage | null;
}

const catalog = models as Record<string, ModelInfo>;

/**
 * Post-generation report for a /v1/messages response: truncation/refusal
 * warnings, normalized usage, and actual cost from catalog rates. Never throws.
 */
export function checkChat(response: MessageLike): ResponseReport {
  const warnings: Issue[] = [];
  const finishReason = response.stop_reason ?? undefined;
  const model = response.model;

  if (finishReason === "max_tokens") {
    warnings.push({
      severity: "warning",
      code: "over_output_limit",
      path: [],
      message:
        'The response was truncated: stop_reason is "max_tokens". Raise `max_tokens` (and stream large outputs) to get the full answer.',
      ...(model !== undefined && { model }),
      meta: { stopReason: finishReason },
    });
  }
  if (finishReason === "refusal") {
    warnings.push({
      severity: "warning",
      code: "unsupported_capability",
      path: [],
      message:
        'The model declined this request: stop_reason is "refusal". `content` may be empty (pre-output) or partial (mid-stream); check `stop_details` for the category.',
      ...(model !== undefined && { model }),
      meta: { stopReason: finishReason },
    });
  }
  if (finishReason === "model_context_window_exceeded") {
    warnings.push({
      severity: "warning",
      code: "over_context",
      path: [],
      message:
        'The model hit the context window mid-generation: stop_reason is "model_context_window_exceeded". Compact or split the conversation.',
      ...(model !== undefined && { model }),
      meta: { stopReason: finishReason },
    });
  }

  const raw = response.usage ?? {};
  const freshInput = raw.input_tokens ?? undefined;
  const cachedInputTokens = raw.cache_read_input_tokens ?? undefined;
  const cacheWriteTokens = raw.cache_creation_input_tokens ?? undefined;
  const outputTokens = raw.output_tokens ?? undefined;

  // Anthropic's `input_tokens` is the UNCACHED remainder only — cache reads and
  // cache writes are reported separately (total prompt = input_tokens +
  // cache_read_input_tokens + cache_creation_input_tokens, per the prompt
  // caching docs). computeCostUSD assumes cachedInputTokens are INCLUDED in
  // inputTokens and re-rates them at cacheRead, so fold cache reads back into
  // inputTokens here; cache writes are billed only at the cacheWrite rate.
  const inputTokens =
    freshInput !== undefined || cachedInputTokens !== undefined
      ? (freshInput ?? 0) + (cachedInputTokens ?? 0)
      : undefined;

  // Build usage field-by-field so absent counts stay absent keys (matching
  // the other providers' checkChat) instead of explicitly-undefined ones.
  const usage: UsageReport = {};
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;
  if (cachedInputTokens !== undefined) usage.cachedInputTokens = cachedInputTokens;
  if (cacheWriteTokens !== undefined) usage.cacheWriteTokens = cacheWriteTokens;
  if (inputTokens !== undefined || cacheWriteTokens !== undefined || outputTokens !== undefined) {
    usage.totalTokens = (inputTokens ?? 0) + (cacheWriteTokens ?? 0) + (outputTokens ?? 0);
  }

  const info = model === undefined ? undefined : resolveModelInfo(catalog, model);
  const costUSD = computeCostUSD(info?.cost, {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheWriteTokens,
  });

  return {
    warnings,
    ...(finishReason !== undefined && { finishReason }),
    usage,
    ...(costUSD !== undefined && { costUSD }),
  };
}
