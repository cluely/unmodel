import type { Issue } from "../../core/issues";
import type { ResponseReport } from "../../core/report";
import type { ModelInfo } from "../../core/catalog-types";
import { computeAudioMinutesCostUSD } from "../../core/cost";
import { models } from "./models";

const catalog: Record<string, ModelInfo> = models;

/**
 * Shape of a batch STT (POST /stt) JSON response — see
 * https://docs.cartesia.ai/api-reference/stt/transcribe. TTS endpoints return
 * raw audio bytes, so there is deliberately no TTS response checker.
 */
export interface SttTranscriptionLike {
  type?: string;
  request_id?: string;
  text?: string | null;
  language?: string | null;
  /** Duration of the transcribed audio, in seconds. */
  duration?: number | null;
  words?: Array<{ word?: string; start?: number; end?: number }> | null;
}

/**
 * Inspects a batch STT response: warns on an empty transcript and prices the
 * reported audio `duration` against catalog per-minute rates when a model id
 * is supplied (the response does not echo the model). Cartesia's catalog
 * currently carries no USD rate — credit pricing is plan-dependent (see
 * models.ts) — so `costUSD` stays undefined until one exists. Never throws.
 */
export function checkStt(res: SttTranscriptionLike, model?: string): ResponseReport {
  const warnings: Issue[] = [];

  if (res.text == null || res.text.trim() === "") {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["text"],
      message: "The response contains an empty transcript — the audio may be silent, unsupported, or truncated.",
      meta: { kind: "empty_transcript" },
    });
  }

  const costUSD =
    typeof res.duration === "number" && model !== undefined
      ? computeAudioMinutesCostUSD(catalog[model]?.cost, res.duration / 60)
      : undefined;

  return { warnings, usage: {}, ...(costUSD !== undefined && { costUSD }) };
}
