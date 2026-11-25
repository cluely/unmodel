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
import { image as ideogramAdapter } from "../../src/providers/ideogram/unified-image";
import { image as openaiAdapter } from "../../src/providers/openai/unified";

describe("the pack", () => {
  test("registers exactly the nineteen image providers, sorted", () => {
    expect([...image.providers]).toEqual([
      "black-forest-labs",
      "bria",
      "bytedance",
      // fal is a QUEUE in front of many vendors rather than a vendor, so some
      // of its refs are second routes to models another adapter here also
      // serves. Both belong: they are different endpoints, with different
      // bodies, prices and keys.
      "fal",
      "google",
      "higgsfield",
      "ideogram",
      "kling",
      "krea",
      "leonardo",
      "luma",
      "openai",
      "recraft",
      "revana",
      "reve",
      "runway",
      "stability",
      "vidu",
      "xai",
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
      model: "openai/gpt-image-1.5",
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
      model: "openai/gpt-image-1.5",
      prompt: "a lighthouse in fog",
      providerOptions: { google: { parameters: { personGeneration: "allow_all" } } },
    });
    expect(Object.hasOwn(params, "parameters")).toBe(false);
  });

  test("an override the provider rejects says where it came from", () => {
    const result = image.safe({
      model: "openai/gpt-image-1.5",
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

  test("runway's per-model outputFormat enum, reported at `outputFormat`", () => {
    // WebP reaches the wire — muse_image returns it — and seedream5_pro's own
    // png/jpeg enum is what refuses it there.
    const muse = image({
      model: "runway/muse_image",
      prompt: "a lighthouse in fog",
      outputFormat: "webp",
    }) as unknown as Record<string, unknown>;
    expect(muse["outputFormat"]).toBe("webp");
    const seedream = image.safe({
      model: "runway/seedream5_pro",
      prompt: "a lighthouse in fog",
      outputFormat: "webp",
    });
    expect(seedream.ok).toBe(false);
    if (seedream.ok) return;
    expect(seedream.errors[0]).toMatchObject({ code: "invalid_enum_value", path: ["outputFormat"] });
  });

  test("runway's seedream5_lite takes freeform dimensions verbatim, inside its pixel range", () => {
    const result = image.safe({
      model: "runway/seedream5_lite",
      prompt: "a lighthouse in fog",
      dimensions: { width: 3000, height: 2000 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.params as unknown as Record<string, unknown>)["ratio"]).toBe("3000:2000");
    expect(result.params.warnings).toEqual([]);
  });

  test("runway's optional-ratio arms get no invented size when none was asked for", () => {
    const result = image.safe({ model: "runway/ideogram_4_0", prompt: "a lighthouse in fog" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("ratio" in (result.params as unknown as Record<string, unknown>)).toBe(false);
    expect(result.params.warnings).toEqual([]);
  });

  test("leonardo's per-model dimension cap, reported at `aspectRatio`", () => {
    // `as never`: Phoenix's `tiers` is `["1k", "2k"]`, so `"4k"` no longer
    // compiles — the narrowing catching this at the call site is the point,
    // and the runtime half still has to answer for JavaScript callers.
    const result = image.safe({
      model: "leonardo/phoenix-v1.0",
      prompt: "a lighthouse in fog",
      aspectRatio: "16:9",
      resolution: "4k",
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toEqual(["aspectRatio"]);
    expect(result.errors[0]!.message).toContain("2048");
  });

  test("leonardo's negativePrompt reaches the models that take it, and names them where it cannot", () => {
    const params = image({
      model: "leonardo/kino-xl",
      prompt: "a lighthouse in fog",
      negativePrompt: "blurry",
    });
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      model: "kino-xl",
      parameters: { prompt: "a lighthouse in fog", negative_prompt: "blurry" },
    });

    const refused = image.safe({
      model: "leonardo/lucid-origin",
      prompt: "a lighthouse in fog",
      negativePrompt: "blurry",
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.errors[0]!.path).toEqual(["negativePrompt"]);
    expect(refused.errors[0]!.message).toContain("leonardo/phoenix-v1.0");
    expect(refused.errors[0]!.message).toContain("leonardo/kino-xl");
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
    // `as never` because the per-model narrowing now types `aspectRatio` from
    // Imagen's own five-value enum, so `"21:9"` no longer compiles here — which
    // is the point of the narrowing, and exactly why the runtime half still
    // has to be checked: a JavaScript caller reaches this branch.
    const result = image.safe({
      model: "google/imagen-4.0-generate-001",
      prompt: "a lighthouse in fog",
      aspectRatio: "21:9",
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({
      code: "invalid_enum_value",
      path: ["aspectRatio"],
    });
    expect(result.errors[0]!.meta).toMatchObject({ allowed: ["1:1", "3:4", "4:3", "9:16", "16:9"] });
  });
});

describe("`size`, the third spelling of one decision", () => {
  test("any two of the three is `invalid_shape` naming both", () => {
    const pairs: Array<Record<string, unknown>> = [
      { size: "1024x1024", aspectRatio: "1:1" },
      { size: "1024x1024", dimensions: { width: 1024, height: 1024 } },
      { aspectRatio: "1:1", dimensions: { width: 1024, height: 1024 } },
    ];
    for (const pair of pairs) {
      const result = image.safe({
        model: "openai/gpt-image-2",
        prompt: "a lighthouse in fog",
        ...pair,
      } as never);
      expect(result.ok, JSON.stringify(pair)).toBe(false);
      if (result.ok) continue;
      expect(result.errors[0]!.code).toBe("invalid_shape");
      for (const field of Object.keys(pair)) {
        expect(result.errors[0]!.message, field).toContain(field);
      }
    }
  });

  test("a tier beside a size is refused, naming `size` rather than `dimensions`", () => {
    // `size` carries the pixel count itself, so `resolution` has nothing left
    // to say and could only contradict it — the same rule `dimensions` meets,
    // with the message pointed at the word the caller actually wrote.
    const result = image.safe({
      model: "openai/gpt-image-2",
      prompt: "a lighthouse in fog",
      size: "1024x1024",
      resolution: "2k",
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ code: "invalid_shape", path: ["resolution"] });
    expect(result.errors[0]!.message).toContain("`size`");
    expect(result.errors[0]!.message).not.toContain("`dimensions`");
  });

  test("a free-form preset the rules refuse is the provider's own error", () => {
    // `"1920x1080"` COMPILES — gpt-image-2's `size` is free-form, so the type
    // carries a `${number}x${number}` tail beside the presets and a tail
    // cannot encode "both edges divisible by 16". 1080 is not, which is
    // exactly why it is absent from `GPT_IMAGE_2_SIZES`. The runtime refusal
    // is the other half of that promise, and it is `checkGptImage2Size` — the
    // same check a hand-written call meets.
    const result = image.safe({
      model: "openai/gpt-image-2",
      prompt: "a lighthouse in fog",
      size: "1920x1080",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ code: "invalid_enum_value", path: ["size"] });
    expect(result.errors[0]!.message).toContain("16");
    // …while the preset that IS on the list compiles, verbatim.
    const ok = image.safe({
      model: "openai/gpt-image-2",
      prompt: "a lighthouse in fog",
      size: "2560x1440",
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.params).toMatchObject({ size: "2560x1440" });
  });

  test("a size outside a closed enum is refused by that model's own list", () => {
    const result = image.safe({
      model: "openai/dall-e-3",
      prompt: "a lighthouse in fog",
      size: "1920x1080",
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toEqual(["size"]);
  });

  test("a non-pixel literal is checked against the model's declared list", () => {
    expect(
      image.safe({ model: "openai/gpt-image-2", prompt: "hi", size: "auto" }).ok,
    ).toBe(true);
    const bogus = image.safe({
      model: "openai/gpt-image-2",
      prompt: "hi",
      size: "enormous",
    } as never);
    expect(bogus.ok).toBe(false);
    if (bogus.ok) return;
    expect(bogus.errors[0]).toMatchObject({ code: "invalid_enum_value", path: ["size"] });
    expect(bogus.errors[0]!.message).toContain('"auto"');
  });

  test("at a shape-only provider a size becomes the shape, and always warns", () => {
    // S1: the ratio is expressible, the pixel count is not. Same
    // `pixelsToRatio` the `dimensions` arm uses — with the warning pointed at
    // `size`, because that is the word that was written.
    const result = image.safe({
      model: "stability/stable-image-ultra",
      prompt: "a lighthouse in fog",
      size: "1920x1080",
    } as never);
    expect(result.ok, result.ok ? "" : JSON.stringify(result.errors)).toBe(true);
    if (!result.ok) return;
    expect(result.params).toMatchObject({ aspect_ratio: "16:9" });
    const warnings = (result.params as unknown as { warnings: readonly { code: string; path: unknown[] }[] })
      .warnings;
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: "approximated_param", path: ["size"] });
  });

  test("a size no shape on the model matches is `unsupported_param`, not a snap", () => {
    const result = image.safe({
      model: "stability/stable-image-ultra",
      prompt: "a lighthouse in fog",
      // 4:1 — wider than 21:9, Stability's widest, by more than 2%.
      size: "1200x300",
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ code: "unsupported_param", path: ["size"] });
  });
});

// ---------------------------------------------------------------------------
// revana — a shape and a tier under `input`, and no pixel field
// ---------------------------------------------------------------------------

describe("revana: a picture is sized by shape and by tier", () => {
  const body = (params: Record<string, unknown>): unknown =>
    JSON.parse(JSON.stringify(image(params as never)));

  test("every canonical word lands under `input`, the tier in the catalog's spelling", () => {
    expect(
      body({
        model: "revana/nano-banana-pro",
        prompt: "a red fox in snow",
        aspectRatio: "16:9",
        resolution: "2k",
        n: 2,
        seed: 7,
      }),
    ).toEqual({
      model: "nano-banana-pro",
      input: {
        prompt: "a red fox in snow",
        aspect_ratio: "16:9",
        resolution: "2K",
        num_images: 2,
        seed: 7,
      },
    });
  });

  test("a shape is sent in the catalog's own spelling — the API matches the list as strings", () => {
    // `1.5:1` IS 3:2, and the API refuses it where `3:2` is listed.
    expect(body({ model: "revana/gpt-image-1", prompt: "a fox", aspectRatio: "1.5:1" })).toEqual({
      model: "gpt-image-1",
      input: { prompt: "a fox", aspect_ratio: "3:2" },
    });
  });

  test("a model that lists no shapes takes the ratio as written", () => {
    expect(body({ model: "revana/ideogram-v3", prompt: "a fox", aspectRatio: "5:4" })).toEqual({
      model: "ideogram-v3",
      input: { prompt: "a fox", aspect_ratio: "5:4" },
    });
  });

  test("pixels beside a tier are complementary here: the shape and the size both go", () => {
    const result = image.safe({
      model: "revana/nano-banana-pro",
      prompt: "a fox",
      dimensions: { width: 1920, height: 1080 },
      resolution: "4k",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(JSON.stringify(result.params))).toEqual({
      model: "nano-banana-pro",
      input: { prompt: "a fox", aspect_ratio: "16:9", resolution: "4K" },
    });
    expect(result.params.warnings.map((warning) => [warning.code, warning.path])).toEqual([
      ["approximated_param", ["dimensions"]],
    ]);
  });

  test("a tier the model does not list is refused, and its own sizes are named reachable", () => {
    // `seedream-5.0-pro` lists 1K and 2K.
    const result = image.safe({
      model: "revana/seedream-5.0-pro",
      prompt: "a fox",
      resolution: "4k",
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({
      code: "invalid_enum_value",
      path: ["resolution"],
      meta: { allowed: ["1k", "2k"], value: "4k" },
    });
    expect(result.errors[0]!.message).toContain("providerOptions.revana.input.resolution");
  });

  test("the model's own `max_images` is `revana.image`'s finding, at `n`", () => {
    const result = image.safe({ model: "revana/imagen-4", prompt: "a fox", n: 5 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ code: "invalid_enum_value", path: ["n"] });
    expect(result.errors[0]!.message).toContain("must be 1 to 4");
  });

  test("`outputFormat` and `outputDelivery` are declared gaps that say what Revana does", () => {
    const format = image.safe({ model: "revana/imagen-4", prompt: "a fox", outputFormat: "png" });
    expect(format.ok).toBe(false);
    if (format.ok) return;
    expect(format.errors[0]).toMatchObject({ code: "unsupported_param", path: ["outputFormat"] });
    expect(format.errors[0]!.message).toContain("`output.urls` lists the finished files");

    const delivery = image.safe({ model: "revana/imagen-4", prompt: "a fox", outputDelivery: "url" });
    expect(delivery.ok).toBe(false);
    if (delivery.ok) return;
    expect(delivery.errors[0]).toMatchObject({ code: "unsupported_param", path: ["outputDelivery"] });
    expect(delivery.errors[0]!.message).toContain("queued `Generation`");
  });

  test("the upscaler is not an image ref: it warns, and `revana.image` says what it takes", () => {
    const result = image.safe({ model: "revana/recraft-crisp-upscale", prompt: "a fox" } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.warnings.map((issue) => issue.code)).toEqual(["unknown_model"]);
    expect(result.errors[0]!.message).toContain("It takes: `input.image_url`; `input.video_url`.");
  });

  test("the result is `revana.image`'s Validated, priced per picture", () => {
    const request = { model: "revana/nano-banana-pro", prompt: "a fox", resolution: "4k", n: 2 } as const;
    const params = image(request);
    expect(params.request.url).toBe("https://api.revana.si/v1/generations");
    expect(params.toSdk("revana")).toEqual(JSON.parse(JSON.stringify(params)));
    // Two pictures at the listed 4K rate — what the quote endpoint answered
    // for one (`test/fixtures/revana/quote-oracle.json`, `res-ok`), twice.
    const safe = image.safe(request);
    expect(safe.ok && safe.estimate?.costUSD).toBeCloseTo(0.16, 6);
  });
});

// ---------------------------------------------------------------------------
// higgsfield — a route for a ref, and every refusal read off that route's row
// ---------------------------------------------------------------------------

describe("higgsfield: the route's own row decides every word", () => {
  const body = (params: Record<string, unknown>): unknown =>
    JSON.parse(JSON.stringify(image(params as never)));
  const refused = (params: Record<string, unknown>): { code: string; path: unknown[]; message: string } => {
    const result = image.safe(params as never);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.errors.length).toBe(1);
    return result.errors[0]!;
  };

  test("Soul: a count is `batch_size`, and the route id is the URL path", () => {
    const params = image({
      model: "higgsfield/higgsfield-ai/soul/standard",
      prompt: "a red fox in snow",
      aspectRatio: "16:9",
      n: 4,
      seed: 7,
    });
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      prompt: "a red fox in snow",
      aspect_ratio: "16:9",
      batch_size: 4,
      seed: 7,
    });
    expect(params.request.url).toBe("https://api.higgsfield.ai/higgsfield-ai/soul/standard");
    expect(params.toSdk("higgsfield")).toEqual({ input: JSON.parse(JSON.stringify(params)) });
  });

  test("Soul renders 1 or 4: a 2 is the route's own finding, at `n`", () => {
    const issue = refused({ model: "higgsfield/higgsfield-ai/soul/standard", prompt: "a fox", n: 2 });
    expect(issue).toMatchObject({ code: "invalid_enum_value", path: ["n"] });
    expect(issue.message).toBe(
      "`batch_size` must be 1 or 4 on higgsfield-ai/soul/standard; got 2. (compiled from `batch_size`)",
    );
  });

  test("the Kling Image series route requires a count, and says so at `n`", () => {
    const issue = refused({ model: "higgsfield/kling-image/v4.0/text-to-image/series", prompt: "a fox" });
    expect(issue).toMatchObject({ code: "invalid_shape", path: ["n"] });
    expect(issue.message).toContain("`series_amount` is required by kling-image/v4.0/text-to-image/series");
    expect(body({ model: "higgsfield/kling-image/v4.0/text-to-image/series", prompt: "a fox", n: 3 })).toEqual({
      prompt: "a fox",
      series_amount: 3,
    });
  });

  test("a count at a route that renders one image is refused, naming the routes that take one", () => {
    const issue = refused({ model: "higgsfield/ideogram/v4.0", prompt: "a fox", n: 2 });
    expect(issue).toMatchObject({ code: "unsupported_param", path: ["n"] });
    expect(issue.message).toContain("`ideogram/v4.0` renders one image per request");
    expect(issue.message).toContain("5 of the 18 Higgsfield image routes do take one");
  });

  test("a canonical tier is sent in the route's spelling", () => {
    expect(body({ model: "higgsfield/marketing-studio/image", prompt: "a fox", resolution: "2k" })).toEqual({
      prompt: "a fox",
      resolution: "2k",
    });
  });

  test("Soul sizes in 720p / 1080p, which is not a tier: refused, never mapped onto one", () => {
    const issue = refused({ model: "higgsfield/higgsfield-ai/soul/standard", prompt: "a fox", resolution: "1k" });
    expect(issue).toMatchObject({ code: "invalid_enum_value", path: ["resolution"] });
    expect(issue.message).toContain("none of its values is a canonical tier");
    expect(issue.message).toContain("`providerOptions.higgsfield.resolution`");
    // …and the route's own word reaches it there, checked by the route's own
    // vocabulary and priced at the rate that resolution selects.
    const result = image.safe({
      model: "higgsfield/higgsfield-ai/soul/standard",
      prompt: "a fox",
      providerOptions: { higgsfield: { resolution: "1080p" } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(JSON.stringify(result.params))).toEqual({ prompt: "a fox", resolution: "1080p" });
    expect(result.estimate.costUSD).toBe(0.1875);
  });

  test("a tier the route does not list is refused naming the ones it does", () => {
    const issue = refused({ model: "higgsfield/kling-image/v4.0/text-to-image", prompt: "a fox", resolution: "1k" });
    expect(issue).toMatchObject({ code: "invalid_enum_value", path: ["resolution"] });
    expect(issue.message).toContain('`resolution` must be "2k" or "4k" on `kling-image/v4.0/text-to-image`');
  });

  test("a word the route has no parameter for is refused, counting the routes that have one", () => {
    const seed = refused({ model: "higgsfield/marketing-studio/image", prompt: "a fox", seed: 7 });
    expect(seed).toMatchObject({ code: "unsupported_param", path: ["seed"] });
    expect(seed.message).toContain("`marketing-studio/image` declares no `seed` parameter");
    expect(seed.message).toContain("5 of the 18 Higgsfield image routes do take it");

    const negative = refused({ model: "higgsfield/ideogram/v4.0", prompt: "a fox", negativePrompt: "blur" });
    expect(negative).toMatchObject({ code: "unsupported_param", path: ["negativePrompt"] });
    expect(negative.message).toContain(
      "1 of the 18 Higgsfield image routes does take it: `alibaba/qwen-image-3/text-to-image`",
    );
  });

  test("`outputFormat` maps where the route has one, in the route's spelling", () => {
    expect(body({ model: "higgsfield/recraft/v4.1/text-to-image", prompt: "a fox", outputFormat: "jpeg" })).toEqual({
      prompt: "a fox",
      output_format: "jpg",
    });
    const issue = refused({ model: "higgsfield/higgsfield-ai/soul/standard", prompt: "a fox", outputFormat: "png" });
    expect(issue).toMatchObject({ code: "unsupported_param", path: ["outputFormat"] });
    expect(issue.message).toContain("4 of the 18 Higgsfield image routes do take it");
  });

  test("pixels are sent as the listed shape they describe, with the warning that always carries", () => {
    const result = image.safe({
      model: "higgsfield/z-image/turbo",
      prompt: "a fox",
      dimensions: { width: 1920, height: 1080 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(JSON.stringify(result.params))).toEqual({ prompt: "a fox", aspect_ratio: "16:9" });
    expect(result.params.warnings.map((warning) => [warning.code, warning.path])).toEqual([
      ["approximated_param", ["dimensions"]],
    ]);
  });

  test("a shape the route does not list is refused, never snapped", () => {
    const issue = refused({ model: "higgsfield/z-image/turbo", prompt: "a fox", aspectRatio: "5:4" });
    expect(issue).toMatchObject({ code: "invalid_enum_value", path: ["aspectRatio"] });
  });

  test('`outputDelivery: "url"` is what every route does; "base64" has no parameter', () => {
    expect(body({ model: "higgsfield/z-image/turbo", prompt: "a fox", outputDelivery: "url" })).toEqual({
      prompt: "a fox",
    });
    const issue = refused({ model: "higgsfield/z-image/turbo", prompt: "a fox", outputDelivery: "base64" });
    expect(issue).toMatchObject({ code: "unsupported_param", path: ["outputDelivery"] });
    expect(issue.message).toContain("`images[].url`");
  });

  test("an extra is the route's own parameter, and a sibling route's is refused by name", () => {
    expect(
      body({ model: "higgsfield/higgsfield-ai/soul/standard", prompt: "a fox", style_strength: 0.5 }),
    ).toEqual({ prompt: "a fox", style_strength: 0.5 });
    const issue = refused({ model: "higgsfield/z-image/turbo", prompt: "a fox", style_strength: 0.5 });
    expect(issue).toMatchObject({ code: "unsupported_param", path: ["style_strength"] });
    expect(issue.message).toContain("higgsfield-ai/soul/standard");
  });

  test("a route that requires a source picture is not an `unmodel/image` ref, and is not refused either", () => {
    // `unknown_model` is a warning: a route newer than the roster must stay
    // callable. The words Higgsfield spells one way everywhere are sent on, and
    // `higgsfield.image` reports what this route's own schema requires.
    const result = image.safe({ model: "higgsfield/alibaba/qwen-image-3/edit", prompt: "a fox", seed: 7 } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.warnings.map((issue) => issue.code)).toContain("unknown_model");
    expect(result.errors.map((issue) => [issue.code, issue.path])).toEqual([["invalid_shape", ["image_urls"]]]);
  });

  test("a word with more than one spelling is not guessed at a route with no row", () => {
    const model = "higgsfield/some/newer-route";
    const issue = refused({ model, prompt: "a fox", n: 2 });
    expect(issue).toMatchObject({ code: "unsupported_param", path: ["n"] });
    expect(issue.message).toContain("`batch_size` or `series_amount`");
    expect(issue.message).toContain("`providerOptions.higgsfield`");
    // A size and an encoding have one parameter and several VALUE spellings.
    expect(refused({ model, prompt: "a fox", resolution: "1k" })).toMatchObject({ code: "unsupported_param", path: ["resolution"] });
    expect(refused({ model, prompt: "a fox", outputFormat: "jpeg" })).toMatchObject({ code: "unsupported_param", path: ["outputFormat"] });
    // What Higgsfield spells one way everywhere is sent on, with the kernel's warning.
    const result = image.safe({ model, prompt: "a fox", seed: 7, negativePrompt: "blur", aspectRatio: "16:9" } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(JSON.stringify(result.params))).toEqual({
      prompt: "a fox",
      negative_prompt: "blur",
      seed: 7,
      aspect_ratio: "16:9",
    });
    expect(result.warnings.map((warning) => warning.code)).toContain("unknown_model");
  });

  test("`hf_webhook` rides `providerOptions` into the URL, and into the SDK's `webhook`", () => {
    const params = image({
      model: "higgsfield/z-image/turbo",
      prompt: "a fox",
      providerOptions: { higgsfield: { hf_webhook: "https://example.com/hook" } },
    });
    expect(JSON.parse(JSON.stringify(params))).toEqual({ prompt: "a fox" });
    expect(params.request.url).toBe(
      "https://api.higgsfield.ai/z-image/turbo?hf_webhook=https%3A%2F%2Fexample.com%2Fhook",
    );
    expect(params.toSdk("higgsfield")).toEqual({
      input: { prompt: "a fox" },
      webhook: { url: "https://example.com/hook" },
    });
  });
});

describe("the throwing form", () => {
  test("throws UnmodelValidationError labelled with the category", () => {
    expect(() => image({ model: "openai/gpt-image-1.5", prompt: "hi", seed: 3 })).toThrow(
      UnmodelValidationError,
    );
    try {
      image({ model: "openai/gpt-image-1.5", prompt: "hi", seed: 3 });
    } catch (error) {
      expect((error as Error).message).toContain("unmodel/image");
      expect((error as UnmodelValidationError).issues[0]!.path).toEqual(["seed"]);
    }
  });
});
