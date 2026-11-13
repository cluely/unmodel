import { describe, expect, test } from "bun:test";
import { tts, TTS_URL, MAX_CHARACTERS, PRO_ONLY_LANGUAGES } from "./tts";
import { models } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = tts.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("smallest-ai.tts happy path", () => {
  test("returns a wire-pure body with only the JSON content-type header", () => {
    const params = {
      text: "Hello from Waves TTS.",
      voice_id: "meher",
      model: "lightning_v3.1_pro" as const,
      sample_rate: 24000 as const,
      output_format: "wav" as const,
    };
    const v = tts(params);

    expect(Object.keys(v)).toEqual(["text", "voice_id", "model", "sample_rate", "output_format"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(TTS_URL);
    expect(v.request.method).toBe("POST");
    // "`Accept` ... Optional. The server ignores it; `output_format` sets the
    // audio format." — so it is not sent.
    expect(v.request.headers).toEqual({ "content-type": "application/json" });
    // No first-party JS SDK; the Python SDK takes the same keys.
    expect(v.toSdk("smallest-ai")).toEqual(params);
  });

  test("all documented optional fields pass", () => {
    const r = tts.safe({
      text: "x",
      voice_id: "meher",
      model: "lightning_v3.1_pro",
      sample_rate: 44100,
      speed: 1.5,
      language: "hi",
      number_pronunciation_language: "en",
      math_notation: true,
      date_format: "EU",
      content_filter: { enabled: true, action: "redact" },
      output_format: "mp3",
      pronunciation_dicts: ["dict_1"],
      session_id: "session-1.a_b",
      request_id: "req-1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("omitting model resolves no pool — it is picked from the voice — and warns nothing", () => {
    const r = tts.safe({ text: "x", voice_id: "magnus" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("lightning_v3.1 still validates, with a deprecated_model warning (retiring 2026-11-30)", () => {
    const r = tts.safe({ text: "x", voice_id: "magnus", model: "lightning_v3.1" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
  });

  test("unknown model warns", () => {
    const r = tts.safe({ text: "x", voice_id: "v", model: "lightning_v9" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("unknown top-level key warns", () => {
    const r = safeUnchecked({ text: "x", voice_id: "v", pitch: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("unknown_param");
  });
});

describe("smallest-ai.tts x-expire-content header", () => {
  test("x_expire_content is stripped from the body onto request.headers", () => {
    const v = tts({ text: "x", voice_id: "meher", x_expire_content: true });
    expect(Object.keys(v)).toEqual(["text", "voice_id"]);
    expect((v as Record<string, unknown>).x_expire_content).toBeUndefined();
    expect(v.request.headers["x-expire-content"]).toBe("true");
  });

  test("omitting it leaves the header off (content retention is the default)", () => {
    const v = tts({ text: "x", voice_id: "meher" });
    expect(v.request.headers["x-expire-content"]).toBeUndefined();
  });

  test("headers are not shared between two validations", () => {
    const a = tts({ text: "a", voice_id: "v", x_expire_content: true });
    const b = tts({ text: "b", voice_id: "v" });
    a.request.headers.authorization = "Bearer leak";
    expect(b.request.headers.authorization).toBeUndefined();
  });
});

describe("smallest-ai.tts character cap (8000 characters after trim)", () => {
  test("text over the cap is over_output_limit with character meta", () => {
    const text = "a".repeat(MAX_CHARACTERS + 1);
    const r = tts.safe({ text, voice_id: "meher", model: "lightning_v3.1_pro" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.errors[0]?.path).toEqual(["text"]);
      expect(r.errors[0]?.message).toContain("characters, not tokens");
      expect(r.errors[0]?.meta?.limitCharacters).toBe(8000);
      expect(r.errors[0]?.meta?.actualCharacters).toBe(8001);
    }
  });

  test("text at exactly the cap passes", () => {
    const r = tts.safe({ text: "a".repeat(MAX_CHARACTERS), voice_id: "v", model: "lightning_v3.1_pro" });
    expect(r.ok).toBe(true);
  });

  test("the cap is measured after trim", () => {
    const text = `  ${"a".repeat(MAX_CHARACTERS)}\n`;
    expect(tts.safe({ text, voice_id: "v", model: "lightning_v3.1_pro" }).ok).toBe(true);
  });

  test("over the model cards' 250-character chunk size is a warning, not an error", () => {
    const r = tts.safe({ text: "a".repeat(251), voice_id: "meher", model: "lightning_v3.1_pro" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const issue = r.warnings.find((w) => w.code === "over_output_limit");
      expect(issue?.severity).toBe("warning");
      expect(issue?.path).toEqual(["text"]);
      expect(issue?.meta?.chunkCharacters).toBe(250);
      expect(issue?.meta?.actualCharacters).toBe(251);
    }
  });

  test("at or under 250 characters there is no chunk-size warning", () => {
    const r = tts.safe({ text: "a".repeat(250), voice_id: "meher", model: "lightning_v3.1_pro" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("the endpoint-level cap applies with no model and for unknown models", () => {
    for (const model of [undefined, "lightning_v9"]) {
      const r = tts.safe({ text: "a".repeat(MAX_CHARACTERS + 1), voice_id: "v", ...(model && { model }) });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("over_output_limit");
    }
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const unchecked = tts as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      unchecked({ text: "a".repeat(MAX_CHARACTERS + 1), voice_id: "v" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("smallest-ai.tts schema enforcement", () => {
  test("speed outside 0.5–2.0 is invalid_shape", () => {
    for (const speed of [0.4, 2.1]) {
      const r = safeUnchecked({ text: "x", voice_id: "v", speed });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.path).toEqual(["speed"]);
    }
    expect(tts.safe({ text: "x", voice_id: "v", speed: 0.5 }).ok).toBe(true);
    expect(tts.safe({ text: "x", voice_id: "v", speed: 2 }).ok).toBe(true);
  });

  test("an undocumented sample_rate is invalid_shape", () => {
    const r = safeUnchecked({ text: "x", voice_id: "v", sample_rate: 22050 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("an undocumented output_format is invalid_shape", () => {
    const r = safeUnchecked({ text: "x", voice_id: "v", output_format: "opus" });
    expect(r.ok).toBe(false);
  });

  test("an undocumented language code is invalid_shape", () => {
    const r = safeUnchecked({ text: "x", voice_id: "v", language: "xx" });
    expect(r.ok).toBe(false);
  });

  test("correlation ids reject disallowed characters and over-long values", () => {
    expect(safeUnchecked({ text: "x", voice_id: "v", session_id: "has space" }).ok).toBe(false);
    expect(safeUnchecked({ text: "x", voice_id: "v", request_id: "a".repeat(129) }).ok).toBe(false);
  });

  test("empty text is invalid_shape", () => {
    const r = safeUnchecked({ text: "", voice_id: "v" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("date_format takes EU or US and nothing else", () => {
    for (const date_format of ["EU", "US"] as const) {
      expect(tts.safe({ text: "05/03/2024", voice_id: "v", date_format }).ok).toBe(true);
    }
    const r = safeUnchecked({ text: "05/03/2024", voice_id: "v", date_format: "ISO" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["date_format"]);
  });

  test("content_filter takes a boolean `enabled` and a reject/flag/redact `action`", () => {
    for (const action of ["reject", "flag", "redact"] as const) {
      expect(tts.safe({ text: "x", voice_id: "v", content_filter: { enabled: true, action } }).ok).toBe(
        true,
      );
    }
    const badAction = safeUnchecked({ text: "x", voice_id: "v", content_filter: { action: "mute" } });
    expect(badAction.ok).toBe(false);
    if (!badAction.ok) expect(badAction.errors[0]?.path).toEqual(["content_filter", "action"]);
    const badEnabled = safeUnchecked({ text: "x", voice_id: "v", content_filter: { enabled: "true" } });
    expect(badEnabled.ok).toBe(false);
  });
});

describe("smallest-ai.tts per-model gates (doc audit 2026-11-12)", () => {
  test("word_timestamps is a warning — accepted over HTTP but ignored — with or without a model", () => {
    for (const model of [undefined, "lightning_v3.1_pro"] as const) {
      const r = tts.safe({ text: "x", voice_id: "v", word_timestamps: true, ...(model && { model }) });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const issues = r.warnings.filter((w) => w.code === "unsupported_param");
        expect(issues.length).toBe(1);
        expect(issues[0]?.path).toEqual(["word_timestamps"]);
        expect(issues[0]?.message).toContain("silently ignored");
        expect(issues[0]?.meta?.ignored).toBe(true);
      }
    }
  });

  test("Pro-only languages on lightning_v3.1 are a warning, not an error", () => {
    for (const language of PRO_ONLY_LANGUAGES) {
      const r = tts.safe({ text: "x", voice_id: "v", model: "lightning_v3.1", language });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const issue = r.warnings.find((w) => w.code === "invalid_enum_value");
        expect(issue?.severity).toBe("warning");
        expect(issue?.path).toEqual(["language"]);
        expect(issue?.message).toContain("lightning_v3.1_pro");
      }
    }
  });

  test("the same languages pass on the Pro pool", () => {
    for (const language of PRO_ONLY_LANGUAGES) {
      expect(
        tts.safe({ text: "x", voice_id: "meher", model: "lightning_v3.1_pro", language }).ok,
      ).toBe(true);
    }
  });

  test("base-pool languages and auto pass on both pools", () => {
    for (const model of ["lightning_v3.1", "lightning_v3.1_pro"] as const) {
      for (const language of ["auto", "en", "hi", "ta", "es", "pl"] as const) {
        expect(tts.safe({ text: "x", voice_id: "v", model, language }).ok).toBe(true);
      }
    }
  });

  test("number_pronunciation_language is gated the same way", () => {
    const r = tts.safe({
      text: "x",
      voice_id: "v",
      model: "lightning_v3.1",
      number_pronunciation_language: "ja",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const issue = r.warnings.find((w) => w.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["number_pronunciation_language"]);
    }
  });

  test("an omitted model is never language-gated: its pool is picked from the voice", () => {
    const r = tts.safe({
      text: "x",
      voice_id: "meher",
      language: "ja",
      number_pronunciation_language: "ja",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("constraintsFor exposes the word_timestamps rule with its source", () => {
    expect(tts.constraintsFor("lightning_v3.1").at(0)?.deny?.word_timestamps?.source).toContain(
      "docs.smallest.ai",
    );
  });
});

describe("smallest-ai cost estimation", () => {
  test("lightning_v3.1_pro prices at $19.5/1M characters", () => {
    const r = tts.safe({ text: "a".repeat(200), voice_id: "meher", model: "lightning_v3.1_pro" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.0039, 10);
  });

  test("lightning_v3.1 prices at $17.5/1M characters", () => {
    const r = tts.safe({ text: "a".repeat(200), voice_id: "v", model: "lightning_v3.1" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.0035, 10);
  });

  // Documents the sharp edge: `model` is optional and an omitted one is
  // picked from the voice, which the validator cannot see — so the request
  // resolves no rate, yields no estimate, and `maxCostUSD` cannot fire on it.
  test("omitting `model` yields no costUSD, so maxCostUSD does not fire", () => {
    const r = tts.safe({ text: "a".repeat(250), voice_id: "meher" }, { maxCostUSD: 0.0000001 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.estimate.costUSD).toBeUndefined();
      expect(r.warnings.some((w) => w.code === "over_budget")).toBe(false);
    }
  });

  test("maxCostUSD enforces over_budget on the priced pool", () => {
    const r = tts.safe(
      { text: "a".repeat(250), voice_id: "meher", model: "lightning_v3.1_pro" },
      { maxCostUSD: 0.001 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });
});

describe("smallest-ai lightning_v3.1_pro_10_26 (Pro preview checkpoint, 2026-10-29)", () => {
  test("validates as a catalogued id, with no warnings", () => {
    const r = tts.safe({
      text: "Hola, ¿qué tal?",
      voice_id: "meher",
      model: "lightning_v3.1_pro_10_26",
      language: "es",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("prices at the Pro pool's $19.5/1M characters", () => {
    const r = tts.safe({ text: "a".repeat(200), voice_id: "meher", model: "lightning_v3.1_pro_10_26" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.0039, 10);
  });

  test("word_timestamps is accepted but ignored, as on the stable pools", () => {
    const r = tts.safe({
      text: "x",
      voice_id: "meher",
      model: "lightning_v3.1_pro_10_26",
      word_timestamps: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const issue = r.warnings.find((w) => w.code === "unsupported_param");
      expect(issue?.path).toEqual(["word_timestamps"]);
      expect(issue?.meta?.ignored).toBe(true);
    }
  });

  test("the catalog row is marked beta (preview)", () => {
    expect(models["lightning_v3.1_pro_10_26"].status).toBe("beta");
  });
});

describe("smallest-ai catalog", () => {
  test("every catalogued id is TTS-shaped with the 8000-character cap", () => {
    for (const info of Object.values(models)) {
      expect(info.limit.context).toBe(0);
      expect(info.limit.characters).toBe(8000);
      expect(info.modalities.input).toEqual(["text"]);
      expect(info.modalities.output).toEqual(["audio"]);
    }
  });

  test("lightning_v3.1 is marked deprecated (retiring 2026-11-30, then served by Pro)", () => {
    expect(models["lightning_v3.1"].status).toBe("deprecated");
  });
});
