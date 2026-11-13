import { describe, expect, test } from "bun:test";
import { video, TEXT_TO_VIDEO_URL } from "./video";
import { RUNWAY_VERSION } from "./shared";
import { videoConstraints } from "./constraints";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = video.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("runway.video happy path", () => {
  test("returns a wire-pure body with URL, method and version header", () => {
    const v = video({
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
    const v = video({ model: "gen4.5", promptText: "hi", ratio: "1280:720", duration: 5 });
    const toSdk = v.toSdk as (target: string) => unknown;
    // Video endpoints declare no "ai-sdk" target: the AI SDK's video
    // primitive is still `experimental_generateVideo`.
    expect(() => toSdk("ai-sdk")).toThrow(TypeError);
    expect(() => toSdk("runway")).not.toThrow();
  });

  test("unknown model warns but validates", () => {
    const r = video.safe({ model: "gen6", promptText: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("seedance2_5 does not require promptText", () => {
    const r = video.safe({ model: "seedance2_5", ratio: "1280:720", duration: 5 });
    expect(r.ok).toBe(true);
  });
});

describe("runway.video route/model rules", () => {
  test("gen4_turbo is image-to-video only: unsupported_capability", () => {
    const r = video.safe({
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
    const r = video.safe({
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
    const r = video.safe({ model: "veo3.1", ratio: "1280:720" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path[0])).toContain("promptText");
    }
  });

  test("references on veo3.1 is unsupported_param", () => {
    const r = video.safe({
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

describe("runway.video cost estimation", () => {
  test("seedance2 rate follows the ratio tier (720p vs 4K)", () => {
    const small = video.safe({
      model: "seedance2",
      promptText: "hi",
      ratio: "1280:720",
      duration: 10,
    });
    expect(small.ok).toBe(true);
    if (small.ok) expect(small.estimate.costUSD).toBeCloseTo(3.6, 10); // 36 cr/s

    const fourK = video.safe({
      model: "seedance2",
      promptText: "hi",
      ratio: "3840:2160",
      duration: 10,
    });
    expect(fourK.ok).toBe(true);
    if (fourK.ok) expect(fourK.estimate.costUSD).toBeCloseTo(15, 10); // 150 cr/s
  });

  test("hailuo3 adds 2 credits per reference image", () => {
    const r = video.safe({
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
    const r = video.safe({
      model: "seedance2_5",
      promptText: "hi",
      ratio: "854:480",
      duration: 4,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.8, 10);
  });
});

describe("runway.video route support and shape rules", () => {
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
      video.safe({
        model: "grok_imagine_1_5",
        promptText: "x",
        references: Array(7).fill(ref),
      }).ok,
    ).toBe(true);

    const over = video.safe({
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
      video.safe({ model: "seedance2_5", references: Array(30).fill(ref) }).ok,
    ).toBe(true);
  });

  test("promptText is capped per model", () => {
    const r = video.safe({
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

describe("runway.video documented enum coverage", () => {
  // RunwayVideoRatio and RunwayVideoResolution are derived from these same
  // per-model tables, so iterating the tables proves every value the types
  // advertise is one the runtime accepts for the model that documents it.
  test("every documented ratio and resolution validates on its own model", () => {
    for (const [model, constraints] of Object.entries(videoConstraints)) {
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

describe("runway.video — Kling, WAN, H3 Max, Grok Lite and Gemini Omni 1.x arms", () => {
  const TEXT = "a fox runs";
  const CLIP = "https://example.com/clip.mp4";

  test.each([
    ["kling2.5_turbo_pro", { promptText: TEXT, ratio: "1920:1080", duration: 10 }, 1.2],
    ["kling3.0_standard", { ratio: "1280:720", duration: 5, audio: false }, 0.45],
    ["klingO3_pro", { ratio: "1440:1440", duration: 5 }, 0.85],
    // kling_4's documented tiers: 940:940 is 720p, 1440:1440 is 1080p.
    ["kling_4", { promptText: TEXT, ratio: "940:940", duration: 5 }, 0.79],
    ["kling_4", { promptText: TEXT, ratio: "1440:1440", duration: 5 }, 1.18],
    ["kling_4_flash", { promptText: TEXT, ratio: "1464:628", duration: 5 }, 0.47],
    ["wan3", { promptText: TEXT, duration: 5 }, 1],
    ["wan3_prime", { promptText: TEXT, ratio: "624:624", duration: 5 }, 0.34],
    ["h3_max", { promptText: TEXT, resolution: "768p", duration: 6 }, 0.48],
    ["grok_imagine_1_5_lite", { promptText: TEXT, ratio: "1904:1072", duration: 5 }, 0.7],
    ["grok_imagine_1_5_lite", { promptText: TEXT, duration: 5 }, 0.1],
    // 1080p: 15 credits/s + 1 per reference image.
    [
      "gemini_omni_flash_1.1",
      { promptText: TEXT, ratio: "1920:1080", duration: 4, references: [{ uri: "https://example.com/a.png" }] },
      0.61,
    ],
    ["gemini_omni_flash_1.2", { promptText: TEXT, ratio: "3840:2160", duration: 3 }, 0.63],
  ] as const)("%s validates warning-free and prices (%o)", (model, extra, usd) => {
    const r = safeUnchecked({ model, ...extra });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    expect(r.estimate.costUSD).toBeCloseTo(usd, 10);
  });

  test("the Kling 3.0 / O3 arms require ratio, not promptText", () => {
    const none = safeUnchecked({ model: "kling3.0_4k", duration: 5 });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.errors[0]).toMatchObject({ code: "invalid_shape", path: ["ratio"] });
    expect(safeUnchecked({ model: "kling3.0_4k", ratio: "2880:2880" }).ok).toBe(true);
    // …and each variant takes its own sizes only.
    const pro = safeUnchecked({ model: "klingO3_pro", ratio: "1280:720" });
    expect(pro.ok).toBe(false);
    if (!pro.ok) expect(pro.errors[0]?.code).toBe("invalid_enum_value");
  });

  test("kling2.5_turbo_pro runs 5 or 10 seconds", () => {
    const r = safeUnchecked({ model: "kling2.5_turbo_pro", promptText: TEXT, duration: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta?.allowed).toEqual([5, 10]);
  });

  test("Gemini Omni Flash 1.x reference videos are bare { uri } items; seedance's carry type", () => {
    expect(
      safeUnchecked({ model: "gemini_omni_flash_1.2", promptText: TEXT, referenceVideos: [{ uri: CLIP }] }).ok,
    ).toBe(true);
    const typed = safeUnchecked({
      model: "gemini_omni_flash_1.1",
      promptText: TEXT,
      referenceVideos: [{ type: "video", uri: CLIP }],
    });
    expect(typed.ok).toBe(false);
    const untyped = safeUnchecked({ model: "seedance2", promptText: TEXT, referenceVideos: [{ uri: CLIP }] });
    expect(untyped.ok).toBe(false);
    if (!untyped.ok) {
      expect(untyped.errors[0]).toMatchObject({ code: "invalid_shape", path: ["referenceVideos", 0, "type"] });
    }
  });

  test("kling_4 takes no audio and grok_imagine_1_5_lite no references", () => {
    const audio = safeUnchecked({ model: "kling_4", promptText: TEXT, audio: true });
    expect(audio.ok).toBe(false);
    if (!audio.ok) expect(audio.errors[0]).toMatchObject({ code: "unsupported_param", path: ["audio"] });
    const refs = safeUnchecked({
      model: "grok_imagine_1_5_lite",
      promptText: TEXT,
      references: [{ uri: "https://example.com/a.png" }],
    });
    expect(refs.ok).toBe(false);
  });
});
