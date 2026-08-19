import { describe, expect, test } from "bun:test";
import { speech, TTS_URL, MAX_CHARACTERS, REQUIRED_ACCEPT, PRO_ONLY_LANGUAGES } from "./speech";
import { models } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = speech.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("smallest-ai.speech happy path", () => {
  test("returns a wire-pure body with the required accept header", () => {
    const params = {
      text: "Hello from Waves TTS.",
      voice_id: "meher",
      model: "lightning_v3.1_pro" as const,
      sample_rate: 24000 as const,
      output_format: "wav" as const,
    };
    const v = speech(params);

    expect(Object.keys(v)).toEqual(["text", "voice_id", "model", "sample_rate", "output_format"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(TTS_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    // Documented as required — "omitting it can return an empty or unplayable response".
    expect(v.request.headers.accept).toBe(REQUIRED_ACCEPT);
    // No first-party JS SDK; the Python SDK takes the same keys.
    expect(v.toSdk("smallest-ai")).toEqual(params);
  });

  test("all documented optional fields pass", () => {
    const r = speech.safe({
      text: "x",
      voice_id: "magnus",
      model: "lightning_v3.1",
      sample_rate: 44100,
      speed: 1.5,
      language: "hi",
      number_pronunciation_language: "en",
      math_notation: true,
      output_format: "mp3",
      pronunciation_dicts: ["dict_1"],
      session_id: "session-1.a_b",
      request_id: "req-1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("omitting model resolves to the documented lightning_v3.1 default", () => {
    const r = speech.safe({ text: "x", voice_id: "magnus" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown model warns", () => {
    const r = speech.safe({ text: "x", voice_id: "v", model: "lightning_v9" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("unknown top-level key warns", () => {
    const r = safeUnchecked({ text: "x", voice_id: "v", pitch: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("unknown_param");
  });
});

describe("smallest-ai.speech x-expire-content header", () => {
  test("x_expire_content is stripped from the body onto request.headers", () => {
    const v = speech({ text: "x", voice_id: "meher", x_expire_content: true });
    expect(Object.keys(v)).toEqual(["text", "voice_id"]);
    expect((v as Record<string, unknown>).x_expire_content).toBeUndefined();
    expect(v.request.headers["x-expire-content"]).toBe("true");
  });

  test("omitting it leaves the header off (content retention is the default)", () => {
    const v = speech({ text: "x", voice_id: "meher" });
    expect(v.request.headers["x-expire-content"]).toBeUndefined();
  });

  test("headers are not shared between two validations", () => {
    const a = speech({ text: "a", voice_id: "v", x_expire_content: true });
    const b = speech({ text: "b", voice_id: "v" });
    a.request.headers.authorization = "Bearer leak";
    expect(b.request.headers.authorization).toBeUndefined();
  });
});

describe("smallest-ai.speech character cap (250 characters)", () => {
  test("text over the cap is over_output_limit with character meta", () => {
    const text = "a".repeat(MAX_CHARACTERS + 1);
    const r = speech.safe({ text, voice_id: "meher" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.errors[0]?.path).toEqual(["text"]);
      expect(r.errors[0]?.message).toContain("characters, not tokens");
      expect(r.errors[0]?.meta?.limitCharacters).toBe(250);
      expect(r.errors[0]?.meta?.actualCharacters).toBe(251);
    }
  });

  test("text at exactly the cap passes", () => {
    expect(speech.safe({ text: "a".repeat(MAX_CHARACTERS), voice_id: "v" }).ok).toBe(true);
  });

  test("the endpoint-level cap applies even for unknown models", () => {
    const r = speech.safe({ text: "a".repeat(300), voice_id: "v", model: "lightning_v9" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("over_output_limit");
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const unchecked = speech as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      unchecked({ text: "a".repeat(251), voice_id: "v" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("smallest-ai.speech schema enforcement", () => {
  test("speed outside 0.5–2.0 is invalid_shape", () => {
    for (const speed of [0.4, 2.1]) {
      const r = safeUnchecked({ text: "x", voice_id: "v", speed });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.path).toEqual(["speed"]);
    }
    expect(speech.safe({ text: "x", voice_id: "v", speed: 0.5 }).ok).toBe(true);
    expect(speech.safe({ text: "x", voice_id: "v", speed: 2 }).ok).toBe(true);
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
});

describe("smallest-ai.speech per-model gates (doc audit 2026-08-13)", () => {
  test("word_timestamps is a warning — accepted over HTTP but ignored", () => {
    const r = speech.safe({ text: "x", voice_id: "v", word_timestamps: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const issue = r.warnings.find((w) => w.code === "unsupported_param");
      expect(issue?.path).toEqual(["word_timestamps"]);
      expect(issue?.message).toContain("silently ignored");
      expect(issue?.meta?.ignored).toBe(true);
    }
  });

  test("Pro-only languages are rejected on the standard pool", () => {
    for (const language of PRO_ONLY_LANGUAGES) {
      const r = speech.safe({ text: "x", voice_id: "v", model: "lightning_v3.1", language });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("invalid_enum_value");
        expect(r.errors[0]?.path).toEqual(["language"]);
      }
    }
  });

  test("the same languages pass on the Pro pool", () => {
    for (const language of PRO_ONLY_LANGUAGES) {
      expect(
        speech.safe({ text: "x", voice_id: "meher", model: "lightning_v3.1_pro", language }).ok,
      ).toBe(true);
    }
  });

  test("base-pool languages and auto pass on both pools", () => {
    for (const model of ["lightning_v3.1", "lightning_v3.1_pro"] as const) {
      for (const language of ["auto", "en", "hi", "ta", "es", "pl"] as const) {
        expect(speech.safe({ text: "x", voice_id: "v", model, language }).ok).toBe(true);
      }
    }
  });

  test("number_pronunciation_language is gated the same way", () => {
    const r = speech.safe({ text: "x", voice_id: "v", number_pronunciation_language: "ja" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["number_pronunciation_language"]);
  });

  test("constraintsFor exposes the word_timestamps rule with its source", () => {
    expect(speech.constraintsFor("lightning_v3.1").at(0)?.deny?.word_timestamps?.source).toContain(
      "docs.smallest.ai",
    );
  });
});

describe("smallest-ai cost estimation", () => {
  test("lightning_v3.1_pro prices at $19.5/1M characters", () => {
    const r = speech.safe({ text: "a".repeat(200), voice_id: "meher", model: "lightning_v3.1_pro" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.0039, 10);
  });

  test("lightning_v3.1 has no published per-character rate — no costUSD", () => {
    const r = speech.safe({ text: "a".repeat(200), voice_id: "v", model: "lightning_v3.1" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  // Documents the sharp edge: `model` is optional and defaults to
  // `lightning_v3.1`, the pool with no published rate — so the most common
  // request shape yields no estimate and `maxCostUSD` cannot fire on it.
  test("omitting `model` yields no costUSD, so maxCostUSD does not fire", () => {
    const r = speech.safe({ text: "a".repeat(250), voice_id: "meher" }, { maxCostUSD: 0.0000001 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.estimate.costUSD).toBeUndefined();
      expect(r.warnings.some((w) => w.code === "over_budget")).toBe(false);
    }
  });

  test("maxCostUSD enforces over_budget on the priced pool", () => {
    const r = speech.safe(
      { text: "a".repeat(250), voice_id: "meher", model: "lightning_v3.1_pro" },
      { maxCostUSD: 0.001 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });
});

describe("smallest-ai catalog", () => {
  test("both pools are TTS-shaped with the 250-character cap", () => {
    for (const info of Object.values(models)) {
      expect(info.limit.context).toBe(0);
      expect(info.limit.characters).toBe(250);
      expect(info.modalities.input).toEqual(["text"]);
      expect(info.modalities.output).toEqual(["audio"]);
    }
  });
});
