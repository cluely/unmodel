/**
 * `unmodel/image`, end to end through the ready-made pack.
 *
 * The golden matrix next door pins *what* each provider compiles to; this pins
 * what a caller gets back — that the result is the provider's own `Validated`,
 * with its `.request`, its `.toSdk(…)` and its estimate intact, and that the
 * two escape hatches behave: `providerOptions` merging before validation, and
 * a bound the adapter deliberately did not copy surfacing as the provider's
 * own finding at the canonical path.
 */
import { describe, expect, test } from "bun:test";
import { UnmodelValidationError } from "../../src/core/issues";
import { TranslationUnavailableError } from "../../src/core/translate/errors";
import { createImage, image } from "../../src/unified/image";
import { image as ideogramAdapter } from "../../src/providers/ideogram/unified";
import { image as openaiAdapter } from "../../src/providers/openai/unified";

describe("the pack", () => {
  test("registers exactly the fifteen image providers, sorted", () => {
    expect([...image.providers]).toEqual([
      "black-forest-labs",
      "bria",
      "bytedance",
      "google",
      "ideogram",
      "kling",
      "krea",
      "leonardo",
      "luma",
      "openai",
      "recraft",
      "reve",
      "runway",
      "stability",
      "vidu",
    ]);
  });

  test("a provider outside the pack is structural, not a validation error", () => {
    expect(() => image({ model: "elevenlabs/eleven_v3", prompt: "hi" } as never)).toThrow(
      TranslationUnavailableError,
    );
    const result = image.safe({ model: "elevenlabs/eleven_v3", prompt: "hi" } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.meta).toMatchObject({ structural: true, provider: "elevenlabs" });
  });

  test("a model the adapter does not list warns but still compiles", () => {
    const result = image.safe({ model: "openai/gpt-image-3", prompt: "hi" } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Twice, and correctly so: the kernel checks the ref against the adapter's
    // `models` list, and the provider's own catalog layer checks it again.
    expect(result.warnings.map((issue) => issue.code)).toEqual(["unknown_model", "unknown_model"]);
    expect((result.params as unknown as { model: string }).model).toBe("gpt-image-3");
  });

  test("a hand-built pack contains exactly the adapters it was given", () => {
    const pair = createImage([openaiAdapter, ideogramAdapter]);
    expect([...pair.providers]).toEqual(["ideogram", "openai"]);
    expect(() => pair({ model: "google/imagen-4.0-generate-001", prompt: "hi" } as never)).toThrow(
      TranslationUnavailableError,
    );
  });
});

describe("the result is the provider's own Validated", () => {
  test("openai: JSON body, request line and toSdk", () => {
    const params = image({
      model: "openai/gpt-image-2",
      prompt: "a lighthouse in fog",
      aspectRatio: "16:9",
      resolution: "1k",
      outputFormat: "webp",
    });
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      model: "gpt-image-2",
      prompt: "a lighthouse in fog",
      size: "1360x768",
      output_format: "webp",
    });
    expect(params.request).toEqual({
      url: "https://api.openai.com/v1/images/generations",
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(params.toSdk("openai")).toEqual(JSON.parse(JSON.stringify(params)) as never);
    expect(params.warnings).toEqual([]);
  });

  test("google: the prompt moves into `instances`, the rest into `parameters`", () => {
    const result = image.safe({
      model: "google/imagen-4.0-generate-001",
      prompt: "a lighthouse in fog",
      aspectRatio: "16:9",
      resolution: "2k",
      n: 4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(JSON.stringify(result.params))).toEqual({
      instances: [{ prompt: "a lighthouse in fog" }],
      parameters: { aspectRatio: "16:9", sampleImageSize: "2K", sampleCount: 4 },
    });
    // The model is stripped into the URL — Imagen addresses the model by path.
    const request = result.params as unknown as { request: { url: string } };
    expect(request.request.url).toEndWith("/models/imagen-4.0-generate-001:predict");
  });

  test("the model IS the route at black-forest-labs, both generations", () => {
    const flux2 = image({
      model: "black-forest-labs/flux-2-pro",
      prompt: "a lighthouse",
      dimensions: { width: 1024, height: 768 },
    });
    expect(flux2.request.url).toBe("https://api.bfl.ai/v1/flux-2-pro");
    expect(JSON.parse(JSON.stringify(flux2))).toEqual({
      prompt: "a lighthouse",
      width: 1024,
      height: 768,
    });

    const ultra = image({
      model: "black-forest-labs/flux-pro-1.1-ultra",
      prompt: "a lighthouse",
      aspectRatio: "21:9",
    });
    expect(ultra.request.url).toBe("https://api.bfl.ai/v1/flux-pro-1.1-ultra");
    // S5: the reduced spelling, because one shape gets one spelling.
    expect(JSON.parse(JSON.stringify(ultra))).toEqual({
      prompt: "a lighthouse",
      aspect_ratio: "7:3",
    });
  });

  test("one ref chooses the route AND a wire param at ideogram", () => {
    const quality = image({ model: "ideogram/ideogram-3.0-quality", prompt: "hi" });
    expect(quality.request.url).toBe("https://api.ideogram.ai/v1/ideogram-v3/generate");
    expect(JSON.parse(JSON.stringify(quality))).toEqual({
      prompt: "hi",
      rendering_speed: "QUALITY",
    });
    const turbo = image({ model: "ideogram/ideogram-4.0-turbo", prompt: "hi" });
    expect(turbo.request.url).toBe("https://api.ideogram.ai/v1/ideogram-v4/generate");
    // 4.0's prompt field is `text_prompt`, not `prompt`.
    expect(JSON.parse(JSON.stringify(turbo))).toEqual({
      text_prompt: "hi",
      rendering_speed: "TURBO",
    });
  });

  test("the estimate rides through from the provider's own pricing", () => {
    const result = image.safe({
      model: "stability/stable-image-ultra",
      prompt: "a lighthouse in fog",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate.costUSD).toBeGreaterThan(0);
  });
});

describe("providerOptions", () => {
  test("deep-merges over the compiled body before validation", () => {
    const params = image({
      model: "leonardo/lucid-origin",
      prompt: "a lighthouse in fog",
      aspectRatio: "16:9",
      providerOptions: {
        // A nested override merges key-by-key: `width` and `height` survive.
        leonardo: { parameters: { mode: "ULTRA" }, apiKey: undefined },
      },
    });
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      model: "lucid-origin",
      parameters: {
        prompt: "a lighthouse in fog",
        width: 1360,
        height: 768,
        mode: "ULTRA",
      },
    });
  });

  test("an override wins over the compiled value, and is validated like it", () => {
    const params = image({
      model: "openai/gpt-image-1",
      prompt: "a lighthouse in fog",
      aspectRatio: "1:1",
      providerOptions: { openai: { size: "1536x1024", quality: "high" } },
    });
    expect(JSON.parse(JSON.stringify(params))).toMatchObject({
      size: "1536x1024",
      quality: "high",
    });
  });

  test("a block for another provider is ignored", () => {
    const params = image({
      model: "openai/gpt-image-1",
      prompt: "a lighthouse in fog",
      providerOptions: { google: { parameters: { personGeneration: "allow_all" } } },
    });
    expect(Object.hasOwn(params, "parameters")).toBe(false);
  });

  test("an override the provider rejects says where it came from", () => {
    const result = image.safe({
      model: "openai/gpt-image-1",
      prompt: "a lighthouse in fog",
      providerOptions: { openai: { size: "3000x3000" } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // `size` and not `aspectRatio`: the caller wrote the wire key themselves,
    // so the adapter's declared provenance for it does not apply.
    expect(result.errors[0]!.path).toEqual(["size"]);
    expect(result.errors[0]!.message).toEndWith("(supplied via `providerOptions`)");
  });

  test("the escape hatch reaches a required field the vocabulary cannot express", () => {
    // Vidu's viduq1 requires at least one reference image, which `image()` has
    // no word for. The adapter says so — and says how — rather than compiling
    // a request that cannot work.
    const refused = image.safe({ model: "vidu/viduq1", prompt: "a lighthouse" });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors[0]!.path).toEqual(["model"]);

    const supplied = image.safe({
      model: "vidu/viduq1",
      prompt: "a lighthouse",
      aspectRatio: "16:9",
      providerOptions: { vidu: { images: ["https://example.com/ref.png"] } },
    });
    expect(supplied.ok, JSON.stringify(supplied.ok ? [] : supplied.errors)).toBe(true);
    if (!supplied.ok) return;
    expect(JSON.parse(JSON.stringify(supplied.params))).toMatchObject({
      images: ["https://example.com/ref.png"],
      aspect_ratio: "16:9",
    });
  });
});

describe("bounds the adapter did not copy surface as the provider's own finding", () => {
  /**
   * The point of these: a bound that exists in a provider's validator is NOT
   * restated in its adapter, so there is exactly one copy of it. What the
   * adapter owes the caller is the *path* — the finding has to arrive at the
   * canonical field, not at a wire param they never wrote.
   */
  test("gpt-image-2's free-form size rules, reported at `dimensions`", () => {
    const result = image.safe({
      model: "openai/gpt-image-2",
      prompt: "a lighthouse in fog",
      dimensions: { width: 1000, height: 1000 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({
      code: "invalid_enum_value",
      path: ["dimensions"],
      meta: { violations: ["divisible_by_16"] },
    });
    // The wire name is quoted, so the bug report writes itself.
    expect(result.errors[0]!.message).toEndWith("(compiled from `size`)");
  });

  test("leonardo's per-model dimension cap, reported at `aspectRatio`", () => {
    const result = image.safe({
      model: "leonardo/phoenix-v1.0",
      prompt: "a lighthouse in fog",
      aspectRatio: "16:9",
      resolution: "4k",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toEqual(["aspectRatio"]);
    expect(result.errors[0]!.message).toContain("2048");
  });

  test("a canonical-space failure stops before the provider validator runs", () => {
    const result = image.safe({
      model: "google/imagen-4.0-generate-001",
      prompt: "a lighthouse in fog",
      dimensions: { width: 1024, height: 1024 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((issue) => issue.code)).toEqual(["unsupported_param"]);
    expect(result.errors[0]!.path).toEqual(["dimensions"]);
  });

  test("a tier beside explicit pixels is refused, never ignored", () => {
    // The one overlap `resolveSizing` does not own: at a provider whose size
    // field takes pixels, `dimensions` has already said everything a tier
    // could, and the two can disagree.
    for (const model of [
      "openai/gpt-image-2",
      "black-forest-labs/flux-2-pro",
      "leonardo/lucid-origin",
      "bytedance/seedream-4-0-250828",
      "recraft/recraftv4_1",
      "ideogram/ideogram-3.0-quality",
    ]) {
      const result = image.safe({
        model,
        prompt: "hi",
        dimensions: { width: 1344, height: 768 },
        resolution: "4k",
      } as never);
      expect(result.ok, model).toBe(false);
      if (result.ok) continue;
      expect(result.errors[0], model).toMatchObject({
        code: "invalid_shape",
        path: ["resolution"],
      });
    }
  });

  test("a ratio no provider enum has is an error naming that provider's list", () => {
    const result = image.safe({
      model: "google/imagen-4.0-generate-001",
      prompt: "a lighthouse in fog",
      aspectRatio: "21:9",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({
      code: "invalid_enum_value",
      path: ["aspectRatio"],
    });
    expect(result.errors[0]!.meta).toMatchObject({ allowed: ["1:1", "3:4", "4:3", "9:16", "16:9"] });
  });
});

describe("the throwing form", () => {
  test("throws UnmodelValidationError labelled with the category", () => {
    expect(() => image({ model: "openai/gpt-image-1", prompt: "hi", seed: 3 })).toThrow(
      UnmodelValidationError,
    );
    try {
      image({ model: "openai/gpt-image-1", prompt: "hi", seed: 3 });
    } catch (error) {
      expect((error as Error).message).toContain("unmodel/image");
      expect((error as UnmodelValidationError).issues[0]!.path).toEqual(["seed"]);
    }
  });
});
