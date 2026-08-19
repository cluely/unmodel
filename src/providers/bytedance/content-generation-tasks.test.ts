import { describe, expect, test } from "bun:test";
import {
  contentGenerationTasks,
  contentGenerationTaskUrl,
  contentGenerationTasksUrl,
  CONTENT_GENERATION_TASKS_URL,
} from "./content-generation-tasks";
import { videoModels } from "./models";
import { ARK_AP_SOUTHEAST_BASE_URL } from "./shared";
import { videoCostUSD, videoUsdPerSecond } from "./pricing";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = contentGenerationTasks.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const TEXT = { type: "text", text: "The kitten is yawning at the camera." } as const;
const IMAGE = (role?: string): Record<string, unknown> => ({
  type: "image_url",
  image_url: { url: "https://example.com/frame.png" },
  ...(role !== undefined && { role }),
});
const VIDEO = { type: "video_url", video_url: { url: "https://example.com/clip.mp4" }, role: "reference_video" };
const AUDIO = { type: "audio_url", audio_url: { url: "https://example.com/vo.wav" }, role: "reference_audio" };

/** Minimal but real PNG header bytes, as the `data:` URI form the API takes. */
function pngDataUri(width: number, height: number): string {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

describe("bytedance.contentGenerationTasks happy path", () => {
  test("returns the exact wire body plus request metadata", () => {
    const v = contentGenerationTasks({
      model: "seedance-1-5-pro-251215",
      content: [{ type: "text", text: "The kitten is yawning at the camera." }],
      resolution: "720p",
      ratio: "16:9",
      duration: 5,
      seed: 11,
      camera_fixed: false,
      watermark: true,
    });

    expect(JSON.parse(JSON.stringify(v))).toEqual({
      model: "seedance-1-5-pro-251215",
      content: [{ type: "text", text: "The kitten is yawning at the camera." }],
      resolution: "720p",
      ratio: "16:9",
      duration: 5,
      seed: 11,
      camera_fixed: false,
      watermark: true,
    });
    expect(v.request.url).toBe(`${ARK_AP_SOUTHEAST_BASE_URL}/contents/generations/tasks`);
    expect(v.request.url).toBe(CONTENT_GENERATION_TASKS_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    expect(v.toSdk("bytedance")).toEqual(JSON.parse(JSON.stringify(v)));
  });

  test("the polling URL is derived from the submit URL", () => {
    expect(contentGenerationTaskUrl("cgt-2026-abc")).toBe(
      `${CONTENT_GENERATION_TASKS_URL}/cgt-2026-abc`,
    );
    expect(contentGenerationTasksUrl()).toBe(CONTENT_GENERATION_TASKS_URL);
  });

  test("every cataloged video model validates a minimal text-to-video request", () => {
    for (const id of Object.keys(videoModels)) {
      const r = safeUnchecked({ model: id, content: [TEXT] });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings.map((w) => w.code)).not.toContain("unknown_model");
    }
  });

  test("omni reference input validates on Dreamina Seedance 2.5", () => {
    const r = contentGenerationTasks({
      model: "dreamina-seedance-2-5-260628",
      content: [
        { type: "text", text: "extend the shot" },
        { type: "video_url", video_url: { url: "https://example.com/clip.mp4" }, role: "reference_video" },
        { type: "audio_url", audio_url: { url: "https://example.com/vo.wav" }, role: "reference_audio" },
      ],
      omni_reference_task_type: "extend",
      ratio: "adaptive",
      duration: -1,
      output_format: "mov",
      priority: 5,
    });
    expect(Object.keys(r)).toContain("omni_reference_task_type");
  });

  test("unknown model warns but still validates", () => {
    const r = safeUnchecked({ model: "seedance-9-0-pro-991231", content: [TEXT] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("unknown content types warn instead of failing", () => {
    const r = safeUnchecked({
      model: "seedance-1-5-pro-251215",
      content: [TEXT, { type: "sticker_url", sticker_url: { url: "https://x/a.png" } }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
      expect(r.warnings[0]?.path).toEqual(["content", 1, "type"]);
    }
  });

  test("empty content fails the shape check", () => {
    const r = safeUnchecked({ model: "seedance-1-5-pro-251215", content: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("a content item missing its payload fails", () => {
    const r = safeUnchecked({
      model: "seedance-1-5-pro-251215",
      content: [{ type: "image_url" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["content", 0, "image_url"]);
  });

  test("an unknown role fails", () => {
    const r = safeUnchecked({
      model: "dreamina-seedance-2-0-260128",
      content: [TEXT, IMAGE("middle_frame")],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
  });
});

describe("bytedance.contentGenerationTasks per-model param enforcement", () => {
  test("seed / camera_fixed / draft are rejected on the 2.x models", () => {
    const r = safeUnchecked({
      model: "dreamina-seedance-2-5-260628",
      content: [TEXT],
      seed: 7,
      camera_fixed: true,
      draft: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path[0]).sort()).toEqual(["camera_fixed", "draft", "seed"]);
      expect(r.errors.every((e) => e.code === "unsupported_param")).toBe(true);
    }
  });

  test("frames is Seedance 1.0 only", () => {
    const r = safeUnchecked({ model: "seedance-1-5-pro-251215", content: [TEXT], frames: 121 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["frames"]);
    expect(safeUnchecked({ model: "seedance-1-0-pro-250528", content: [TEXT], frames: 121 }).ok).toBe(
      true,
    );
  });

  test("generate_audio is rejected on the silent Seedance 1.0 models", () => {
    const r = safeUnchecked({
      model: "seedance-1-0-pro-250528",
      content: [TEXT],
      generate_audio: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["generate_audio"]);
  });

  test("omni_reference_task_type and output_format are Seedance 2.5 only", () => {
    const r = safeUnchecked({
      model: "dreamina-seedance-2-0-260128",
      content: [TEXT],
      omni_reference_task_type: "reference",
      output_format: "mov",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path[0]).sort()).toEqual([
        "omni_reference_task_type",
        "output_format",
      ]);
    }
  });

  test("priority is Seedance 2.x only", () => {
    const r = safeUnchecked({ model: "seedance-1-0-pro-250528", content: [TEXT], priority: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["priority"]);
  });

  test("resolution enums are per model", () => {
    expect(
      safeUnchecked({ model: "dreamina-seedance-2-0-260128", content: [TEXT], resolution: "4k" }).ok,
    ).toBe(true);
    const fast = safeUnchecked({
      model: "dreamina-seedance-2-0-fast-260128",
      content: [TEXT],
      resolution: "1080p",
    });
    expect(fast.ok).toBe(false);
    if (!fast.ok) {
      expect(fast.errors[0]?.code).toBe("invalid_enum_value");
      expect(fast.errors[0]?.meta?.["allowed"]).toEqual(["480p", "720p"]);
    }
  });

  test("offline inference is unavailable on the 2.x models", () => {
    const r = safeUnchecked({
      model: "dreamina-seedance-2-5-260628",
      content: [TEXT],
      service_tier: "flex",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["service_tier"]);
    expect(
      safeUnchecked({ model: "seedance-1-0-pro-250528", content: [TEXT], service_tier: "flex" }).ok,
    ).toBe(true);
  });
});

describe("bytedance.contentGenerationTasks output-spec rules", () => {
  test("duration ranges are per model", () => {
    expect(safeUnchecked({ model: "seedance-1-0-pro-250528", content: [TEXT], duration: 2 }).ok).toBe(
      true,
    );
    const tooShort = safeUnchecked({
      model: "seedance-1-5-pro-251215",
      content: [TEXT],
      duration: 2,
    });
    expect(tooShort.ok).toBe(false);
    if (!tooShort.ok) expect(tooShort.errors[0]?.message).toContain("4–12 seconds");

    const tooLong = safeUnchecked({
      model: "dreamina-seedance-2-0-260128",
      content: [TEXT],
      duration: 30,
    });
    expect(tooLong.ok).toBe(false);
    expect(
      safeUnchecked({ model: "dreamina-seedance-2-5-260628", content: [TEXT], duration: 30 }).ok,
    ).toBe(true);
  });

  test("duration -1 is documented for 2.x and 1.5 pro only", () => {
    expect(safeUnchecked({ model: "seedance-1-5-pro-251215", content: [TEXT], duration: -1 }).ok).toBe(
      true,
    );
    const legacy = safeUnchecked({
      model: "seedance-1-0-pro-250528",
      content: [TEXT],
      duration: -1,
    });
    expect(legacy.ok).toBe(false);
    if (!legacy.ok) expect(legacy.errors[0]?.path).toEqual(["duration"]);
  });

  test("frames must be 25 + 4n inside [29, 289]", () => {
    expect(safeUnchecked({ model: "seedance-1-0-pro-250528", content: [TEXT], frames: 57 }).ok).toBe(
      true,
    );
    for (const frames of [58, 25, 293]) {
      const r = safeUnchecked({ model: "seedance-1-0-pro-250528", content: [TEXT], frames });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.path).toEqual(["frames"]);
    }
  });

  test("Seedance 1.0 has no adaptive ratio for text-to-video", () => {
    const r = safeUnchecked({
      model: "seedance-1-0-pro-250528",
      content: [TEXT],
      ratio: "adaptive",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["ratio"]);
    // …but image-to-video does support it.
    expect(
      safeUnchecked({
        model: "seedance-1-0-pro-250528",
        content: [TEXT, IMAGE("first_frame")],
        ratio: "adaptive",
      }).ok,
    ).toBe(true);
  });

  test("Seedance 2.5 image-to-video only supports the adaptive ratio", () => {
    const r = safeUnchecked({
      model: "dreamina-seedance-2-5-260628",
      content: [TEXT, IMAGE("first_frame")],
      ratio: "16:9",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("only supports `adaptive`");
    // Text-to-video on the same model may name a ratio.
    expect(
      safeUnchecked({ model: "dreamina-seedance-2-5-260628", content: [TEXT], ratio: "16:9" }).ok,
    ).toBe(true);
  });

  test("ratio is a closed enum", () => {
    const r = safeUnchecked({ model: "seedance-1-0-pro-250528", content: [TEXT], ratio: "5:4" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
  });
});

describe("bytedance.contentGenerationTasks content rules", () => {
  test("omni reference input is rejected on the 1.x models", () => {
    const r = safeUnchecked({
      model: "seedance-1-5-pro-251215",
      content: [TEXT, IMAGE("reference_image"), VIDEO],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.every((e) => e.code === "unsupported_capability")).toBe(true);
      expect(r.errors.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("reference counts are capped per model", () => {
    const many = Array.from({ length: 10 }, () => IMAGE("reference_image"));
    const r = safeUnchecked({ model: "dreamina-seedance-2-0-260128", content: [TEXT, ...many] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta).toMatchObject({ count: 10, limit: 9 });
    // Seedance 2.5 accepts up to 30.
    expect(
      safeUnchecked({ model: "dreamina-seedance-2-5-260628", content: [TEXT, ...many] }).ok,
    ).toBe(true);
  });

  test("first-frame and omni-reference scenarios cannot be mixed", () => {
    const r = safeUnchecked({
      model: "dreamina-seedance-2-0-260128",
      content: [TEXT, IMAGE("first_frame"), IMAGE("reference_image")],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.message.includes("mutually exclusive"))).toBe(true);
  });

  test("last-frame images are rejected on Seedance 1.0 pro fast", () => {
    const r = safeUnchecked({
      model: "seedance-1-0-pro-fast-251015",
      content: [IMAGE("first_frame"), IMAGE("last_frame")],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("first-frame image-to-video only");
    expect(
      safeUnchecked({
        model: "seedance-1-0-pro-250528",
        content: [IMAGE("first_frame"), IMAGE("last_frame")],
      }).ok,
    ).toBe(true);
  });

  test("the 2.0 series rejects audio-only input", () => {
    const r = safeUnchecked({ model: "dreamina-seedance-2-0-260128", content: [TEXT, AUDIO] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("audio-only input");
    // Seedance 2.5 does support it.
    expect(safeUnchecked({ model: "dreamina-seedance-2-5-260628", content: [TEXT, AUDIO] }).ok).toBe(
      true,
    );
  });

  test("draft task references are Seedance 1.5 pro only", () => {
    expect(
      safeUnchecked({
        model: "seedance-1-5-pro-251215",
        content: [{ type: "draft_task", draft_task: { id: "cgt-123" } }],
      }).ok,
    ).toBe(true);
    const r = safeUnchecked({
      model: "seedance-1-0-pro-250528",
      content: [{ type: "draft_task", draft_task: { id: "cgt-123" } }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("draft mode is a Seedance 1.5 pro capability");
  });

  test("inline frame images are measured against the documented bounds", () => {
    const r = safeUnchecked({
      model: "seedance-1-0-pro-250528",
      content: [TEXT, { type: "image_url", image_url: { url: pngDataUri(100, 100) } }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("media_dimensions_exceeded");
      expect(r.errors[0]?.path).toEqual(["content", 1, "image_url", "url"]);
    }
  });

  test("edit and extend sub-tasks carry their documented constraints", () => {
    const noVideo = safeUnchecked({
      model: "dreamina-seedance-2-5-260628",
      content: [TEXT],
      omni_reference_task_type: "edit",
      ratio: "16:9",
      duration: 5,
    });
    expect(noVideo.ok).toBe(false);
    if (!noVideo.ok) {
      expect(noVideo.errors.map((e) => e.path[0]).sort()).toEqual(["content", "duration", "ratio"]);
    }
    expect(
      safeUnchecked({
        model: "dreamina-seedance-2-5-260628",
        content: [TEXT, VIDEO],
        omni_reference_task_type: "edit",
        ratio: "adaptive",
        duration: -1,
      }).ok,
    ).toBe(true);
  });

  test("draft mode forces 480p and excludes flex + last-frame return", () => {
    const r = safeUnchecked({
      model: "seedance-1-5-pro-251215",
      content: [TEXT],
      draft: true,
      resolution: "720p",
      return_last_frame: true,
      service_tier: "flex",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path[0]).sort()).toEqual([
        "resolution",
        "return_last_frame",
        "service_tier",
      ]);
    }
  });

  test("throwing form raises UnmodelValidationError", () => {
    expect(() =>
      contentGenerationTasks({
        model: "seedance-1-0-pro-250528",
        content: [{ type: "text", text: "hi" }],
        duration: 20,
      }),
    ).toThrow(UnmodelValidationError);
  });
});

describe("bytedance.contentGenerationTasks cost estimation", () => {
  test("per-second rates follow the documented resolution tiers", () => {
    expect(videoUsdPerSecond("dreamina-seedance-2-0-260128", {})).toBeCloseTo(0.15, 10);
    expect(videoUsdPerSecond("dreamina-seedance-2-0-260128", { resolution: "4k" })).toBeCloseTo(
      0.78,
      10,
    );
    // Seedance 1.5 pro halves with silent output and applies the draft factor.
    expect(videoUsdPerSecond("seedance-1-5-pro-251215", { generateAudio: false })).toBeCloseTo(
      0.026,
      10,
    );
    expect(
      videoUsdPerSecond("seedance-1-5-pro-251215", { resolution: "480p", draft: true }),
    ).toBeCloseTo(0.024 * 0.6, 10);
  });

  test("the estimate uses the documented duration default", () => {
    const r = contentGenerationTasks.safe({
      model: "seedance-1-0-pro-250528",
      content: [{ type: "text", text: "hi" }],
    });
    expect(r.ok).toBe(true);
    // 1080p default × 5s default.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.61, 10);
  });

  test("frames win over duration and convert at 24 fps", () => {
    expect(
      videoCostUSD("seedance-1-0-pro-250528", { frames: 121, duration: 5, resolution: "720p" }),
    ).toBeCloseTo(0.052 * (121 / 24), 10);
  });

  test("a model-selected length yields no estimate", () => {
    const r = contentGenerationTasks.safe({
      model: "dreamina-seedance-2-5-260628",
      content: [{ type: "text", text: "hi" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
    expect(
      videoCostUSD("dreamina-seedance-2-5-260628", { duration: 10 }),
    ).toBeCloseTo(2.31, 10);
  });

  test("maxCostUSD fails a 4K request over budget", () => {
    const r = safeUnchecked(
      {
        model: "dreamina-seedance-2-0-260128",
        content: [TEXT],
        resolution: "4k",
        duration: 10,
      },
      { maxCostUSD: 1 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("over_budget");
  });
});
