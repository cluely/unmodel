import type { Issue } from "../../core/issues";
import type { ResponseReport } from "../../core/report";
import type { ModelInfo } from "../../core/catalog-types";
import { computeAudioMinutesCostUSD } from "../../core/cost";
import { models, DEFAULT_TRANSCRIBER, MINIMUM_BILLED_SECONDS } from "./models";

/**
 * Structural subset of a GET /speechtotext/v1/jobs/{id} response
 * (https://docs.rev.ai/api/asynchronous/reference). `duration_seconds` appears
 * once the media has been inspected.
 */
export interface JobResponseLike {
  id?: string;
  /** "in_progress" | "transcribed" | "failed". */
  status?: string;
  /** Media length in SECONDS. */
  duration_seconds?: number | null;
  /** Engine the job ran on; absent means the "machine" default. */
  transcriber?: string;
  language?: string;
  speaker_channels_count?: number | null;
  /** Machine-readable failure code, e.g. "invalid_media". */
  failure?: string;
  failure_detail?: string;
  created_on?: string;
  completed_on?: string;
}

const catalog: Record<string, ModelInfo> = models;

/**
 * Post-transcription report for a polled Rev AI job. Never throws.
 *
 * - `status: "failed"` → a warning with `meta.kind: "transcription_failed"`
 *   carrying `failure` / `failure_detail` (IssueCode has no response-side
 *   codes, so the closest validation code is reused — `meta.kind` is the
 *   reliable discriminator).
 * - `finishReason` mirrors `status`.
 * - `costUSD` = billed minutes x the catalog per-minute rate for the echoed
 *   `transcriber` (defaulting to "machine"), where billed minutes apply the
 *   documented 15-second floor and the per-channel multiplier of
 *   `speaker_channels_count`. Non-English audio bills at the foreign-language
 *   rate, which the catalog does not carry, so those estimates are the
 *   English-rate floor. STT has no token usage, so `usage` is always empty.
 */
export function checkJob(res: JobResponseLike): ResponseReport {
  const warnings: Issue[] = [];

  if (res.status === "failed") {
    const detail = res.failure_detail ?? "no failure_detail provided";
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["status"],
      message: `Transcription job failed${res.failure !== undefined ? ` (${res.failure})` : ""}: ${detail}.`,
      meta: {
        kind: "transcription_failed",
        ...(res.failure !== undefined && { failure: res.failure }),
      },
    });
  }

  const transcriber = res.transcriber ?? DEFAULT_TRANSCRIBER;
  const seconds = res.duration_seconds;
  const costUSD =
    typeof seconds === "number" && seconds > 0
      ? computeAudioMinutesCostUSD(
          catalog[transcriber]?.cost,
          (Math.max(seconds, MINIMUM_BILLED_SECONDS) / 60) * (res.speaker_channels_count ?? 1),
        )
      : undefined;

  return {
    warnings,
    ...(res.status !== undefined && { finishReason: res.status }),
    usage: {},
    ...(costUSD !== undefined && { costUSD }),
  };
}
