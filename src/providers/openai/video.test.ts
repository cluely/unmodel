import { describe, expect, test } from "bun:test";
import {
  video,
  VIDEOS_URL,
  DEFAULT_VIDEO_MODEL_ID,
  DEFAULT_VIDEO_SECONDS,
  DEFAULT_VIDEO_SIZE,
} from "./video";
import { SORA_MODELS, SORA_RATE_PER_SECOND } from "./videos-models";
import { videoConstraints } from "./constraints";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the Tier-A compile-time surface so runtime enforcement of
// type-blocked params can be exercised.
const safeUnchecked = video.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("openai.video happy path", () => {
  test("returns a wire-pure body with hidden toSdk/request", () => {
    const params = {
      model: "sora-2" as const,
      prompt: "a calico cat pounces through tall grass",
      size: "1280x720" as const,
      seconds: "8" as const,
    };
    const v = video(params);

    expect(Object.keys(v)).toEqual(["model", "prompt", "size", "seconds"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(VIDEOS_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    expect(v.toSdk("openai")).toEqual(params);
  });

  test("model omitted validates against the documented sora-2 default", () => {
    const r = video.safe({ prompt: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      // 4s (default) x $0.10/s (sora-2 720p default size).
      expect(r.estimate.costUSD).toBeCloseTo(0.4, 10);
    }
  });

  test("input_reference with exactly one of file_id/image_url passes", () => {
    const byFile = video.safe({
      model: "sora-2",
      prompt: "x",
      input_reference: { file_id: "file-abc" },
    });
    expect(byFile.ok).toBe(true);

    const byUrl = video.safe({
      model: "sora-2",
      prompt: "x",
      input_reference: { image_url: "https://example.com/first-frame.png" },
    });
    expect(byUrl.ok).toBe(true);
  });

  test("unknown model falls back to the escape arm with warnings", () => {
    const r = video.safe({ model: "sora-3", prompt: "x", brand_new_param: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const codes = r.warnings.map((w) => w.code);
      expect(codes).toContain("unknown_model");
      expect(codes).toContain("unknown_param");
    }
  });

  test("dated snapshots validate without warnings", () => {
    const r = video.safe({ model: "sora-2-pro-2025-10-06", prompt: "x", size: "1792x1024" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });
});

describe("openai.video per-model size/seconds constraints", () => {
  test("sora-2 renders 720p only: 1024p size is invalid_enum_value", () => {
    const r = safeUnchecked({ model: "sora-2", prompt: "x", size: "1024x1792" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["size"]);
      expect(issue?.message).toContain('"720x1280"');
    }
  });

  test("model omitted still enforces the sora-2 (default) size set", () => {
    const r = safeUnchecked({ prompt: "x", size: "1920x1080" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
  });

  test("sora-2-pro accepts 1024p and 1080p sizes", () => {
    for (const size of ["1024x1792", "1792x1024", "1920x1080", "1080x1920"] as const) {
      const r = video.safe({ model: "sora-2-pro", prompt: "x", size });
      expect(r.ok).toBe(true);
    }
  });

  test("seconds outside the documented set is invalid_enum_value", () => {
    const r = safeUnchecked({ model: "sora-2", prompt: "x", seconds: "6" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["seconds"]);
    }
  });

  test('guide-documented "16" and "20" second clips pass', () => {
    for (const seconds of ["16", "20"] as const) {
      const r = video.safe({ model: "sora-2-pro", prompt: "x", seconds });
      expect(r.ok).toBe(true);
    }
  });

  test("numeric seconds is an invalid_shape error (the wire wants strings)", () => {
    const r = safeUnchecked({ model: "sora-2", prompt: "x", seconds: 8 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("the throwing form throws with the enum issue", () => {
    const videoUnchecked = video as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      videoUnchecked({ model: "sora-2", prompt: "x", size: "1080x1920" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });

  test("constraintsFor exposes the per-model enum tables", () => {
    expect(video.constraintsFor("sora-2")[0]?.enums?.size).toEqual(["720x1280", "1280x720"]);
    expect(video.constraintsFor("sora-2-pro")[0]?.enums?.size).toContain("1920x1080");
    expect(videoConstraints["sora-2"].enums.seconds).toEqual(["4", "8", "12", "16", "20"]);
  });
});

describe("openai.video input_reference pairing", () => {
  test("both file_id and image_url is an invalid_shape error", () => {
    const r = video.safe({
      model: "sora-2",
      prompt: "x",
      input_reference: { file_id: "file-abc", image_url: "https://example.com/a.png" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["input_reference"]);
      expect(r.errors[0]?.message).toContain("both");
    }
  });

  test("an empty input_reference object is an invalid_shape error", () => {
    const r = video.safe({ model: "sora-2", prompt: "x", input_reference: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("neither");
  });
});

describe("openai.video catalog wiring", () => {
  test("catalog-known non-video models are unsupported_capability", () => {
    const r = safeUnchecked({ model: "gpt-4o", prompt: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_capability");
      expect(issue?.path).toEqual(["model"]);
      expect(issue?.message).toContain("does not generate video");
    }
  });

  test("hand catalog follows the non-token-model contract", () => {
    for (const info of Object.values(SORA_MODELS)) {
      expect(info.limit.context).toBe(0);
      expect(info.cost.perVideoSecond).toBeGreaterThan(0);
      expect(info.modalities.output).toEqual(["video"]);
    }
    expect(DEFAULT_VIDEO_MODEL_ID in SORA_MODELS).toBe(true);
  });
});

describe("openai.video cost estimation", () => {
  test("cost is seconds x per-resolution rate", () => {
    const r = video.safe({ model: "sora-2-pro", prompt: "x", size: "1920x1080", seconds: "12" });
    expect(r.ok).toBe(true);
    // 12s x $0.70/s (sora-2-pro 1080p).
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(8.4, 10);
  });

  test("defaults price at the documented default size/seconds", () => {
    const rate = SORA_RATE_PER_SECOND[DEFAULT_VIDEO_MODEL_ID][DEFAULT_VIDEO_SIZE];
    const r = video.safe({ prompt: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(Number(DEFAULT_VIDEO_SECONDS) * rate!, 10);
  });

  test("maxCostUSD under the estimate is over_budget", () => {
    const r = video.safe(
      { model: "sora-2-pro", prompt: "x", size: "1920x1080", seconds: "12" },
      { maxCostUSD: 5 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });

  test("unknown models produce no cost estimate", () => {
    const r = video.safe({ model: "sora-3", prompt: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});
