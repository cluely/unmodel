import type { Issue } from "../../core/issues";
import type { ResponseReport, UsageReport } from "../../core/report";
import { createCheckChat } from "../openai-compatible/check";
import { models } from "../../catalog/openai.gen";

// The Chat Completions response checker is the shared OpenAI-compatible one
// (src/providers/openai-compatible/check.ts), bound to OpenAI's catalog.
export type { ChatChoiceLike, ChatCompletionLike } from "../openai-compatible/check";

/**
 * Inspects a Chat Completions response for silent quality problems
 * (truncation, content filtering, refusals) and prices the actual usage
 * against catalog rates. Never throws.
 */
export const checkChat = createCheckChat(models, "OpenAI");

export interface ImagesResponseLike {
  data?: Array<{
    b64_json?: string;
    url?: string;
    revised_prompt?: string;
  }> | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  } | null;
}

/**
 * Inspects an Images response: warns when no image came back and maps the
 * GPT-image usage block. Both `POST /v1/images/generations` and
 * `POST /v1/images/edits` return this shape, so the same checker covers the
 * generations and edit endpoints. No cost is computed — the response does not
 * echo the model id.
 */
export function checkImages(res: ImagesResponseLike): ResponseReport {
  const warnings: Issue[] = [];
  if (res.data == null || res.data.length === 0) {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["data"],
      message: "The response contains no generated images.",
      meta: { kind: "empty_data" },
    });
  }

  const rawUsage = res.usage;
  const usage: UsageReport = {
    ...(rawUsage?.input_tokens !== undefined && { inputTokens: rawUsage.input_tokens }),
    ...(rawUsage?.output_tokens !== undefined && { outputTokens: rawUsage.output_tokens }),
    ...(rawUsage?.total_tokens !== undefined && { totalTokens: rawUsage.total_tokens }),
  };

  return { warnings, usage };
}
