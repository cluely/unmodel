import type { Issue } from "../../core/issues";
import type { ResponseReport, UsageReport } from "../../core/report";
import type { ModelInfo } from "../../core/catalog-types";
import { computeCostUSD } from "../../core/cost";
import { resolveModelInfo } from "../../core/catalog-lookup";

// Structural response types: only the fields the checkers read, so any
// fetch-parsed JSON or SDK response object is accepted.

export interface ChatChoiceLike {
  finish_reason?: string | null;
  message?: {
    refusal?: string | null;
  } | null;
}

export interface ChatCompletionLike {
  model?: string;
  choices?: ChatChoiceLike[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
      cache_write_tokens?: number;
    } | null;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    } | null;
  } | null;
}

/**
 * Builds a Chat Completions response checker bound to one provider's catalog:
 * it inspects a response for silent quality problems (truncation, content
 * filtering, refusals) and prices the actual usage against catalog rates.
 * `providerName` appears in provider-attributed messages (e.g. "OpenAI",
 * "groq"). The returned function never throws.
 */
export function createCheckChat(
  catalog: Record<string, ModelInfo>,
  providerName: string,
): (res: ChatCompletionLike) => ResponseReport {
  /**
   * Resolves a response model id against the catalog. Responses often carry a
   * dated snapshot id (e.g. "gpt-5.2-2026-01-15") absent from the catalog;
   * core's shared lookup handles date-suffix stripping and prefix fallback.
   */
  function catalogInfoFor(modelId: string | undefined): ModelInfo | undefined {
    return modelId === undefined ? undefined : resolveModelInfo(catalog, modelId);
  }

  return function checkChat(res: ChatCompletionLike): ResponseReport {
    const warnings: Issue[] = [];

    (res.choices ?? []).forEach((choice, index) => {
      if (choice.finish_reason === "length") {
        warnings.push({
          severity: "warning",
          code: "over_output_limit",
          path: ["choices", index, "finish_reason"],
          message:
            "The completion was truncated: generation hit the max_completion_tokens/max_tokens budget (or the model's output limit) before finishing.",
          meta: { kind: "truncated", finishReason: "length" },
          ...(res.model !== undefined && { model: res.model }),
        });
      }
      if (choice.finish_reason === "content_filter") {
        warnings.push({
          severity: "warning",
          code: "unsupported_capability",
          path: ["choices", index, "finish_reason"],
          message: `Output was cut by ${providerName}'s content filter; the completion is incomplete.`,
          meta: { kind: "content_filtered", finishReason: "content_filter" },
          ...(res.model !== undefined && { model: res.model }),
        });
      }
      const refusal = choice.message?.refusal;
      if (typeof refusal === "string" && refusal.length > 0) {
        warnings.push({
          severity: "warning",
          code: "unsupported_capability",
          path: ["choices", index, "message", "refusal"],
          message: `The model refused to answer: ${refusal}`,
          meta: { kind: "refusal" },
          ...(res.model !== undefined && { model: res.model }),
        });
      }
    });

    const usage: UsageReport = {};
    const rawUsage = res.usage;
    if (rawUsage != null) {
      if (rawUsage.prompt_tokens !== undefined) usage.inputTokens = rawUsage.prompt_tokens;
      if (rawUsage.completion_tokens !== undefined) usage.outputTokens = rawUsage.completion_tokens;
      if (rawUsage.total_tokens !== undefined) usage.totalTokens = rawUsage.total_tokens;
      const cached = rawUsage.prompt_tokens_details?.cached_tokens;
      if (cached !== undefined) usage.cachedInputTokens = cached;
      const cacheWrite = rawUsage.prompt_tokens_details?.cache_write_tokens;
      if (cacheWrite !== undefined) usage.cacheWriteTokens = cacheWrite;
      const reasoning = rawUsage.completion_tokens_details?.reasoning_tokens;
      if (reasoning !== undefined) usage.reasoningTokens = reasoning;
    }

    // Reasoning tokens are already counted inside completion_tokens on this
    // API, so they are deliberately not passed to the cost breakdown.
    //
    // cache_write_tokens are likewise INCLUDED in prompt_tokens, but billed at
    // the cacheWrite rate INSTEAD of the input rate (1.25x, not 1x + 1.25x) —
    // "Cache write billing uses this value at 1.25x the uncached input token
    // rate" (developers.openai.com/api/docs/guides/prompt-caching). Core's
    // computeCostUSD adds cacheWriteTokens on top of inputTokens (a separate
    // bucket, Anthropic-style), so subtract them from the input bill here.
    const cacheWrite = usage.cacheWriteTokens ?? 0;
    const costUSD = computeCostUSD(catalogInfoFor(res.model)?.cost, {
      inputTokens:
        usage.inputTokens === undefined ? undefined : Math.max(0, usage.inputTokens - cacheWrite),
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
    });

    const finishReason = res.choices?.[0]?.finish_reason;
    return {
      warnings,
      usage,
      ...(finishReason != null && { finishReason }),
      ...(costUSD !== undefined && { costUSD }),
    };
  };
}
