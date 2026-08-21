import type { Issue } from "../../core/issues";
import type { ResponseReport } from "../../core/report";
import type { ModelInfo } from "../../core/catalog-types";
import { computeAudioMinutesCostUSD, minutesFromSeconds } from "../../core/cost";
import { models } from "./models";

/**
 * Structural subset of a pre-recorded /v1/listen response
 * (https://developers.deepgram.com/docs/pre-recorded-audio).
 */
export interface ListenResponseLike {
  metadata?: {
    request_id?: string;
    /** Audio length in SECONDS. */
    duration?: number;
    models?: string[];
    /** Keyed by model uuid; `arch` is the family id, e.g. "nova-3". */
    model_info?: Record<string, { name?: string; version?: string; arch?: string }>;
  } | null;
  results?: {
    channels?: Array<{
      alternatives?: Array<{ transcript?: string; confidence?: number }>;
    }> | null;
  } | null;
}

const catalog: Record<string, ModelInfo> = models;

/**
 * Post-transcription report for a pre-recorded /v1/listen response. Never
 * throws.
 *
 * - An empty first transcript → warning with `meta.kind: "empty_transcript"`
 *   (the audio may contain no recognizable speech, or the wrong
 *   encoding/sample params were sent).
 * - `costUSD` = metadata.duration minutes x the catalog per-minute rate for
 *   `modelId`. Pass the model id you requested; when omitted, the first
 *   `metadata.model_info` entry whose `arch` matches a catalog id is used
 *   (e.g. arch "nova-3"). Undefined when no rate is known. The response
 *   carries no token usage, so `usage` is always empty.
 */
export function checkListen(res: ListenResponseLike, modelId?: string): ResponseReport {
  const warnings: Issue[] = [];

  const transcript = res.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  if (transcript !== undefined && transcript.length === 0) {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["results", "channels", 0, "alternatives", 0, "transcript"],
      message:
        "The response transcript is empty — the audio may contain no recognizable speech, or raw audio was sent with wrong encoding params.",
      meta: { kind: "empty_transcript" },
    });
  }

  let resolved = modelId;
  if (resolved === undefined) {
    for (const info of Object.values(res.metadata?.model_info ?? {})) {
      if (info.arch !== undefined && catalog[info.arch] !== undefined) {
        resolved = info.arch;
        break;
      }
    }
  }

  const duration = res.metadata?.duration;
  const costUSD =
    typeof duration === "number"
      ? computeAudioMinutesCostUSD(
          resolved !== undefined ? catalog[resolved]?.cost : undefined,
          minutesFromSeconds(duration),
        )
      : undefined;

  return { warnings, usage: {}, ...(costUSD !== undefined && { costUSD }) };
}
