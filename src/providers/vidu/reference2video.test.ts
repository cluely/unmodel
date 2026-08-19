import { describe, expect, test } from "bun:test";
import { reference2video, REFERENCE2VIDEO_URL } from "./reference2video";
import { imageFromReference, REFERENCE2IMAGE_URL } from "./image-from-reference";

describe("vidu.reference2video", () => {
  test("accepts the named-subjects form", () => {
    const v = reference2video({
      model: "viduq3",
      prompt: "@chef and @sous are cooking together",
      subjects: [
        { name: "chef", images: ["https://example.com/chef.png"] },
        { name: "sous", images: ["https://example.com/sous.png"] },
      ],
      duration: 8,
    });
    expect(v.request.url).toBe(REFERENCE2VIDEO_URL);
    expect(Object.keys(v)).toEqual(["model", "prompt", "subjects", "duration"]);
  });

  test("accepts the flat images form", () => {
    const r = reference2video.safe({
      model: "viduq3-mix",
      prompt: "a consistent character walks through a market",
      images: ["https://example.com/a.png"],
      duration: 5,
    });
    expect(r.ok).toBe(true);
  });

  test("references are required", () => {
    const r = reference2video.safe({ model: "viduq3", prompt: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.find((e) => e.code === "invalid_shape")?.path).toEqual(["images"]);
  });

  test("subjects are not available on viduq3-mix", () => {
    const r = reference2video.safe({
      model: "viduq3-mix",
      prompt: "hi",
      subjects: [{ name: "a", images: ["https://example.com/a.png"] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "unsupported_param")?.path).toEqual(["subjects"]);
    }
  });

  test("video references are viduq2-pro-only", () => {
    const r = reference2video.safe({
      model: "viduq3",
      prompt: "hi",
      videos: ["https://example.com/clip.mp4"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "unsupported_param")?.path).toEqual(["videos"]);
    }
  });

  test("viduq2-pro drops to 4 images when a video rides along", () => {
    const four = Array.from({ length: 4 }, (_, i) => `https://example.com/${i}.png`);
    expect(
      reference2video.safe({
        model: "viduq2-pro",
        prompt: "hi",
        images: four,
        videos: ["https://example.com/clip.mp4"],
        duration: 5,
      }).ok,
    ).toBe(true);

    const over = reference2video.safe({
      model: "viduq2-pro",
      prompt: "hi",
      images: [...four, "https://example.com/5.png"],
      videos: ["https://example.com/clip.mp4"],
      duration: 5,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors.find((e) => e.code === "invalid_shape")?.meta?.max).toBe(4);
  });

  test("a subject takes at most 3 images", () => {
    const r = reference2video.safe({
      model: "viduq3",
      prompt: "hi",
      subjects: [
        {
          name: "a",
          images: [
            "https://example.com/1.png",
            "https://example.com/2.png",
            "https://example.com/3.png",
            "https://example.com/4.png",
          ],
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["subjects", 0, "images"]);
  });

  test("viduq3 starts at 3 seconds on this route", () => {
    const r = reference2video.safe({
      model: "viduq3",
      prompt: "hi",
      images: ["https://example.com/a.png"],
      duration: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.find((e) => e.code === "invalid_enum_value")?.meta?.min).toBe(3);
  });

  test("every ViduResolution preset validates on the model that offers it", () => {
    // Keep in sync with ViduResolution in shared.ts — REFERENCE2VIDEO_SUPPORT
    // narrows the union per model here: the q3 models offer 540p/720p/1080p
    // and vidu2.0 is the only 360p arm.
    for (const resolution of ["540p", "720p", "1080p"] as const) {
      const r = reference2video.safe({
        model: "viduq3-turbo",
        prompt: "hi",
        images: ["https://example.com/a.png"],
        duration: 5,
        resolution,
      });
      expect(r.ok, `${resolution} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `${resolution}`).toEqual([]);
    }
    for (const resolution of ["360p", "720p"] as const) {
      const r = reference2video.safe({
        model: "vidu2.0",
        prompt: "hi",
        images: ["https://example.com/a.png"],
        duration: 4,
        resolution,
      });
      expect(r.ok, `vidu2.0 ${resolution} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `vidu2.0 ${resolution}`).toEqual([]);
    }
  });

  test("reference2video has its own cheaper turbo rate", () => {
    const r = reference2video.safe({
      model: "viduq3-turbo",
      prompt: "hi",
      images: ["https://example.com/a.png"],
      resolution: "720p",
      duration: 10,
    });
    expect(r.ok).toBe(true);
    // $0.05/s here vs $0.055/s on text2video.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.5, 10);
  });
});

describe("vidu.imageFromReference", () => {
  test("text-to-image needs no references on viduq2", () => {
    const v = imageFromReference({
      model: "viduq2",
      prompt: "a lighthouse at dusk",
      resolution: "2K",
    });
    expect(v.request.url).toBe(REFERENCE2IMAGE_URL);
    expect(Object.keys(v)).toEqual(["model", "prompt", "resolution"]);
  });

  test("viduq1 requires at least one reference", () => {
    const r = imageFromReference.safe({ model: "viduq1", prompt: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.find((e) => e.code === "invalid_shape")?.meta?.min).toBe(1);
  });

  test("viduq1 is 1080p-only", () => {
    const r = imageFromReference.safe({
      model: "viduq1",
      prompt: "hi",
      images: ["https://example.com/a.png"],
      resolution: "4K",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "invalid_enum_value")?.meta?.allowed).toEqual([
        "1080p",
      ]);
    }
  });

  test("video-only model ids warn as unknown here", () => {
    const r = imageFromReference.safe({ model: "viduq3-pro", prompt: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("every ViduImageAspectRatio and ViduImageResolution preset validates", () => {
    // Keep in sync with ViduImageAspectRatio / ViduImageResolution in
    // image-from-reference.ts — viduq2 is the wider arm and accepts both sets
    // whole; checkModelRules narrows them for viduq1 (no 21:9 / 2:3 / 3:2,
    // 1080p only).
    const ratios = [
      "16:9", "9:16", "1:1", "3:4", "4:3", "21:9", "2:3", "3:2", "auto",
    ] as const;
    for (const aspect_ratio of ratios) {
      const r = imageFromReference.safe({ model: "viduq2", prompt: "hi", aspect_ratio });
      expect(r.ok, `aspect_ratio ${aspect_ratio} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `aspect_ratio ${aspect_ratio}`).toEqual([]);
    }
    for (const resolution of ["1080p", "2K", "4K"] as const) {
      const r = imageFromReference.safe({ model: "viduq2", prompt: "hi", resolution });
      expect(r.ok, `resolution ${resolution} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `resolution ${resolution}`).toEqual([]);
    }
  });

  test("per-image price follows the reference count band", () => {
    const few = imageFromReference.safe({
      model: "viduq2",
      prompt: "hi",
      images: ["https://example.com/a.png"],
      resolution: "4K",
    });
    expect(few.ok).toBe(true);
    if (few.ok) expect(few.estimate.costUSD).toBeCloseTo(0.1, 10);

    const many = imageFromReference.safe({
      model: "viduq2",
      prompt: "hi",
      images: Array.from({ length: 5 }, (_, i) => `https://example.com/${i}.png`),
      resolution: "4K",
    });
    expect(many.ok).toBe(true);
    if (many.ok) expect(many.estimate.costUSD).toBeCloseTo(0.15, 10);
  });

  test("prompt caps at 2000 characters on the image route", () => {
    const r = imageFromReference.safe({ model: "viduq2", prompt: "a".repeat(2001) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["prompt"]);
  });
});
