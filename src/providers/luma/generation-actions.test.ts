import { describe, expect, test } from "bun:test";
import { videoUpscale, upscaleUrl } from "./video-upscale";
import { videoAddAudio, addAudioUrl } from "./video-add-audio";
import { LUMA_VIDEO_RESOLUTIONS } from "./video";
import { DREAM_MACHINE_BASE_URL } from "./shared";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUpscale = videoUpscale.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const ID = "123e4567-e89b-12d3-a456-426614174000";

describe("luma.videoUpscale", () => {
  test("strips the path param from the body and puts it in the URL", () => {
    const v = videoUpscale({ id: ID, resolution: "4k" });
    expect(Object.keys(v)).toEqual(["resolution"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual({ resolution: "4k" });
    expect(v.request.url).toBe(`${DREAM_MACHINE_BASE_URL}/generations/${ID}/upscale`);
    expect(v.request.method).toBe("POST");
  });

  test("upscaleUrl percent-encodes the id", () => {
    expect(upscaleUrl("a b/c")).toBe(`${DREAM_MACHINE_BASE_URL}/generations/a%20b%2Fc/upscale`);
  });

  test("id is required and non-empty", () => {
    expect(safeUpscale({ resolution: "4k" }).ok).toBe(false);
    expect(safeUpscale({ id: "", resolution: "4k" }).ok).toBe(false);
  });

  test("resolution is checked against the documented values", () => {
    expect(videoUpscale.safe({ id: ID, resolution: "1080p" }).ok).toBe(true);
    const r = videoUpscale.safe({ id: ID, resolution: "8k" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["resolution"]);
      expect(issue?.meta?.allowed).toEqual(["540p", "720p", "1080p", "4k"]);
    }
  });

  test("every LumaVideoResolution preset passes cleanly", () => {
    // Keep in sync with LumaVideoResolution in video.ts — this route
    // shares the generate route's documented resolution list, and carries no
    // `model`, so no per-model narrowing applies and the whole union is legal.
    for (const resolution of LUMA_VIDEO_RESOLUTIONS) {
      const r = videoUpscale.safe({ id: ID, resolution });
      expect(r.ok, `preset ${resolution} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `preset ${resolution} should be warning-free`).toEqual([]);
    }
  });

  test("no model on the wire means no unknown_model warning", () => {
    const r = videoUpscale.safe({ id: ID });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });
});

describe("luma.videoAddAudio", () => {
  test("strips the path param from the body and puts it in the URL", () => {
    const v = videoAddAudio({
      id: ID,
      prompt: "distant thunder and rain on pavement",
      negative_prompt: "music",
    });
    expect(Object.keys(v)).toEqual(["prompt", "negative_prompt"]);
    expect(v.request.url).toBe(`${DREAM_MACHINE_BASE_URL}/generations/${ID}/audio`);
    expect(addAudioUrl(ID)).toBe(v.request.url);
  });

  test("an empty body is valid — the spec marks nothing required", () => {
    const r = videoAddAudio.safe({ id: ID });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("toSdk returns the body unchanged in shape", () => {
    const v = videoAddAudio({ id: ID, prompt: "rain" });
    expect(v.toSdk("luma")).toEqual({ prompt: "rain" });
  });
});
