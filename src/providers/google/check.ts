import type { Issue } from "../../core/issues";
import type { ResponseReport, UsageReport } from "../../core/report";
import type { ModelInfo } from "../../core/catalog-types";
import { resolveModelInfo } from "../../core/catalog-lookup";
import { computeCostUSD } from "../../core/cost";
import { models } from "../../catalog/google.gen";

/**
 * Structural subset of a generateContent response — the parsed wire JSON and
 * @google/genai's `GenerateContentResponse` are both assignable.
 */
export interface ChatResponseLike {
  candidates?: Array<{
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
    toolUsePromptTokenCount?: number;
    totalTokenCount?: number;
  };
  modelVersion?: string;
}

/** finishReason values that mean the provider filtered/blocked the output. */
const FILTERED_FINISH_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "IMAGE_RECITATION",
]);

/**
 * The `candidates[0].finishReason` values a generateContent response can
 * carry, as `checkChat` reports them on `finishReason`.
 *
 * PUBLIC API — keep in sync with the branches below: `"MAX_TOKENS"` (the
 * truncation branch) and every member of `FILTERED_FINISH_REASONS` above (the
 * content-filtering branch). `"STOP"` is the ordinary success value, which the
 * checker does not branch on but every caller compares against
 * (`check.test.ts` asserts it), so it is listed too.
 *
 * Tail-open, per this library's `(string & {})` convention: the checker never
 * refuses an off-list finish reason — `check.test.ts` pins that an
 * unrecognized one is passed through and NOT treated as filtering — and the
 * Gemini enum grows with each modality (the four `IMAGE_*` members arrived
 * that way). The union drives autocomplete; it does not gate values.
 */
export type GoogleFinishReason =
  | "STOP"
  | "MAX_TOKENS"
  | "SAFETY"
  | "RECITATION"
  | "BLOCKLIST"
  | "PROHIBITED_CONTENT"
  | "SPII"
  | "IMAGE_SAFETY"
  | "IMAGE_PROHIBITED_CONTENT"
  | "IMAGE_RECITATION"
  | (string & {});

const catalog: Record<string, ModelInfo> = models;

/**
 * Resolves the response's `modelVersion` (e.g. "gemini-2.5-flash-preview-05-20",
 * possibly "models/"-prefixed) to catalog info via the shared core semantics:
 * "models/" strip, exact match, then longest "-"/"." boundary prefix.
 */
function modelInfoFor(modelVersion: string | undefined): ModelInfo | undefined {
  if (modelVersion === undefined) return undefined;
  return resolveModelInfo(catalog, modelVersion);
}

/**
 * Post-generation report for a generateContent response. Never throws.
 *
 * - `finishReason` MAX_TOKENS → truncation warning (`meta.kind: "truncated"`).
 * - safety/recitation/prohibited-content finish reasons and
 *   `promptFeedback.blockReason` (prompt blocked; candidates empty) →
 *   filtering warnings (`meta.kind: "content_filtered"`). IssueCode has no
 *   response-side codes, so these reuse the closest validation codes —
 *   `meta.kind` is the reliable discriminator.
 * - usage: promptTokenCount → inputTokens, candidatesTokenCount →
 *   outputTokens, thoughtsTokenCount → reasoningTokens (billed at the output
 *   rate for costing, since Google prices thoughts as output),
 *   cachedContentTokenCount → cachedInputTokens (already included in
 *   promptTokenCount, matching computeCostUSD's re-rating convention).
 * - `costUSD` is priced from catalog rates via the response's `modelVersion`
 *   (prefix fallback); undefined when the model is unknown.
 */
export function checkChat(response: ChatResponseLike): ResponseReport<GoogleFinishReason> {
  const warnings: Issue[] = [];
  const finishReason = response.candidates?.[0]?.finishReason;

  if (finishReason === "MAX_TOKENS") {
    warnings.push({
      severity: "warning",
      code: "over_output_limit",
      path: ["candidates", 0, "finishReason"],
      message:
        "Response was truncated: generation stopped at the maxOutputTokens limit (finishReason MAX_TOKENS).",
      meta: { kind: "truncated", finishReason },
    });
  } else if (finishReason !== undefined && FILTERED_FINISH_REASONS.has(finishReason)) {
    warnings.push({
      severity: "warning",
      code: "unsupported_capability",
      path: ["candidates", 0, "finishReason"],
      message: `Response content was filtered by the provider (finishReason ${finishReason}).`,
      meta: { kind: "content_filtered", finishReason },
    });
  }

  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason !== undefined && blockReason !== "BLOCK_REASON_UNSPECIFIED") {
    warnings.push({
      severity: "warning",
      code: "unsupported_capability",
      path: ["promptFeedback", "blockReason"],
      message: `Prompt was blocked before generation (blockReason ${blockReason}); candidates are empty.`,
      meta: { kind: "content_filtered", blockReason },
    });
  }

  const meta = response.usageMetadata;
  const usage: UsageReport = {};
  if (meta?.promptTokenCount !== undefined) usage.inputTokens = meta.promptTokenCount;
  if (meta?.candidatesTokenCount !== undefined) usage.outputTokens = meta.candidatesTokenCount;
  if (meta?.thoughtsTokenCount !== undefined) usage.reasoningTokens = meta.thoughtsTokenCount;
  if (meta?.cachedContentTokenCount !== undefined) usage.cachedInputTokens = meta.cachedContentTokenCount;
  if (meta?.totalTokenCount !== undefined) usage.totalTokens = meta.totalTokenCount;

  const info = modelInfoFor(response.modelVersion);
  let costUSD: number | undefined;
  if (info !== undefined && meta !== undefined) {
    // Google bills thoughts and tool-use prompt tokens at the output/input
    // rates; fold them in for costing while keeping usage fields raw.
    const billedInput =
      meta.promptTokenCount === undefined
        ? undefined
        : meta.promptTokenCount + (meta.toolUsePromptTokenCount ?? 0);
    const billedOutput =
      meta.candidatesTokenCount === undefined && meta.thoughtsTokenCount === undefined
        ? undefined
        : (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0);
    costUSD = computeCostUSD(info.cost, {
      ...(billedInput !== undefined && { inputTokens: billedInput }),
      ...(billedOutput !== undefined && { outputTokens: billedOutput }),
      ...(meta.cachedContentTokenCount !== undefined && {
        cachedInputTokens: meta.cachedContentTokenCount,
      }),
    });
  }

  return {
    warnings,
    ...(finishReason !== undefined && { finishReason }),
    usage,
    ...(costUSD !== undefined && { costUSD }),
  };
}
