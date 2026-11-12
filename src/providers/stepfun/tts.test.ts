import { describe, expect, test } from "bun:test";
import {
  tts,
  AUDIO_SPEECH_URL,
  MAX_INSTRUCTION_CHARACTERS,
  SPEECH_MAX_INPUT_CHARACTERS,
  SYSTEM_VOICES,
} from "./tts";
import { speechModels } from "./audio-models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = tts.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("stepfun.tts happy path", () => {
  test("returns a wire-pure body with url/method/headers", () => {
    const params = {
      model: "stepaudio-2.5-tts" as const,
      input: "Hello from StepAudio.",
      voice: "vibrant-youth",
      response_format: "wav" as const,
      sample_rate: 24000 as const,
    };
    const v = tts(params);

    expect(Object.keys(v)).toEqual(["model", "input", "voice", "response_format", "sample_rate"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(AUDIO_SPEECH_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    // No first-party JS SDK; the self-named target is the identity.
    expect(v.toSdk("stepfun")).toEqual(params);
  });

  test("all documented optional fields pass", () => {
    const r = tts.safe({
      model: "stepaudio-2.5-tts",
      input: "x",
      voice: "zixinnansheng",
      response_format: "opus",
      speed: 1.5,
      volume: 0.8,
      instruction: "Speak gently, like a bedtime story.",
      sample_rate: 48000,
      pronunciation_map: [{ tone: "LOL/laugh out loudly" }],
      stream_format: "sse",
      markdown_filter: true,
      return_url: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("stepaudio-3-tts validates clean with every documented field", () => {
    const r = tts.safe({
      model: "stepaudio-3-tts",
      input: "Hello from StepAudio 3.",
      voice: "vibrant-youth",
      response_format: "flac",
      speed: 1.2,
      volume: 1.5,
      instruction: "Warm, unhurried, a little amused.",
      sample_rate: 48000,
      stream_format: "audio",
      return_url: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("every documented system voice passes", () => {
    for (const voice of SYSTEM_VOICES) {
      expect(tts.safe({ model: "stepaudio-2.5-tts", input: "x", voice }).ok).toBe(true);
    }
  });

  test("a cloned voice id is a plain string and passes", () => {
    expect(tts.safe({ model: "stepaudio-2.5-tts", input: "x", voice: "voice-tone-abc123" }).ok).toBe(
      true,
    );
  });

  test("unknown top-level key warns", () => {
    const r = safeUnchecked({ model: "stepaudio-2.5-tts", input: "x", voice: "v", pitch: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("unknown_param");
  });
});

describe("stepfun.tts model enum (doc audit 2026-11-12)", () => {
  test("the catalog's step-tts-2 is off the documented enum — warns, does not error", () => {
    const r = tts.safe({ model: "step-tts-2", input: "x", voice: "v" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const issue = r.warnings.find((w) => w.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["model"]);
      expect(issue?.message).toContain("Currently supports");
      expect(issue?.meta?.allowed).toEqual(["stepaudio-3-tts", "stepaudio-2.5-tts"]);
    }
  });

  test("an id the catalog does not know warns unknown_model AND off-enum", () => {
    const r = tts.safe({ model: "stepaudio-9-tts", input: "x", voice: "v" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const codes = r.warnings.map((w) => w.code);
      expect(codes).toContain("unknown_model");
      expect(codes).toContain("invalid_enum_value");
    }
  });
});

describe("stepfun.tts character caps", () => {
  test("input over 1,000 characters is over_output_limit with character meta", () => {
    const input = "a".repeat(SPEECH_MAX_INPUT_CHARACTERS + 1);
    const r = tts.safe({ model: "stepaudio-2.5-tts", input, voice: "v" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.errors[0]?.path).toEqual(["input"]);
      expect(r.errors[0]?.message).toContain("characters, not tokens");
      expect(r.errors[0]?.meta?.limitCharacters).toBe(1000);
      expect(r.errors[0]?.meta?.actualCharacters).toBe(1001);
    }
  });

  test("input at exactly the cap passes", () => {
    const input = "a".repeat(SPEECH_MAX_INPUT_CHARACTERS);
    expect(tts.safe({ model: "stepaudio-2.5-tts", input, voice: "v" }).ok).toBe(true);
  });

  test("the endpoint-level cap applies even for unknown models", () => {
    const r = tts.safe({ model: "stepaudio-9-tts", input: "a".repeat(1200), voice: "v" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("over_output_limit");
  });

  test("the instruction caps are per model: 200 for stepaudio-2.5-tts, 500 for stepaudio-3-tts", () => {
    expect(MAX_INSTRUCTION_CHARACTERS).toEqual({ "stepaudio-3-tts": 500, "stepaudio-2.5-tts": 200 });
  });

  test("stepaudio-2.5-tts: instruction over 200 characters is invalid_shape", () => {
    const r = tts.safe({
      model: "stepaudio-2.5-tts",
      input: "x",
      voice: "v",
      instruction: "a".repeat(201),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["instruction"]);
      expect(r.errors[0]?.message).toContain("stepaudio-3-tts: 500");
      expect(r.errors[0]?.meta?.limitCharacters).toBe(200);
    }
    expect(
      tts.safe({ model: "stepaudio-2.5-tts", input: "x", voice: "v", instruction: "a".repeat(200) }).ok,
    ).toBe(true);
  });

  test("stepaudio-3-tts: a 300-character instruction passes, 501 is invalid_shape", () => {
    const at300 = tts.safe({
      model: "stepaudio-3-tts",
      input: "x",
      voice: "v",
      instruction: "a".repeat(300),
    });
    expect(at300.ok).toBe(true);
    if (at300.ok) expect(at300.warnings).toEqual([]);
    expect(
      tts.safe({ model: "stepaudio-3-tts", input: "x", voice: "v", instruction: "a".repeat(500) }).ok,
    ).toBe(true);

    const r = tts.safe({
      model: "stepaudio-3-tts",
      input: "x",
      voice: "v",
      instruction: "a".repeat(501),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.path).toEqual(["instruction"]);
      expect(r.errors[0]?.meta?.limitCharacters).toBe(500);
      expect(r.errors[0]?.meta?.actualCharacters).toBe(501);
    }
  });

  test("an id with no documented instruction cap is not capped", () => {
    const r = tts.safe({ model: "step-tts-2", input: "x", voice: "v", instruction: "a".repeat(600) });
    expect(r.ok).toBe(true);
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const unchecked = tts as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      unchecked({ model: "stepaudio-2.5-tts", input: "a".repeat(1001), voice: "v" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("stepfun.tts schema enforcement", () => {
  test("speed outside 0.5–2.0 is invalid_shape", () => {
    for (const speed of [0.4, 2.1]) {
      const r = safeUnchecked({ model: "stepaudio-2.5-tts", input: "x", voice: "v", speed });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.path).toEqual(["speed"]);
    }
    expect(tts.safe({ model: "stepaudio-2.5-tts", input: "x", voice: "v", speed: 0.5 }).ok).toBe(
      true,
    );
    expect(tts.safe({ model: "stepaudio-2.5-tts", input: "x", voice: "v", speed: 2 }).ok).toBe(
      true,
    );
  });

  test("volume outside 0.1–2.0 is invalid_shape", () => {
    for (const volume of [0.05, 2.5]) {
      const r = safeUnchecked({ model: "stepaudio-2.5-tts", input: "x", voice: "v", volume });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.path).toEqual(["volume"]);
    }
  });

  test("an undocumented sample_rate is invalid_shape", () => {
    const r = safeUnchecked({ model: "stepaudio-2.5-tts", input: "x", voice: "v", sample_rate: 44100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("an undocumented response_format is invalid_shape", () => {
    const r = safeUnchecked({ model: "stepaudio-2.5-tts", input: "x", voice: "v", response_format: "aac" });
    expect(r.ok).toBe(false);
  });

  test("empty input and empty voice are invalid_shape", () => {
    expect(safeUnchecked({ model: "stepaudio-2.5-tts", input: "", voice: "v" }).ok).toBe(false);
    expect(safeUnchecked({ model: "stepaudio-2.5-tts", input: "x", voice: "" }).ok).toBe(false);
  });
});

describe("stepfun cost estimation", () => {
  // Documents the sharp edge: no USD rate is published for StepFun speech, so
  // there is no estimate and `maxCostUSD` cannot fire.
  test("no published rate — no costUSD, and maxCostUSD does not fire", () => {
    const r = tts.safe(
      { model: "stepaudio-2.5-tts", input: "a".repeat(500), voice: "v" },
      { maxCostUSD: 0.0000001 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.estimate.costUSD).toBeUndefined();
      expect(r.warnings.some((w) => w.code === "over_budget")).toBe(false);
    }
  });

  test("stepaudio-3-tts: contradictory published rates — no costUSD", () => {
    // Model card "$0.36 / 10,000 characters" vs pricing page "$14.00 / 1M
    // billable input text characters" (weighted counting) — see audio-models.ts.
    expect("cost" in speechModels["stepaudio-3-tts"]).toBe(false);
    const r = tts.safe(
      { model: "stepaudio-3-tts", input: "a".repeat(500), voice: "v" },
      { maxCostUSD: 0.0000001 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});

describe("stepfun speech catalog", () => {
  test("every row is TTS-shaped with the 1,000-character cap layered on", () => {
    for (const info of Object.values(speechModels)) {
      expect(info.limit.characters).toBe(1000);
      expect(info.modalities.input).toEqual(["text"]);
      expect(info.modalities.output).toEqual(["audio"]);
    }
  });

  test("stepaudio-3-tts carries the endpoint cap like its siblings", () => {
    const r = tts.safe({ model: "stepaudio-3-tts", input: "a".repeat(1001), voice: "v" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta?.limitCharacters).toBe(1000);
  });

  test("step-tts-2 is deprecated (off the current create-speech enum)", () => {
    expect(speechModels["step-tts-2"].status).toBe("deprecated");
  });
});
