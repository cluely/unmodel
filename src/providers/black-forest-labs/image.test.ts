import { describe, expect, test } from "bun:test";
import { image, bflModelUrl, BFL_API_BASE_URL, BFL_GET_RESULT_URL } from "./image";
import { models } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = image.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("black-forest-labs.image happy path", () => {
  test("returns a wire-pure body with the model stripped into the URL", () => {
    const v = image({
      model: "flux-2-pro",
      prompt: "a tiny cabin in a snowy forest",
      width: 1024,
      height: 768,
      seed: 42,
    });

    // model is a route selector, not a body field.
    expect(Object.keys(v)).toEqual(["prompt", "width", "height", "seed"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual({
      prompt: "a tiny cabin in a snowy forest",
      width: 1024,
      height: 768,
      seed: 42,
    });

    expect(v.request.url).toBe(`${BFL_API_BASE_URL}/v1/flux-2-pro`);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("toSdk returns the wire body unchanged (no official SDK)", () => {
    const v = image({ model: "flux-2-max", prompt: "hi", disable_pup: true });
    expect(v.toSdk("black-forest-labs")).toEqual({ prompt: "hi", disable_pup: true });
  });

  test("each catalog model maps to its own route", () => {
    for (const id of Object.keys(models).filter((m) => m.startsWith("flux-2"))) {
      const r = safeUnchecked({ model: id, prompt: "hi" });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const request = (r.params as { request: { url: string } }).request;
        expect(request.url).toBe(`${BFL_API_BASE_URL}/v1/${id}`);
      }
    }
    expect(bflModelUrl("flux-2-pro")).toBe(`${BFL_API_BASE_URL}/v1/flux-2-pro`);
    expect(BFL_GET_RESULT_URL).toBe(`${BFL_API_BASE_URL}/v1/get_result`);
  });

  test("flex accepts guidance, steps, prompt_upsampling and blob path", () => {
    const r = image.safe({
      model: "flux-2-flex",
      prompt: "hi",
      prompt_upsampling: false,
      guidance: 7.5,
      steps: 28,
      input_image_blob_path: "blobs/ref.png",
      input_image_8: "data:image/png;base64,xxxx",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("explicit null means provider default and passes deny rules", () => {
    // Deny rules are null-tolerant: null = unset on this API.
    const r = safeUnchecked({
      model: "flux-2-pro",
      prompt: "hi",
      guidance: null,
      steps: null,
      prompt_upsampling: null,
      seed: null,
      width: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown model warns but validates and still routes by id", () => {
    const r = safeUnchecked({ model: "flux-9-mega", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      const request = (r.params as { request: { url: string } }).request;
      expect(request.url).toBe(`${BFL_API_BASE_URL}/v1/flux-9-mega`);
    }
  });

  test("preview routes warn as beta-free known models with no estimate", () => {
    const r = image.safe({ model: "flux-2-pro-preview", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(r.estimate.costUSD).toBeUndefined();
    }
  });

  test("unknown top-level params warn", () => {
    const r = safeUnchecked({ model: "flux-2-pro", prompt: "hi", brand_new_param: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const unknown = r.warnings.find((w) => w.code === "unknown_param");
      expect(unknown?.path).toEqual(["brand_new_param"]);
    }
  });
});

describe("black-forest-labs.image per-route param enforcement", () => {
  test("guidance/steps on flux-2-pro are unsupported_param", () => {
    const r = safeUnchecked({ model: "flux-2-pro", prompt: "hi", guidance: 5, steps: 30 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code)).toEqual(["unsupported_param", "unsupported_param"]);
      expect(r.errors.map((e) => e.path[0])).toEqual(["guidance", "steps"]);
      expect(String(r.errors[0]?.meta?.source)).toContain("api.bfl.ai/openapi.json");
    }
  });

  test("prompt_upsampling on flux-2-max is unsupported_param", () => {
    const r = safeUnchecked({ model: "flux-2-max", prompt: "hi", prompt_upsampling: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["prompt_upsampling"]);
  });

  test("disable_pup on flux-2-flex is unsupported_param", () => {
    const r = safeUnchecked({ model: "flux-2-flex", prompt: "hi", disable_pup: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["disable_pup"]);
    }
  });

  test("klein rejects a fifth input image and flex-only knobs", () => {
    const r = safeUnchecked({
      model: "flux-2-klein-9b",
      prompt: "hi",
      input_image_5: "data:image/png;base64,xxxx",
      steps: 20,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path[0]).sort()).toEqual(["input_image_5", "steps"]);
    }
  });

  test("klein accepts four input images", () => {
    const r = image.safe({
      model: "flux-2-klein-4b",
      prompt: "hi",
      input_image: "a",
      input_image_2: "b",
      input_image_3: "c",
      input_image_4: "d",
    });
    expect(r.ok).toBe(true);
  });

  test("constraintsFor exposes the deny table", () => {
    const deny = image.constraintsFor("flux-2-klein-4b")[0]?.deny;
    expect(deny?.input_image_5?.reason).toContain("at most 4 input images");
    expect(deny?.input_image_5?.source).toContain("api.bfl.ai");
  });
});

describe("black-forest-labs.image shape", () => {
  test("safety_tolerance above 5 is invalid_shape on flux-2 routes", () => {
    const r = safeUnchecked({ model: "flux-2-pro", prompt: "hi", safety_tolerance: 6 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("width below 64 is invalid_shape", () => {
    const r = safeUnchecked({ model: "flux-2-pro", prompt: "hi", width: 32 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["width"]);
    }
  });

  test("undocumented output_format is invalid_shape", () => {
    const r = safeUnchecked({ model: "flux-2-pro", prompt: "hi", output_format: "avif" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["output_format"]);
  });

  test("guidance outside 1.5–10 is invalid_shape on flex", () => {
    const r = safeUnchecked({ model: "flux-2-flex", prompt: "hi", guidance: 12 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["guidance"]);
  });

  test("missing prompt is invalid_shape and the throwing form throws", () => {
    const throwing = image as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      throwing({ model: "flux-2-pro" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("black-forest-labs.image cost estimation", () => {
  test("estimates the documented 1MP base price per model", () => {
    const cases: Array<[string, number]> = [
      ["flux-2-max", 0.07],
      ["flux-2-pro", 0.03],
      ["flux-2-flex", 0.05],
      ["flux-2-klein-9b", 0.015],
      ["flux-2-klein-4b", 0.014],
    ];
    for (const [model, price] of cases) {
      const r = safeUnchecked({ model, prompt: "hi" });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(price, 10);
    }
  });

  test("maxCostUSD under the estimate is over_budget", () => {
    const r = image.safe({ model: "flux-2-max", prompt: "hi" }, { maxCostUSD: 0.05 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });
});
