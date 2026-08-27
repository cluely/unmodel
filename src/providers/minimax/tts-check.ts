/**
 * MiniMax T2A v2 response checks — POST https://api.minimax.io/v1/t2a_v2
 *
 * ## MiniMax answers 200 for every outcome
 *
 * The T2A reference (https://platform.minimax.io/docs/api-reference/speech-t2a-http,
 * verified 2026-08-26) declares exactly ONE HTTP response — `200` — and
 * documents no non-200 at all. Failure rides IN BAND, on `base_resp`:
 *
 * ```json
 * {
 *   "data": { "audio": "<hex encoded audio>", "status": 2 },
 *   "extra_info": { "audio_length": 11124, "audio_size": 179926, "usage_characters": 163, … },
 *   "trace_id": "01b8bf9bb7433cc75c18eee6cfa8fe21",
 *   "base_resp": { "status_code": 0, "status_msg": "success" }
 * }
 * ```
 *
 * A caller that branches on `res.ok` reads `data.audio` off a response whose
 * `base_resp.status_code` was `1004` ("authentication failed") and hands the
 * empty string on as audio. That is the silent-failure class this checker
 * exists for, and it is the same in-band shape unmodel already reports for
 * Soniox (`status: "error"`), Resemble (`success: false`), Tripo3D (`code`)
 * and PixVerse (`ErrCode`).
 *
 * The outcome therefore rides on `finishReason`, the way the job checkers
 * report a failed job (`revai.checkJob` → `"failed"`, `resemble.checkTts` →
 * `"failure"`): it is the provider's own vocabulary, and MiniMax's happens to
 * be numeric, which is why `ResponseReport`'s `Reason` admits `number`.
 *
 * ## The envelope is provider-wide, not TTS-wide
 *
 * `base_resp` is documented identically on the music-generation and
 * video-generation routes (`./video.ts` records it there), and is ABSENT from
 * the OpenAI-compatible chat route, which `./chat.ts` serves. That is why this
 * is a checker rather than an `errorPath` arm on `TtsDelivery`: the delivery
 * descriptor is answered by all nineteen tts adapters and is documented as a
 * description that no module in the library reads a body off, so a fact about
 * one provider's whole platform has no business being filed under one
 * category. `MINIMAX_TTS_DELIVERY` (./tts-params.ts) is unchanged.
 *
 * ## Why this module imports `./models` and never `./tts`
 *
 * The catalog rates live in `./models`; the validator in `./tts` carries a zod
 * schema this file has no use for. Importing `./tts` here would drag that
 * schema into every graph that reaches the barrel — the cut
 * `test/bundle-budget.test.ts` records for the voice-clone pack, which moved
 * `T2A_LANGUAGE_BOOSTS` out of `./tts` for exactly this reason.
 */

import type { Issue } from "../../core/issues";
import type { ResponseReport } from "../../core/report";
import type { ModelInfo } from "../../core/catalog-types";
import { computeCharacterCostUSD } from "../../core/cost";
import { speechModels } from "./models";

const T2A_DOCS = "https://platform.minimax.io/docs/api-reference/speech-t2a-http";

/**
 * The documented `base_resp.status_code` values — the vocabulary `checkTts`
 * reports on `finishReason`. See {@link MINIMAX_BASE_RESP_INFO} for each
 * code's documented `status_msg` and whether a retry can help.
 *
 * Tail-open (`number & {}`) for the reason recorded in full on
 * `SonioxTranscriptionStatus`: this checker TOLERATES an unrecognized code
 * rather than refusing it — anything non-zero is a failure — and
 * `MinimaxT2aResponseLike.base_resp.status_code` is a `number`, so a closed
 * union could only be reached by a cast that asserts more than the runtime
 * checks. Branch on `!== 0`, not on the members: `0` is the only success and
 * it is FALSY, so `if (report.finishReason)` reads a successful synthesis as a
 * failure.
 */
export type MinimaxBaseRespStatus =
  | 0
  | 1000
  | 1001
  | 1002
  | 1004
  | 1039
  | 1042
  | 2013
  | (number & {});

/** What {@link MINIMAX_BASE_RESP_INFO} records about one status code. */
export interface MinimaxBaseRespInfo {
  /** MiniMax's own `status_msg` for this code, quoted from {@link T2A_DOCS}. */
  readonly statusMsg: string;
  /**
   * Whether resending the identical request can succeed. ABSENT where the
   * documented message does not answer that question — an omitted `retryable`
   * is "MiniMax does not say", not "no".
   */
  readonly retryable?: boolean;
}

/**
 * The documented `base_resp.status_code` values, transcribed from the response
 * schema at {@link T2A_DOCS} on 2026-08-26. `statusMsg` is MiniMax's string,
 * quoted; `retryable` is unmodel's reading OF that string, because MiniMax
 * publishes no retry classification of its own — a rate limit clears and a bad
 * key does not, and that is the branch a caller needs that a pass/fail verdict
 * cannot give.
 *
 * `1000` ("unknown error") carries no `retryable`: an unknown error is
 * unclassifiable by definition, and guessing either way here would be the one
 * guessed value that makes the other seven untrustworthy. `0` carries none
 * either — there is nothing to retry about a success.
 *
 * The table is exported because the codes ride on MiniMax's music and video
 * routes too (`./video.ts` records the same envelope): a caller polling those
 * reads the same numbers off responses this checker never sees.
 *
 * The declared type is the literal table INTERSECTED with a numeric index
 * signature, so both reads work without a cast: an exact key keeps its
 * literal payload (`INFO[1004].retryable` is the literal `false`), and the
 * checker's own open-tailed output indexes it too
 * (`INFO[report.finishReason]` is `MinimaxBaseRespInfo | undefined`).
 * A `Partial<Record<…>>` would allow the second at the price of the first.
 */
const MINIMAX_BASE_RESP_TABLE = {
  0: { statusMsg: "success" },
  1000: { statusMsg: "unknown error" },
  1001: { statusMsg: "timeout", retryable: true },
  1002: { statusMsg: "rate limit exceeded", retryable: true },
  1004: { statusMsg: "authentication failed", retryable: false },
  1039: { statusMsg: "TPM rate limit exceeded", retryable: true },
  1042: { statusMsg: "invalid characters exceed `10%`", retryable: false },
  2013: { statusMsg: "invalid input parameters", retryable: false },
} as const satisfies Record<number, MinimaxBaseRespInfo>;

export const MINIMAX_BASE_RESP_INFO: typeof MINIMAX_BASE_RESP_TABLE & {
  readonly [code: number]: MinimaxBaseRespInfo | undefined;
} = MINIMAX_BASE_RESP_TABLE;

/**
 * Structural subset of a non-streaming `POST /v1/t2a_v2` response
 * ({@link T2A_DOCS}). Every field is optional because this describes what a
 * checker may READ, not what MiniMax promises to send.
 */
export interface MinimaxT2aResponseLike {
  /**
   * The synthesized audio, hex-encoded — or a URL when the request asked for
   * `output_format: "url"`, which `MINIMAX_TTS_DELIVERY` describes.
   */
  data?: {
    audio?: string | null;
    /**
     * Documented as `1` synthesizing, `2` completed. Declared and deliberately
     * NOT reported: this is the non-streaming route, which answers once the
     * audio exists, so a `1` here would be a documented-impossible state and a
     * warning about it would be a check for a case no response can carry. The
     * outcome lives on `base_resp.status_code`.
     */
    status?: number | null;
  } | null;
  /** Metadata about the generated audio; `usage_characters` is what is billed. */
  extra_info?: {
    audio_length?: number | null;
    audio_sample_rate?: number | null;
    audio_size?: number | null;
    bitrate?: number | null;
    word_count?: number | null;
    invisible_character_ratio?: number | null;
    usage_characters?: number | null;
    audio_format?: string | null;
    audio_channel?: number | null;
  } | null;
  /** "Session identifier for troubleshooting" — quote it in a support ticket. */
  trace_id?: string | null;
  /** The in-band status envelope. `status_code: 0` is the only success. */
  base_resp?: { status_code?: MinimaxBaseRespStatus; status_msg?: string } | null;
}

const catalog: Record<string, ModelInfo> = speechModels;
const baseRespInfo: Partial<Record<number, MinimaxBaseRespInfo>> = MINIMAX_BASE_RESP_INFO;

/** A decoded JSON object, narrowed without asserting a provider response shape. */
function objectOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

/**
 * Inspects a `POST /v1/t2a_v2` JSON response. Never throws.
 *
 * - `finishReason` mirrors `base_resp.status_code`, so the outcome is one field
 *   rather than a warning count. `0` is the only success, and it is falsy.
 * - `base_resp.status_code` present and non-zero → a warning quoting the
 *   documented `status_msg` and the code, with `meta.kind: "provider_error"`
 *   (`IssueCode` has no response-side codes, so the closest validation code is
 *   reused and `meta.kind` is the reliable discriminator — the recorded reason
 *   on `src/providers/soniox/check.ts`), plus `meta.retryable` from
 *   {@link MINIMAX_BASE_RESP_INFO} where MiniMax's own message answers it.
 *   That is the distinction a pass/fail verdict cannot carry: `1002` and
 *   `1004` are both failures, and only one is worth sending again.
 * - `data.audio` missing or empty → an `empty_audio` warning, the same pair
 *   Resemble's checker reports for its own in-band failure flag.
 * - `costUSD` = `extra_info.usage_characters` priced against the catalog's
 *   `perMillionCharacters` rate for `options.model`; undefined when either is
 *   absent. MiniMax bills the CHARACTERS it counted, which is why this is
 *   worth reading back rather than re-deriving from the request text.
 *
 * `usage` stays empty: `UsageReport` counts TOKENS, and a character count is
 * not one — widening the shared report shape for one provider's unit is the
 * trade this checker deliberately does not make (the price carries the fact).
 *
 * ```ts
 * const res = await (await fetch(params.request.url, { … })).json();
 * const report = minimax.checkTts(res, { model: "speech-2.8-hd" });
 *
 * if (report.finishReason !== undefined && report.finishReason !== 0) {
 *   const failure = report.warnings.find((w) => w.meta?.kind === "provider_error");
 *   if (failure?.meta?.retryable === true) await backOffAndRetry();
 *   else throw new Error(String(failure?.message));
 * }
 * ```
 */
export function checkTts(
  res: unknown,
  options: { model?: string } = {},
): ResponseReport<MinimaxBaseRespStatus> {
  const warnings: Issue[] = [];
  const response = objectOf(res);
  const baseResp = objectOf(response?.["base_resp"]);
  const data = objectOf(response?.["data"]);
  const extraInfo = objectOf(response?.["extra_info"]);

  const status = baseResp?.["status_code"];
  if (typeof status === "number" && status !== 0) {
    const rawMsg = baseResp?.["status_msg"];
    const msg = typeof rawMsg === "string" ? rawMsg : undefined;
    const rawTraceId = response?.["trace_id"];
    const traceId = typeof rawTraceId === "string" ? rawTraceId : undefined;
    const retryable = baseRespInfo[status]?.retryable;
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["base_resp", "status_code"],
      message: `MiniMax answered HTTP 200 with \`base_resp.status_code: ${status}\`${
        msg != null && msg !== "" ? ` — "${msg}"` : ""
      }. The T2A route reports every failure in band, so the status line is not the outcome.`,
      meta: {
        kind: "provider_error",
        statusCode: status,
        ...(msg != null && msg !== "" && { statusMsg: msg }),
        ...(retryable !== undefined && { retryable }),
        ...(traceId !== undefined && { traceId }),
        source: T2A_DOCS,
      },
    });
  }

  const audio = data?.["audio"];
  if (typeof audio !== "string" || audio.trim() === "") {
    warnings.push({
      severity: "warning",
      code: "invalid_shape",
      path: ["data", "audio"],
      message: "The response carries no `data.audio` — no audio was returned.",
      meta: { kind: "empty_audio", source: T2A_DOCS },
    });
  }

  const characters = extraInfo?.["usage_characters"];
  const info = options.model !== undefined ? catalog[options.model] : undefined;
  const costUSD =
    typeof characters === "number" ? computeCharacterCostUSD(info?.cost, characters) : undefined;

  return {
    warnings,
    ...(typeof status === "number" && { finishReason: status }),
    usage: {},
    ...(costUSD !== undefined && { costUSD }),
  };
}
