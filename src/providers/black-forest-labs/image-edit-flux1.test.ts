import { describe, expect, test } from "bun:test";
import { imageEditFill, imageEditExpand } from "./image-edit-flux1";
import { BFL_API_BASE_URL } from "./image";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeFill = imageEditFill.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;
const safeExpand = imageEditExpand.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("black-forest-labs.imageEditFill", () => {
  test("returns a wire-pure body with the model stripped into the URL", () => {
    const v = imageEditFill({
      model: "flux-pro-1.0-fill",
      image: "data:image/png;base64,aaa",
      mask: "data:image/png;base64,bbb",
      prompt: "a bunch of sunflowers in the vase",
    });
    expect(Object.keys(v)).toEqual(["image", "mask", "prompt"]);
    expect(v.request.url).toBe(`${BFL_API_BASE_URL}/v1/flux-pro-1.0-fill`);
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("guidance runs 1.5–100 on the editing routes (not the 1.5–10 of flux-2-flex)", () => {
    expect(safeFill({ model: "flux-pro-1.0-fill", image: "x", guidance: 60 }).ok).toBe(true);
    expect(safeFill({ model: "flux-pro-1.0-fill", image: "x", guidance: 100 }).ok).toBe(true);
    expect(safeFill({ model: "flux-pro-1.0-fill", image: "x", guidance: 101 }).ok).toBe(false);
    expect(safeFill({ model: "flux-pro-1.0-fill", image: "x", guidance: 1 }).ok).toBe(false);
  });

  test("steps start at 15 on the editing routes", () => {
    expect(safeFill({ model: "flux-pro-1.0-fill", image: "x", steps: 15 }).ok).toBe(true);
    const low = safeFill({ model: "flux-pro-1.0-fill", image: "x", steps: 10 });
    expect(low.ok).toBe(false);
    if (!low.ok) expect(low.errors[0]?.code).toBe("invalid_shape");
  });

  test("image is required", () => {
    const r = safeFill({ model: "flux-pro-1.0-fill", prompt: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["image"]);
  });

  test("the finetuned route requires finetune_id; the base route rejects it", () => {
    const missing = safeFill({ model: "flux-pro-1.0-fill-finetuned", image: "x" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]?.path).toEqual(["finetune_id"]);

    const ok = imageEditFill.safe({
      model: "flux-pro-1.0-fill-finetuned",
      image: "x",
      finetune_id: "my-lora",
    });
    expect(ok.ok).toBe(true);

    const denied = safeFill({ model: "flux-pro-1.0-fill", image: "x", finetune_id: "my-lora" });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.errors[0]?.code).toBe("unsupported_param");
  });

  test("an unknown fill model warns but validates", () => {
    const r = safeFill({ model: "flux-pro-1.0-fill-vNEXT", image: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("fill is $0.05 per image (5 credits)", () => {
    const r = imageEditFill.safe({ model: "flux-pro-1.0-fill", image: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.05, 10);
  });
});

describe("black-forest-labs.imageEditExpand", () => {
  test("defaults to the single documented expand route", () => {
    const v = imageEditExpand({ image: "data:image/png;base64,aaa", top: 256 });
    expect(Object.keys(v)).toEqual(["image", "top"]);
    expect(v.request.url).toBe(`${BFL_API_BASE_URL}/v1/flux-pro-1.0-expand`);
  });

  test("per-side margins are capped at 2048", () => {
    expect(safeExpand({ image: "x", left: 2048 }).ok).toBe(true);
    const over = safeExpand({ image: "x", left: 2049 });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors[0]?.code).toBe("invalid_shape");
  });

  test("a request that expands nothing is rejected", () => {
    const r = safeExpand({ image: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("at least one of");
  });

  test("an unknown expand model warns but validates", () => {
    const r = safeExpand({ model: "flux-pro-1.0-expand-vNEXT", image: "x", left: 10 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("expand has no published price, so no estimate", () => {
    const r = imageEditExpand.safe({ image: "x", right: 100 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});
