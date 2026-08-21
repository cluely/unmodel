import { describe, expect, test } from "bun:test";
import {
  realtimeTranscription,
  REALTIME_URL,
  SONIOX_CONTAINER_AUDIO_FORMATS,
  SONIOX_RAW_AUDIO_FORMATS,
  MAX_CONTEXT_CHARACTERS,
  MAX_CLIENT_REFERENCE_ID_CHARACTERS,
  contextLength,
} from "./realtime";
import { models, REALTIME_MODEL_IDS } from "./models";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = realtimeTranscription.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

/** Ten minutes of session, declared out of band (no param references the audio). */
// The empty path addresses the params object itself — the media is the socket
// stream. Inferred, not annotated, so the `readonly []` coordinate survives.
const tenMinutes = { media: [{ path: [] as const, durationSeconds: 600 }] };

describe("soniox.realtimeTranscription happy path", () => {
  test("the enumerable body IS the config message; .request is the socket", () => {
    const params = {
      model: "stt-rt-v5" as const,
      audio_format: "pcm_s16le" as const,
      sample_rate: 16000,
      num_channels: 1,
      language_hints: ["en", "es"],
      enable_endpoint_detection: true,
    };
    const v = realtimeTranscription(params);

    expect(Object.keys(v)).toEqual([
      "model",
      "audio_format",
      "sample_rate",
      "num_channels",
      "language_hints",
      "enable_endpoint_detection",
    ]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(REALTIME_URL);
    expect(v.request.url.startsWith("wss://")).toBe(true);
    // The handshake is an HTTP GET upgrade; this API authenticates in band
    // (`api_key` inside the message), so there are no headers to carry.
    expect(v.request.method).toBe("GET");
    expect(v.request.headers).toEqual({});
    expect(v.toSdk("soniox")).toEqual(params);
  });

  test("every documented field passes, warning-free", () => {
    const r = realtimeTranscription.safe({
      api_key: "sk-not-a-real-key",
      model: "stt-rt-v5",
      audio_format: "auto",
      language_hints: ["en"],
      language_hints_strict: true,
      enable_speaker_diarization: true,
      enable_language_identification: true,
      enable_endpoint_detection: true,
      max_endpoint_delay_ms: 2000,
      endpoint_sensitivity: 0.5,
      endpoint_latency_adjustment_level: 2,
      context: { general: [{ key: "Domain", value: "medicine" }], terms: ["ketamine"] },
      translation: { type: "two_way", language_a: "en", language_b: "es" },
      client_reference_id: "session-1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("api_key is passed through untouched when you choose to include it", () => {
    const v = realtimeTranscription({
      api_key: "sk-not-a-real-key",
      model: "stt-rt-v5",
      audio_format: "auto",
    });
    expect(JSON.parse(JSON.stringify(v)).api_key).toBe("sk-not-a-real-key");
    // …and omitting it is equally valid: unmodel never requires a credential.
    expect(realtimeTranscription.safe({ model: "stt-rt-v5", audio_format: "auto" }).ok).toBe(true);
  });

  test("unknown field warns but passes through", () => {
    const r = safeUnchecked({
      model: "stt-rt-v5",
      audio_format: "auto",
      brand_new_toggle: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
  });
});

describe("soniox.realtimeTranscription audio_format", () => {
  test("every container format and raw encoding is accepted", () => {
    for (const audio_format of SONIOX_CONTAINER_AUDIO_FORMATS) {
      const r = safeUnchecked({ model: "stt-rt-v5", audio_format });
      expect(r.ok, `${audio_format} should validate`).toBe(true);
    }
    for (const audio_format of SONIOX_RAW_AUDIO_FORMATS) {
      const r = safeUnchecked({
        model: "stt-rt-v5",
        audio_format,
        sample_rate: 16000,
        num_channels: 1,
      });
      expect(r.ok, `${audio_format} should validate`).toBe(true);
    }
  });

  test("raw encodings require sample_rate and num_channels", () => {
    const r = realtimeTranscription.safe({ model: "stt-rt-v5", audio_format: "pcm_s16le" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path)).toEqual([["sample_rate"], ["num_channels"]]);
      expect(r.errors[0]?.code).toBe("invalid_shape");
    }
    // Container formats carry both in their header.
    expect(realtimeTranscription.safe({ model: "stt-rt-v5", audio_format: "wav" }).ok).toBe(true);
  });

  test("an unknown audio_format is invalid_enum_value", () => {
    const r = safeUnchecked({ model: "stt-rt-v5", audio_format: "pcm_s16" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["audio_format"]);
      expect(String(r.errors[0]?.message)).toContain("pcm_s16le");
    }
  });
});

describe("soniox.realtimeTranscription bounds + model gate", () => {
  test("async models are rejected on the realtime socket", () => {
    const r = realtimeTranscription.safe({ model: "stt-async-v5", audio_format: "auto" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.path).toEqual(["model"]);
      expect(r.errors[0]?.message).toContain("stt-rt-v5");
    }
    expect(REALTIME_MODEL_IDS).toEqual(["stt-rt-v5", "stt-rt-v4"]);
  });

  test("an unknown model warns but passes — it may be new", () => {
    const r = realtimeTranscription.safe({ model: "stt-rt-v6", audio_format: "auto" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("stt-rt-v4 is flagged deprecated, and its v5-only knobs warn", () => {
    const r = realtimeTranscription.safe({
      model: "stt-rt-v4",
      audio_format: "auto",
      endpoint_sensitivity: 0.5,
      endpoint_latency_adjustment_level: 1,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual([
        "deprecated_model",
        "unsupported_param",
        "unsupported_param",
      ]);
      expect(r.warnings[1]?.path).toEqual(["endpoint_sensitivity"]);
      expect(r.warnings[2]?.path).toEqual(["endpoint_latency_adjustment_level"]);
    }
  });

  test("endpoint-detection knobs carry their documented ranges", () => {
    const cases: Array<[string, unknown]> = [
      ["max_endpoint_delay_ms", 499],
      ["max_endpoint_delay_ms", 3001],
      ["endpoint_sensitivity", -1.1],
      ["endpoint_sensitivity", 1.1],
      ["endpoint_latency_adjustment_level", -1],
      ["endpoint_latency_adjustment_level", 4],
      ["endpoint_latency_adjustment_level", 1.5],
    ];
    for (const [field, value] of cases) {
      const r = safeUnchecked({ model: "stt-rt-v5", audio_format: "auto", [field]: value });
      expect(r.ok, `${field}=${String(value)} should be rejected`).toBe(false);
    }
    const edges = realtimeTranscription.safe({
      model: "stt-rt-v5",
      audio_format: "auto",
      max_endpoint_delay_ms: 500,
      endpoint_sensitivity: -1,
      endpoint_latency_adjustment_level: 3,
    });
    expect(edges.ok).toBe(true);
  });

  test("context caps at 10,000 characters, string or object", () => {
    expect(MAX_CONTEXT_CHARACTERS).toBe(10_000);
    const long = "x".repeat(MAX_CONTEXT_CHARACTERS + 1);
    const asString = realtimeTranscription.safe({
      model: "stt-rt-v5",
      audio_format: "auto",
      context: long,
    });
    expect(asString.ok).toBe(false);
    if (!asString.ok) expect(asString.errors[0]?.path).toEqual(["context"]);

    const asObject = realtimeTranscription.safe({
      model: "stt-rt-v5",
      audio_format: "auto",
      context: { text: long },
    });
    expect(asObject.ok).toBe(false);

    expect(
      realtimeTranscription.safe({ model: "stt-rt-v5", audio_format: "auto", context: "x".repeat(9_000) })
        .ok,
    ).toBe(true);
  });

  // "Context size limit — Maximum 8,000 tokens (~10,000 characters)."
  // https://soniox.com/docs/stt/concepts/context — the budget is over the four
  // sections' CONTENT, so JSON punctuation, key names and section names are
  // not part of the measure.
  test("the object form is measured over content, not serialized JSON", () => {
    // 400 general entries whose content is 9,600 characters but whose
    // serialization is well past 10,000 — this must NOT be rejected.
    const general = Array.from({ length: 400 }, (_, i) => ({
      key: `k${String(i).padStart(3, "0")}`.padEnd(12, "x"),
      value: "v".repeat(12),
    }));
    const context = { general };
    expect(contextLength(context)).toBe(400 * 24);
    expect(JSON.stringify(context).length).toBeGreaterThan(MAX_CONTEXT_CHARACTERS);
    expect(realtimeTranscription.safe({ model: "stt-rt-v5", audio_format: "auto", context }).ok).toBe(
      true,
    );
  });

  test("content over the cap is still an error, and names the real count", () => {
    const context = {
      text: "t".repeat(6_000),
      terms: Array.from({ length: 100 }, () => "x".repeat(41)),
      translation_terms: [{ source: "s", target: "t" }],
      general: [{ key: "domain", value: "healthcare" }],
    };
    // 6000 + 4100 + 2 + 16 = 10,118 characters of content.
    expect(contextLength(context)).toBe(10_118);
    const r = realtimeTranscription.safe({ model: "stt-rt-v5", audio_format: "auto", context });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["context"]);
      expect(issue?.meta?.actual).toBe(10_118);
      expect(issue?.meta?.limit).toBe(MAX_CONTEXT_CHARACTERS);
      expect(issue?.meta?.source).toBe("https://soniox.com/docs/stt/concepts/context");
    }
  });

  test("contextLength sums every documented section and ignores the rest", () => {
    expect(contextLength("abcde")).toBe(5);
    expect(
      contextLength({
        general: [{ key: "ab", value: "cde" }],
        text: "fghi",
        terms: ["jk", "lmn"],
        translation_terms: [{ source: "op", target: "q" }],
      }),
    ).toBe(5 + 4 + 5 + 3);
    // Sections may be null/absent; unknown extra keys are not counted.
    expect(
      contextLength({ general: null, text: null, terms: null, translation_terms: null }),
    ).toBe(0);
    expect(contextLength({ notASection: "x".repeat(50) } as never)).toBe(0);
  });

  test("client_reference_id caps at 256 characters", () => {
    const r = safeUnchecked({
      model: "stt-rt-v5",
      audio_format: "auto",
      client_reference_id: "x".repeat(MAX_CLIENT_REFERENCE_ID_CHARACTERS + 1),
    });
    expect(r.ok).toBe(false);
  });

  test("translation must be a complete one_way or two_way object", () => {
    expect(
      realtimeTranscription.safe({
        model: "stt-rt-v5",
        audio_format: "auto",
        translation: { type: "one_way", target_language: "es" },
      }).ok,
    ).toBe(true);
    const incomplete = safeUnchecked({
      model: "stt-rt-v5",
      audio_format: "auto",
      translation: { type: "two_way", language_a: "en" },
    });
    expect(incomplete.ok).toBe(false);
  });
});

describe("soniox.realtimeTranscription cost estimation", () => {
  test("a declared session length prices at the realtime $0.12/hour rate", () => {
    expect(models["stt-rt-v5"].cost?.perAudioMinute).toBeCloseTo(0.12 / 60, 12);
    const r = realtimeTranscription.safe(
      { model: "stt-rt-v5", audio_format: "auto" },
      tenMinutes,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.02, 10);
  });

  test("without a declaration there is no estimate", () => {
    const r = realtimeTranscription.safe({ model: "stt-rt-v5", audio_format: "auto" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("over_budget fires against the session estimate", () => {
    const r = realtimeTranscription.safe(
      { model: "stt-rt-v5", audio_format: "auto" },
      { ...tenMinutes, maxCostUSD: 0.01 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });
});
