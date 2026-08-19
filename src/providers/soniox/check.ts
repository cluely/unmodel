import type { Issue } from "../../core/issues";
import type { ResponseReport } from "../../core/report";
import type { ModelInfo } from "../../core/catalog-types";
import { computeAudioMinutesCostUSD } from "../../core/cost";
import { models } from "./models";

/**
 * Structural subset of a GET/POST /v1/transcriptions response
 * (https://soniox.com/docs/api-reference/stt/transcriptions/get_transcription).
 * The transcript text itself lives at GET /v1/transcriptions/{id}/transcript
 * and is not needed here.
 */
export interface TranscriptionResponseLike {
  id?: string;
  /** "queued" | "processing" | "completed" | "error". */
  status?: string;
  /** Model the transcription ran on, echoed by the API. */
  model?: string;
  /** Audio duration in MILLISECONDS; available once processing starts. */
  audio_duration_ms?: number | null;
  error_type?: string | null;
  error_message?: string | null;
}

const catalog: Record<string, ModelInfo> = models;

/**
 * Post-transcription report for a polled Soniox transcription. Never throws.
 *
 * - `status: "error"` → a warning with `meta.kind: "transcription_failed"`
 *   (IssueCode has no response-side codes, so the closest validation code is
 *   reused — `meta.kind` is the reliable discriminator).
 * - `finishReason` mirrors the terminal `status`.
 * - `costUSD` = audio_duration_ms ÷ 60000 minutes x the catalog per-minute
 *   rate; undefined when the model is unknown or duration is absent. Token
 *   usage does not apply to STT, so `usage` is always empty.
 */
export function checkTranscription(res: TranscriptionResponseLike): ResponseReport {
  const warnings: Issue[] = [];

  if (res.status === "error") {
    const detail = res.error_message ?? "no error_message provided";
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["status"],
      message: `Transcription failed${res.error_type != null ? ` (${res.error_type})` : ""}: ${detail}.`,
      meta: {
        kind: "transcription_failed",
        ...(res.error_type != null && { errorType: res.error_type }),
      },
    });
  }

  const info = res.model !== undefined ? catalog[res.model] : undefined;
  const costUSD =
    typeof res.audio_duration_ms === "number"
      ? computeAudioMinutesCostUSD(info?.cost, res.audio_duration_ms / 60_000)
      : undefined;

  return {
    warnings,
    ...(res.status !== undefined && { finishReason: res.status }),
    usage: {},
    ...(costUSD !== undefined && { costUSD }),
  };
}
