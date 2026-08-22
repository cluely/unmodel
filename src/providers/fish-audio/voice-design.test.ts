import { describe, expect, test } from "bun:test";
import {
  voiceDesign,
  VOICE_DESIGN_URL,
  DEFAULT_VOICE_DESIGN_MODEL,
  VOICE_DESIGN_COST_PER_REQUEST_USD,
  VOICE_DESIGN_INSTRUCTION_MAX_CHARACTERS,
  VOICE_DESIGN_REFERENCE_TEXT_MAX_CHARACTERS,
} from "./voice-design";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = voiceDesign.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("fish-audio.voiceDesign happy path", () => {
  test("returns a wire-pure body with model stripped to the required header", () => {
    const v = voiceDesign({
      model: "voice-design-1",
      instruction: "Warm, confident studio narrator with a natural tone",
      n: 2,
      seed: 42,
    });

    expect(Object.keys(v)).toEqual(["instruction", "n", "seed"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual({
      instruction: "Warm, confident studio narrator with a natural tone",
      n: 2,
      seed: 42,
    });

    expect(v.request.url).toBe(VOICE_DESIGN_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    expect(v.request.headers.model).toBe("voice-design-1");
  });

  test("the required header is emitted even when model is omitted", () => {
    const v = voiceDesign({ instruction: "A gravelly sea captain" });
    expect(v.request.headers.model).toBe(DEFAULT_VOICE_DESIGN_MODEL);
  });

  test("every documented field validates together without warnings", () => {
    const r = voiceDesign.safe({
      instruction: "Warm, confident studio narrator",
      reference_text: "Welcome to Fish Audio.",
      language: "en",
      n: 4,
      speed: 1,
      num_step: 32,
      guidance_scale: 2,
      instruct_guidance_scale: 0,
      seed: 42,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("estimates the flat documented per-request rate", () => {
    const r = voiceDesign.safe({ instruction: "desc", n: 4 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBe(VOICE_DESIGN_COST_PER_REQUEST_USD);
  });

  test("maxCostUSD below the flat rate is over_budget", () => {
    const r = voiceDesign.safe({ instruction: "desc" }, { maxCostUSD: 0.001 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("over_budget");
  });

  test("unknown model warns but validates", () => {
    const r = voiceDesign.safe({ model: "voice-design-2", instruction: "desc" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("a TTS catalog id in the model header is rejected", () => {
    const r = voiceDesign.safe({ model: "s2.1-pro", instruction: "desc" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((i) => i.code === "unsupported_capability");
      expect(issue?.path).toEqual(["model"]);
      expect(issue?.meta?.allowed).toEqual(["voice-design-1"]);
    }
  });
});

describe("fish-audio.voiceDesign documented bounds", () => {
  test("instruction is bounded 1–2000 characters", () => {
    expect(voiceDesign.safe({ instruction: "" }).ok).toBe(false);
    expect(
      voiceDesign.safe({
        instruction: "a".repeat(VOICE_DESIGN_INSTRUCTION_MAX_CHARACTERS + 1),
      }).ok,
    ).toBe(false);
    expect(
      voiceDesign.safe({ instruction: "a".repeat(VOICE_DESIGN_INSTRUCTION_MAX_CHARACTERS) }).ok,
    ).toBe(true);
  });

  test("reference_text is capped at 150 characters (OpenAPI beats the feature page's 300)", () => {
    expect(
      voiceDesign.safe({
        instruction: "desc",
        reference_text: "a".repeat(VOICE_DESIGN_REFERENCE_TEXT_MAX_CHARACTERS + 1),
      }).ok,
    ).toBe(false);
    expect(
      voiceDesign.safe({
        instruction: "desc",
        reference_text: "a".repeat(VOICE_DESIGN_REFERENCE_TEXT_MAX_CHARACTERS),
      }).ok,
    ).toBe(true);
  });

  test("n, speed and num_step enforce their documented ranges", () => {
    expect(voiceDesign.safe({ instruction: "d", n: 0 }).ok).toBe(false);
    expect(voiceDesign.safe({ instruction: "d", n: 5 }).ok).toBe(false);
    expect(voiceDesign.safe({ instruction: "d", speed: 0 }).ok).toBe(false);
    expect(voiceDesign.safe({ instruction: "d", speed: 3.5 }).ok).toBe(false);
    expect(voiceDesign.safe({ instruction: "d", num_step: 0 }).ok).toBe(false);
    expect(voiceDesign.safe({ instruction: "d", num_step: 129 }).ok).toBe(false);
    expect(voiceDesign.safe({ instruction: "d", n: 1, speed: 3, num_step: 128 }).ok).toBe(true);
  });

  test("guidance scales refuse negatives", () => {
    expect(voiceDesign.safe({ instruction: "d", guidance_scale: -1 }).ok).toBe(false);
    expect(voiceDesign.safe({ instruction: "d", instruct_guidance_scale: -1 }).ok).toBe(false);
  });

  test("unknown top-level params warn (the wire schema itself is closed)", () => {
    const r = safeUnchecked({ instruction: "d", brand_new_param: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const unknown = r.warnings.find((w) => w.code === "unknown_param");
      expect(unknown?.path).toEqual(["brand_new_param"]);
    }
  });
});
