import type { ResponseReport } from "../../core/report";
import { resolveModelInfo } from "../../core/catalog-lookup";
import { computeCostUSD } from "../../core/cost";
import {
  checkChat as checkGoogleChat,
  type ChatResponseLike,
} from "../google";
import { models } from "../../catalog/google-vertex.gen";

export type { ChatResponseLike };

/**
 * Post-generation report for a Vertex generateContent response. Never throws.
 *
 * The response wire shape (candidates/promptFeedback/usageMetadata) is
 * dialect-identical to the Gemini API, so the warning/usage extraction is
 * delegated to unmodel/google's checker. Pricing, however, must come from
 * google-vertex catalog rates — the google-priced `costUSD` is dropped and
 * recomputed here from the response's `modelVersion`.
 */
export function checkChat(response: ChatResponseLike): ResponseReport {
  const { costUSD: _googlePriced, ...report } = checkGoogleChat(response);

  const info =
    response.modelVersion === undefined ? undefined : resolveModelInfo(models, response.modelVersion);
  const meta = response.usageMetadata;
  if (info === undefined || meta === undefined) return report;

  // Same billing conventions as google/check.ts (duplicated — the folding is
  // private there): thoughts are billed at the output rate, tool-use prompt
  // tokens at the input rate, and cachedContentTokenCount (already included
  // in promptTokenCount) is re-rated by computeCostUSD.
  const billedInput =
    meta.promptTokenCount === undefined
      ? undefined
      : meta.promptTokenCount + (meta.toolUsePromptTokenCount ?? 0);
  const billedOutput =
    meta.candidatesTokenCount === undefined && meta.thoughtsTokenCount === undefined
      ? undefined
      : (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0);
  const costUSD = computeCostUSD(info.cost, {
    ...(billedInput !== undefined && { inputTokens: billedInput }),
    ...(billedOutput !== undefined && { outputTokens: billedOutput }),
    ...(meta.cachedContentTokenCount !== undefined && {
      cachedInputTokens: meta.cachedContentTokenCount,
    }),
  });
  return costUSD === undefined ? report : { ...report, costUSD };
}
