import { describe, expect, test } from "bun:test";
import { imageFlux1, FLUX1_DIMENSION_MULTIPLE } from "./image-flux1";
import { BFL_API_BASE_URL } from "./image";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = imageFlux1.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("black-forest-labs.imageFlux1 happy path", () => {
  test("flux-pro-1.1 returns a wire-pure body with the model stripped into the URL", () => {
    const v = imageFlux1({
      model: "flux-pro-1.1",
      prompt: "a lighthouse in a storm",
      width: 1024,
      height: 768,
    });

    expect(Object.keys(v)).toEqual(["prompt", "width", "height"]);
    expect(v.request.url).toBe(`${BFL_API_BASE_URL}/v1/flux-pro-1.1`);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    expect(v.toSdk("black-forest-labs")).toEqual({
      prompt: "a lighthouse in a storm",
      width: 1024,
      height: 768,
    });
  });

  test("flux-dev accepts steps and guidance", () => {
    const r = imageFlux1.safe({ model: "flux-dev", prompt: "hi", steps: 28, guidance: 3 });
    expect(r.ok).toBe(true);
  });

  test("ultra accepts aspect_ratio, raw and image_prompt_strength", () => {
    const r = imageFlux1.safe({
      model: "flux-pro-1.1-ultra",
      prompt: "hi",
      aspect_ratio: "21:9",
      raw: true,
      image_prompt_strength: 0.4,
    });
    expect(r.ok).toBe(true);
  });

  test("unknown route warns but validates", () => {
    const r = safeUnchecked({ model: "flux-pro-2.0", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("unknown_model");
  });
});

describe("black-forest-labs.imageFlux1 per-route param surfaces", () => {
  test("flux-pro-1.1 rejects steps/guidance (FluxPro11Inputs has neither)", () => {
    for (const param of ["steps", "guidance"]) {
      const r = safeUnchecked({ model: "flux-pro-1.1", prompt: "hi", [param]: 3 });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("unsupported_param");
        expect(r.errors[0]?.meta?.source).toContain("FluxPro11Inputs");
      }
    }
  });

  test("the width/height routes reject aspect_ratio, raw and image_prompt_strength", () => {
    for (const model of ["flux-pro-1.1", "flux-dev"]) {
      const r = safeUnchecked({ model, prompt: "hi", aspect_ratio: "16:9" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.code).toBe("unsupported_param");
    }
  });

  test("the ultra route rejects width/height/steps/guidance", () => {
    // Values chosen to be schema-valid so the deny rule, not a bound, fires.
    const cases: Array<[string, number]> = [
      ["width", 512],
      ["height", 512],
      ["steps", 20],
      ["guidance", 3],
    ];
    for (const [param, value] of cases) {
      const r = safeUnchecked({ model: "flux-pro-1.1-ultra", prompt: "hi", [param]: value });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.code).toBe("unsupported_param");
    }
  });

  test("finetune params are denied on the non-finetuned routes", () => {
    const r = safeUnchecked({ model: "flux-pro-1.1-ultra", prompt: "hi", finetune_id: "mine" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("unsupported_param");
  });

  test("the finetuned ultra route requires finetune_id", () => {
    const missing = safeUnchecked({ model: "flux-pro-1.1-ultra-finetuned", prompt: "hi" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]?.path).toEqual(["finetune_id"]);

    const ok = imageFlux1.safe({
      model: "flux-pro-1.1-ultra-finetuned",
      prompt: "hi",
      finetune_id: "my-lora",
      finetune_strength: 1.2,
    });
    expect(ok.ok).toBe(true);
  });
});

describe("black-forest-labs.imageFlux1 dimension rules", () => {
  test("width/height must be multiples of 32", () => {
    expect(FLUX1_DIMENSION_MULTIPLE).toBe(32);
    const r = safeUnchecked({ model: "flux-pro-1.1", prompt: "hi", width: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["width"]);
      expect(r.errors[0]?.meta?.multipleOf).toBe(32);
    }
  });

  test("width/height outside 256–1440 fail", () => {
    for (const width of [128, 1472]) {
      const r = safeUnchecked({ model: "flux-pro-1.1", prompt: "hi", width });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
    }
  });

  test("the documented bounds themselves pass", () => {
    for (const width of [256, 1440]) {
      const r = imageFlux1.safe({ model: "flux-pro-1.1", prompt: "hi", width });
      expect(r.ok).toBe(true);
    }
  });
});

describe("black-forest-labs.imageFlux1 aspect_ratio and guidance bounds", () => {
  test("every BflAspectRatio preset passes on the ultra route", () => {
    // Keep in sync with the BflAspectRatio union in aspect.ts — each named
    // preset must satisfy checkAspectRatioRange ("W:H" between 21:9 and 9:21),
    // or the autocomplete would advertise ratios the API rejects.
    const presets = [
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
    for (const aspect_ratio of presets) {
      const r = imageFlux1.safe({ model: "flux-pro-1.1-ultra", prompt: "hi", aspect_ratio });
      expect(r.ok, `preset ${aspect_ratio} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `preset ${aspect_ratio} should be warning-free`).toEqual([]);
    }
  });

  test("ultra ratios outside 21:9…9:21 fail", () => {
    for (const aspect_ratio of ["22:9", "1:5"] as const) {
      const r = imageFlux1.safe({ model: "flux-pro-1.1-ultra", prompt: "hi", aspect_ratio });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
    }
    // "16x9" is not even assignable to BflAspectRatio any more — that is the
    // point — so the runtime path is reached through the unchecked alias.
    const malformed = safeUnchecked({
      model: "flux-pro-1.1-ultra",
      prompt: "hi",
      aspect_ratio: "16x9",
    });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.errors[0]?.code).toBe("invalid_enum_value");
  });

  test("flux-dev caps guidance at 5 (not FLUX.2 [flex]'s 10)", () => {
    expect(imageFlux1.safe({ model: "flux-dev", prompt: "hi", guidance: 5 }).ok).toBe(true);
    const over = safeUnchecked({ model: "flux-dev", prompt: "hi", guidance: 7 });
    expect(over.ok).toBe(false);
  });

  test("safety_tolerance goes to 6 on FLUX.1 (FLUX.2 caps at 5)", () => {
    expect(imageFlux1.safe({ model: "flux-dev", prompt: "hi", safety_tolerance: 6 }).ok).toBe(true);
    expect(safeUnchecked({ model: "flux-dev", prompt: "hi", safety_tolerance: 7 }).ok).toBe(false);
  });
});

describe("black-forest-labs.imageFlux1 cost estimation", () => {
  test("documented credit prices are used", () => {
    const pro = imageFlux1.safe({ model: "flux-pro-1.1", prompt: "hi" });
    if (pro.ok) expect(pro.estimate.costUSD).toBeCloseTo(0.04, 10);
    const ultra = imageFlux1.safe({ model: "flux-pro-1.1-ultra", prompt: "hi" });
    if (ultra.ok) expect(ultra.estimate.costUSD).toBeCloseTo(0.06, 10);
  });

  test("flux-dev has no published price, so no estimate", () => {
    const r = imageFlux1.safe({ model: "flux-dev", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});
