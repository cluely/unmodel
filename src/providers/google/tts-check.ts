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

/** A decoded JSON object, narrowed without asserting a provider response shape. */
function objectOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function isAudioMimeType(value: unknown): boolean {
  return typeof value === "string" && value.toLowerCase().startsWith("audio/");
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Does this candidate carry any actual audio?
 *
 * Both deliveries count: inline base64 (`inlineData`) and a URI to fetch
 * (`fileData`). Gemini's documented TTS envelope and this adapter's exported
 * delivery descriptor both pin the audio to `parts[0]`; accepting a later
 * part here would let policy pass a response the descriptor cannot extract.
 */
function hasAudioPart(candidate: Readonly<Record<string, unknown>> | undefined): boolean {
  const content = objectOf(candidate?.["content"]);
  const rawParts = content?.["parts"];
  const entry = objectOf(Array.isArray(rawParts) ? rawParts[0] : undefined);
  const inlineData = objectOf(entry?.["inlineData"]);
  const fileData = objectOf(entry?.["fileData"]);
  return (
    (isAudioMimeType(inlineData?.["mimeType"]) && isNonEmptyString(inlineData?.["data"])) ||
    (isAudioMimeType(fileData?.["mimeType"]) && isNonEmptyString(fileData?.["fileUri"]))
  );
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
 * - a clean STOP without a populated `audio/*` delivery (non-empty
 *   `inlineData.data` or `fileData.fileUri`) → an empty-audio warning
 *   (`meta.kind: "empty_audio"`). Also documented: "the model occasionally
 *   returns text tokens instead of audio tokens".
 * - usage: promptTokenCount → inputTokens, candidatesTokenCount →
 *   outputTokens (the rendered audio), cachedContentTokenCount →
 *   cachedInputTokens.
 * - `costUSD` is priced from the three hand rows via the response's
 *   `modelVersion` (prefix fallback); undefined when the model is unknown.
 */
export function checkTts(response: unknown): ResponseReport<GoogleTtsFinishReason> {
  const warnings: Issue[] = [];
  const decoded = objectOf(response);
  const candidates = decoded?.["candidates"];
  const candidate = Array.isArray(candidates) ? objectOf(candidates[0]) : undefined;
  const rawFinishReason = candidate?.["finishReason"];
  const finishReason = typeof rawFinishReason === "string" ? rawFinishReason : undefined;

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

  const promptFeedback = objectOf(decoded?.["promptFeedback"]);
  const rawBlockReason = promptFeedback?.["blockReason"];
  const blockReason = typeof rawBlockReason === "string" ? rawBlockReason : undefined;
  const blocked = blockReason !== undefined && blockReason !== "BLOCK_REASON_UNSPECIFIED";
  if (blocked) {
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
    !blocked &&
    candidates !== undefined &&
    !hasAudioPart(candidate)
  ) {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["candidates", 0, "content", "parts"],
      message:
        "Generation finished normally (finishReason STOP) but no populated audio/* part came back — neither non-empty inlineData.data nor fileData.fileUri. " +
        "Gemini TTS occasionally returns text tokens instead of audio tokens; retrying is the documented remedy.",
      meta: { kind: "empty_audio", finishReason, source: GEMINI_TTS_DOCS_URL },
    });
  }

  const meta = objectOf(decoded?.["usageMetadata"]);
  const promptTokenCount = meta?.["promptTokenCount"];
  const candidatesTokenCount = meta?.["candidatesTokenCount"];
  const cachedContentTokenCount = meta?.["cachedContentTokenCount"];
  const totalTokenCount = meta?.["totalTokenCount"];
  const usage: UsageReport = {};
  if (typeof promptTokenCount === "number") usage.inputTokens = promptTokenCount;
  if (typeof candidatesTokenCount === "number") usage.outputTokens = candidatesTokenCount;
  if (typeof cachedContentTokenCount === "number") {
    usage.cachedInputTokens = cachedContentTokenCount;
  }
  if (typeof totalTokenCount === "number") usage.totalTokens = totalTokenCount;

  const modelVersion = decoded?.["modelVersion"];
  const info = typeof modelVersion === "string" ? resolveModelInfo(catalog, modelVersion) : undefined;
  let costUSD: number | undefined;
  if (info !== undefined && meta !== undefined) {
    costUSD = computeCostUSD(info.cost, {
      ...(typeof promptTokenCount === "number" && { inputTokens: promptTokenCount }),
      ...(typeof candidatesTokenCount === "number" && { outputTokens: candidatesTokenCount }),
      ...(typeof cachedContentTokenCount === "number" && {
        cachedInputTokens: cachedContentTokenCount,
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
