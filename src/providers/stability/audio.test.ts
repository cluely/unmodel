import { describe, expect, test } from "bun:test";
import {
  stableAudioTextToAudio,
  stableAudioAudioToAudio,
  stableAudioInpaint,
  stableAudioCredits,
  STABLE_AUDIO_TEXT_TO_AUDIO_URL,
  STABLE_AUDIO_AUDIO_TO_AUDIO_URL,
  STABLE_AUDIO_INPAINT_URL,
  STABILITY_USD_PER_CREDIT,
} from "./audio";
import { toFormData } from "./generate";
import { models } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const mp3Blob = new Blob([new Uint8Array([0x49, 0x44, 0x33])], { type: "audio/mpeg" });

const safeT2aUnchecked = stableAudioTextToAudio.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("stability.stableAudioTextToAudio", () => {
  test("enumerable props are the exact multipart fields", () => {
    const v = stableAudioTextToAudio({
      prompt: "A cheerful acoustic guitar loop in 3/4",
      duration: 20,
      model: "stable-audio-2.5",
      output_format: "wav",
    });
    expect(Object.keys(v)).toEqual(["prompt", "duration", "model", "output_format"]);
    expect(v.request.url).toBe(STABLE_AUDIO_TEXT_TO_AUDIO_URL);
    expect(v.request.method).toBe("POST");
    // Multipart: fetch derives the boundary from FormData; no static headers.
    expect(v.request.headers).toEqual({});
    expect(v.toSdk("stability")).toEqual({
      prompt: "A cheerful acoustic guitar loop in 3/4",
      duration: 20,
      model: "stable-audio-2.5",
      output_format: "wav",
    });
  });

  test("stable-audio-2 credits follow 17 + 0.06 x steps", () => {
    expect(stableAudioCredits("stable-audio-2")).toBeCloseTo(20, 10);
    expect(stableAudioCredits("stable-audio-2", 100)).toBeCloseTo(23, 10);
    expect(stableAudioCredits("stable-audio-2.5", 4)).toBe(20);
    expect(stableAudioCredits("stable-audio-3")).toBe(26);
    expect(stableAudioCredits("sd3.5-large")).toBeUndefined();

    const dflt = stableAudioTextToAudio.safe({ prompt: "hi" });
    expect(dflt.ok).toBe(true);
    if (dflt.ok) expect(dflt.estimate.costUSD).toBeCloseTo(0.2, 10);

    const hundred = stableAudioTextToAudio.safe({ prompt: "hi", steps: 100 });
    expect(hundred.ok).toBe(true);
    if (hundred.ok) expect(hundred.estimate.costUSD).toBeCloseTo(23 * STABILITY_USD_PER_CREDIT, 10);
  });

  test("stable-audio-2.5 is a flat 20 credits", () => {
    const r = stableAudioTextToAudio.safe({ prompt: "hi", model: "stable-audio-2.5", steps: 4 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.2, 10);
  });

  test("steps bounds are per model", () => {
    // stable-audio-2: 30–100.
    expect(stableAudioTextToAudio.safe({ prompt: "hi", steps: 30 }).ok).toBe(true);
    const low = stableAudioTextToAudio.safe({ prompt: "hi", steps: 8 });
    expect(low.ok).toBe(false);
    if (!low.ok) {
      expect(low.errors[0]?.path).toEqual(["steps"]);
      expect(low.errors[0]?.meta).toMatchObject({ min: 30, max: 100 });
    }
    // stable-audio-2.5: 4–8.
    expect(
      stableAudioTextToAudio.safe({ prompt: "hi", model: "stable-audio-2.5", steps: 8 }).ok,
    ).toBe(true);
    const high = stableAudioTextToAudio.safe({
      prompt: "hi",
      model: "stable-audio-2.5",
      steps: 50,
    });
    expect(high.ok).toBe(false);
    if (!high.ok) expect(high.errors[0]?.meta).toMatchObject({ min: 4, max: 8 });
  });

  test("stable-audio-3 is rejected: it is served by the async routes", () => {
    const r = stableAudioTextToAudio.safe({ prompt: "hi", model: "stable-audio-3" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["model"]);
    }
    // …but it IS a catalogued Stability model.
    expect(models["stable-audio-3"].family).toBe("stable-audio");
  });

  test("an off-catalog model warns unknown_model alongside the enum error", () => {
    const r = stableAudioTextToAudio.safe({ prompt: "hi", model: "stable-audio-9" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code)).toEqual(["invalid_enum_value"]);
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.model).toBe("stable-audio-9");
    }
    // stable-audio-3 IS catalogued, so it is rejected without that warning.
    const catalogued = stableAudioTextToAudio.safe({ prompt: "hi", model: "stable-audio-3" });
    expect(catalogued.ok).toBe(false);
    if (!catalogued.ok) expect(catalogued.warnings).toEqual([]);
  });

  test("duration outside 1–190 seconds is invalid_shape", () => {
    const r = stableAudioTextToAudio.safe({ prompt: "hi", duration: 191 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["duration"]);
    expect(stableAudioTextToAudio.safe({ prompt: "hi", duration: 190 }).ok).toBe(true);
  });

  test("cfg_scale outside 1–25 and an empty prompt are invalid_shape", () => {
    expect(safeT2aUnchecked({ prompt: "hi", cfg_scale: 26 }).ok).toBe(false);
    expect(stableAudioTextToAudio.safe({ prompt: "" }).ok).toBe(false);
  });

  test("maxCostUSD turns a generation into over_budget", () => {
    const r = stableAudioTextToAudio.safe({ prompt: "hi" }, { maxCostUSD: 0.1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });
});

describe("stability.stableAudioAudioToAudio", () => {
  test("targets the audio-to-audio route and carries the audio Blob", () => {
    const v = stableAudioAudioToAudio({
      prompt: "make it a jazz trio",
      audio: mp3Blob,
      strength: 0.6,
    });
    expect(v.request.url).toBe(STABLE_AUDIO_AUDIO_TO_AUDIO_URL);
    const form = toFormData(v);
    expect(form.get("prompt")).toBe("make it a jazz trio");
    expect(form.get("strength")).toBe("0.6");
    expect(form.get("audio")).toBeInstanceOf(Blob);
  });

  test("audio is required", () => {
    const r = safeT2aUnchecked({ prompt: "hi" }) as ValidateResult<unknown>;
    expect(r.ok).toBe(true); // text-to-audio needs no audio…
    const missing = stableAudioAudioToAudio.safe({ prompt: "hi" } as never);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]?.path).toEqual(["audio"]);
  });

  test("stable-audio-2.5 floors strength at 0.01", () => {
    const r = stableAudioAudioToAudio.safe({
      prompt: "hi",
      audio: mp3Blob,
      model: "stable-audio-2.5",
      strength: 0.005,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["strength"]);
    // stable-audio-2 accepts the full 0–1 range.
    expect(
      stableAudioAudioToAudio.safe({ prompt: "hi", audio: mp3Blob, strength: 0.005 }).ok,
    ).toBe(true);
  });

  test("strength outside 0–1 is invalid_shape", () => {
    const r = stableAudioAudioToAudio.safe({ prompt: "hi", audio: mp3Blob, strength: 1.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["strength"]);
  });
});

describe("stability.stableAudioInpaint", () => {
  test("has no model field and is priced as Stable Audio 2.5", () => {
    const v = stableAudioInpaint({
      prompt: "swap the bridge for a sax solo",
      audio: mp3Blob,
      mask_start: 30,
      mask_end: 60,
    });
    expect(Object.keys(v)).toEqual(["prompt", "audio", "mask_start", "mask_end"]);
    expect(v.request.url).toBe(STABLE_AUDIO_INPAINT_URL);
    const r = stableAudioInpaint.safe({ prompt: "hi", audio: mp3Blob });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.2, 10);
  });

  test("steps follow the 2.5 bounds (4–8)", () => {
    expect(stableAudioInpaint.safe({ prompt: "hi", audio: mp3Blob, steps: 8 }).ok).toBe(true);
    const r = stableAudioInpaint.safe({ prompt: "hi", audio: mp3Blob, steps: 50 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta).toMatchObject({ min: 4, max: 8 });
  });

  test("mask bounds are 0–190 seconds", () => {
    const r = stableAudioInpaint.safe({ prompt: "hi", audio: mp3Blob, mask_end: 191 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["mask_end"]);
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const throwing = stableAudioInpaint as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      throwing({ prompt: "hi", audio: mp3Blob, steps: 99 });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});
