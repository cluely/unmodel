import { describe, expect, test } from "bun:test";
import {
  GENERATE_VIDEOS_BASE_URL,
  generateVideos,
  generateVideosUrl,
  type GenerateVideosBody,
} from "./generate-videos";
import { generateVideosModels, veoSupplementModels } from "./veo-models";
import type { Issue } from "../../core/issues";
import type { ValidateResult } from "../../core/result";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const PROMPT: GenerateVideosBody["instances"] = [{ prompt: "a hummingbird in slow motion" }];

function expectError(result: ValidateResult<unknown>, code: Issue["code"]): Issue {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected validation failure");
  const issue = result.errors.find((e) => e.code === code);
  expect(issue).toBeDefined();
  return issue!;
}

function expectOk<V>(result: ValidateResult<V>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected ok, got: ${JSON.stringify(result.errors)}`);
  return result;
}

describe("wire purity", () => {
  test("model is stripped from the body and JSON output; URL carries it", () => {
    const validated = generateVideos({
      model: "veo-3.1-generate-preview",
      instances: PROMPT,
      parameters: { aspectRatio: "16:9" },
    });
    expect(Object.keys(validated)).toEqual(["instances", "parameters"]);
    const json = JSON.parse(JSON.stringify(validated));
    expect("model" in json).toBe(false);
    expect(json).toEqual({ instances: PROMPT, parameters: { aspectRatio: "16:9" } });
    expect(validated.request.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning",
    );
    expect(validated.request.method).toBe("POST");
    expect(validated.request.headers["content-type"]).toBe("application/json");
  });

  test("toSdk and request are non-enumerable but callable", () => {
    const validated = generateVideos({ model: "veo-3.1-generate-preview", instances: PROMPT });
    expect(Object.getOwnPropertyDescriptor(validated, "toSdk")?.enumerable).toBe(false);
    expect(Object.getOwnPropertyDescriptor(validated, "request")?.enumerable).toBe(false);
    expect(typeof validated.toSdk).toBe("function");
  });

  test('a leading "models/" is stripped: both forms yield the same URL and catalog hit', () => {
    const bare = generateVideos.safe({ model: "veo-3.1-generate-preview", instances: PROMPT });
    const prefixed = generateVideos.safe({
      model: "models/veo-3.1-generate-preview",
      instances: PROMPT,
    });
    if (!bare.ok || !prefixed.ok) throw new Error("expected both forms to validate");
    expect(prefixed.params.request.url).toBe(bare.params.request.url);
    expect(prefixed.params.request.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning",
    );
    expect(prefixed.warnings.some((w) => w.code === "unknown_model")).toBe(false);
  });

  test("generateVideosUrl helper accepts both id forms", () => {
    expect(generateVideosUrl("veo-3.1-generate-preview")).toBe(
      `${GENERATE_VIDEOS_BASE_URL}/veo-3.1-generate-preview:predictLongRunning`,
    );
    expect(generateVideosUrl("models/veo-3.1-generate-preview")).toBe(
      generateVideosUrl("veo-3.1-generate-preview"),
    );
  });
});

describe("instances/parameters wire shape", () => {
  test("exactly one instance is required", () => {
    expectError(generateVideos.safe({ model: "veo-3.1-generate-preview", instances: [] }), "invalid_shape");
    expectError(
      generateVideos.safe({
        model: "veo-3.1-generate-preview",
        instances: [{ prompt: "a" }, { prompt: "b" }],
      }),
      "invalid_shape",
    );
  });

  test("an instance needs at least one of prompt/image/video", () => {
    const issue = expectError(
      generateVideos.safe({ model: "veo-3.1-generate-preview", instances: [{}] }),
      "invalid_shape",
    );
    expect(issue.path).toEqual(["instances", 0]);
  });

  test("image-to-video with bytesBase64Encoded passes and survives serialization", () => {
    const validated = generateVideos({
      model: "veo-3.1-generate-preview",
      instances: [{ prompt: "animate this", image: { bytesBase64Encoded: PNG_1X1, mimeType: "image/png" } }],
    });
    const json = JSON.parse(JSON.stringify(validated));
    expect(json.instances[0].image).toEqual({ bytesBase64Encoded: PNG_1X1, mimeType: "image/png" });
  });

  test("more than 3 referenceImages is a shape error", () => {
    const ref = { image: { bytesBase64Encoded: PNG_1X1 }, referenceType: "asset" as const };
    expectError(
      generateVideos.safe({
        model: "veo-3.1-generate-preview",
        instances: [{ prompt: "styled", referenceImages: [ref, ref, ref, ref] }],
      }),
      "invalid_shape",
    );
  });

  test("unknown top-level keys warn but pass through", () => {
    const result = expectOk(
      generateVideos.safe({
        model: "veo-3.1-generate-preview",
        instances: PROMPT,
        // @ts-expect-error deliberate typo to exercise the unknown-key warning
        parametrs: { aspectRatio: "16:9" },
      }),
    );
    expect(result.warnings.some((w) => w.code === "unknown_param" && w.path[0] === "parametrs")).toBe(true);
  });
});

describe("toSdk mapping", () => {
  test("instances[0] and parameters re-shape into { model, prompt, image, config }", () => {
    const validated = generateVideos({
      model: "veo-3.1-generate-preview",
      instances: [
        {
          prompt: "a hummingbird",
          image: { bytesBase64Encoded: PNG_1X1, mimeType: "image/png" },
          lastFrame: { bytesBase64Encoded: PNG_1X1, mimeType: "image/png" },
        },
      ],
      parameters: {
        aspectRatio: "16:9",
        durationSeconds: 8,
        resolution: "1080p",
        personGeneration: "allow_adult",
        negativePrompt: "rain",
        sampleCount: 1,
      },
    });
    expect(validated.toSdk("google")).toEqual({
      model: "veo-3.1-generate-preview",
      prompt: "a hummingbird",
      image: { imageBytes: PNG_1X1, mimeType: "image/png" },
      config: {
        numberOfVideos: 1,
        durationSeconds: 8,
        aspectRatio: "16:9",
        resolution: "1080p",
        personGeneration: "allow_adult",
        negativePrompt: "rain",
        lastFrame: { imageBytes: PNG_1X1, mimeType: "image/png" },
      },
    });
  });

  test("video extension and referenceImages map to SDK names", () => {
    const extension = generateVideos({
      model: "veo-3.1-generate-preview",
      instances: [
        { prompt: "keep flying", video: { uri: "https://example.test/video.mp4", encoding: "video/mp4" } },
      ],
    });
    expect(extension.toSdk("google")).toEqual({
      model: "veo-3.1-generate-preview",
      prompt: "keep flying",
      video: { uri: "https://example.test/video.mp4", mimeType: "video/mp4" },
    });

    const referenced = generateVideos({
      model: "veo-3.1-generate-preview",
      instances: [
        {
          prompt: "in this style",
          referenceImages: [{ image: { bytesBase64Encoded: PNG_1X1 }, referenceType: "asset" }],
        },
      ],
    });
    expect(referenced.toSdk("google")).toEqual({
      model: "veo-3.1-generate-preview",
      prompt: "in this style",
      config: { referenceImages: [{ image: { imageBytes: PNG_1X1 }, referenceType: "asset" }] },
    });
  });

  test("config is omitted when nothing feeds it", () => {
    const validated = generateVideos({ model: "veo-3.1-generate-preview", instances: PROMPT });
    expect(validated.toSdk("google")).toEqual({
      model: "veo-3.1-generate-preview",
      prompt: "a hummingbird in slow motion",
    });
  });
});

describe("per-model param constraints", () => {
  test("veo 2 rejects the resolution parameter", () => {
    const issue = expectError(
      generateVideos.safe({
        model: "veo-2.0-generate-001",
        instances: PROMPT,
        parameters: { resolution: "720p" },
      }),
      "unsupported_param",
    );
    expect(issue.path).toEqual(["parameters", "resolution"]);
    expect(issue.meta?.source).toBeDefined();
  });

  test("durationSeconds allow-lists differ: veo 3.x is 4/6/8, veo 2 is 5-8", () => {
    expectError(
      generateVideos.safe({
        model: "veo-3.1-generate-preview",
        instances: PROMPT,
        parameters: { durationSeconds: 5 },
      }),
      "invalid_enum_value",
    );
    expectOk(
      generateVideos.safe({
        model: "veo-2.0-generate-001",
        instances: PROMPT,
        parameters: { durationSeconds: 5 },
      }),
    );
    expectError(
      generateVideos.safe({
        model: "veo-2.0-generate-001",
        instances: PROMPT,
        parameters: { durationSeconds: 4 },
      }),
      "invalid_enum_value",
    );
  });

  test('personGeneration "dont_allow" is veo 2-only', () => {
    expectError(
      generateVideos.safe({
        model: "veo-3.1-generate-preview",
        instances: PROMPT,
        parameters: { personGeneration: "dont_allow" },
      }),
      "invalid_enum_value",
    );
    expectOk(
      generateVideos.safe({
        model: "veo-2.0-generate-001",
        instances: PROMPT,
        parameters: { personGeneration: "dont_allow" },
      }),
    );
  });

  test("sampleCount is 1 on veo 3.x, up to 2 on veo 2", () => {
    expectError(
      generateVideos.safe({
        model: "veo-3.1-generate-preview",
        instances: PROMPT,
        parameters: { sampleCount: 2 },
      }),
      "invalid_enum_value",
    );
    expectOk(
      generateVideos.safe({
        model: "veo-2.0-generate-001",
        instances: PROMPT,
        parameters: { sampleCount: 2 },
      }),
    );
  });

  test("veo 3.1 lite stops at 1080p; the standard model allows 4k", () => {
    expectError(
      generateVideos.safe({
        model: "veo-3.1-lite-generate-preview",
        instances: PROMPT,
        parameters: { resolution: "4k" },
      }),
      "invalid_enum_value",
    );
    expectOk(
      generateVideos.safe({
        model: "veo-3.1-generate-preview",
        instances: PROMPT,
        parameters: { resolution: "4k" },
      }),
    );
  });

  test("aspectRatio is 16:9 or 9:16 for every veo model", () => {
    const issue = expectError(
      generateVideos.safe({
        model: "veo-3.1-generate-preview",
        instances: PROMPT,
        // @ts-expect-error deliberately invalid enum value
        parameters: { aspectRatio: "4:3" },
      }),
      "invalid_enum_value",
    );
    expect(issue.path).toEqual(["parameters", "aspectRatio"]);
  });

  test("referenceImages and video extension are veo 3.1/3.1-fast features", () => {
    const ref = { image: { bytesBase64Encoded: PNG_1X1 }, referenceType: "asset" as const };
    expectError(
      generateVideos.safe({
        model: "veo-2.0-generate-001",
        instances: [{ prompt: "styled", referenceImages: [ref] }],
      }),
      "unsupported_capability",
    );
    expectError(
      generateVideos.safe({
        model: "veo-2.0-generate-001",
        instances: [{ prompt: "extend", video: { uri: "https://example.test/v.mp4" } }],
      }),
      "unsupported_capability",
    );
    expectOk(
      generateVideos.safe({
        model: "veo-3.1-fast-generate-preview",
        instances: [{ prompt: "styled", referenceImages: [ref] }],
      }),
    );
  });
});

describe("pairing rules", () => {
  test("1080p/4k require durationSeconds 8 on veo 3.x", () => {
    const issue = expectError(
      generateVideos.safe({
        model: "veo-3.1-generate-preview",
        instances: PROMPT,
        parameters: { resolution: "1080p", durationSeconds: 4 },
      }),
      "invalid_enum_value",
    );
    expect(issue.path).toEqual(["parameters", "durationSeconds"]);
    // Omitted duration defaults to 8 server-side — no error.
    expectOk(
      generateVideos.safe({
        model: "veo-3.1-generate-preview",
        instances: PROMPT,
        parameters: { resolution: "1080p" },
      }),
    );
  });

  test("video extension outputs 720p only", () => {
    const issue = expectError(
      generateVideos.safe({
        model: "veo-3.1-generate-preview",
        instances: [{ prompt: "extend", video: { uri: "https://example.test/v.mp4" } }],
        parameters: { resolution: "1080p" },
      }),
      "invalid_enum_value",
    );
    expect(issue.path).toEqual(["parameters", "resolution"]);
  });

  test('image-driven generation forbids personGeneration "allow_all"', () => {
    expectError(
      generateVideos.safe({
        model: "veo-3.1-generate-preview",
        instances: [{ prompt: "animate", image: { bytesBase64Encoded: PNG_1X1 } }],
        parameters: { personGeneration: "allow_all" },
      }),
      "invalid_enum_value",
    );
    // Text-to-video allow_all is fine.
    expectOk(
      generateVideos.safe({
        model: "veo-3.1-generate-preview",
        instances: PROMPT,
        parameters: { personGeneration: "allow_all" },
      }),
    );
  });

  test("lastFrame requires image; referenceImages require a prompt", () => {
    expectError(
      generateVideos.safe({
        model: "veo-3.1-generate-preview",
        instances: [{ prompt: "interpolate", lastFrame: { bytesBase64Encoded: PNG_1X1 } }],
      }),
      "invalid_shape",
    );
    expectError(
      generateVideos.safe({
        model: "veo-3.1-generate-preview",
        instances: [
          {
            image: { bytesBase64Encoded: PNG_1X1 },
            referenceImages: [{ image: { bytesBase64Encoded: PNG_1X1 }, referenceType: "asset" }],
          },
        ],
      }),
      "invalid_shape",
    );
  });
});

describe("model catalog", () => {
  test("unknown model warns and skips model-dependent checks", () => {
    const result = expectOk(
      generateVideos.safe({
        model: "veo-9.9-generate-preview",
        instances: PROMPT,
        // Would be invalid_enum_value on a known veo model — skipped here.
        parameters: { durationSeconds: 3 },
      }),
    );
    expect(result.warnings.some((w) => w.code === "unknown_model")).toBe(true);
  });

  test("a non-video model is rejected", () => {
    const issue = expectError(
      generateVideos.safe({ model: "gemini-2.5-flash", instances: PROMPT }),
      "unsupported_capability",
    );
    expect(issue.path).toEqual(["model"]);
  });

  test("hand-supplemented veo ids resolve in the merged catalog", () => {
    for (const id of Object.keys(veoSupplementModels)) {
      expect(generateVideosModels[id]).toBeDefined();
      expect(generateVideosModels[id]!.limit.context).toBe(0);
      expect(generateVideosModels[id]!.cost?.perVideoSecond).toBeGreaterThan(0);
      const result = expectOk(generateVideos.safe({ model: id, instances: PROMPT }));
      expect(result.warnings.some((w) => w.code === "unknown_model")).toBe(false);
    }
  });

  test("generated veo-3.1 entries carry supplemented per-second pricing", () => {
    expect(generateVideosModels["veo-3.1-generate-preview"]!.cost?.perVideoSecond).toBe(0.4);
    expect(generateVideosModels["veo-3.1-lite-generate-preview"]!.cost?.perVideoSecond).toBe(0.05);
  });
});

describe("cost estimation", () => {
  test("worst case defaults: 8 seconds at the 720p rate", () => {
    const result = expectOk(
      generateVideos.safe({ model: "veo-3.1-generate-preview", instances: PROMPT }),
    );
    expect(result.estimate?.costUSD).toBeCloseTo(8 * 0.4, 10);
  });

  test("explicit duration and resolution override the defaults", () => {
    const fourK = expectOk(
      generateVideos.safe({
        model: "veo-3.1-generate-preview",
        instances: PROMPT,
        parameters: { resolution: "4k", durationSeconds: 8 },
      }),
    );
    expect(fourK.estimate?.costUSD).toBeCloseTo(8 * 0.6, 10);

    const short = expectOk(
      generateVideos.safe({
        model: "veo-3.1-fast-generate-preview",
        instances: PROMPT,
        parameters: { durationSeconds: 4 },
      }),
    );
    expect(short.estimate?.costUSD).toBeCloseTo(4 * 0.1, 10);
  });

  test("veo 2 multiplies by sampleCount", () => {
    const result = expectOk(
      generateVideos.safe({
        model: "veo-2.0-generate-001",
        instances: PROMPT,
        parameters: { durationSeconds: 5, sampleCount: 2 },
      }),
    );
    expect(result.estimate?.costUSD).toBeCloseTo(5 * 0.35 * 2, 10);
  });

  test("maxCostUSD enforces a budget", () => {
    expectError(
      generateVideos.safe(
        { model: "veo-3.1-generate-preview", instances: PROMPT },
        { maxCostUSD: 1 },
      ),
      "over_budget",
    );
  });
});

// ---------------------------------------------------------------------------
// 2026-08-13 doc re-audit: the deprecated Veo 3 ids, the seed parameter, and
// the per-model input caps stated in the "Model versions" section.
// ---------------------------------------------------------------------------

describe("Veo 3 (deprecated) ids", () => {
  test.each(["veo-3.0-generate-001", "veo-3.0-fast-generate-001"])(
    "%s is cataloged and warns deprecated instead of unknown",
    (model) => {
      const result = expectOk(generateVideos.safe({ model, instances: PROMPT }));
      expect(result.warnings.some((w) => w.code === "deprecated_model")).toBe(true);
      expect(result.warnings.some((w) => w.code === "unknown_model")).toBe(false);
    },
  );

  test("veo-2.0-generate-001 is deprecated too", () => {
    const result = expectOk(
      generateVideos.safe({ model: "veo-2.0-generate-001", instances: PROMPT }),
    );
    expect(result.warnings.some((w) => w.code === "deprecated_model")).toBe(true);
  });

  test("Veo 3 Fast prices 1080p above its 720p catalog rate", () => {
    const result = expectOk(
      generateVideos.safe({
        model: "veo-3.0-fast-generate-001",
        instances: PROMPT,
        parameters: { durationSeconds: 8, resolution: "1080p" },
      }),
    );
    expect(result.estimate?.costUSD).toBeCloseTo(8 * 0.12, 10);
  });

  test("reference images and extension stay Veo 3.1-only", () => {
    expectError(
      generateVideos.safe({
        model: "veo-3.0-generate-001",
        instances: [{ prompt: "hi", video: { uri: "https://example.invalid/v.mp4" } }],
      }),
      "unsupported_capability",
    );
  });
});

describe("seed", () => {
  test('seed rides the wire body but is dropped by toSdk("google")', () => {
    const validated = generateVideos({
      model: "veo-3.1-generate-preview",
      instances: PROMPT,
      parameters: { seed: 42, aspectRatio: "16:9" },
    });
    expect(JSON.parse(JSON.stringify(validated))).toEqual({
      instances: PROMPT,
      parameters: { seed: 42, aspectRatio: "16:9" },
    });
    const sdk = validated.toSdk("google") as { config?: Record<string, unknown> };
    expect(sdk.config).toEqual({ aspectRatio: "16:9" });
  });
});

describe("documented input caps", () => {
  test("a Veo 3.1 prompt beyond the 1,024-token text-input limit reports over_context", () => {
    const issue = expectError(
      generateVideos.safe({
        model: "veo-3.1-generate-preview",
        instances: [{ prompt: "word ".repeat(8000) }],
      }),
      "over_context",
    );
    expect(issue.path).toEqual(["instances", 0, "prompt"]);
    expect(issue.meta?.limit).toBe(1024);
  });

  test("the veo-3.1 catalog entries carry the documented 1,024-token input limit", () => {
    for (const id of [
      "veo-3.1-generate-preview",
      "veo-3.1-fast-generate-preview",
      "veo-3.1-lite-generate-preview",
    ]) {
      expect(generateVideosModels[id]?.limit.input).toBe(1024);
      // Video models are not token-context models.
      expect(generateVideosModels[id]?.limit.context).toBe(0);
    }
  });

  test("Veo 2 caps input images at 20MB; Veo 3.1 has no documented image cap", () => {
    const big = "A".repeat(21 * 1024 * 1024);
    const issue = expectError(
      generateVideos.safe({
        model: "veo-2.0-generate-001",
        instances: [{ prompt: "hi", image: { bytesBase64Encoded: big, mimeType: "image/png" } }],
      }),
      "media_too_large",
    );
    expect(issue.path).toEqual(["instances", 0, "image"]);
    expect(issue.meta?.limit).toBe(20 * 1024 * 1024);

    expectOk(
      generateVideos.safe({
        model: "veo-3.1-generate-preview",
        instances: [
          { prompt: "hi", image: { bytesBase64Encoded: big, mimeType: "image/png" } },
        ],
        parameters: { personGeneration: "allow_adult" },
      }),
    );
  });

  test("a small Veo 2 image passes, in both accepted spellings", () => {
    for (const image of [
      { bytesBase64Encoded: PNG_1X1, mimeType: "image/png" },
      { inlineData: { data: PNG_1X1, mimeType: "image/png" } },
    ] as const) {
      expectOk(
        generateVideos.safe({
          model: "veo-2.0-generate-001",
          instances: [{ prompt: "hi", image }],
          parameters: { personGeneration: "allow_adult" },
        }),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// gemini-omni-flash-preview — the one catalogued video-output model that is
// not a Veo id. Both `veo-`-prefixed family rules skip it, so before its own
// constraints entry existed it accepted ANY parameters with zero warnings.
// Docs: https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash
// ("Output video: 3s-10s (720p, 24 FPS)") and .../docs/omni (9:16 / 16:9).
// ---------------------------------------------------------------------------

const OMNI = "gemini-omni-flash-preview";
const OMNI_DOCS = "https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash";

describe("gemini-omni-flash-preview parameter bounds", () => {
  test("absurd parameters are rejected, not silently accepted", () => {
    const result = generateVideos.safe({
      model: OMNI,
      instances: PROMPT,
      parameters: {
        durationSeconds: 10_000_000_000,
        aspectRatio: "42:1",
        resolution: "16k",
        sampleCount: 99,
      },
    } as unknown as GenerateVideosBody);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected validation failure");
    expect(result.errors.map((e) => e.path.join("."))).toEqual([
      "parameters.durationSeconds",
      "parameters.aspectRatio",
      "parameters.resolution",
      "parameters.sampleCount",
    ]);
    // The Omni pages back these, not the Veo page.
    for (const issue of result.errors) expect(issue.meta?.source).toBe(OMNI_DOCS);
  });

  test("the documented 3-10s window: both ends pass, 2s and 11s do not", () => {
    for (const durationSeconds of [3, 10]) {
      expectOk(generateVideos.safe({ model: OMNI, instances: PROMPT, parameters: { durationSeconds } }));
    }
    for (const durationSeconds of [2, 11]) {
      const issue = expectError(
        generateVideos.safe({ model: OMNI, instances: PROMPT, parameters: { durationSeconds } }),
        "invalid_enum_value",
      );
      expect(issue.path).toEqual(["parameters", "durationSeconds"]);
      expect(issue.meta?.allowed).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    }
  });

  test("720p / 16:9 / 9:16 / one video pass", () => {
    expectOk(
      generateVideos.safe({
        model: OMNI,
        instances: PROMPT,
        parameters: { durationSeconds: 6, aspectRatio: "9:16", resolution: "720p", sampleCount: 1 },
      }),
    );
    expectOk(
      generateVideos.safe({
        model: OMNI,
        instances: PROMPT,
        parameters: { aspectRatio: "16:9", resolution: "720p" },
      }),
    );
  });

  test("the Veo-only instance and pairing rules stay off Omni", () => {
    // 1080p/4k-need-8s, extension and referenceImages are veo- gated; Omni's
    // own enums are what bound it.
    expectOk(generateVideos.safe({ model: OMNI, instances: PROMPT, parameters: { durationSeconds: 4 } }));
  });
});

describe("every catalogued video model is bounded", () => {
  const videoModelIds = Object.keys(generateVideosModels).filter((id) =>
    generateVideosModels[id]!.modalities.output.includes("video"),
  );

  test("the catalog actually has video ids to check", () => {
    expect(videoModelIds.length).toBeGreaterThanOrEqual(7);
    expect(videoModelIds).toContain(OMNI);
  });

  test.each(videoModelIds)("%s carries at least one constraints entry", (id) => {
    expect(generateVideos.constraintsFor(id).length).toBeGreaterThan(0);
  });

  test.each(videoModelIds)("%s rejects an absurd durationSeconds", (id) => {
    const result = generateVideos.safe({
      model: id,
      instances: PROMPT,
      parameters: { durationSeconds: 10_000_000_000 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path.join(".") === "parameters.durationSeconds")).toBe(true);
  });

  test("a future video model with no encoded bounds warns instead of failing open", () => {
    // No shipped id hits the coverage gate any more, so stand a hypothetical
    // one up in the merged catalog: a non-`veo-` id skips both family rules
    // and has no entry of its own, exactly the shape that let Omni through.
    const id = "unmodel-test-video-preview";
    generateVideosModels[id] = {
      ...generateVideosModels[OMNI]!,
      id,
      name: "Unmodel Test Video",
    };
    try {
      expect(generateVideos.constraintsFor(id)).toEqual([]);
      const result = expectOk(
        generateVideos.safe({
          model: id,
          instances: PROMPT,
          parameters: { durationSeconds: 10_000_000_000 },
        }),
      );
      const warning = result.warnings.find((w) => w.code === "unsupported_capability");
      expect(warning?.path).toEqual(["parameters"]);
      expect(warning?.message).toContain("no documented `parameters` bounds are encoded");
    } finally {
      delete generateVideosModels[id];
    }
  });
});
