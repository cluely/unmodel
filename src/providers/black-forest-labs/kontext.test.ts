import { describe, expect, test } from "bun:test";
import { fluxKontext } from "./kontext";
import { BFL_API_BASE_URL } from "./flux2";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = fluxKontext.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

/**
 * The named arms of the `BflAspectRatio` union in aspect.ts — kept in sync by
 * hand so the runtime rule and the autocomplete cannot drift apart.
 */
const BFL_ASPECT_RATIO_PRESETS = [
  "21:9",
  "2:1",
  "16:9",
  "3:2",
  "4:3",
  "5:4",
  "1:1",
  "4:5",
  "3:4",
  "2:3",
  "9:16",
  "1:2",
  "9:21",
] as const;

describe("black-forest-labs.fluxKontext happy path", () => {
  test("returns a wire-pure body with the model stripped into the URL", () => {
    const v = fluxKontext({
      model: "flux-kontext-max",
      prompt: "replace the sky with a thunderstorm",
      input_image: "data:image/png;base64,xxxx",
      aspect_ratio: "16:9",
      prompt_upsampling: true,
    });

    expect(Object.keys(v)).toEqual([
      "prompt",
      "input_image",
      "aspect_ratio",
      "prompt_upsampling",
    ]);
    expect(v.request.url).toBe(`${BFL_API_BASE_URL}/v1/flux-kontext-max`);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    expect(v.toSdk("black-forest-labs")).toEqual({
      prompt: "replace the sky with a thunderstorm",
      input_image: "data:image/png;base64,xxxx",
      aspect_ratio: "16:9",
      prompt_upsampling: true,
    });
  });

  test("kontext allows safety_tolerance up to 6 (unlike flux-2's 0–5)", () => {
    const ok = fluxKontext.safe({ model: "flux-kontext-pro", prompt: "hi", safety_tolerance: 6 });
    expect(ok.ok).toBe(true);
    const bad = safeUnchecked({ model: "flux-kontext-pro", prompt: "hi", safety_tolerance: 7 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]?.code).toBe("invalid_shape");
  });

  test("text-to-image use (no input_image) passes", () => {
    const r = fluxKontext.safe({ model: "flux-kontext-pro", prompt: "a red door" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("explicit nulls pass", () => {
    const r = fluxKontext.safe({
      model: "flux-kontext-pro",
      prompt: "hi",
      input_image: null,
      aspect_ratio: null,
      seed: null,
      output_format: null,
    });
    expect(r.ok).toBe(true);
  });

  test("unknown kontext model warns but validates", () => {
    const r = fluxKontext.safe({ model: "flux-kontext-ultra", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});

describe("black-forest-labs.fluxKontext aspect_ratio", () => {
  test("every BflAspectRatio preset passes the runtime rule it advertises", () => {
    // Keep in sync with the BflAspectRatio union in aspect.ts — each named
    // preset must satisfy checkAspectRatioRange ("W:H" between 21:9 and 9:21),
    // or the autocomplete would advertise ratios the API rejects.
    for (const aspect_ratio of BFL_ASPECT_RATIO_PRESETS) {
      const r = fluxKontext.safe({ model: "flux-kontext-pro", prompt: "hi", aspect_ratio });
      expect(r.ok, `preset ${aspect_ratio} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `preset ${aspect_ratio} should be warning-free`).toEqual([]);
    }
  });

  test("free-form ratios inside the documented range still pass", () => {
    for (const aspect_ratio of ["7:3", "10:16"] as const) {
      const r = fluxKontext.safe({ model: "flux-kontext-pro", prompt: "hi", aspect_ratio });
      expect(r.ok).toBe(true);
    }
  });

  test("ratios wider than 21:9 or taller than 9:21 fail", () => {
    for (const aspect_ratio of ["22:9", "5:1", "1:5"] as const) {
      const r = fluxKontext.safe({ model: "flux-kontext-pro", prompt: "hi", aspect_ratio });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("invalid_enum_value");
        expect(r.errors[0]?.path).toEqual(["aspect_ratio"]);
      }
    }
  });

  test("malformed ratios fail", () => {
    // Not assignable to BflAspectRatio any more (that is the point) — the
    // runtime path stays reachable for callers who ignore the types.
    for (const ratio of ["wide", "16x9", "16:", "0:1"]) {
      const r = safeUnchecked({ model: "flux-kontext-pro", prompt: "hi", aspect_ratio: ratio });
      expect(r.ok).toBe(false);
    }
  });
});

describe("black-forest-labs.fluxKontext cost estimation", () => {
  test("kontext pro is $0.04 and max is $0.08 per image", () => {
    const pro = fluxKontext.safe({ model: "flux-kontext-pro", prompt: "hi" });
    expect(pro.ok).toBe(true);
    if (pro.ok) expect(pro.estimate.costUSD).toBeCloseTo(0.04, 10);
    const max = fluxKontext.safe({ model: "flux-kontext-max", prompt: "hi" });
    expect(max.ok).toBe(true);
    if (max.ok) expect(max.estimate.costUSD).toBeCloseTo(0.08, 10);
  });

  test("maxCostUSD under the estimate is over_budget", () => {
    const r = fluxKontext.safe(
      { model: "flux-kontext-max", prompt: "hi" },
      { maxCostUSD: 0.05 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });
});
