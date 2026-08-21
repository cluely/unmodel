import type { Issue } from "../../core/issues";
import type { ResponseReport } from "../../core/report";
import type { ModelInfo } from "../../core/catalog-types";
import { computeAudioMinutesCostUSD, minutesFromSeconds } from "../../core/cost";
import { transcriptionModels } from "./audio-models";

/**
 * Structural subset of a POST /v1/audio/transcriptions response
 * (the `TranscriptionResponse` schema in https://docs.mistral.ai/openapi.yaml).
 * `usage.prompt_audio_seconds` is the billed audio length in SECONDS.
 */
export interface TranscriptionResponseLike {
  model?: string;
  text?: string;
  language?: string | null;
  segments?: Array<{
    text?: string;
    start?: number;
    end?: number;
    score?: number | null;
    speaker_id?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_audio_seconds?: number | null;
    service_tier?: string | null;
  } | null;
}

const catalog: Record<string, ModelInfo> = transcriptionModels;

/**
 * Post-transcription report for a Mistral transcription response. Never
 * throws.
 *
 * - An empty `text` → a warning with `meta.kind: "empty_transcript"` (the
 *   audio may hold no recognizable speech, or the wrong language was pinned).
 * - `usage` mirrors the response's token counts — Voxtral reports them even
 *   though transcription is billed per audio minute.
 * - `costUSD` = `usage.prompt_audio_seconds` ÷ 60 x the catalog per-minute
 *   rate for the echoed `model`; undefined when the model is unknown, carries
 *   no rate, or the audio length is absent.
 */
export function checkTranscription(res: TranscriptionResponseLike): ResponseReport {
  const warnings: Issue[] = [];

  if (res.text !== undefined && res.text.length === 0) {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["text"],
      message:
        "The response transcript is empty — the audio may contain no recognizable speech, or the wrong `language` was pinned.",
      meta: { kind: "empty_transcript" },
    });
  }

  const usage = res.usage ?? undefined;
  const seconds = usage?.prompt_audio_seconds;
  const costUSD =
    typeof seconds === "number"
      ? computeAudioMinutesCostUSD(
          res.model !== undefined ? catalog[res.model]?.cost : undefined,
          minutesFromSeconds(seconds),
        )
      : undefined;

  return {
    warnings,
    usage: {
      ...(usage?.prompt_tokens !== undefined && { inputTokens: usage.prompt_tokens }),
      ...(usage?.completion_tokens !== undefined && { outputTokens: usage.completion_tokens }),
      ...(usage?.total_tokens !== undefined && { totalTokens: usage.total_tokens }),
    },
    ...(costUSD !== undefined && { costUSD }),
  };
}
