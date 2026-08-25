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

describe("stepfun.tts model enum (doc audit 2026-08-24)", () => {
  test("the catalog's step-tts-2 is off the documented enum — warns, does not error", () => {
    const r = tts.safe({ model: "step-tts-2", input: "x", voice: "v" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const issue = r.warnings.find((w) => w.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["model"]);
      expect(issue?.message).toContain("Currently supports");
      expect(issue?.meta?.allowed).toEqual(["stepaudio-2.5-tts"]);
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

  test("instruction over 200 characters is rejected by the schema", () => {
    const r = safeUnchecked({
      model: "stepaudio-2.5-tts",
      input: "x",
      voice: "v",
      instruction: "a".repeat(MAX_INSTRUCTION_CHARACTERS + 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["instruction"]);
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
});

describe("stepfun speech catalog", () => {
  test("both rows are TTS-shaped with the 1,000-character cap layered on", () => {
    for (const info of Object.values(speechModels)) {
      expect(info.limit.characters).toBe(1000);
      expect(info.modalities.input).toEqual(["text"]);
      expect(info.modalities.output).toEqual(["audio"]);
    }
  });

  test("step-tts-2 is deprecated (off the current create-speech enum)", () => {
    expect(speechModels["step-tts-2"].status).toBe("deprecated");
  });
});
