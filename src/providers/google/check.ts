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
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: { mimeType?: string; data?: string };
      }>;
    };
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
    /**
     * Per-modality breakdown of `promptTokenCount`, e.g.
     * `[{ modality: "TEXT", tokenCount: 5 }, { modality: "AUDIO", tokenCount: 1 }]`.
     *
     * Confirmed against a live response, which is why it is typed rather than
     * guessed: the entries **sum to** `promptTokenCount`, they do not extend
     * it — so the AUDIO slice is handed to `computeCostUSD` as
     * `audioInputTokens`, which re-rates it out of the text bill at the
     * model's `inputAudio` rate. On the audio-capable Gemini models that
     * publish both, audio is 2–4x text.
     */
    promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  };
  modelVersion?: string;
}

/**
 * The AUDIO slice of `promptTokensDetails`, or undefined when the response
 * carries no per-modality breakdown.
 *
 * Exported because it is the fact, not the plumbing: a caller reading raw
 * usage off a response wants the same number `checkChat`/`checkStt` price
 * with. It matters most on a transcription, whose prompt is almost entirely
 * audio — the difference between a right price and a 3x-low one.
 */
export function audioPromptTokens(
  meta: ChatResponseLike["usageMetadata"],
): number | undefined {
  const details = meta?.promptTokensDetails;
  if (details === undefined) return undefined;
  let audio: number | undefined;
  for (const entry of details) {
    if (entry?.modality?.toUpperCase() !== "AUDIO") continue;
    audio = (audio ?? 0) + (entry.tokenCount ?? 0);
  }
  return audio;
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
 *   promptTokenCount, matching computeCostUSD's re-rating convention), and
 *   `promptTokensDetails`'s AUDIO entry → audioInputTokens on the same
 *   convention (see {@link audioPromptTokens}).
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
    // The AUDIO slice of promptTokenCount, when the response broke it down —
    // re-rated out of the text bill at the model's inputAudio rate.
    const audioTokens = audioPromptTokens(meta);
    costUSD = computeCostUSD(info.cost, {
      ...(billedInput !== undefined && { inputTokens: billedInput }),
      ...(billedOutput !== undefined && { outputTokens: billedOutput }),
      ...(meta.cachedContentTokenCount !== undefined && {
        cachedInputTokens: meta.cachedContentTokenCount,
      }),
      ...(audioTokens !== undefined && { audioInputTokens: audioTokens }),
    });
  }

  return {
    warnings,
    ...(finishReason !== undefined && { finishReason }),
    usage,
    ...(costUSD !== undefined && { costUSD }),
  };
}

/**
 * Post-generation report for a Gemini **transcription** response.
 *
 * `checkChat` plus one fact that only makes sense on this surface: a
 * transcription that finishes cleanly and returns no text is a failed
 * transcription, not an empty answer. Everything else — the finish reasons,
 * the block reason, the usage mapping, and the per-modality audio re-rating
 * that matters most here (a transcription's prompt is almost entirely audio,
 * billed at 2–4x the text rate) — is the same logic, called rather than
 * copied.
 *
 * It lives in this module rather than a `stt-check.ts` sibling because
 * `checkChat` is the whole of it and this module already imports the generated
 * catalog that prices both.
 */
export function checkStt(response: ChatResponseLike): ResponseReport<GoogleFinishReason> {
  const report = checkChat(response);
  const finishReason = response.candidates?.[0]?.finishReason;
  const blockReason = response.promptFeedback?.blockReason;

  // Only for an otherwise-clean finish: a MAX_TOKENS or filtered response has
  // already been explained, and "and there is no transcript" would be noise.
  if (finishReason === "STOP" && blockReason === undefined && response.candidates !== undefined) {
    const parts = response.candidates[0]?.content?.parts ?? [];
    const transcript = parts.map((part) => part?.text ?? "").join("").trim();
    if (transcript === "") {
      report.warnings.push({
        severity: "warning",
        code: "invalid_shape",
        path: ["candidates", 0, "content", "parts"],
        message:
          "Generation finished normally (finishReason STOP) but no transcript text came back. " +
          "Check that the audio part actually carried audio, that its mimeType matches the bytes, and that the prompt asked for a transcription.",
        meta: { kind: "empty_transcript", finishReason },
      });
    }
  }

  return report;
}
