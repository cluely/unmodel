import { describe, expect, test } from "bun:test";
import { tts, AUDIO_SPEECH_URL } from "./tts";
import { speechModels, SPEECH_MAX_INPUT_CHARACTERS } from "./audio-models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the Tier-A compile-time surface so runtime enforcement of
// type-blocked params can be exercised.
const safeUnchecked = tts.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("openai.tts happy path", () => {
  test("returns a wire-pure body with hidden toSdk/request", () => {
    const params = {
      model: "gpt-4o-mini-tts" as const,
      input: "Today is a wonderful day.",
      voice: "marin" as const,
      instructions: "Speak cheerfully.",
      response_format: "wav" as const,
      speed: 1.1,
    };
    const v = tts(params);

    expect(Object.keys(v)).toEqual([
      "model",
      "input",
      "voice",
      "instructions",
      "response_format",
      "speed",
    ]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);
    expect(v.request.url).toBe(AUDIO_SPEECH_URL);
    expect(v.request.headers["content-type"]).toBe("application/json");
    expect(v.toSdk("openai")).toEqual(params);
  });

  test("a custom voice object is accepted (and never enum-checked)", () => {
    const r = tts.safe({ model: "tts-1", input: "hi", voice: { id: "voice_1234" } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown model falls back to the escape arm with a warning", () => {
    const r = tts.safe({ model: "tts-3", input: "hi", voice: "whoever" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("unknown_model");
  });
});

describe("openai.tts per-model rules", () => {
  test("instructions is denied on tts-1 and tts-1-hd", () => {
    for (const model of ["tts-1", "tts-1-hd"]) {
      const r = safeUnchecked({ model, input: "hi", voice: "alloy", instructions: "be chirpy" });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const issue = r.errors.find((e) => e.code === "unsupported_param");
        expect(issue?.path).toEqual(["instructions"]);
        expect(String(issue?.meta?.source)).toContain("audio/createSpeech");
      }
    }
  });

  test("stream_format sse is rejected for tts-1 but allowed for gpt-4o-mini-tts", () => {
    const bad = safeUnchecked({ model: "tts-1", input: "hi", voice: "alloy", stream_format: "sse" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]?.code).toBe("invalid_enum_value");

    const good = tts.safe({
      model: "gpt-4o-mini-tts",
      input: "hi",
      voice: "alloy",
      stream_format: "sse",
    });
    expect(good.ok).toBe(true);
  });

  test("marin/verse/ballad/cedar are gpt-4o-mini-tts-only voices", () => {
    for (const voice of ["marin", "verse", "ballad", "cedar"] as const) {
      const bad = safeUnchecked({ model: "tts-1-hd", input: "hi", voice });
      expect(bad.ok).toBe(false);
      if (!bad.ok) {
        const issue = bad.errors.find((e) => e.code === "invalid_enum_value");
        expect(issue?.path).toEqual(["voice"]);
        expect(issue?.message).toContain("custom voice object");
      }
      expect(tts.safe({ model: "gpt-4o-mini-tts", input: "hi", voice }).ok).toBe(true);
    }
  });

  test("fable / onyx / nova are accepted (the SDK union wrongly omits them)", () => {
    for (const voice of ["fable", "onyx", "nova"] as const) {
      expect(tts.safe({ model: "tts-1", input: "hi", voice }).ok).toBe(true);
      expect(tts.safe({ model: "gpt-4o-mini-tts", input: "hi", voice }).ok).toBe(true);
    }
  });

  test("an unknown voice string is an invalid_enum_value error", () => {
    const r = safeUnchecked({ model: "tts-1", input: "hi", voice: "bogus" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["voice"]);
  });

  test("response_format outside the documented set is rejected", () => {
    const r = safeUnchecked({ model: "tts-1", input: "hi", voice: "alloy", response_format: "ogg" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
  });

  test("speed outside 0.25–4.0 fails the schema", () => {
    const r = safeUnchecked({ model: "tts-1", input: "hi", voice: "alloy", speed: 8 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });
});

describe("openai.tts limits and cost", () => {
  test("the 4096-character input cap is enforced", () => {
    expect(SPEECH_MAX_INPUT_CHARACTERS).toBe(4096);
    expect(speechModels["tts-1"].limit.characters).toBe(4096);

    const r = tts.safe({
      model: "tts-1",
      input: "x".repeat(SPEECH_MAX_INPUT_CHARACTERS + 1),
      voice: "alloy",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "over_output_limit");
      expect(issue?.path).toEqual(["input"]);
      expect(issue?.meta).toMatchObject({
        limitCharacters: 4096,
        actualCharacters: 4097,
      });
    }
  });

  test("the endpoint cap still applies to a model id the catalog does not know", () => {
    const r = safeUnchecked({
      model: "tts-3-brand-new",
      input: "x".repeat(5000),
      voice: "alloy",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "over_output_limit");
      expect(issue?.path).toEqual(["input"]);
      expect(issue?.message).toContain("/v1/audio/speech");
      expect(issue?.meta).toMatchObject({ limitCharacters: 4096, actualCharacters: 5000 });
      // The unknown id is still surfaced as a warning alongside the cap.
      expect(r.warnings.map((w) => w.code)).toContain("unknown_model");
    }
  });

  test("character-billed models get a cost estimate", () => {
    const r = tts.safe({ model: "tts-1-hd", input: "x".repeat(1000), voice: "alloy" });
    expect(r.ok).toBe(true);
    // $30.00 / 1M characters × 1000 characters = $0.03.
    if (r.ok) expect(r.estimate?.costUSD).toBeCloseTo(0.03, 10);
  });

  test("token-billed gpt-4o-mini-tts gets no character estimate", () => {
    const r = tts.safe({ model: "gpt-4o-mini-tts", input: "x".repeat(1000), voice: "alloy" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate?.costUSD).toBeUndefined();
  });

  test("maxCostUSD is enforced against the character estimate", () => {
    const r = tts.safe(
      { model: "tts-1-hd", input: "x".repeat(4000), voice: "alloy" },
      { maxCostUSD: 0.01 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const ttsUnchecked = tts as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      ttsUnchecked({ model: "tts-1", input: "hi", voice: "alloy", instructions: "no" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});
