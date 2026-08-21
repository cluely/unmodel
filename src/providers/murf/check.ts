/**
 * Post-generation response checks for Murf AI.
 *
 * Only `POST /v1/speech/generate` has a checker: its response is JSON and
 * carries `audioLengthInSeconds`, `remainingCharacterCount` and a `warning`
 * string. `POST /v1/speech/stream` answers with an audio stream (no JSON
 * envelope), so it has no checker.
 *
 * Response reference:
 * https://murf.ai/api/docs/api-reference/text-to-speech/generate
 * (verified 2026-08-13).
 */

import type { Issue } from "../../core/issues";
import type { ResponseReport } from "../../core/report";

export interface MurfWordDuration {
  word?: string;
  startMs?: number;
  endMs?: number;
}

/** Shape of a POST /v1/speech/generate JSON response. */
export interface MurfSpeechResponseLike {
  /** "URL to generated audio" — available for download for 72 hours. */
  audioFile?: string | null;
  /** Base64 payload, present when `encodeAsBase64` was set. */
  encodedAudio?: string | null;
  /** Duration of the generated audio, in seconds. */
  audioLengthInSeconds?: number | null;
  /** "Characters available in billing cycle" after this request. */
  remainingCharacterCount?: number | null;
  /** Timing data per word. */
  wordDurations?: MurfWordDuration[] | null;
  /** "Any warnings from processing". */
  warning?: string | null;
}

/**
 * Inspects a `POST /v1/speech/generate` JSON response: warns when neither an
 * `audioFile` URL nor `encodedAudio` came back, when the audio is
 * zero-length, and when the API attached its own `warning` string.
 *
 * `costUSD` is deliberately NOT computed here. Murf bills per INPUT
 * character, and the response echoes no character count for the request —
 * `remainingCharacterCount` is a balance, not a usage figure — so the
 * request-time estimate from `speechGenerate` remains the authoritative
 * number. Never throws.
 */
export function checkTts(res: MurfSpeechResponseLike): ResponseReport {
  const warnings: Issue[] = [];

  const hasUrl = typeof res.audioFile === "string" && res.audioFile !== "";
  const hasBase64 = typeof res.encodedAudio === "string" && res.encodedAudio !== "";
  if (!hasUrl && !hasBase64) {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["audioFile"],
      message:
        "The response carries neither an `audioFile` URL nor `encodedAudio` — no audio was returned.",
      meta: { kind: "empty_audio" },
    });
  }

  if (typeof res.audioLengthInSeconds === "number" && res.audioLengthInSeconds <= 0) {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["audioLengthInSeconds"],
      message: `The generated audio is ${res.audioLengthInSeconds} seconds long — the input may have been empty or entirely markup.`,
      meta: { kind: "zero_length_audio", audioLengthInSeconds: res.audioLengthInSeconds },
    });
  }

  if (typeof res.warning === "string" && res.warning !== "") {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["warning"],
      message: `Murf attached a warning to this generation: ${res.warning}`,
      meta: { kind: "provider_warning", warning: res.warning },
    });
  }

  return { warnings, usage: {} };
}
