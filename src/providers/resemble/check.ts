/**
 * Post-generation response checks for Resemble AI.
 *
 * Only the synchronous synthesis route has a checker: its response is JSON
 * and carries `success`, base64 `audio_content`, `duration` and an `issues`
 * array. The streaming route answers with a chunked WAV stream (no JSON
 * envelope), so it has no checker.
 *
 * Response reference:
 * https://docs.resemble.ai/voice-generation/text-to-speech/synchronous
 * (verified 2026-08-13).
 *
 * NO COST IS COMPUTED. Resemble publishes no public per-character or
 * per-second USD rate for voice generation, so the catalog carries no rate
 * (see models.ts) and `costUSD` stays undefined — `duration` is reported for
 * your own accounting, not priced.
 */

import type { Issue } from "../../core/issues";
import type { ResponseReport } from "../../core/report";

/** Grapheme/phoneme timing arrays returned alongside the audio. */
export interface ResembleAudioTimestamps {
  graph_chars?: string[];
  graph_times?: number[][];
  phon_chars?: string[];
  phon_times?: number[][];
  [key: string]: unknown;
}

/** Shape of a synchronous `/synthesize` JSON response. */
export interface ResembleSynthesisLike {
  /** Operation status. */
  success?: boolean;
  /** Base64-encoded audio bytes. */
  audio_content?: string | null;
  /** Grapheme/phoneme timing arrays. */
  audio_timestamps?: ResembleAudioTimestamps | null;
  /** Total clip length in seconds. */
  duration?: number | null;
  /** Pre-processing synthesis time in seconds. */
  synth_duration?: number | null;
  /** Echoed request format/rate. */
  output_format?: string | null;
  sample_rate?: number | null;
  /** Generation random seed. */
  seed?: number | null;
  /** Saved clip title, or null. */
  title?: string | null;
  /** "Issues related to the request." */
  issues?: unknown[] | null;
}

/**
 * Inspects a synchronous `/synthesize` JSON response: warns when the request
 * did not succeed, when no audio came back, when the clip is zero-length,
 * and once per entry in the API's own `issues` array. Never throws.
 */
export function checkTts(res: ResembleSynthesisLike): ResponseReport {
  const warnings: Issue[] = [];

  if (res.success === false) {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["success"],
      message: "Resemble reported `success: false` — the clip was not synthesized.",
      meta: { kind: "not_successful" },
    });
  }

  const audio = res.audio_content;
  if (typeof audio !== "string" || audio === "") {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["audio_content"],
      message: "The response carries no `audio_content` — no audio was returned.",
      meta: { kind: "empty_audio" },
    });
  }

  if (typeof res.duration === "number" && res.duration <= 0) {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["duration"],
      message: `The synthesized clip is ${res.duration} seconds long — the input may have been empty or entirely SSML markup.`,
      meta: { kind: "zero_length_audio", duration: res.duration },
    });
  }

  if (Array.isArray(res.issues)) {
    for (const [index, issue] of res.issues.entries()) {
      warnings.push({
        severity: "warning",
        code: "invalid_shape",
        path: ["issues", index],
        message: `Resemble attached an issue to this synthesis: ${typeof issue === "string" ? issue : JSON.stringify(issue)}`,
        meta: { kind: "provider_issue", issue },
      });
    }
  }

  // `costUSD` is deliberately omitted — see the module JSDoc.
  return { warnings, usage: {} };
}
