/**
 * `minimax.checkTts` — the read-back for a route that answers 200 for every
 * outcome.
 *
 * MiniMax's T2A reference declares exactly one HTTP response and reports
 * failure on `base_resp.status_code`, so `res.ok` says nothing about whether
 * audio was synthesized. These tests pin the two things the checker exists to
 * say (a non-zero code is a failure, and an empty `data.audio` is one too) and
 * the one number it can price exactly: the character count MiniMax itself
 * counted.
 */

import { describe, expect, test } from "bun:test";
import { checkTts, MINIMAX_BASE_RESP_INFO, type MinimaxT2aResponseLike } from "./tts-check";
import { T2A_HD_PER_MILLION_CHARACTERS } from "./models";

const SUCCESS: MinimaxT2aResponseLike = {
  data: { audio: "fffb90c400", status: 2 },
  extra_info: { audio_length: 11124, audio_size: 179926, usage_characters: 163 },
  trace_id: "01b8bf9bb7433cc75c18eee6cfa8fe21",
  base_resp: { status_code: 0, status_msg: "success" },
};

describe("the in-band failure envelope", () => {
  test("a non-zero base_resp.status_code warns and quotes status_msg", () => {
    const report = checkTts({
      data: { audio: "", status: 2 },
      trace_id: "trace-1002",
      base_resp: { status_code: 1002, status_msg: "rate limit exceeded" },
    });

    const failure = report.warnings.find((w) => w.meta?.kind === "provider_error");
    expect(failure).toBeDefined();
    expect(failure?.severity).toBe("warning");
    expect(failure?.path).toEqual(["base_resp", "status_code"]);
    expect(failure?.message).toContain("1002");
    expect(failure?.message).toContain("rate limit exceeded");
    expect(failure?.meta?.statusCode).toBe(1002);
    expect(failure?.meta?.statusMsg).toBe("rate limit exceeded");
    expect(failure?.meta?.traceId).toBe("trace-1002");
    expect(failure?.meta?.source).toBe(
      "https://platform.minimax.io/docs/api-reference/speech-t2a-http",
    );
  });

  test("every documented non-zero code is reported, and 0 is not", () => {
    for (const code of [1000, 1001, 1002, 1004, 1039, 1042, 2013] as const) {
      const report = checkTts({ ...SUCCESS, base_resp: { status_code: code, status_msg: "x" } });
      expect(report.warnings.some((w) => w.meta?.kind === "provider_error")).toBe(true);
    }
    expect(checkTts(SUCCESS).warnings).toEqual([]);
  });

  test("an undocumented code is tolerated rather than refused — the type is tail-open", () => {
    const report = checkTts({ ...SUCCESS, base_resp: { status_code: 9999 } });
    const failure = report.warnings.find((w) => w.meta?.kind === "provider_error");
    expect(failure?.meta?.statusCode).toBe(9999);
    // No status_msg came back, so the message does not invent one.
    expect(failure?.message).not.toContain('""');
  });

  test("a response with no base_resp at all is not a failure", () => {
    const report = checkTts({ data: { audio: "fffb90c400" } });
    expect(report.warnings).toEqual([]);
  });
});

describe("the outcome rides on finishReason, not on a warning count", () => {
  test("a success reports finishReason 0 — falsy, which is why the branch is `!== 0`", () => {
    const report = checkTts(SUCCESS);
    expect(report.finishReason).toBe(0);
    expect(report.warnings).toEqual([]);
    // The trap this pins: truthiness reads a clean synthesis as a failure.
    expect(Boolean(report.finishReason)).toBe(false);
  });

  test("a retryable failure carries the code and `meta.retryable: true`", () => {
    const report = checkTts({
      data: { audio: "" },
      base_resp: { status_code: 1002, status_msg: "rate limit exceeded" },
    });
    expect(report.finishReason).toBe(1002);
    const failure = report.warnings.find((w) => w.meta?.kind === "provider_error");
    expect(failure?.meta?.retryable).toBe(true);
  });

  test("a terminal failure carries the code and `meta.retryable: false`", () => {
    const report = checkTts({
      data: { audio: "" },
      base_resp: { status_code: 1004, status_msg: "authentication failed" },
    });
    expect(report.finishReason).toBe(1004);
    const failure = report.warnings.find((w) => w.meta?.kind === "provider_error");
    expect(failure?.meta?.retryable).toBe(false);
    // 1002 and 1004 are both failures; only one is worth sending again. That
    // distinction is the reason there is no pass/fail verdict field.
    expect(failure?.meta?.statusCode).toBe(1004);
  });

  test("an unclassifiable code omits `retryable` rather than guessing", () => {
    for (const code of [1000, 9999] as const) {
      const report = checkTts({ ...SUCCESS, base_resp: { status_code: code } });
      const failure = report.warnings.find((w) => w.meta?.kind === "provider_error");
      expect(failure?.meta && Object.hasOwn(failure.meta, "retryable")).toBe(false);
    }
  });

  test("no base_resp means no outcome to report — the field stays absent", () => {
    expect(checkTts({ data: { audio: "fffb90c400" } }).finishReason).toBeUndefined();
  });

  test("MINIMAX_BASE_RESP_INFO covers every documented code with MiniMax's own message", () => {
    expect(Object.keys(MINIMAX_BASE_RESP_INFO).map(Number)).toEqual([
      0, 1000, 1001, 1002, 1004, 1039, 1042, 2013,
    ]);
    expect(MINIMAX_BASE_RESP_INFO[1039].statusMsg).toBe("TPM rate limit exceeded");
    expect(MINIMAX_BASE_RESP_INFO[1001].retryable).toBe(true);
    expect(MINIMAX_BASE_RESP_INFO[2013].retryable).toBe(false);
    expect(MINIMAX_BASE_RESP_INFO[1042].retryable).toBe(false);
    // Success and "unknown error" are the two the docs do not classify.
    expect(Object.hasOwn(MINIMAX_BASE_RESP_INFO[0], "retryable")).toBe(false);
    expect(Object.hasOwn(MINIMAX_BASE_RESP_INFO[1000], "retryable")).toBe(false);
  });
});

describe("empty audio", () => {
  test("a missing or empty data.audio warns, alongside the status warning", () => {
    for (const data of [undefined, null, {}, { audio: "" }, { audio: null }] as const) {
      const report = checkTts({ data, base_resp: { status_code: 0 } });
      expect(report.warnings.map((w) => w.meta?.kind)).toEqual(["empty_audio"]);
      expect(report.warnings[0]?.path).toEqual(["data", "audio"]);
    }
  });

  test("a URL delivery is audio too — output_format: url puts a URL in the same field", () => {
    const report = checkTts({
      data: { audio: "https://cdn.minimax.io/take.mp3" },
      base_resp: { status_code: 0 },
    });
    expect(report.warnings).toEqual([]);
  });

  test("a failed request reports BOTH, the way Resemble's checker does", () => {
    const report = checkTts({ data: null, base_resp: { status_code: 1004, status_msg: "authentication failed" } });
    expect(report.warnings.map((w) => w.meta?.kind)).toEqual(["provider_error", "empty_audio"]);
  });
});

describe("cost, from the characters MiniMax counted", () => {
  test("usage_characters prices against the catalog per-million rate", () => {
    const report = checkTts(SUCCESS, { model: "speech-2.8-hd" });
    expect(report.costUSD).toBeCloseTo((163 * T2A_HD_PER_MILLION_CHARACTERS) / 1_000_000, 12);
  });

  test("no model, no rate, no cost — and never a guess", () => {
    expect(checkTts(SUCCESS).costUSD).toBeUndefined();
    expect(checkTts(SUCCESS, { model: "not-a-minimax-model" }).costUSD).toBeUndefined();
    expect(checkTts({ ...SUCCESS, extra_info: {} }, { model: "speech-2.8-hd" }).costUSD).toBeUndefined();
  });

  test("usage stays empty — a character count is not a token count", () => {
    expect(checkTts(SUCCESS, { model: "speech-2.8-hd" }).usage).toEqual({});
  });

  test("never throws on a response that is nothing like the documented shape", () => {
    expect(() => checkTts({} as MinimaxT2aResponseLike)).not.toThrow();
    expect(() => checkTts({ base_resp: null, data: null, extra_info: null })).not.toThrow();
  });
});
