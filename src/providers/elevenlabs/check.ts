/**
 * Post-generation response checks for ElevenLabs.
 *
 * Only speech-to-text has a checker: its response is JSON and carries
 * `audio_duration_secs`, which prices the actual usage. Text-to-speech
 * responds with raw audio bytes (no JSON envelope), so it has no checker.
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
