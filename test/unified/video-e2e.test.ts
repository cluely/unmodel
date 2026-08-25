/**
 * `unmodel/video`, end to end through the ready-made pack.
 *
 * The golden matrix next door pins *what* each provider compiles to; this pins
 * what a caller gets back — that the result is the provider's own `Validated`
 * with its `.request`, its `.toSdk(…)` and its estimate intact — and the two
 * things the golden tree deliberately cannot hold:
 *
 * - **route derivation**, including the refusals. A model that has no arm for
 *   the route the inputs derive is the category's signature error, and its
 *   message (which derivation, which routes the model *does* serve, what to
 *   type instead) is a contract worth pinning.
 * - **refusals in general.** A duration a model does not offer is an error, not
 *   a warning, so it cannot live in a fixture whose whole shape is a compiled
 *   body.
 */
import { describe, expect, test } from "bun:test";
import { UnmodelValidationError } from "../../src/core/issues";
import { TranslationUnavailableError } from "../../src/core/translate/errors";
import { createVideo, video } from "../../src/unified/video";
import { video as googleAdapter } from "../../src/providers/google/unified-video";
import { video as klingAdapter } from "../../src/providers/kling/unified-video";
import { video as openaiAdapter } from "../../src/providers/openai/unified";

describe("the pack", () => {
  test("registers exactly the twelve video providers, sorted", () => {
    expect([...video.providers]).toEqual([
      "bytedance",
      "fal",
      "google",
      "kling",
      "lightricks",
      "luma",
      "minimax",
      "openai",
      "pixverse",
      "runway",
      "vidu",
      "xai",
    ]);
  });

  test("a provider outside the pack is structural, not a validation error", () => {
    expect(() => video({ model: "elevenlabs/eleven_v3", prompt: "hi" } as never)).toThrow(
      TranslationUnavailableError,
    );
    const result = video.safe({ model: "elevenlabs/eleven_v3", prompt: "hi" } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.meta).toMatchObject({ structural: true, provider: "elevenlabs" });
  });

  test("a model the adapter does not list warns but still compiles", () => {
    const result = video.safe({ model: "openai/sora-3", prompt: "hi" } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Twice, and correctly so: the kernel checks the ref against the adapter's
    // `models` list, and the provider's own catalog layer checks it again.
    expect(result.warnings.map((issue) => issue.code)).toEqual(["unknown_model", "unknown_model"]);
    expect((result.params as unknown as { model: string }).model).toBe("sora-3");
  });

  test("a hand-built pack contains exactly the adapters it was given", () => {
    const pair = createVideo([openaiAdapter, googleAdapter]);
    expect([...pair.providers]).toEqual(["google", "openai"]);
    expect(() => pair({ model: "luma/ray-2", prompt: "hi" } as never)).toThrow(
      TranslationUnavailableError,
    );
  });
});

// ---------------------------------------------------------------------------
// Route derivation — the contract this category is built on
// ---------------------------------------------------------------------------

describe("route derivation", () => {
  test("a model with no text-to-video route says which route it serves", () => {
    const result = video.safe({ model: "runway/gen4_turbo", prompt: "hi", duration: 5 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({
      code: "unsupported_capability",
      path: ["prompt"],
      meta: { route: "text", routes: ["image"] },
    });
    expect(result.errors[0]!.message).toBe(
      '"gen4_turbo" has no text-to-video route; it serves image-to-video — pass `image`.',
    );
  });

  test("a model with no image-to-video route says the same, the other way round", () => {
    const result = video.safe({
      model: "runway/aleph2",
      prompt: "hi",
      image: { url: "https://example.com/frame.png" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({
      code: "unsupported_capability",
      path: ["image"],
      meta: { route: "image", routes: ["video"] },
    });
    expect(result.errors[0]!.message).toContain("it serves video-to-video — pass `video`");
  });

  test("the inputs pick the endpoint, not the caller", () => {
    const url = (params: Record<string, unknown>): string =>
      (video(params as never) as unknown as { request: { url: string } }).request.url;
    const base = { model: "vidu/viduq3-turbo", prompt: "a fox", duration: 5 };
    expect(url(base)).toBe("https://api.vidu.com/ent/v2/text2video");
    expect(url({ ...base, image: { url: "https://example.com/a.png" } })).toBe(
      "https://api.vidu.com/ent/v2/img2video",
    );
    expect(
      url({ ...base, image: [{ url: "https://example.com/a.png", role: "reference" }] }),
    ).toBe("https://api.vidu.com/ent/v2/reference2video");
  });

  test("the model id picks the route family, and the inputs pick the route in it", () => {
    const url = (model: string, extra: Record<string, unknown> = {}): string =>
      (
        video({ model, prompt: "a fox", duration: 5, ...extra } as never) as unknown as {
          request: { url: string };
        }
      ).request.url;
    const frame = { image: { url: "https://example.com/a.png" } };
    expect(url("kling/kling-v3")).toBe("https://api-singapore.klingai.com/v1/videos/text2video");
    expect(url("kling/kling-v3", frame)).toBe(
      "https://api-singapore.klingai.com/v1/videos/image2video",
    );
    expect(url("kling/kling-3.0")).toBe("https://api-singapore.klingai.com/text-to-video/kling-3.0");
    expect(url("kling/kling-3.0", frame)).toBe(
      "https://api-singapore.klingai.com/image-to-video/kling-3.0",
    );
    expect(url("kling/kling-3.0-omni", frame)).toBe(
      "https://api-singapore.klingai.com/omni-video/kling-3.0-omni",
    );
  });

  test("a reference is a different route from a first frame, and says so where it is not one", () => {
    const result = video.safe({
      model: "luma/ray-2",
      prompt: "hi",
      image: [{ url: "https://example.com/a.png", role: "reference" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ path: ["image"], meta: { route: "reference" } });
  });

  test("two images claiming one keyframe is a shape error, not a last-one-wins", () => {
    const result = video.safe({
      model: "kling/kling-v3",
      prompt: "hi",
      image: [{ url: "https://example.com/a.png" }, { url: "https://example.com/b.png" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ code: "invalid_shape", path: ["image", 1] });
  });
});

// ---------------------------------------------------------------------------
// Refusals: the half of the loss contract a fixture cannot hold
// ---------------------------------------------------------------------------

/**
 * These probes pass values the **types** now refuse, and that is the point:
 * `luma/ray-2` narrows `duration` to `5 | 9`, so `8` is a compile error before
 * it is a run-time one. The `as never` casts are how a JavaScript caller — or
 * anyone who casts — reaches this code path, and the run-time half of the
 * contract has to keep working for them. (Same idiom as
 * `test/unified/image-presets.test.ts`.)
 */
describe("a value a model cannot serve is refused, never approximated", () => {
  test("a duration outside a closed enum lists the values that exist", () => {
    const result = video.safe({ model: "luma/ray-2", prompt: "hi", duration: 8 } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({
      code: "invalid_enum_value",
      path: ["duration"],
      meta: { allowed: [5, 9], value: 8 },
    });
    expect(result.errors[0]!.message).toContain("must be one of 5, 9 seconds");
  });

  test("the same miss at a provider whose bound is the endpoint's own table", () => {
    // Nothing about kling-v2-1's 5-or-10 is copied into the adapter: the
    // capability map lives in `v1-routes.ts` and answers here, at `duration`.
    const result = video.safe({ model: "kling/kling-v2-1", prompt: "hi", duration: 7 } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ path: ["duration"], meta: { allowed: [5, 10] } });
  });

  test("a tier a model has no size for is an error, not the next one down", () => {
    const result = video.safe({ model: "openai/sora-2", prompt: "hi", resolution: "1080p" } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({
      code: "invalid_enum_value",
      path: ["resolution"],
      meta: { allowed: ["720p"] },
    });
  });

  test("a tier no provider in the category renders is refused everywhere it is asked", () => {
    for (const model of ["luma/ray-2", "google/veo-3.1-generate-preview", "vidu/viduq3-pro"]) {
      const result = video.safe({ model, prompt: "hi", resolution: "1440p" } as never);
      expect(result.ok, model).toBe(false);
      if (result.ok) continue;
      expect(result.errors[0], model).toMatchObject({
        code: "invalid_enum_value",
        path: ["resolution"],
      });
    }
  });

  test("a shape outside a provider's enum names that provider's list", () => {
    const result = video.safe({
      model: "google/veo-3.1-generate-preview",
      prompt: "hi",
      aspectRatio: "4:3",
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({
      code: "invalid_enum_value",
      path: ["aspectRatio"],
      meta: { allowed: ["16:9", "9:16"] },
    });
  });

  test("a declared gap is the kernel's uniform message, at the canonical path", () => {
    const result = video.safe({ model: "luma/ray-2", prompt: "hi", seed: 7 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ code: "unsupported_param", path: ["seed"] });
    expect(result.errors[0]!.message).toStartWith("`seed` is not supported by \"luma/ray-2\":");
  });

  test("a model-dependent gap is refused by the adapter, at the same path", () => {
    // `negativePrompt` is a `/v1/videos/*` field, so it is not a provider-wide
    // gap — which is why kling does not declare it and refuses it per model.
    expect(klingAdapter.unsupported).not.toHaveProperty("negativePrompt");
    const ok = video.safe({ model: "kling/kling-v3", prompt: "hi", negativePrompt: "blur" });
    expect(ok.ok).toBe(true);
    const refused = video.safe({ model: "kling/kling-3.0", prompt: "hi", negativePrompt: "blur" });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.errors[0]).toMatchObject({
      code: "unsupported_param",
      path: ["negativePrompt"],
    });
  });

  test("inline bytes at a URL-only provider name the gap rather than smuggling a data: URI", () => {
    const result = video.safe({
      model: "luma/ray-2",
      prompt: "hi",
      image: { data: "AAAA", mimeType: "image/png" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ code: "unsupported_param", path: ["image"] });
  });

  test("a URL at a bytes-only provider does the same, the other way round", () => {
    const result = video.safe({
      model: "google/veo-3.1-generate-preview",
      prompt: "hi",
      image: { url: "https://example.com/a.png" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.message).toContain("`gcsUri`");
  });

  test("a required field the vocabulary can express is reported at the word for it", () => {
    const result = video.safe({ model: "minimax/MiniMax-H3", prompt: "hi" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((issue) => issue.path)).toEqual([["duration"], ["resolution"]]);
  });
});

// ---------------------------------------------------------------------------
// The result is the provider's own Validated
// ---------------------------------------------------------------------------

describe("the result is the provider's own Validated", () => {
  test("openai: JSON body, request line, toSdk and a per-second estimate", () => {
    const params = video({
      model: "openai/sora-2-pro",
      prompt: "a red fox trotting through fresh snow",
      duration: 12,
      resolution: "1080p",
      aspectRatio: "16:9",
    });
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      model: "sora-2-pro",
      prompt: "a red fox trotting through fresh snow",
      seconds: "12",
      size: "1920x1080",
    });
    expect(params.request.url).toBe("https://api.openai.com/v1/videos");
    expect(params.request.method).toBe("POST");
    expect(params.toSdk("openai")).toMatchObject({ model: "sora-2-pro", seconds: "12" });

    const safe = video.safe({
      model: "openai/sora-2-pro",
      prompt: "a red fox trotting through fresh snow",
      duration: 12,
      resolution: "1080p",
      aspectRatio: "16:9",
    });
    // 12 seconds at $0.70/s — the endpoint's own per-resolution rate table.
    expect(safe.ok && safe.estimate?.costUSD).toBeCloseTo(8.4, 6);
  });

  test("google: the SDK view re-nests what the wire body nests differently", () => {
    const params = video({
      model: "google/veo-3.1-generate-preview",
      prompt: "a hummingbird in slow motion",
      duration: 8,
      aspectRatio: "9:16",
      negativePrompt: "text, watermark",
      n: 1,
    });
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      instances: [{ prompt: "a hummingbird in slow motion" }],
      parameters: {
        durationSeconds: 8,
        aspectRatio: "9:16",
        negativePrompt: "text, watermark",
        sampleCount: 1,
      },
    });
    expect(params.toSdk("google")).toEqual({
      model: "veo-3.1-generate-preview",
      prompt: "a hummingbird in slow motion",
      config: {
        numberOfVideos: 1,
        durationSeconds: 8,
        aspectRatio: "9:16",
        negativePrompt: "text, watermark",
      },
    });
  });

  test("kling: the same request, both route families, both duration encodings", () => {
    const request = { prompt: "a fox in snow", duration: 5, resolution: "1080p" } as const;
    const v1 = video({ model: "kling/kling-v3", ...request });
    const v3 = video({ model: "kling/kling-3.0", ...request });
    expect(JSON.parse(JSON.stringify(v1))).toMatchObject({ duration: "5", mode: "pro" });
    expect(JSON.parse(JSON.stringify(v3))).toMatchObject({
      settings: { duration: 5, resolution: "1080p" },
    });
  });
});

// ---------------------------------------------------------------------------
// providerOptions
// ---------------------------------------------------------------------------

describe("providerOptions", () => {
  test("deep-merges over the compiled body before validation", () => {
    const params = video({
      model: "google/veo-3.1-generate-preview",
      prompt: "a hummingbird in slow motion",
      duration: 8,
      providerOptions: {
        // A nested override merges key-by-key: `durationSeconds` survives.
        google: { parameters: { personGeneration: "allow_adult" } },
      },
    });
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      instances: [{ prompt: "a hummingbird in slow motion" }],
      parameters: { durationSeconds: 8, personGeneration: "allow_adult" },
    });
  });

  test("an override wins over the compiled value, and is validated like it", () => {
    const params = video({
      model: "openai/sora-2-pro",
      prompt: "a fox",
      duration: 8,
      // The 1024p pair has no canonical tier name; this is how it is reached.
      providerOptions: { openai: { size: "1792x1024" } },
    });
    expect(JSON.parse(JSON.stringify(params))).toMatchObject({ size: "1792x1024", seconds: "8" });
  });

  test("a block for another provider is ignored", () => {
    const params = video({
      model: "luma/ray-2",
      prompt: "a fox",
      providerOptions: { google: { parameters: { personGeneration: "allow_all" } } },
    });
    expect(Object.hasOwn(params, "parameters")).toBe(false);
  });

  test("an override the provider rejects says where it came from", () => {
    const result = video.safe({
      model: "openai/sora-2",
      prompt: "a fox",
      providerOptions: { openai: { seconds: "7" } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // `seconds` and not `duration`: the caller wrote the wire key themselves,
    // so the adapter's declared provenance for it does not apply.
    expect(result.errors[0]!.path).toEqual(["seconds"]);
    expect(result.errors[0]!.message).toEndWith("(supplied via `providerOptions`)");
  });

  test("the escape hatch reaches a wire field the vocabulary has no word for", () => {
    const params = video({
      model: "luma/ray-2",
      prompt: "a fox",
      duration: 5,
      providerOptions: { luma: { loop: true, concepts: [{ key: "orbit_left" }] } },
    });
    expect(JSON.parse(JSON.stringify(params))).toMatchObject({
      duration: "5s",
      loop: true,
      concepts: [{ key: "orbit_left" }],
    });
  });
});

// ---------------------------------------------------------------------------
// Bounds the adapter deliberately did not copy
// ---------------------------------------------------------------------------

describe("bounds the adapter did not copy surface as the provider's own finding", () => {
  test("veo's 1080p-needs-8s pairing rule, reported at `duration`", () => {
    const result = video.safe({
      model: "google/veo-3.1-generate-preview",
      prompt: "a fox",
      duration: 6,
      resolution: "1080p",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toEqual(["duration"]);
    expect(result.errors[0]!.message).toContain("must be 8 when using 1080p resolution");
    // The wire name is quoted, so the bug report writes itself.
    expect(result.errors[0]!.message).toEndWith("(compiled from `parameters.durationSeconds`)");
  });

  test("lightricks' automatic duration is a per-model capability, reported at `duration`", () => {
    // An omitted duration compiles to the documented `null`; only the 2.5
    // models have it, and the endpoint's own check says which.
    const auto = video.safe({ model: "lightricks/ltx-2-5-fast", prompt: "a fox" });
    expect(auto.ok).toBe(true);
    const explicit = video.safe({ model: "lightricks/ltx-2-3-pro", prompt: "a fox" });
    expect(explicit.ok).toBe(false);
    if (explicit.ok) return;
    expect(explicit.errors[0]).toMatchObject({
      code: "unsupported_capability",
      path: ["duration"],
    });
    expect(explicit.errors[0]!.message).toContain("needs an explicit duration");
  });

  test("vidu's per-model, per-route duration bounds, reported at `duration`", () => {
    const result = video.safe({ model: "vidu/viduq1", prompt: "a fox", duration: 8 } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toEqual(["duration"]);
    expect(result.errors[0]!.message).toContain("5 seconds");
  });

  test("a model this snapshot has not seen keeps every route open", () => {
    // It has already drawn `unknown_model`; gating it against tables that do
    // not describe it would be a guess dressed as a check.
    for (const model of ["runway/gen5", "vidu/viduq4", "kling/kling-4.0"]) {
      const result = video.safe({
        model,
        prompt: "a fox",
        image: { url: "https://example.com/a.png" },
      } as never);
      expect(result.ok, model).toBe(true);
    }
  });

  test("a tier with no shape beside it is refused where `ratio` carries the size", () => {
    // Runway's `ratio` members are pixel pairs, so a tier only picks between
    // entries of a shape — with no shape there is nothing to pick, and the
    // adapter says so instead of dropping the tier.
    const result = video.safe({ model: "runway/seedance2", prompt: "a fox", resolution: "1080p" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ code: "unsupported_param", path: ["resolution"] });
    expect(result.errors[0]!.message).toContain("Pass `aspectRatio` alongside `resolution`");
  });

  test("a canonical-space failure stops before the provider validator runs", () => {
    const result = video.safe({
      model: "pixverse/v6",
      prompt: "a fox",
      image: { url: "https://example.com/a.png" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((issue) => issue.code)).toEqual(["unsupported_param"]);
    expect(result.errors[0]!.path).toEqual(["image"]);
    expect(result.errors[0]!.message).toContain("POST /openapi/v2/image/upload");
  });
});

describe("the throwing form", () => {
  test("throws UnmodelValidationError labelled with the category", () => {
    expect(() => video({ model: "luma/ray-2", prompt: "hi", seed: 3 })).toThrow(
      UnmodelValidationError,
    );
    try {
      video({ model: "luma/ray-2", prompt: "hi", seed: 3 });
    } catch (error) {
      expect((error as Error).message).toContain("unmodel/video");
      expect((error as UnmodelValidationError).issues[0]!.path).toEqual(["seed"]);
    }
  });
});
