import type { Issue } from "../../core/issues";
import type { ResponseReport, UsageReport } from "../../core/report";
import { computeCostUSD } from "../../core/cost";
import { resolveBedrockModelInfo } from "./chat";

/** The `usage` object of a Converse response (API_runtime_TokenUsage). */
export interface ConverseUsageLike {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  cacheReadInputTokens?: number | null;
  cacheWriteInputTokens?: number | null;
}

/**
 * Structural subset of a Converse response — works with SDK
 * (`ConverseCommandOutput`) and raw fetch shapes alike.
 */
export interface ConverseResponseLike {
  stopReason?: string | null;
  usage?: ConverseUsageLike | null;
}

/**
 * Post-generation report for a Converse response: truncation/guardrail/
 * context warnings, normalized usage, and actual cost from catalog rates.
 * Never throws.
 *
 * The Converse response carries no model id, so pass the `modelId` you
 * requested to get `costUSD`; without it only warnings and usage are
 * reported.
 */
export function checkChat(response: ConverseResponseLike, modelId?: string): ResponseReport {
  const warnings: Issue[] = [];
  const finishReason = response.stopReason ?? undefined;

  const warn = (code: Issue["code"], message: string): void => {
    warnings.push({
      severity: "warning",
      code,
      path: [],
      message,
      ...(modelId !== undefined && { model: modelId }),
      meta: { stopReason: finishReason },
    });
  };

  if (finishReason === "max_tokens") {
    warn(
      "over_output_limit",
      'The response was truncated: stopReason is "max_tokens". Raise inferenceConfig.maxTokens to get the full answer.',
    );
  }
  if (finishReason === "guardrail_intervened") {
    warn(
      "unsupported_capability",
      'A guardrail intervened: stopReason is "guardrail_intervened". Check the `trace.guardrail` assessments for what was blocked or masked.',
    );
  }
  if (finishReason === "content_filtered") {
    warn(
      "unsupported_capability",
      'Output was cut by content filtering: stopReason is "content_filtered"; the response is incomplete.',
    );
  }
  if (finishReason === "model_context_window_exceeded") {
    warn(
      "over_context",
      'The model hit its context window: stopReason is "model_context_window_exceeded". Compact or split the conversation.',
    );
  }
  if (finishReason === "malformed_model_output" || finishReason === "malformed_tool_use") {
    warn(
      "invalid_shape",
      `The model produced unparseable output: stopReason is "${finishReason}". Retry, or loosen the tool/output schema.`,
    );
  }

  const raw = response.usage ?? {};
  const freshInput = raw.inputTokens ?? undefined;
  const cachedInputTokens = raw.cacheReadInputTokens ?? undefined;
  const cacheWriteTokens = raw.cacheWriteInputTokens ?? undefined;
  const outputTokens = raw.outputTokens ?? undefined;

  // Bedrock's `inputTokens` counts only non-cached input tokens — "total
  // input tokens = inputTokens + cacheReadInputTokens + cacheWriteInputTokens"
  // (docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html).
  // computeCostUSD assumes cachedInputTokens are INCLUDED in inputTokens and
  // re-rates them at cacheRead, so fold cache reads back into inputTokens;
  // cache writes are billed only at the cacheWrite rate.
  const inputTokens =
    freshInput !== undefined || cachedInputTokens !== undefined
      ? (freshInput ?? 0) + (cachedInputTokens ?? 0)
      : undefined;

  const usage: UsageReport = {};
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;
  if (cachedInputTokens !== undefined) usage.cachedInputTokens = cachedInputTokens;
  if (cacheWriteTokens !== undefined) usage.cacheWriteTokens = cacheWriteTokens;
  const totalTokens = raw.totalTokens ?? undefined;
  if (totalTokens !== undefined) usage.totalTokens = totalTokens;

  const info = modelId === undefined ? undefined : resolveBedrockModelInfo(modelId);
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
