import type { Issue } from "../../core/issues";
import type { ResponseReport } from "../../core/report";
import type { ModelInfo } from "../../core/catalog-types";
import { computeAudioMinutesCostUSD, minutesFromSeconds } from "../../core/cost";
import { models } from "./models";
import { DEFAULT_MODEL } from "./stt";

/**
 * Structural subset of a GET /v2/jobs/{id} response
 * (https://docs.speechmatics.com/speech-to-text/batch/output). `duration` is
 * the media length in SECONDS and appears once the job has been inspected.
 */
export interface JobDetailsLike {
  job?: {
    id?: string;
    /** "running" | "done" | "rejected". */
    status?: string;
    /** Media duration in SECONDS. */
    duration?: number | null;
    data_name?: string;
    created_at?: string;
    /** Present when the job failed; one entry per failed attempt. */
    errors?: Array<{ message?: string; timestamp?: string }> | null;
    config?: {
      type?: string;
      transcription_config?: { model?: string; operating_point?: string; language?: string } | null;
    } | null;
  } | null;
}

/**
 * The batch job `status` values, as `checkJob` reports them on `finishReason`.
 * Speechmatics' own vocabulary: `running` (not "processing") and `rejected`
 * (not "error").
 *
 * PUBLIC API — keep in sync with the `job?.status === "rejected"` branch
 * below; `running` and `done` are the values it deliberately does not warn
 * about.
 *
 * Tail-open for the reason recorded in full on `AssemblyaiTranscriptStatus`
 * (src/providers/assemblyai/check.ts): this checker TOLERATES an unrecognized
 * status rather than refusing it, and `JobDetailsLike`'s `status` is a
 * `string`, so a closed union could only be reached by a cast that asserts
 * more than the runtime checks. Speechmatics also expires and deletes jobs,
 * which the three modeled values do not cover.
 */
export type SpeechmaticsJobStatus = "running" | "done" | "rejected" | (string & {});

const catalog: Record<string, ModelInfo> = models;

/**
 * Post-transcription report for a polled Speechmatics batch job. Never throws.
 *
 * - `status: "rejected"` → a warning with `meta.kind: "transcription_failed"`
 *   carrying every message from `job.errors` (IssueCode has no response-side
 *   codes, so the closest validation code is reused — `meta.kind` is the
 *   reliable discriminator).
 * - `finishReason` mirrors `job.status`.
 * - `costUSD` = `job.duration` minutes x the catalog per-minute rate for the
 *   echoed `transcription_config.model` (falling back to the deprecated
 *   `operating_point`, then to the documented `standard` default). Undefined
 *   when the duration is absent or the model is unknown. STT carries no token
 *   usage, so `usage` is always empty. Speech-intelligence bolt-ons are billed
 *   on top and are not included.
 */
export function checkJob(res: JobDetailsLike): ResponseReport<SpeechmaticsJobStatus> {
  const warnings: Issue[] = [];
  const job = res.job ?? undefined;

  if (job?.status === "rejected") {
    const messages = (job.errors ?? [])
      .map((e) => e?.message)
      .filter((m): m is string => typeof m === "string" && m.length > 0);
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["job", "status"],
      message: `Transcription job was rejected: ${messages.length > 0 ? messages.join("; ") : "no error messages provided"}.`,
      meta: { kind: "transcription_failed", ...(messages.length > 0 && { errors: messages }) },
    });
  }

  const tc = job?.config?.transcription_config ?? undefined;
  const modelId = tc?.model ?? tc?.operating_point ?? (tc !== undefined ? DEFAULT_MODEL : undefined);
  const duration = job?.duration;
  const costUSD =
    typeof duration === "number" && duration > 0
      ? computeAudioMinutesCostUSD(
          modelId !== undefined ? catalog[modelId]?.cost : undefined,
          minutesFromSeconds(duration),
        )
      : undefined;

  return {
    warnings,
    ...(job?.status !== undefined && { finishReason: job.status }),
    usage: {},
    ...(costUSD !== undefined && { costUSD }),
  };
}
