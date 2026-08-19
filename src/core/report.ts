import type { Issue } from "./issues";

export interface UsageReport {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
}

/** Returned by the post-generation `check*` functions. Never throws. */
export interface ResponseReport {
  warnings: Issue[];
  finishReason?: string;
  usage: UsageReport;
  /** Actual cost in USD priced from catalog rates; undefined if the model is unknown. */
  costUSD?: number;
}
