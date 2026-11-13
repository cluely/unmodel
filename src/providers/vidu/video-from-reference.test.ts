import { describe, expect, test } from "bun:test";
import { videoFromReference, REFERENCE2VIDEO_URL } from "./video-from-reference";
import { imageFromReference, REFERENCE2IMAGE_URL } from "./image-from-reference";

describe("vidu.videoFromReference", () => {
  test("accepts the named-subjects form", () => {
    const v = videoFromReference({
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
    const r = videoFromReference.safe({
      model: "viduq3-mix",
      prompt: "a consistent character walks through a market",
      images: ["https://example.com/a.png"],
      duration: 5,
    });
    expect(r.ok).toBe(true);
  });

  test("references are required", () => {
    const r = videoFromReference.safe({ model: "viduq3", prompt: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.find((e) => e.code === "invalid_shape")?.path).toEqual(["images"]);
  });

  test("subjects are not available on viduq3-mix", () => {
    const r = videoFromReference.safe({
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
    const r = videoFromReference.safe({
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
      videoFromReference.safe({
        model: "viduq2-pro",
        prompt: "hi",
        images: four,
        videos: ["https://example.com/clip.mp4"],
        duration: 5,
      }).ok,
    ).toBe(true);

    const over = videoFromReference.safe({
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
    const r = videoFromReference.safe({
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
    const r = videoFromReference.safe({
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
    // narrows the union per model here: the q3 models offer 540p/720p/1080p,
    // vidu2.0 is the only 360p arm and viduq4-preview the only 2K / 4K one.
    for (const resolution of ["540p", "720p", "1080p"] as const) {
      const r = videoFromReference.safe({
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
      const r = videoFromReference.safe({
        model: "vidu2.0",
        prompt: "hi",
        images: ["https://example.com/a.png"],
        duration: 4,
        resolution,
      });
      expect(r.ok, `vidu2.0 ${resolution} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `vidu2.0 ${resolution}`).toEqual([]);
    }
    for (const resolution of ["2K", "4K"] as const) {
      const r = videoFromReference.safe({
        model: "viduq4-preview",
        prompt: "hi",
        images: ["https://example.com/a.png"],
        resolution,
      });
      expect(r.ok, `viduq4-preview ${resolution} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `viduq4-preview ${resolution}`).toEqual([]);
    }
  });

  test("viduq4-preview takes up to 15 images, 3 sounds and 2K / 4K, unpriced", () => {
    const images = Array.from({ length: 15 }, (_, i) => `https://example.com/${i}.png`);
    const r = videoFromReference.safe({
      model: "viduq4-preview",
      prompt: "a".repeat(20000),
      images,
      sounds: ["https://example.com/a.mp3", "https://example.com/b.mp3", "https://example.com/c.mp3"],
      resolution: "4K",
      duration: 16,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(r.estimate.costUSD).toBeUndefined();
    }

    const tooMany = videoFromReference.safe({
      model: "viduq4-preview",
      prompt: "hi",
      images: [...images, "https://example.com/15.png"],
    });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) {
      const issue = tooMany.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["images"]);
      expect(issue?.meta?.max).toBe(15);
    }
  });

  test("subjects take server_id, and a bare name is a text subject", () => {
    const r = videoFromReference.safe({
      model: "viduq3",
      prompt: "@saved meets @narrator",
      subjects: [{ name: "saved", server_id: "subject-123" }, { name: "narrator" }],
      watermark: true,
      wm_position: 1,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("viduq2-pro takes subjects: 4 image or text, 2 video (1 temporary)", () => {
    const image = (name: string) => ({ name, images: [`https://example.com/${name}.png`] });
    const clip = "https://example.com/clip.mp4";
    const ok = videoFromReference.safe({
      model: "viduq2-pro",
      prompt: "hi",
      subjects: [
        image("a"),
        image("b"),
        image("c"),
        image("d"),
        { name: "v1", videos: [clip] },
        { name: "v2", videos: [clip], server_id: "subject-123" },
      ],
      duration: 5,
    });
    expect(ok.ok).toBe(true);

    const fiveImages = videoFromReference.safe({
      model: "viduq2-pro",
      prompt: "hi",
      subjects: ["a", "b", "c", "d", "e"].map(image),
      duration: 5,
    });
    expect(fiveImages.ok).toBe(false);
    if (!fiveImages.ok) {
      const issue = fiveImages.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["subjects"]);
      expect(issue?.meta?.max).toBe(4);
    }

    const twoTemporary = videoFromReference.safe({
      model: "viduq2-pro",
      prompt: "hi",
      subjects: [
        { name: "v1", videos: [clip] },
        { name: "v2", videos: [clip] },
      ],
      duration: 5,
    });
    expect(twoTemporary.ok).toBe(false);
    if (!twoTemporary.ok) {
      expect(twoTemporary.errors.find((e) => e.code === "invalid_shape")?.meta?.temporary).toBe(2);
    }

    const twoClips = videoFromReference.safe({
      model: "viduq2-pro",
      prompt: "hi",
      subjects: [{ name: "v1", videos: [clip, clip] }],
      duration: 5,
    });
    expect(twoClips.ok).toBe(false);
    if (!twoClips.ok) {
      expect(twoClips.errors.find((e) => e.code === "invalid_shape")?.path).toEqual([
        "subjects",
        0,
        "videos",
      ]);
    }
  });

  test("a saved subject's kind is on the server, so viduq2-pro bounds it by the total of 6", () => {
    const image = (name: string) => ({ name, images: [`https://example.com/${name}.png`] });
    const saved = (name: string) => ({ name, server_id: `subject-${name}` });
    const four = ["a", "b", "c", "d"].map(image);
    // The documented maximum: 4 image subjects + 2 saved (video) subjects.
    const ok = videoFromReference.safe({
      model: "viduq2-pro",
      prompt: "hi",
      subjects: [...four, saved("v1"), saved("v2")],
      duration: 5,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.warnings).toEqual([]);

    const seven = videoFromReference.safe({
      model: "viduq2-pro",
      prompt: "hi",
      subjects: [...four, saved("v1"), saved("v2"), saved("v3")],
      duration: 5,
    });
    expect(seven.ok).toBe(false);
    if (!seven.ok) {
      const issue = seven.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["subjects"]);
      expect(issue?.meta?.max).toBe(6);
    }

    // Off viduq2-pro a saved subject can only be an image subject: 8 is over the 7.
    const q3 = videoFromReference.safe({
      model: "viduq3",
      prompt: "hi",
      subjects: [...["a", "b", "c", "d", "e", "f", "g"].map(image), saved("s")],
    });
    expect(q3.ok).toBe(false);
    if (!q3.ok) {
      const issue = q3.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["subjects"]);
      expect(issue?.meta?.max).toBe(7);
    }
  });

  test("video subjects are viduq2-pro-only", () => {
    for (const model of ["viduq3", "viduq3-drama"] as const) {
      const r = videoFromReference.safe({
        model,
        prompt: "hi",
        subjects: [{ name: "v", videos: ["https://example.com/clip.mp4"] }],
      });
      expect(r.ok, model).toBe(false);
      if (!r.ok) {
        const issue = r.errors.find((e) => e.code === "unsupported_param");
        expect(issue?.path, model).toEqual(["subjects", 0, "videos"]);
        expect(issue?.meta?.supported, model).toEqual(["viduq2-pro"]);
      }
    }
  });

  test("viduq4-preview has no subjects form", () => {
    const r = videoFromReference.safe({
      model: "viduq4-preview",
      prompt: "hi",
      subjects: [{ name: "a", images: ["https://example.com/a.png"] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "unsupported_param")?.path).toEqual(["subjects"]);
    }
  });

  test("sounds caps at 3 on the models that document it", () => {
    const four = ["a", "b", "c", "d"].map((n) => `https://example.com/${n}.mp3`);
    const r = videoFromReference.safe({
      model: "viduq3-mix",
      prompt: "hi",
      images: ["https://example.com/a.png"],
      sounds: four,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["sounds"]);
      expect(issue?.meta?.max).toBe(3);
    }
    expect(
      videoFromReference.safe({
        model: "viduq3-mix",
        prompt: "hi",
        images: ["https://example.com/a.png"],
        sounds: four.slice(0, 3),
      }).ok,
    ).toBe(true);
  });

  test("viduq3-drama takes both forms, 2–16 seconds, 720p / 1080p, unpriced", () => {
    const subjects = videoFromReference.safe({
      model: "viduq3-drama",
      prompt: "@hero walks in",
      subjects: [{ name: "hero", images: ["https://example.com/hero.png"] }],
      duration: 16,
    });
    expect(subjects.ok).toBe(true);
    if (subjects.ok) {
      expect(subjects.warnings).toEqual([]);
      expect(subjects.estimate.costUSD).toBeUndefined();
    }

    const images = videoFromReference.safe({
      model: "viduq3-drama",
      prompt: "hi",
      images: ["https://example.com/a.png"],
      sounds: ["https://example.com/a.mp3"],
      duration: 2,
      resolution: "1080p",
    });
    expect(images.ok).toBe(true);

    const r540 = videoFromReference.safe({
      model: "viduq3-drama",
      prompt: "hi",
      images: ["https://example.com/a.png"],
      resolution: "540p",
    });
    expect(r540.ok).toBe(false);
    if (!r540.ok) {
      expect(r540.errors.find((e) => e.code === "invalid_enum_value")?.meta?.allowed).toEqual([
        "720p",
        "1080p",
      ]);
    }
  });

  test("viduq3-ad takes 3–15 seconds and no subjects, unpriced", () => {
    const r = videoFromReference.safe({
      model: "viduq3-ad",
      prompt: "hi",
      images: ["https://example.com/a.png"],
      duration: 15,
      resolution: "1080p",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(r.estimate.costUSD).toBeUndefined();
    }

    const long = videoFromReference.safe({
      model: "viduq3-ad",
      prompt: "hi",
      images: ["https://example.com/a.png"],
      duration: 16,
    });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.errors.find((e) => e.code === "invalid_enum_value")?.meta?.max).toBe(15);

    const subjects = videoFromReference.safe({
      model: "viduq3-ad",
      prompt: "hi",
      subjects: [{ name: "a", images: ["https://example.com/a.png"] }],
    });
    expect(subjects.ok).toBe(false);
    if (!subjects.ok) {
      expect(subjects.errors.find((e) => e.code === "unsupported_param")?.path).toEqual(["subjects"]);
    }
  });

  test("aspect_ratio accepts auto on this route", () => {
    const r = videoFromReference.safe({
      model: "viduq3",
      prompt: "hi",
      images: ["https://example.com/a.png"],
      aspect_ratio: "auto",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("q3 prompts run to 20000 characters; q2 / q1 stay at 5000", () => {
    const base = { prompt: "", images: ["https://example.com/a.png"] };
    expect(
      videoFromReference.safe({ ...base, model: "viduq3", prompt: "a".repeat(20000) }).ok,
    ).toBe(true);
    const r = videoFromReference.safe({ ...base, model: "viduq2", prompt: "a".repeat(5001) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["prompt"]);
      expect(issue?.meta?.max).toBe(5000);
    }
  });

  test("reference2video has its own cheaper turbo rate", () => {
    const r = videoFromReference.safe({
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
