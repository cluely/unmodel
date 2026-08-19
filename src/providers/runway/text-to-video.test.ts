import { describe, expect, test } from "bun:test";
import { textToVideo, TEXT_TO_VIDEO_URL } from "./text-to-video";
import { RUNWAY_VERSION } from "./shared";
import { textToVideoConstraints } from "./constraints";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = textToVideo.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("runway.textToVideo happy path", () => {
  test("returns a wire-pure body with URL, method and version header", () => {
    const v = textToVideo({
      model: "gen4.5",
      promptText: "a slow dolly shot through a neon alley",
      ratio: "1280:720",
      duration: 5,
    });
    expect(Object.keys(v)).toEqual(["model", "promptText", "ratio", "duration"]);
    expect(v.request.url).toBe(TEXT_TO_VIDEO_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["x-runway-version"]).toBe(RUNWAY_VERSION);
    expect(v.toSdk("runway")).toEqual({
      model: "gen4.5",
      promptText: "a slow dolly shot through a neon alley",
      ratio: "1280:720",
      duration: 5,
    });
  });

  test("\"runway\" is the endpoint's only SDK target", () => {
    const v = textToVideo({ model: "gen4.5", promptText: "hi", ratio: "1280:720", duration: 5 });
    const toSdk = v.toSdk as (target: string) => unknown;
    // Video endpoints declare no "ai-sdk" target: the AI SDK's video
    // primitive is still `experimental_generateVideo`.
    expect(() => toSdk("ai-sdk")).toThrow(TypeError);
    expect(() => toSdk("runway")).not.toThrow();
  });

  test("unknown model warns but validates", () => {
    const r = textToVideo.safe({ model: "gen6", promptText: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("seedance2_5 does not require promptText", () => {
    const r = textToVideo.safe({ model: "seedance2_5", ratio: "1280:720", duration: 5 });
    expect(r.ok).toBe(true);
  });
});

describe("runway.textToVideo route/model rules", () => {
  test("gen4_turbo is image-to-video only: unsupported_capability", () => {
    const r = textToVideo.safe({
      model: "gen4_turbo",
      promptText: "hi",
      ratio: "1280:720",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_capability");
      expect(issue?.path).toEqual(["model"]);
      expect(String(issue?.meta?.source)).toContain("docs.dev.runwayml.com");
    }
  });

  test("gen4.5 text_to_video only offers 1280:720 and 720:1280", () => {
    // 1104:832 is valid on image_to_video but not here.
    const r = textToVideo.safe({
      model: "gen4.5",
      promptText: "hi",
      ratio: "1104:832",
      duration: 5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["ratio"]);
      expect(issue?.meta?.allowed).toEqual(["1280:720", "720:1280"]);
    }
  });

  test("missing promptText on veo3.1 is invalid_shape", () => {
    const r = textToVideo.safe({ model: "veo3.1", ratio: "1280:720" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path[0])).toContain("promptText");
    }
  });

  test("references on veo3.1 is unsupported_param", () => {
    const r = textToVideo.safe({
      model: "veo3.1",
      promptText: "hi",
      ratio: "1280:720",
      references: [{ uri: "https://example.com/a.png" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "unsupported_param")?.path).toEqual(["references"]);
    }
  });

  test("grok_imagine_1_5 resolution enum", () => {
    // "4k" is not a documented Runway video resolution at all, so it is no
    // longer assignable to RunwayVideoResolution — the runtime path stays
    // reachable through the unchecked alias.
    const r = safeUnchecked({
      model: "grok_imagine_1_5",
      promptText: "hi",
      resolution: "4k",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.meta?.allowed).toEqual(["480p", "720p", "1080p"]);
    }
  });

  test("malformed reference arrays are invalid_shape", () => {
    const r = safeUnchecked({
      model: "seedance2",
      promptText: "hi",
      referenceVideos: [{ type: "video" }], // missing uri
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });
});

describe("runway.textToVideo cost estimation", () => {
  test("seedance2 rate follows the ratio tier (720p vs 4K)", () => {
    const small = textToVideo.safe({
      model: "seedance2",
      promptText: "hi",
      ratio: "1280:720",
      duration: 10,
    });
    expect(small.ok).toBe(true);
    if (small.ok) expect(small.estimate.costUSD).toBeCloseTo(3.6, 10); // 36 cr/s

    const fourK = textToVideo.safe({
      model: "seedance2",
      promptText: "hi",
      ratio: "3840:2160",
      duration: 10,
    });
    expect(fourK.ok).toBe(true);
    if (fourK.ok) expect(fourK.estimate.costUSD).toBeCloseTo(15, 10); // 150 cr/s
  });

  test("hailuo3 adds 2 credits per reference image", () => {
    const r = textToVideo.safe({
      model: "hailuo3",
      promptText: "hi",
      resolution: "768P",
      duration: 5,
      references: [{ uri: "https://example.com/a.png" }, { uri: "https://example.com/b.png" }],
    });
    expect(r.ok).toBe(true);
    // 5s × 10 credits + 2 refs × 2 credits = 54 credits
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.54, 10);
  });

  test("seedance2_5 applies the 80-credit minimum", () => {
    // 4s × 20 credits (480p tier) = 80 credits — exactly the documented
    // minimum, so shorter-than-minimum billing cannot occur below it.
    const r = textToVideo.safe({
      model: "seedance2_5",
      promptText: "hi",
      ratio: "854:480",
      duration: 4,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.8, 10);
  });
});

describe("runway.textToVideo route support and shape rules", () => {
  test("aleph2 is video_to_video-only and rejected here", () => {
    const r = safeUnchecked({ model: "aleph2", promptText: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_capability");
      expect(issue?.path).toEqual(["model"]);
      expect(issue?.message).toContain("video_to_video");
    }
  });

  test("reference arrays are capped per model", () => {
    const ref = { uri: "https://example.com/ref.png" };
    // grok_imagine_1_5: references max 7.
    expect(
      textToVideo.safe({
        model: "grok_imagine_1_5",
        promptText: "x",
        references: Array(7).fill(ref),
      }).ok,
    ).toBe(true);

    const over = textToVideo.safe({
      model: "grok_imagine_1_5",
      promptText: "x",
      references: Array(8).fill(ref),
    });
    expect(over.ok).toBe(false);
    if (!over.ok) {
      const issue = over.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["references"]);
      expect(issue?.meta?.max).toBe(7);
    }

    // seedance2_5 takes up to 30.
    expect(
      textToVideo.safe({ model: "seedance2_5", references: Array(30).fill(ref) }).ok,
    ).toBe(true);
  });

  test("promptText is capped per model", () => {
    const r = textToVideo.safe({
      model: "gen4.5",
      promptText: "a".repeat(1001),
      ratio: "1280:720",
      duration: 5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "invalid_shape")?.meta?.max).toBe(1000);
    }
  });
});

describe("runway.textToVideo documented enum coverage", () => {
  // RunwayVideoRatio and RunwayVideoResolution are derived from these same
  // per-model tables, so iterating the tables proves every value the types
  // advertise is one the runtime accepts for the model that documents it.
  test("every documented ratio and resolution validates on its own model", () => {
    for (const [model, constraints] of Object.entries(textToVideoConstraints)) {
      const enums = constraints?.enums;
      if (enums === undefined) continue;
      const duration = enums.duration?.[0];
      const base = { model, promptText: "hi", ...(duration !== undefined && { duration }) };
      for (const ratio of enums.ratio ?? []) {
        const r = safeUnchecked({ ...base, ratio });
        expect(r.ok, `${model} should accept ratio ${String(ratio)}`).toBe(true);
        if (r.ok) {
          expect(r.warnings, `${model} ratio ${String(ratio)} should be warning-free`).toEqual([]);
        }
      }
      for (const resolution of enums.resolution ?? []) {
        const r = safeUnchecked({ ...base, ...(enums.ratio?.[0] !== undefined && { ratio: enums.ratio[0] }), resolution });
        expect(r.ok, `${model} should accept resolution ${String(resolution)}`).toBe(true);
      }
    }
  });
});
