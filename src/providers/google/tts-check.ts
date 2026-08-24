/**
 * Post-generation report for a Gemini TTS response.
 *
 * A separate module from `./check.ts` — which serves `google.chat` — for the
 * bundle reason that runs through this whole surface: `./check.ts` imports
 * `src/catalog/google.gen.ts` (38 models, ~90 KiB) to price a chat response,
 * and a TTS caller must not pay for it. This one prices against the three hand
 * rows in `./tts-models.ts`.
 *
 * The response shape is the same `generateContent` envelope, read for a
 * different payload: the audio comes back as
 * `candidates[0].content.parts[0].inlineData` with an `audio/*` mimeType and
 * base64 `data` (raw PCM at 24 kHz, mono, 16-bit unless `responseFormat.audio`
 * asked for a container) — or, when the request set
 * `responseFormat.audio.delivery` to `URI` (`GEMINI_AUDIO_DELIVERY_MODES` in
 * ./tts-constraints, validated by ./tts), as a `fileData` part carrying an
 * `audio/*` mimeType and a `fileUri` to fetch instead of bytes.
 */

import type { Issue } from "../../core/issues";
import type { ResponseReport, UsageReport } from "../../core/report";
import type { ModelInfo } from "../../core/catalog-types";
import { resolveModelInfo } from "../../core/catalog-lookup";
import { computeCostUSD } from "../../core/cost";
import { ttsModels } from "./tts-models";
import { GEMINI_TTS_DOCS_URL } from "./tts-constraints";

/**
 * Structural subset of a TTS `generateContent` response — the parsed wire JSON
 * and @google/genai's `GenerateContentResponse` are both assignable.
 *
 * `content.parts` is typed (unlike `ChatResponseLike`, which reads only
 * `finishReason`) because the audio payload is the thing this checker is for:
 * a STOP with no audio part is the failure mode the guide warns about — "the
 * model occasionally returns text tokens instead of audio tokens".
 */
export interface TtsResponseLike {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: { mimeType?: string; data?: string };
        fileData?: { fileUri?: string; mimeType?: string };
      }>;
    };
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
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
]);

/**
 * The `candidates[0].finishReason` values a TTS response can carry, as
 * `checkTts` reports them.
 *
 * Tail-open per this library's `(string & {})` convention: the checker never
 * refuses an off-list finish reason, and the Gemini enum grows with each
 * modality. The union drives autocomplete; it does not gate values.
 */
export type GoogleTtsFinishReason =
  | "STOP"
  | "MAX_TOKENS"
  | "SAFETY"
  | "RECITATION"
  | "BLOCKLIST"
  | "PROHIBITED_CONTENT"
  | "SPII"
  | (string & {});

const catalog: Record<string, ModelInfo> = ttsModels;

/**
 * Does this candidate carry any actual audio?
 *
 * Both deliveries count: inline base64 (`inlineData`) and a URI to fetch
 * (`fileData`). Scanning only `inlineData` would report `empty_audio` on every
 * `delivery: "URI"` response — a request this same package validates.
 */
function hasAudioPart(response: TtsResponseLike): boolean {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts.some((part) => {
    const mimeType = part?.inlineData?.mimeType ?? part?.fileData?.mimeType;
    return typeof mimeType === "string" && mimeType.toLowerCase().startsWith("audio/");
  });
}

/**
 * Post-generation report for a Gemini TTS response. Never throws.
 *
 * - `finishReason` MAX_TOKENS → truncation warning (`meta.kind: "truncated"`).
 *   On this surface truncation means the audio stops mid-sentence, which is
 *   the one failure a caller cannot hear until they play it.
 * - safety/recitation/prohibited-content finish reasons and
 *   `promptFeedback.blockReason` → filtering warnings
 *   (`meta.kind: "content_filtered"`). The guide names a TTS-specific cause:
 *   "vague prompts may fail to trigger the speech synthesis classifier,
 *   resulting in a rejected request (PROHIBITED_CONTENT)".
 * - a clean STOP that carries no `audio/*` part → an empty-audio warning
 *   (`meta.kind: "empty_audio"`). Also documented: "the model occasionally
 *   returns text tokens instead of audio tokens".
 * - usage: promptTokenCount → inputTokens, candidatesTokenCount →
 *   outputTokens (the rendered audio), cachedContentTokenCount →
 *   cachedInputTokens.
 * - `costUSD` is priced from the three hand rows via the response's
 *   `modelVersion` (prefix fallback); undefined when the model is unknown.
 */
export function checkTts(response: TtsResponseLike): ResponseReport<GoogleTtsFinishReason> {
  const warnings: Issue[] = [];
  const finishReason = response.candidates?.[0]?.finishReason;

  if (finishReason === "MAX_TOKENS") {
    warnings.push({
      severity: "warning",
      code: "over_output_limit",
      path: ["candidates", 0, "finishReason"],
      message:
        "Audio was truncated: generation stopped at the maxOutputTokens limit (finishReason MAX_TOKENS).",
      meta: { kind: "truncated", finishReason },
    });
  } else if (finishReason !== undefined && FILTERED_FINISH_REASONS.has(finishReason)) {
    warnings.push({
      severity: "warning",
      code: "unsupported_capability",
      path: ["candidates", 0, "finishReason"],
      message:
        `Synthesis was refused by the provider (finishReason ${finishReason}). ` +
        "A vague prompt can fail to trigger the speech-synthesis classifier: add a clear preamble instructing the model to synthesize speech, and label where the transcript begins.",
      meta: { kind: "content_filtered", finishReason, source: GEMINI_TTS_DOCS_URL },
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

  // Only for an otherwise-clean finish: a MAX_TOKENS or filtered response has
  // already been explained, and a second warning saying "and there is no
  // audio" would be noise rather than news.
  if (
    finishReason === "STOP" &&
    blockReason === undefined &&
    response.candidates !== undefined &&
    !hasAudioPart(response)
  ) {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["candidates", 0, "content", "parts"],
      message:
        "Generation finished normally (finishReason STOP) but no audio/* part came back — neither inlineData nor a fileData URI. " +
        "Gemini TTS occasionally returns text tokens instead of audio tokens; retrying is the documented remedy.",
      meta: { kind: "empty_audio", finishReason, source: GEMINI_TTS_DOCS_URL },
    });
  }

  const meta = response.usageMetadata;
  const usage: UsageReport = {};
  if (meta?.promptTokenCount !== undefined) usage.inputTokens = meta.promptTokenCount;
  if (meta?.candidatesTokenCount !== undefined) usage.outputTokens = meta.candidatesTokenCount;
  if (meta?.cachedContentTokenCount !== undefined) {
    usage.cachedInputTokens = meta.cachedContentTokenCount;
  }
  if (meta?.totalTokenCount !== undefined) usage.totalTokens = meta.totalTokenCount;

  const info =
    response.modelVersion === undefined
      ? undefined
      : resolveModelInfo(catalog, response.modelVersion);
  let costUSD: number | undefined;
  if (info !== undefined && meta !== undefined) {
    costUSD = computeCostUSD(info.cost, {
      ...(meta.promptTokenCount !== undefined && { inputTokens: meta.promptTokenCount }),
      ...(meta.candidatesTokenCount !== undefined && { outputTokens: meta.candidatesTokenCount }),
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
