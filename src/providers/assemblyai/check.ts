import type { Issue } from "../../core/issues";
import type { ResponseReport } from "../../core/report";
import type { ModelInfo } from "../../core/catalog-types";
import { computeAudioMinutesCostUSD } from "../../core/cost";
import { models } from "./models";

/**
 * Structural subset of a GET /v2/transcript/{id} (or webhook-delivered)
 * transcript object (https://www.assemblyai.com/docs/api-reference/transcripts/get).
 */
export interface TranscriptResponseLike {
  id?: string;
  /** "queued" | "processing" | "completed" | "error". */
  status?: string;
  /** Why the transcript failed, when status is "error". */
  error?: string | null;
  /** Media duration in SECONDS (not ms); null until known. */
  audio_duration?: number | null;
  /** Model the transcript ran on, echoed by the API. */
  speech_model?: string | null;
  text?: string | null;
  confidence?: number | null;
}

const catalog: Record<string, ModelInfo> = models;

/**
 * Post-transcription report for a polled AssemblyAI transcript. Never throws.
 *
 * - `status: "error"` → warning with `meta.kind: "transcription_failed"`
 *   (IssueCode has no response-side codes, so the closest validation code is
 *   reused — `meta.kind` is the reliable discriminator).
 * - completed with empty/null `text` → warning with
 *   `meta.kind: "empty_transcript"`.
 * - `finishReason` mirrors the terminal `status`.
 * - `costUSD` = audio_duration ÷ 60 minutes x the catalog per-minute rate for
 *   the echoed `speech_model`; undefined when the model or duration is
 *   unknown. Token usage does not apply to STT, so `usage` is always empty.
 */
export function checkTranscript(res: TranscriptResponseLike): ResponseReport {
  const warnings: Issue[] = [];

  if (res.status === "error") {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["status"],
      message: `Transcription failed: ${res.error ?? "no error detail provided"}.`,
      meta: { kind: "transcription_failed" },
    });
  }

  if (res.status === "completed" && (res.text == null || res.text.length === 0)) {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["text"],
      message:
        "The completed transcript has no text — the audio may contain no recognizable speech.",
      meta: { kind: "empty_transcript" },
    });
  }

  const info = res.speech_model != null ? catalog[res.speech_model] : undefined;
  const costUSD =
    typeof res.audio_duration === "number"
      ? computeAudioMinutesCostUSD(info?.cost, res.audio_duration / 60)
      : undefined;

  return {
    warnings,
    ...(res.status !== undefined && { finishReason: res.status }),
    usage: {},
    ...(costUSD !== undefined && { costUSD }),
  };
}
