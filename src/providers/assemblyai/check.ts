import type { Issue } from "../../core/issues";
import type { ResponseReport } from "../../core/report";
import type { ModelInfo } from "../../core/catalog-types";
import { computeAudioMinutesCostUSD, minutesFromSeconds } from "../../core/cost";
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

/**
 * The transcript `status` values, as `checkTranscript` reports them on
 * `finishReason`.
 *
 * PUBLIC API — keep in sync with the `res.status === …` branches below
 * (`"error"`, `"completed"`); `queued` and `processing` are the non-terminal
 * values those branches deliberately do not warn about.
 *
 * TAIL DECISION (applies to all five job-status checkers: assemblyai, gladia,
 * soniox, speechmatics, revai). The documented set really is closed, and
 * dropping the `(string & {})` tail here would additionally make a typo like
 * `finishReason === "compleeted"` a compile error, which a tailed union cannot
 * catch. It is kept open anyway, for two reasons that are this repo's own
 * rule, not a preference:
 *
 * 1. An open tail is legitimate exactly where an off-list value is TOLERATED
 *    and illegitimate where the library REFUSES it. This checker tolerates:
 *    an unrecognized status raises no warning, is not treated as a failure,
 *    and is passed through to `finishReason` verbatim. Compare the request
 *    side, where an off-list value IS refused (a zod enum rejects it) and the
 *    matching union is correspondingly closed — `gpt-image-1`'s `size`, whose
 *    completion list `test/unified/completions.test.ts` pins exactly.
 * 2. `TranscriptResponseLike.status` is deliberately `string` (it structurally
 *    accepts both SDK objects and fetch-parsed JSON, and tightening it is out
 *    of scope). A closed union would therefore need a cast right here at the
 *    `finishReason: res.status` return — the type would be asserting something
 *    the runtime does not check, i.e. lying, to buy a typo diagnostic. A
 *    checker that "never throws" cannot promise a closed output vocabulary.
 *
 * Reopen this if a status ever becomes validated (parsed through a zod enum
 * that rejects the unknown value) — then the refusal is real and the closed
 * union would be telling the truth.
 */
export type AssemblyaiTranscriptStatus =
  | "queued"
  | "processing"
  | "completed"
  | "error"
  | (string & {});

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
export function checkTranscript(
  res: TranscriptResponseLike,
): ResponseReport<AssemblyaiTranscriptStatus> {
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
      ? computeAudioMinutesCostUSD(info?.cost, minutesFromSeconds(res.audio_duration))
      : undefined;

  return {
    warnings,
    ...(res.status !== undefined && { finishReason: res.status }),
    usage: {},
    ...(costUSD !== undefined && { costUSD }),
  };
}
