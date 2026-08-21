import type { Issue } from "../../core/issues";
import type { ResponseReport } from "../../core/report";
import type { ModelInfo } from "../../core/catalog-types";
import { computeAudioMinutesCostUSD, minutesFromSeconds } from "../../core/cost";
import { models, DEFAULT_MODEL } from "./models";

/**
 * Structural subset of a GET /v2/pre-recorded/{id} response
 * (https://docs.gladia.io/api-reference/v2/pre-recorded/get). Only the fields
 * needed to detect failure and price the job are modeled.
 */
export interface PreRecordedResultLike {
  id?: string;
  /** "queued" | "processing" | "done" | "error". */
  status?: string;
  /** Populated when `status` is "error". */
  error_code?: number | string | null;
  request_params?: { audio_url?: string; model?: string } | null;
  /** Present once processing finished. */
  file?: { filename?: string; audio_duration?: number | null } | null;
  result?: {
    metadata?: { audio_duration?: number | null; billing_time?: number | null } | null;
    transcription?: { full_transcript?: string } | null;
  } | null;
}

/**
 * The pre-recorded job `status` values, as `checkPreRecorded` reports them on
 * `finishReason`. Note `"done"`, not "completed" — Gladia's own spelling.
 *
 * PUBLIC API — keep in sync with the `res.status === "error"` branch below;
 * `queued`, `processing` and `done` are the values it deliberately does not
 * warn about.
 *
 * Tail-open for the reason recorded in full on `AssemblyaiTranscriptStatus`
 * (src/providers/assemblyai/check.ts): this checker TOLERATES an unrecognized
 * status rather than refusing it, and `PreRecordedResultLike.status` is a
 * `string`, so a closed union could only be reached by a cast that asserts
 * more than the runtime checks.
 */
export type GladiaJobStatus = "queued" | "processing" | "done" | "error" | (string & {});

const catalog: Record<string, ModelInfo> = models;

/**
 * Post-transcription report for a polled Gladia pre-recorded job. Never
 * throws.
 *
 * - `status: "error"` → a warning with `meta.kind: "transcription_failed"`
 *   (IssueCode has no response-side codes, so the closest validation code is
 *   reused — `meta.kind` is the reliable discriminator).
 * - An empty `full_transcript` on a finished job → a warning with
 *   `meta.kind: "empty_transcript"`.
 * - `finishReason` mirrors `status`.
 * - `costUSD` = billed seconds ÷ 60 x the catalog per-minute rate.
 *   `result.metadata.billing_time` wins when present (it is what Gladia
 *   charges for), else the audio duration. The model comes from
 *   `request_params.model`, defaulting to the documented solaria-1. STT
 *   carries no token usage, so `usage` is always empty; audio-intelligence
 *   add-ons are billed on top and are not included.
 */
export function checkPreRecorded(res: PreRecordedResultLike): ResponseReport<GladiaJobStatus> {
  const warnings: Issue[] = [];

  if (res.status === "error") {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["status"],
      message: `Transcription failed${res.error_code != null ? ` (error_code ${res.error_code})` : ""}.`,
      meta: {
        kind: "transcription_failed",
        ...(res.error_code != null && { errorCode: res.error_code }),
      },
    });
  }

  const transcript = res.result?.transcription?.full_transcript;
  if (transcript !== undefined && transcript.length === 0) {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["result", "transcription", "full_transcript"],
      message:
        "The response transcript is empty — the audio may contain no recognizable speech, or the wrong language was pinned.",
      meta: { kind: "empty_transcript" },
    });
  }

  const seconds =
    numberOrUndefined(res.result?.metadata?.billing_time) ??
    numberOrUndefined(res.result?.metadata?.audio_duration) ??
    numberOrUndefined(res.file?.audio_duration);
  const modelId = res.request_params?.model ?? DEFAULT_MODEL;
  const costUSD =
    seconds === undefined ? undefined : computeAudioMinutesCostUSD(catalog[modelId]?.cost, minutesFromSeconds(seconds));

  return {
    warnings,
    ...(res.status !== undefined && { finishReason: res.status }),
    usage: {},
    ...(costUSD !== undefined && { costUSD }),
  };
}

function numberOrUndefined(value: number | null | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}
