/**
 * Post-generation response checks for ElevenLabs.
 *
 * Three routes have one, and the reason is the same each time: the response is
 * JSON and carries a fact the request could not.
 *
 * - speech-to-text — `audio_duration_secs` prices the actual usage;
 * - dubbing projects — `media.duration_s` is the only place the source
 *   duration ever appears, and it is what the per-minute rate multiplies;
 * - dubbing language targets — `output_revision` versus `revision` is the
 *   difference between a signed URL that is current and one that is stale.
 *
 * Text-to-speech and music respond with raw audio bytes (no JSON envelope), so
 * they have none.
 */

import type { Issue } from "../../core/issues";
import type { ResponseReport } from "../../core/report";
import type { ModelInfo } from "../../core/catalog-types";
import { computeAudioMinutesCostUSD, minutesFromSeconds } from "../../core/cost";
import { models } from "./models";

export interface ElevenlabsTranscriptLike {
  language_code?: string;
  language_probability?: number;
  text?: string;
  words?: Array<Record<string, unknown>>;
}

export interface ElevenlabsTranscriptionLike extends ElevenlabsTranscriptLike {
  transcription_id?: string | null;
  /** Duration of the transcribed audio in seconds. */
  audio_duration_secs?: number | null;
  /** Multi-channel responses: one transcript per channel. */
  transcripts?: ElevenlabsTranscriptLike[];
  /** 202 webhook-acceptance response fields (async processing). */
  message?: string;
  request_id?: string;
}

/**
 * Inspects a `POST /v1/speech-to-text` JSON response: warns when no text came
 * back (empty transcription) and, when the request's `model` is supplied and
 * the response carries `audio_duration_secs`, prices the actual usage against
 * catalog per-minute rates. Multi-channel responses are billed independently
 * per channel at the full audio duration, so the cost scales by
 * `transcripts.length`. Surcharges (entity detection/redaction, keyterms,
 * speaker roles) are NOT included. Never throws.
 */
export function checkTranscription(
  res: ElevenlabsTranscriptionLike,
  options: { model?: string } = {},
): ResponseReport {
  const warnings: Issue[] = [];

  // 202 webhook acceptance carries no transcript yet — not an empty result.
  const acceptedAsync = res.request_id !== undefined;
  if (!acceptedAsync) {
    const texts = res.transcripts?.map((t) => t.text ?? "") ?? [res.text ?? ""];
    if (texts.every((text) => text === "")) {
      warnings.push({
        severity: "warning",
        code: "invalid_shape",
        path: ["text"],
        message: "The transcription response contains no text.",
        meta: { kind: "empty_text" },
      });
    }
  }

  const durationSecs = res.audio_duration_secs;
  const info =
    options.model !== undefined
      ? (models as Record<string, ModelInfo>)[options.model]
      : undefined;
  // Multi-channel: each channel is billed at the full audio duration.
  const channels = Math.max(1, res.transcripts?.length ?? 1);
  const costUSD =
    durationSecs != null && info !== undefined
      ? computeAudioMinutesCostUSD(info.cost, minutesFromSeconds(durationSecs * channels))
      : undefined;

  return { warnings, usage: {}, ...(costUSD !== undefined && { costUSD }) };
}

// ---------------------------------------------------------------------------
// Dubbing — the two-level lifecycle, read back
// ---------------------------------------------------------------------------

/** "Why the project/language failed; null unless `status` is 'failed'." */
export interface ElevenlabsDubbingErrorLike {
  /**
   * "Stable identifier for the failure, safe to branch on. New codes are added
   * over time, so treat an unrecognized value as 'internal_error'."
   */
  code?: string;
  /** "Human-readable description… The wording may change at any time." */
  message?: string;
  /**
   * "Whether resubmitting the same input could succeed. False means the
   * failure describes the input or the account."
   */
  retryable?: boolean;
}

/** One entry of the `warnings` array both levels carry. */
export interface ElevenlabsDubbingWarningLike {
  type?: string;
  speaker_ids?: string[];
  message?: string;
}

/** `GET /v1/dubbing/project/{project_id}` — the structural subset worth reading. */
export interface ElevenlabsDubbingProjectLike {
  project_id?: string;
  /** "queued" | "preparing" | "processing" | "ready" | "failed". */
  status?: string;
  model_id?: string | null;
  /** "Source media metadata; null until the project is ready." */
  media?: { duration_s?: number | null; has_video?: boolean | null } | null;
  /** "Identifiers of the language targets created under this project." */
  language_ids?: string[];
  revision?: number;
  error?: ElevenlabsDubbingErrorLike | null;
  warnings?: ElevenlabsDubbingWarningLike[];
}

/**
 * The project `status` values, as `checkDubbingProject` reports them on
 * `finishReason`. Tail-open for the reason recorded on
 * `SonioxTranscriptionStatus`: an unrecognized status is tolerated rather than
 * refused, and the wire field is a `string`.
 */
export type ElevenlabsDubbingProjectStatus =
  | "queued"
  | "preparing"
  | "processing"
  | "ready"
  | "failed"
  | (string & {});

/**
 * Inspects a dubbing PROJECT response. Never throws.
 *
 * - `status: "failed"` → a warning naming `error.code` and `error.retryable`,
 *   with `meta.kind: "dubbing_failed"` (`IssueCode` has no response-side codes,
 *   so the closest validation code is reused and `meta.kind` discriminates —
 *   the recorded reason on `src/providers/soniox/check.ts`).
 * - each `warnings` entry (today only `voices_not_permitted`, "the dub used a
 *   replacement voice for each of them") → one warning, because a dub that
 *   silently swapped a speaker's voice is exactly the outcome a caller would
 *   otherwise discover by listening.
 * - `costUSD` = `media.duration_s` minutes × the catalog per-minute rate for
 *   the effective model × the number of language targets — ElevenLabs' own
 *   formula (model × duration × number of languages). `options.model` overrides
 *   the echoed `model_id` when you know better; `options.languages` overrides
 *   `language_ids.length` for a project whose targets are not all created yet.
 *
 * The duration is why this is a response checker and not an estimate: the
 * request carries a Blob or a URL and never a length.
 */
export function checkDubbingProject(
  res: ElevenlabsDubbingProjectLike,
  options: { model?: string; languages?: number } = {},
): ResponseReport<ElevenlabsDubbingProjectStatus> {
  const warnings: Issue[] = [];

  if (res.status === "failed") {
    const code = res.error?.code;
    const detail = res.error?.message ?? "no error message was reported";
    const retryable = res.error?.retryable;
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["status"],
      message: `The dubbing project failed${code != null ? ` (${code})` : ""}: ${detail}${
        retryable === false ? " Retrying the same input will fail the same way." : ""
      }`,
      meta: {
        kind: "dubbing_failed",
        ...(code != null && { errorCode: code }),
        ...(retryable !== undefined && { retryable }),
      },
    });
  }

  (res.warnings ?? []).forEach((warning, index) => {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["warnings", index],
      message: `ElevenLabs reported \`${warning.type ?? "unknown"}\`: ${
        warning.message ?? "no message was reported"
      }`,
      meta: {
        kind: "dubbing_warning",
        ...(warning.type != null && { type: warning.type }),
        ...(warning.speaker_ids !== undefined && { speakerIds: warning.speaker_ids }),
      },
    });
  });

  const seconds = res.media?.duration_s;
  const modelId = options.model ?? res.model_id ?? undefined;
  const info = modelId != null ? (models as Record<string, ModelInfo>)[modelId] : undefined;
  const languages = options.languages ?? res.language_ids?.length ?? 0;
  const costUSD =
    seconds != null && info !== undefined && languages > 0
      ? computeAudioMinutesCostUSD(info.cost, minutesFromSeconds(seconds * languages))
      : undefined;

  return {
    warnings,
    ...(res.status !== undefined && { finishReason: res.status }),
    usage: {},
    ...(costUSD !== undefined && { costUSD }),
  };
}

/** `GET /v1/dubbing/project/{project_id}/language/{language_id}`. */
export interface ElevenlabsDubbingLanguageLike {
  language_id?: string;
  project_id?: string;
  target_language?: string;
  /** "queued" | "processing" | "completed" | "stale" | "failed". */
  status?: string;
  model_id?: string | null;
  /** "Signed output URLs; null until the target has produced an output." */
  outputs?: { lossless_audio?: string | null } | null;
  /** "Monotonic counter incremented whenever this target's transcript changes." */
  revision?: number;
  /** "The `revision` the current dubbed output was generated from." */
  output_revision?: number | null;
  error?: ElevenlabsDubbingErrorLike | null;
  warnings?: ElevenlabsDubbingWarningLike[];
}

/**
 * The language-target `status` values, as `checkDubbingLanguage` reports them
 * on `finishReason`. Tail-open, for the reason above.
 */
export type ElevenlabsDubbingLanguageStatus =
  | "queued"
  | "processing"
  | "completed"
  | "stale"
  | "failed"
  | (string & {});

/**
 * Inspects a dubbing LANGUAGE TARGET response. Never throws.
 *
 * The reason this exists is the third status axis. `outputs` is kept while a
 * target is stale, so a signed URL read off a `completed` response can still
 * be a dub of an older transcript: "compare `output_revision` against
 * `revision` to tell whether the output is up to date". Whenever
 * `output_revision < revision` — whatever the status says — that is a warning
 * with `meta.kind: "stale_output"`. A JSDoc that omits `stale` ships a silent
 * staleness bug; a checker that omits it ships the bug itself.
 *
 * Also reports `status: "failed"` (naming `error.code`, and noting that a code
 * of `project_failed` means the cause is on the project) and each `warnings`
 * entry. No cost: the rate multiplies the PROJECT's source duration, which
 * this response does not carry — price it with `checkDubbingProject`.
 */
export function checkDubbingLanguage(
  res: ElevenlabsDubbingLanguageLike,
): ResponseReport<ElevenlabsDubbingLanguageStatus> {
  const warnings: Issue[] = [];

  if (res.status === "failed") {
    const code = res.error?.code;
    const detail = res.error?.message ?? "no error message was reported";
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["status"],
      message: `The dubbing language target failed${code != null ? ` (${code})` : ""}: ${detail}${
        code === "project_failed"
          ? " `project_failed` means the parent project failed — read the project for the underlying cause."
          : ""
      }`,
      meta: {
        kind: "dubbing_failed",
        ...(code != null && { errorCode: code }),
        ...(res.error?.retryable !== undefined && { retryable: res.error.retryable }),
      },
    });
  }

  const revision = res.revision;
  const outputRevision = res.output_revision;
  if (typeof revision === "number" && typeof outputRevision === "number" && outputRevision < revision) {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["output_revision"],
      message: `The dubbed output is STALE: it was generated from revision ${outputRevision} and the transcript is now at ${revision}. The signed URL still resolves, so this is not visible from \`outputs\` alone.`,
      meta: { kind: "stale_output", revision, outputRevision },
    });
  }

  (res.warnings ?? []).forEach((warning, index) => {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["warnings", index],
      message: `ElevenLabs reported \`${warning.type ?? "unknown"}\`: ${
        warning.message ?? "no message was reported"
      }`,
      meta: {
        kind: "dubbing_warning",
        ...(warning.type != null && { type: warning.type }),
        ...(warning.speaker_ids !== undefined && { speakerIds: warning.speaker_ids }),
      },
    });
  });

  return {
    warnings,
    ...(res.status !== undefined && { finishReason: res.status }),
    usage: {},
  };
}
