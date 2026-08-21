import { describe, expect, test } from "bun:test";
import {
  GENERATE_VIDEOS_BASE_URL,
  VEO_PARAMETER_SPACE,
  video,
  generateVideosUrl,
  type GenerateVideosBody,
  type GoogleVeoParameters,
  type VeoParameterSpace,
} from "./video";
// The unified adapter builds its rows from the same table; the drift suite at
// the end of this file is what asserts that stays true.
import { video as unifiedVideo } from "./unified-video";
import { videoModels, veoSupplementModels } from "./veo-models";
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
    const validated = video({
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
    const validated = video({ model: "veo-3.1-generate-preview", instances: PROMPT });
    expect(Object.getOwnPropertyDescriptor(validated, "toSdk")?.enumerable).toBe(false);
    expect(Object.getOwnPropertyDescriptor(validated, "request")?.enumerable).toBe(false);
    expect(typeof validated.toSdk).toBe("function");
  });

  test('a leading "models/" is stripped: both forms yield the same URL and catalog hit', () => {
    const bare = video.safe({ model: "veo-3.1-generate-preview", instances: PROMPT });
    const prefixed = video.safe({
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
    expectError(video.safe({ model: "veo-3.1-generate-preview", instances: [] }), "invalid_shape");
    expectError(
      video.safe({
        model: "veo-3.1-generate-preview",
        instances: [{ prompt: "a" }, { prompt: "b" }],
      }),
      "invalid_shape",
    );
  });

  test("an instance needs at least one of prompt/image/video", () => {
    const issue = expectError(
      video.safe({ model: "veo-3.1-generate-preview", instances: [{}] }),
      "invalid_shape",
    );
    expect(issue.path).toEqual(["instances", 0]);
  });

  test("image-to-video with bytesBase64Encoded passes and survives serialization", () => {
    const validated = video({
      model: "veo-3.1-generate-preview",
      instances: [{ prompt: "animate this", image: { bytesBase64Encoded: PNG_1X1, mimeType: "image/png" } }],
    });
    const json = JSON.parse(JSON.stringify(validated));
    expect(json.instances[0].image).toEqual({ bytesBase64Encoded: PNG_1X1, mimeType: "image/png" });
  });

  test("more than 3 referenceImages is a shape error", () => {
    const ref = { image: { bytesBase64Encoded: PNG_1X1 }, referenceType: "asset" as const };
    expectError(
      video.safe({
        model: "veo-3.1-generate-preview",
        instances: [{ prompt: "styled", referenceImages: [ref, ref, ref, ref] }],
      }),
      "invalid_shape",
    );
  });

  test("unknown top-level keys warn but pass through", () => {
    const result = expectOk(
      video.safe({
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
    const validated = video({
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
    const extension = video({
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

    const referenced = video({
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
    const validated = video({ model: "veo-3.1-generate-preview", instances: PROMPT });
    expect(validated.toSdk("google")).toEqual({
      model: "veo-3.1-generate-preview",
      prompt: "a hummingbird in slow motion",
    });
  });
});

describe("per-model param constraints", () => {
  test("veo 2 rejects the resolution parameter", () => {
    const issue = expectError(
      video.safe({
        model: "veo-2.0-generate-001",
        instances: PROMPT,
        // @ts-expect-error Veo 2 has no `resolution` parameter, so the arm
        // types it `never`; the runtime path under test is the one a JS caller
        // still takes.
        parameters: { resolution: "720p" },
      }),
      "unsupported_param",
    );
    expect(issue.path).toEqual(["parameters", "resolution"]);
    expect(issue.meta?.source).toBeDefined();
  });

  test("durationSeconds allow-lists differ: veo 3.x is 4/6/8, veo 2 is 5-8", () => {
    expectError(
      video.safe({
        model: "veo-3.1-generate-preview",
        instances: PROMPT,
        // @ts-expect-error 5s is Veo 2's, not Veo 3.x's — now a compile error too.
        parameters: { durationSeconds: 5 },
      }),
      "invalid_enum_value",
    );
    expectOk(
      video.safe({
        model: "veo-2.0-generate-001",
        instances: PROMPT,
        parameters: { durationSeconds: 5 },
      }),
    );
    expectError(
      video.safe({
        model: "veo-2.0-generate-001",
        instances: PROMPT,
        // @ts-expect-error 4s is Veo 3.x's, not Veo 2's.
        parameters: { durationSeconds: 4 },
      }),
      "invalid_enum_value",
    );
  });

  test('personGeneration "dont_allow" is veo 2-only', () => {
    expectError(
      video.safe({
        model: "veo-3.1-generate-preview",
        instances: PROMPT,
        // @ts-expect-error `dont_allow` is Veo 2-only; the Veo 3.x arm has two values.
        parameters: { personGeneration: "dont_allow" },
      }),
      "invalid_enum_value",
    );
    expectOk(
      video.safe({
        model: "veo-2.0-generate-001",
        instances: PROMPT,
        parameters: { personGeneration: "dont_allow" },
      }),
    );
  });

  test("sampleCount is 1 on veo 3.x, up to 2 on veo 2", () => {
    expectError(
      video.safe({
        model: "veo-3.1-generate-preview",
        instances: PROMPT,
        parameters: { sampleCount: 2 },
      }),
      "invalid_enum_value",
    );
    expectOk(
      video.safe({
        model: "veo-2.0-generate-001",
        instances: PROMPT,
        parameters: { sampleCount: 2 },
      }),
    );
  });

  test("veo 3.1 lite stops at 1080p; the standard model allows 4k", () => {
    expectError(
      video.safe({
        model: "veo-3.1-lite-generate-preview",
        instances: PROMPT,
        // @ts-expect-error Lite stops at 1080p — the wire arm now says so too.
        parameters: { resolution: "4k" },
      }),
      "invalid_enum_value",
    );
    expectOk(
      video.safe({
        model: "veo-3.1-generate-preview",
        instances: PROMPT,
        parameters: { resolution: "4k" },
      }),
    );
  });

  test("aspectRatio is 16:9 or 9:16 for every veo model", () => {
    const issue = expectError(
      video.safe({
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
      video.safe({
        model: "veo-2.0-generate-001",
        instances: [{ prompt: "styled", referenceImages: [ref] }],
      }),
      "unsupported_capability",
    );
    expectError(
      video.safe({
        model: "veo-2.0-generate-001",
        instances: [{ prompt: "extend", video: { uri: "https://example.test/v.mp4" } }],
      }),
      "unsupported_capability",
    );
    expectOk(
      video.safe({
        model: "veo-3.1-fast-generate-preview",
        instances: [{ prompt: "styled", referenceImages: [ref] }],
      }),
    );
  });
});

describe("pairing rules", () => {
  test("1080p/4k require durationSeconds 8 on veo 3.x", () => {
    const issue = expectError(
      video.safe({
        model: "veo-3.1-generate-preview",
        instances: PROMPT,
        parameters: { resolution: "1080p", durationSeconds: 4 },
      }),
      "invalid_enum_value",
    );
    expect(issue.path).toEqual(["parameters", "durationSeconds"]);
    // Omitted duration defaults to 8 server-side — no error.
    expectOk(
      video.safe({
        model: "veo-3.1-generate-preview",
        instances: PROMPT,
        parameters: { resolution: "1080p" },
      }),
    );
  });

  test("video extension outputs 720p only", () => {
    const issue = expectError(
      video.safe({
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
      video.safe({
        model: "veo-3.1-generate-preview",
        instances: [{ prompt: "animate", image: { bytesBase64Encoded: PNG_1X1 } }],
        parameters: { personGeneration: "allow_all" },
      }),
      "invalid_enum_value",
    );
    // Text-to-video allow_all is fine.
    expectOk(
      video.safe({
        model: "veo-3.1-generate-preview",
        instances: PROMPT,
        parameters: { personGeneration: "allow_all" },
      }),
    );
  });

  test("lastFrame requires image; referenceImages require a prompt", () => {
    expectError(
      video.safe({
        model: "veo-3.1-generate-preview",
        instances: [{ prompt: "interpolate", lastFrame: { bytesBase64Encoded: PNG_1X1 } }],
      }),
      "invalid_shape",
    );
    expectError(
      video.safe({
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
      video.safe({
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
      video.safe({ model: "gemini-2.5-flash", instances: PROMPT }),
      "unsupported_capability",
    );
    expect(issue.path).toEqual(["model"]);
  });

  test("hand-supplemented veo ids resolve in the merged catalog", () => {
    for (const id of Object.keys(veoSupplementModels)) {
      expect(videoModels[id]).toBeDefined();
      expect(videoModels[id]!.limit.context).toBe(0);
      expect(videoModels[id]!.cost?.perVideoSecond).toBeGreaterThan(0);
      const result = expectOk(video.safe({ model: id, instances: PROMPT }));
      expect(result.warnings.some((w) => w.code === "unknown_model")).toBe(false);
    }
  });

  test("generated veo-3.1 entries carry supplemented per-second pricing", () => {
    expect(videoModels["veo-3.1-generate-preview"]!.cost?.perVideoSecond).toBe(0.4);
    expect(videoModels["veo-3.1-lite-generate-preview"]!.cost?.perVideoSecond).toBe(0.05);
  });
});

describe("cost estimation", () => {
  test("worst case defaults: 8 seconds at the 720p rate", () => {
    const result = expectOk(
      video.safe({ model: "veo-3.1-generate-preview", instances: PROMPT }),
    );
    expect(result.estimate?.costUSD).toBeCloseTo(8 * 0.4, 10);
  });

  test("explicit duration and resolution override the defaults", () => {
    const fourK = expectOk(
      video.safe({
        model: "veo-3.1-generate-preview",
        instances: PROMPT,
        parameters: { resolution: "4k", durationSeconds: 8 },
      }),
    );
    expect(fourK.estimate?.costUSD).toBeCloseTo(8 * 0.6, 10);

    const short = expectOk(
      video.safe({
        model: "veo-3.1-fast-generate-preview",
        instances: PROMPT,
        parameters: { durationSeconds: 4 },
      }),
    );
    expect(short.estimate?.costUSD).toBeCloseTo(4 * 0.1, 10);
  });

  test("veo 2 multiplies by sampleCount", () => {
    const result = expectOk(
      video.safe({
        model: "veo-2.0-generate-001",
        instances: PROMPT,
        parameters: { durationSeconds: 5, sampleCount: 2 },
      }),
    );
    expect(result.estimate?.costUSD).toBeCloseTo(5 * 0.35 * 2, 10);
  });

  test("maxCostUSD enforces a budget", () => {
    expectError(
      video.safe(
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
      const result = expectOk(video.safe({ model, instances: PROMPT }));
      expect(result.warnings.some((w) => w.code === "deprecated_model")).toBe(true);
      expect(result.warnings.some((w) => w.code === "unknown_model")).toBe(false);
    },
  );

  test("veo-2.0-generate-001 is deprecated too", () => {
    const result = expectOk(
      video.safe({ model: "veo-2.0-generate-001", instances: PROMPT }),
    );
    expect(result.warnings.some((w) => w.code === "deprecated_model")).toBe(true);
  });

  test("Veo 3 Fast prices 1080p above its 720p catalog rate", () => {
    const result = expectOk(
      video.safe({
        model: "veo-3.0-fast-generate-001",
        instances: PROMPT,
        parameters: { durationSeconds: 8, resolution: "1080p" },
      }),
    );
    expect(result.estimate?.costUSD).toBeCloseTo(8 * 0.12, 10);
  });

  test("reference images and extension stay Veo 3.1-only", () => {
    expectError(
      video.safe({
        model: "veo-3.0-generate-001",
        instances: [{ prompt: "hi", video: { uri: "https://example.invalid/v.mp4" } }],
      }),
      "unsupported_capability",
    );
  });
});

describe("seed", () => {
  test('seed rides the wire body but is dropped by toSdk("google")', () => {
    const validated = video({
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
      video.safe({
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
      expect(videoModels[id]?.limit.input).toBe(1024);
      // Video models are not token-context models.
      expect(videoModels[id]?.limit.context).toBe(0);
    }
  });

  test("Veo 2 caps input images at 20MB; Veo 3.1 has no documented image cap", () => {
    const big = "A".repeat(21 * 1024 * 1024);
    const issue = expectError(
      video.safe({
        model: "veo-2.0-generate-001",
        instances: [{ prompt: "hi", image: { bytesBase64Encoded: big, mimeType: "image/png" } }],
      }),
      "media_too_large",
    );
    expect(issue.path).toEqual(["instances", 0, "image"]);
    expect(issue.meta?.limit).toBe(20 * 1024 * 1024);

    expectOk(
      video.safe({
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
        video.safe({
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
    const result = video.safe({
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
    // `as const`: the arm types Omni's `durationSeconds` as the integers 3-10,
    // so a `number[]` loop variable no longer fits even for the valid ends.
    for (const durationSeconds of [3, 10] as const) {
      expectOk(video.safe({ model: OMNI, instances: PROMPT, parameters: { durationSeconds } }));
    }
    for (const durationSeconds of [2, 11] as const) {
      const issue = expectError(
        // @ts-expect-error 2s and 11s are outside the documented 3-10s window.
        video.safe({ model: OMNI, instances: PROMPT, parameters: { durationSeconds } }),
        "invalid_enum_value",
      );
      expect(issue.path).toEqual(["parameters", "durationSeconds"]);
      expect(issue.meta?.allowed).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    }
  });

  test("720p / 16:9 / 9:16 / one video pass", () => {
    expectOk(
      video.safe({
        model: OMNI,
        instances: PROMPT,
        parameters: { durationSeconds: 6, aspectRatio: "9:16", resolution: "720p", sampleCount: 1 },
      }),
    );
    expectOk(
      video.safe({
        model: OMNI,
        instances: PROMPT,
        parameters: { aspectRatio: "16:9", resolution: "720p" },
      }),
    );
  });

  test("the Veo-only instance and pairing rules stay off Omni", () => {
    // 1080p/4k-need-8s, extension and referenceImages are veo- gated; Omni's
    // own enums are what bound it.
    expectOk(video.safe({ model: OMNI, instances: PROMPT, parameters: { durationSeconds: 4 } }));
  });
});

describe("every catalogued video model is bounded", () => {
  const videoModelIds = Object.keys(videoModels).filter((id) =>
    videoModels[id]!.modalities.output.includes("video"),
  );

  test("the catalog actually has video ids to check", () => {
    expect(videoModelIds.length).toBeGreaterThanOrEqual(7);
    expect(videoModelIds).toContain(OMNI);
  });

  test.each(videoModelIds)("%s carries at least one constraints entry", (id) => {
    expect(video.constraintsFor(id).length).toBeGreaterThan(0);
  });

  test.each(videoModelIds)("%s rejects an absurd durationSeconds", (id) => {
    const result = video.safe({
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
    videoModels[id] = {
      ...videoModels[OMNI]!,
      id,
      name: "Unmodel Test Video",
    };
    try {
      expect(video.constraintsFor(id)).toEqual([]);
      const result = expectOk(
        video.safe({
          model: id,
          instances: PROMPT,
          parameters: { durationSeconds: 10_000_000_000 },
        }),
      );
      const warning = result.warnings.find((w) => w.code === "unsupported_capability");
      expect(warning?.path).toEqual(["parameters"]);
      expect(warning?.message).toContain("no documented `parameters` bounds are encoded");
    } finally {
      delete videoModels[id];
    }
  });
});

// ---------------------------------------------------------------------------
// Drift: the per-model type table vs the runtime tables vs the unified rows.
//
// `google.video` accepted `parameters: { resolution: "4k" }` on Veo 2 for as
// long as the endpoint existed, while `unmodel/video` — the surface that
// compiles down to this one — refused the same fact at compile time, and
// `videoConstraints` refused it at run time. Three descriptions of the same
// seven models, and nothing compared them, which is exactly why it rotted
// unnoticed. `VEO_PARAMETER_SPACE` is now the one the types are built from and
// the one `./unified-video` reads; the assertions below tie it to the runtime
// tables in BOTH directions, so a value added to either side alone fails here.
// (The compile-time half of the same invariant lives in
// test/types/google.test-d.ts, and the completion lists in
// test/unified/completions.test.ts.)
// ---------------------------------------------------------------------------

/** The merged `enums` the pipeline actually applies to a model's `parameters`. */
function enumsFor(modelId: string): Record<string, readonly (string | number)[]> {
  const merged: Record<string, readonly (string | number)[]> = {};
  for (const constraints of video.constraintsFor(modelId)) {
    for (const [key, allowed] of Object.entries(constraints.enums ?? {})) merged[key] = allowed;
  }
  return merged;
}

/** The params a model DENIES outright — how "this model has no such field" is spelled. */
function deniedFor(modelId: string): string[] {
  return video.constraintsFor(modelId).flatMap((c) => Object.keys(c.deny ?? {}));
}

/** Sorted and widened, so a tuple type on one side does not decide the comparison. */
function sorted(values: readonly (string | number)[] = []): Array<string | number> {
  return [...values].sort();
}

describe("per-model tables agree (types ↔ runtime ↔ unified)", () => {
  const ids: string[] = Object.keys(VEO_PARAMETER_SPACE);
  /** The row, at the interface type: `personGeneration` is optional on it. */
  const rowOf = (id: string): VeoParameterSpace =>
    (VEO_PARAMETER_SPACE as Readonly<Record<string, VeoParameterSpace>>)[id]!;

  test("the table covers every model the endpoint bounds, and no other", () => {
    expect(ids.length).toBe(7);
    // Every id with a row is a model this endpoint actually serves…
    for (const id of ids) {
      expect(videoModels[id], `${id} is not in the endpoint's catalog`).toBeDefined();
      expect(video.constraintsFor(id).length, `${id} has no runtime constraints`).toBeGreaterThan(0);
    }
    // The two hand-written Veo supplements are in that catalog by construction.
    for (const id of Object.keys(veoSupplementModels)) expect(ids).toContain(id);
    // …and every model this endpoint can actually generate with has a row, so
    // a new video-output id cannot arrive with runtime bounds and a silently
    // wide type. (`videoModels` is the whole google catalog plus the Veo
    // supplements — the video-output filter is the same one
    // `checkVideoModality` applies.)
    const generates = Object.entries(videoModels).filter(([, info]) =>
      info.modalities.output.includes("video"),
    );
    expect(generates.length).toBeGreaterThanOrEqual(ids.length);
    for (const [id] of generates) {
      expect(ids, `${id} generates video but has no VEO_PARAMETER_SPACE row`).toContain(id);
    }
  });

  test.each(ids)("%s: durations match the runtime enum", (id) => {
    expect(sorted(rowOf(id).durations)).toEqual(sorted(enumsFor(id)["durationSeconds"]));
  });

  test.each(ids)("%s: resolutions match the runtime enum, and empty means denied", (id) => {
    const row = rowOf(id);
    const allowed = enumsFor(id)["resolution"];
    if (row.resolutions.length === 0) {
      // The positive statement: no `resolution` parameter at all. The type says
      // `never`, the runtime says `unsupported_param`, and neither may drift
      // into offering a value.
      expect(allowed).toBeUndefined();
      expect(deniedFor(id)).toContain("resolution");
      return;
    }
    expect(deniedFor(id)).not.toContain("resolution");
    expect(sorted(row.resolutions)).toEqual(sorted(allowed));
  });

  test.each(ids)("%s: aspect ratios match the runtime enum", (id) => {
    expect(sorted(rowOf(id).ratios)).toEqual(sorted(enumsFor(id)["aspectRatio"]));
  });

  test.each(ids)("%s: personGeneration is narrowed only where the runtime bounds it", (id) => {
    const published = rowOf(id).personGeneration;
    const allowed = enumsFor(id)["personGeneration"];
    if (published === undefined) {
      // Omni: neither page publishes a list, so the runtime bounds nothing and
      // the wire type keeps its documented union rather than inventing one.
      expect(allowed).toBeUndefined();
      return;
    }
    expect(sorted(published)).toEqual(sorted(allowed));
  });

  test("the unified rows are the same lists, not a second opinion", () => {
    const rows: Readonly<Record<string, { durations: unknown; resolutions: unknown; ratios: unknown }>> =
      unifiedVideo.modelParams;
    expect(Object.keys(rows).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(rows[id]?.durations).toEqual(rowOf(id).durations);
      expect(rows[id]?.resolutions).toEqual(rowOf(id).resolutions);
      expect(rows[id]?.ratios).toEqual(rowOf(id).ratios);
    }
  });

  test("every value the type admits is a value the runtime accepts", () => {
    for (const id of ids) {
      const row = rowOf(id);
      const call = (parameters: GoogleVeoParameters) =>
        expectOk(video.safe({ model: id, instances: PROMPT, parameters } as GenerateVideosBody));
      for (const durationSeconds of row.durations) call({ durationSeconds });
      // 1080p/4k need 8s — a PAIRING rule, which is why it is not in the
      // per-field table; pass the length the pairing check wants.
      for (const resolution of row.resolutions) call({ resolution, durationSeconds: 8 });
      for (const personGeneration of row.personGeneration ?? []) call({ personGeneration });
    }
  });
});
