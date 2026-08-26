import { describe, expect, test } from "bun:test";
import { video } from "./video";
import { models, provider, videoModels } from "./models";
import {
  ATLASCLOUD_BASE_URL,
  GENERATE_VIDEO_URL,
  MODELS_CATALOG_URL,
  UPLOAD_MEDIA_URL,
  modelSchemaUrl,
  predictionUrl,
  resultUrl,
  uploadMediaUrl,
} from "./urls";
import {
  ATLASCLOUD_LISTED_BASE_PRICE_USD,
  ATLASCLOUD_PRICING_CAVEAT,
  listedPrice,
} from "./pricing";
import {
  SEEDANCE_25_RESOLUTIONS,
  VIDEO_RATIOS,
  videoConstraints,
  videoShapeRules,
} from "./constraints";
import { MODELS } from "./video-params";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

/** Bypasses the compile-time surface so runtime enforcement can be exercised. */
const safeUnchecked = video.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const codes = (result: ValidateResult<Record<string, unknown>>): string[] =>
  result.ok ? [] : result.errors.map((issue) => `${String(issue.code)}@${issue.path.join(".")}`);

const IMAGE_URL = "https://example.com/frame.png";
const CLIP_URL = "https://example.com/clip.mp4";

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

describe("the Atlas routes", () => {
  test("one POST path serves every video model", () => {
    expect(ATLASCLOUD_BASE_URL).toBe("https://api.atlascloud.ai/api/v1");
    expect(GENERATE_VIDEO_URL).toBe("https://api.atlascloud.ai/api/v1/model/generateVideo");
    expect(UPLOAD_MEDIA_URL).toBe("https://api.atlascloud.ai/api/v1/model/uploadMedia");
    expect(uploadMediaUrl()).toBe(UPLOAD_MEDIA_URL);
    expect(MODELS_CATALOG_URL).toBe("https://api.atlascloud.ai/api/v1/models");
  });

  test("both documented read-back spellings are exported, and both escape the id", () => {
    expect(predictionUrl("abc 1")).toBe(
      "https://api.atlascloud.ai/api/v1/model/prediction/abc%201",
    );
    // Five of the twenty-three schemas declare `/model/result/{request_id}`
    // instead; a helper that picked one would be guessing for the other family.
    expect(resultUrl("abc 1")).toBe("https://api.atlascloud.ai/api/v1/model/result/abc%201");
  });

  test("a model's schema url is its id with the slashes swapped for dashes", () => {
    expect(modelSchemaUrl("bytedance/seedance-2.5/reference-to-video")).toBe(
      "https://static.atlascloud.ai/model/schema/bytedance-seedance-2.5-reference-to-video.json",
    );
  });
});

// ---------------------------------------------------------------------------
// The wire body
// ---------------------------------------------------------------------------

describe("atlascloud.video happy path", () => {
  test("returns the exact wire body plus request metadata", () => {
    const v = video({
      model: "bytedance/seedance-2.0/text-to-video",
      prompt: "A golden retriever running on a sunny beach",
      duration: 5,
      resolution: "720p",
      ratio: "16:9",
      bitrate_mode: "high",
      generate_audio: true,
      seed: 11,
      watermark: false,
    });

    expect(JSON.parse(JSON.stringify(v))).toEqual({
      model: "bytedance/seedance-2.0/text-to-video",
      prompt: "A golden retriever running on a sunny beach",
      duration: 5,
      resolution: "720p",
      ratio: "16:9",
      bitrate_mode: "high",
      generate_audio: true,
      seed: 11,
      watermark: false,
    });
    expect(v.request.url).toBe(GENERATE_VIDEO_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers).toEqual({ "content-type": "application/json" });
  });

  test("`model` is a REAL body field, not a route pseudo-param", () => {
    // The whole difference from fal, in one assertion: fal strips `endpoint`
    // into the URL path, Atlas keeps `model` in the JSON and the url is fixed.
    const v = video({ model: "bytedance/seedance-2.5/text-to-video", prompt: "hi" });
    expect(Object.keys(JSON.parse(JSON.stringify(v)))).toContain("model");
    expect(v.request.url).toBe(GENERATE_VIDEO_URL);
    expect(v.request.url).not.toContain("seedance");
  });

  test("`.toSdk(\"atlascloud\")` is the identity — Atlas ships no typed client", () => {
    const v = video({ model: "bytedance/seedance-2.5/text-to-video", prompt: "hi" });
    expect(v.toSdk("atlascloud")).toEqual(JSON.parse(JSON.stringify(v)));
  });

  test("a reference request carries all three flat arrays", () => {
    const v = video({
      model: "bytedance/seedance-2.5/reference-to-video",
      prompt: "@Image1 dances to @Audio1",
      reference_images: [IMAGE_URL],
      reference_videos: [CLIP_URL],
      reference_audios: ["https://example.com/bgm.mp3"],
      ratio: "adaptive",
      output_format: "mov",
    });
    expect(JSON.parse(JSON.stringify(v))).toMatchObject({
      reference_images: [IMAGE_URL],
      reference_videos: [CLIP_URL],
      reference_audios: ["https://example.com/bgm.mp3"],
      output_format: "mov",
    });
  });

  test("the three documented media forms all pass: URL, Base64 and asset://", () => {
    const v = video({
      model: "bytedance/seedance-2.5/reference-to-video",
      prompt: "@Image1 @Image2 @Image3",
      reference_images: [
        "https://example.com/a.png",
        "data:image/png;base64,iVBORw0KGgo=",
        "asset://01HZX9QK3M",
      ],
    });
    expect((JSON.parse(JSON.stringify(v)) as { reference_images: string[] }).reference_images).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// `duration`, and the `-1` sentinel
// ---------------------------------------------------------------------------

describe("duration", () => {
  test("`-1` is accepted where the schema lists it", () => {
    for (const model of [
      "bytedance/seedance-2.5/text-to-video",
      "bytedance/seedance-2.0/text-to-video",
      "bytedance/seedance-2.0-mini/text-to-video",
      "bytedance/seedance-2.0-fast/text-to-video",
      "alibaba/wan-3.0/text-to-video",
      "alibaba/wan-3.0-prime/text-to-video",
    ]) {
      const result = safeUnchecked({ model, prompt: "hi", duration: -1 });
      expect(codes(result), model).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  test("`-1` is refused where it is not, naming the families that have it", () => {
    const result = safeUnchecked({
      model: "bytedance/seedance-v1.5-pro/text-to-video",
      prompt: "hi",
      duration: -1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ code: "invalid_enum_value", path: ["duration"] });
    expect(result.errors[0]!.message).toContain("Seedance 2.x and Wan 3.0");
  });

  test("Veo 3.1 has no sentinel either — its enum is three members", () => {
    expect(codes(safeUnchecked({ model: "google/veo3.1/text-to-video", prompt: "p", duration: -1 })))
      .toEqual(["invalid_enum_value@duration"]);
    expect(codes(safeUnchecked({ model: "google/veo3.1/text-to-video", prompt: "p", duration: 6 })))
      .toEqual([]);
    expect(codes(safeUnchecked({ model: "google/veo3.1/text-to-video", prompt: "p", duration: 5 })))
      .toEqual(["invalid_enum_value@duration"]);
  });

  test("the enums differ per family: 30s on 2.5, 15s on the 2.0 series", () => {
    expect(codes(safeUnchecked({ model: "bytedance/seedance-2.5/text-to-video", prompt: "p", duration: 30 })))
      .toEqual([]);
    expect(codes(safeUnchecked({ model: "bytedance/seedance-2.0/text-to-video", prompt: "p", duration: 30 })))
      .toEqual(["invalid_enum_value@duration"]);
    expect(codes(safeUnchecked({ model: "bytedance/seedance-2.0/text-to-video", prompt: "p", duration: 15 })))
      .toEqual([]);
  });

  test("Seedance v1.5 pro publishes a RANGE, so the message quotes bounds", () => {
    expect(codes(safeUnchecked({ model: "bytedance/seedance-v1.5-pro/text-to-video", prompt: "p", duration: 12 })))
      .toEqual([]);
    const over = safeUnchecked({
      model: "bytedance/seedance-v1.5-pro/text-to-video",
      prompt: "p",
      duration: 13,
    });
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.errors[0]!.message).toContain("4–12 seconds");
  });

  test("Wan 3.0 starts at 2 seconds, where every Seedance starts at 4", () => {
    expect(codes(safeUnchecked({ model: "alibaba/wan-3.0/text-to-video", prompt: "p", duration: 2 })))
      .toEqual([]);
    expect(codes(safeUnchecked({ model: "bytedance/seedance-2.0/text-to-video", prompt: "p", duration: 2 })))
      .toEqual(["invalid_enum_value@duration"]);
  });
});

// ---------------------------------------------------------------------------
// Veo 3.1's `allOf` conditional
// ---------------------------------------------------------------------------

describe("the one cross-field rule Atlas expresses in JSON Schema", () => {
  test("1080p and 4k lock `duration` to 8", () => {
    for (const resolution of ["1080p", "4k"]) {
      const result = safeUnchecked({
        model: "google/veo3.1/image-to-video",
        prompt: "p",
        image: IMAGE_URL,
        resolution,
        duration: 4,
      });
      expect(codes(result), resolution).toEqual(["invalid_enum_value@duration"]);
      if (result.ok) continue;
      expect(result.errors[0]!.message).toContain(
        "When resolution is 1080p or 4k, duration must be 8",
      );
    }
  });

  test("720p leaves the three-member enum alone", () => {
    expect(
      codes(
        safeUnchecked({
          model: "google/veo3.1/image-to-video",
          prompt: "p",
          image: IMAGE_URL,
          resolution: "720p",
          duration: 4,
        }),
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Required fields — per MODEL, because each model has its own schema
// ---------------------------------------------------------------------------

describe("required fields", () => {
  test("`prompt` is required on the text routes and optional on the Seedance image ones", () => {
    expect(codes(safeUnchecked({ model: "bytedance/seedance-2.0/text-to-video" })))
      .toEqual(["invalid_shape@prompt"]);
    // "Optional but recommended." — the image route's own prompt description.
    expect(codes(safeUnchecked({ model: "bytedance/seedance-2.0/image-to-video", image: IMAGE_URL })))
      .toEqual([]);
    // …but Wan requires it on BOTH routes.
    expect(codes(safeUnchecked({ model: "alibaba/wan-3.0/image-to-video", image: IMAGE_URL })))
      .toEqual(["invalid_shape@prompt"]);
  });

  test("`image` is required on every image-to-video id", () => {
    expect(codes(safeUnchecked({ model: "bytedance/seedance-2.5/image-to-video", prompt: "p" })))
      .toEqual(["invalid_shape@image"]);
  });

  test("Veo 3.1 reference-to-video requires `images`, and an empty array is not one", () => {
    expect(codes(safeUnchecked({ model: "google/veo3.1/reference-to-video", prompt: "p" })))
      .toEqual(["invalid_shape@images"]);
    expect(codes(safeUnchecked({ model: "google/veo3.1/reference-to-video", prompt: "p", images: [] })))
      .toEqual(["invalid_shape@images"]);
  });

  test("the Seedance reference routes require nothing but `model`", () => {
    expect(codes(safeUnchecked({ model: "bytedance/seedance-2.5/reference-to-video" }))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Reference arrays
// ---------------------------------------------------------------------------

describe("reference arrays", () => {
  test("the caps are per family: 30/10/10 on 2.5, 9/3/3 on the 2.0 series", () => {
    const many = (n: number): string[] => Array.from({ length: n }, (_, i) => `${IMAGE_URL}?${i}`);
    expect(codes(safeUnchecked({
      model: "bytedance/seedance-2.5/reference-to-video",
      reference_images: many(30),
    }))).toEqual([]);
    expect(codes(safeUnchecked({
      model: "bytedance/seedance-2.5/reference-to-video",
      reference_images: many(31),
    }))).toEqual(["unsupported_capability@reference_images"]);
    expect(codes(safeUnchecked({
      model: "bytedance/seedance-2.0/reference-to-video",
      reference_images: many(10),
    }))).toEqual(["unsupported_capability@reference_images"]);
    expect(codes(safeUnchecked({
      model: "bytedance/seedance-2.0/reference-to-video",
      reference_images: many(9),
    }))).toEqual([]);
  });

  test("the 2.0 series declares `minItems: 1`, so an empty array is a shape error", () => {
    expect(codes(safeUnchecked({
      model: "bytedance/seedance-2.0/reference-to-video",
      reference_images: [],
    }))).toEqual(["invalid_shape@reference_images"]);
    // 2.5 declares `minItems: 0`, so the same body is fine there.
    expect(codes(safeUnchecked({
      model: "bytedance/seedance-2.5/reference-to-video",
      reference_images: [],
    }))).toEqual([]);
  });

  test("audio-only reference is unique to 2.5", () => {
    expect(codes(safeUnchecked({
      model: "bytedance/seedance-2.5/reference-to-video",
      reference_audios: ["https://example.com/bgm.mp3"],
    }))).toEqual([]);
    const twoZero = safeUnchecked({
      model: "bytedance/seedance-2.0/reference-to-video",
      reference_audios: ["https://example.com/bgm.mp3"],
    });
    expect(codes(twoZero)).toEqual(["unsupported_capability@reference_audios"]);
    if (twoZero.ok) return;
    expect(twoZero.errors[0]!.message).toContain(
      "Must include at least 1 reference video or image.",
    );
  });

  test("Veo 3.1 caps `images` at 3", () => {
    const three = [IMAGE_URL, `${IMAGE_URL}?2`, `${IMAGE_URL}?3`];
    expect(codes(safeUnchecked({ model: "google/veo3.1/reference-to-video", prompt: "p", images: three })))
      .toEqual([]);
    expect(codes(safeUnchecked({
      model: "google/veo3.1/reference-to-video",
      prompt: "p",
      images: [...three, `${IMAGE_URL}?4`],
    }))).toEqual(["unsupported_capability@images"]);
  });
});

// ---------------------------------------------------------------------------
// `omni_reference_task_type`
// ---------------------------------------------------------------------------

describe("omni_reference_task_type", () => {
  const base = {
    model: "bytedance/seedance-2.5/reference-to-video",
    prompt: "continue the shot",
    reference_videos: [CLIP_URL],
  };

  test("`edit` demands one clip, an adaptive ratio and duration -1", () => {
    expect(codes(safeUnchecked({ ...base, omni_reference_task_type: "edit", duration: -1 })))
      .toEqual([]);
    expect(codes(safeUnchecked({ ...base, omni_reference_task_type: "edit", duration: 5 })))
      .toEqual(["invalid_enum_value@duration"]);
    expect(codes(safeUnchecked({
      ...base,
      omni_reference_task_type: "edit",
      duration: -1,
      ratio: "16:9",
    }))).toEqual(["invalid_enum_value@ratio"]);
    expect(codes(safeUnchecked({
      ...base,
      reference_videos: [CLIP_URL, `${CLIP_URL}?2`],
      omni_reference_task_type: "edit",
      duration: -1,
    }))).toEqual(["invalid_shape@reference_videos"]);
  });

  test("`extend` keeps the ratio rule and drops the duration one", () => {
    expect(codes(safeUnchecked({ ...base, omni_reference_task_type: "extend", duration: 10 })))
      .toEqual([]);
    expect(codes(safeUnchecked({ ...base, omni_reference_task_type: "extend", ratio: "9:16" })))
      .toEqual(["invalid_enum_value@ratio"]);
  });

  test("`auto` and `reference` add no constraints", () => {
    expect(codes(safeUnchecked({ ...base, omni_reference_task_type: "auto", ratio: "16:9" }))).toEqual([]);
    expect(codes(safeUnchecked({ ...base, omni_reference_task_type: "reference", duration: 5 }))).toEqual([]);
  });

  test("it belongs to 2.5's reference route alone", () => {
    expect(codes(safeUnchecked({
      model: "bytedance/seedance-2.0/reference-to-video",
      omni_reference_task_type: "reference",
    }))).toEqual(["unsupported_param@omni_reference_task_type"]);
    expect(codes(safeUnchecked({
      model: "bytedance/seedance-2.5/text-to-video",
      prompt: "p",
      omni_reference_task_type: "reference",
    }))).toEqual(["unsupported_param@omni_reference_task_type"]);
  });
});

// ---------------------------------------------------------------------------
// `ratio` / `aspect_ratio` — one idea, two spellings, and one pinned value
// ---------------------------------------------------------------------------

describe("the shape field", () => {
  test("Seedance 2.5 image-to-video accepts only `adaptive`, and says why", () => {
    expect(codes(safeUnchecked({
      model: "bytedance/seedance-2.5/image-to-video",
      image: IMAGE_URL,
      ratio: "adaptive",
    }))).toEqual([]);
    const named = safeUnchecked({
      model: "bytedance/seedance-2.5/image-to-video",
      image: IMAGE_URL,
      ratio: "16:9",
    });
    expect(named.ok).toBe(false);
    if (named.ok) return;
    expect(named.errors.map((i) => String(i.code))).toContain("unsupported_capability");
    expect(named.errors.map((i) => i.message).join(" ")).toContain(
      "the output preserves the source image's aspect ratio",
    );
  });

  test("`ratio` and `aspect_ratio` are refused for each other by name", () => {
    const ratioOnSeedance15 = safeUnchecked({
      model: "bytedance/seedance-v1.5-pro/text-to-video",
      prompt: "p",
      ratio: "16:9",
    });
    expect(codes(ratioOnSeedance15)).toEqual(["unsupported_param@ratio"]);
    if (!ratioOnSeedance15.ok) {
      expect(ratioOnSeedance15.errors[0]!.message).toContain("aspect_ratio");
    }
    expect(codes(safeUnchecked({
      model: "bytedance/seedance-2.0/text-to-video",
      prompt: "p",
      aspect_ratio: "16:9",
    }))).toEqual(["unsupported_param@aspect_ratio"]);
  });

  test("Wan's image-to-video route has no shape field at all", () => {
    const result = safeUnchecked({
      model: "alibaba/wan-3.0/image-to-video",
      prompt: "p",
      image: IMAGE_URL,
      ratio: "16:9",
    });
    expect(codes(result)).toEqual(["unsupported_param@ratio"]);
    if (result.ok) return;
    expect(result.errors[0]!.message).toContain("the first frame decides the shape");
  });

  test("Veo 3.1 offers two shapes and its reference route offers none", () => {
    expect(codes(safeUnchecked({ model: "google/veo3.1/text-to-video", prompt: "p", aspect_ratio: "9:16" })))
      .toEqual([]);
    expect(codes(safeUnchecked({ model: "google/veo3.1/text-to-video", prompt: "p", aspect_ratio: "4:3" })))
      .toEqual(["invalid_enum_value@aspect_ratio"]);
    expect(codes(safeUnchecked({
      model: "google/veo3.1/reference-to-video",
      prompt: "p",
      images: [IMAGE_URL],
      aspect_ratio: "16:9",
    }))).toEqual(["unsupported_param@aspect_ratio"]);
  });
});

// ---------------------------------------------------------------------------
// `resolution` — the eleven-value ladder, and four spellings of one tier
// ---------------------------------------------------------------------------

describe("resolution", () => {
  test("Seedance 2.5 publishes eleven values and every one of them validates", () => {
    expect(SEEDANCE_25_RESOLUTIONS).toHaveLength(11);
    for (const resolution of SEEDANCE_25_RESOLUTIONS) {
      expect(
        codes(safeUnchecked({ model: "bytedance/seedance-2.5/text-to-video", prompt: "p", resolution })),
        resolution,
      ).toEqual([]);
    }
  });

  test("the 2.0 series casings are the wire's own, `-SR` and all", () => {
    expect(codes(safeUnchecked({ model: "bytedance/seedance-2.0/text-to-video", prompt: "p", resolution: "1440p-SR" })))
      .toEqual([]);
    // 2.5 spells the same rung lower-case; the two are not interchangeable.
    expect(codes(safeUnchecked({ model: "bytedance/seedance-2.0/text-to-video", prompt: "p", resolution: "1440p-sr" })))
      .toEqual(["invalid_enum_value@resolution"]);
  });

  test("native 4k is the full 2.0 model's alone", () => {
    expect(codes(safeUnchecked({ model: "bytedance/seedance-2.0/text-to-video", prompt: "p", resolution: "4k" })))
      .toEqual([]);
    expect(codes(safeUnchecked({ model: "bytedance/seedance-2.0-mini/text-to-video", prompt: "p", resolution: "4k" })))
      .toEqual(["invalid_enum_value@resolution"]);
    expect(codes(safeUnchecked({ model: "bytedance/seedance-2.0-fast/text-to-video", prompt: "p", resolution: "4k" })))
      .toEqual(["invalid_enum_value@resolution"]);
  });

  test("Wan 3.0-prime is the one UPPER-case enum on the provider", () => {
    expect(codes(safeUnchecked({ model: "alibaba/wan-3.0-prime/text-to-video", prompt: "p", resolution: "1080P" })))
      .toEqual([]);
    expect(codes(safeUnchecked({ model: "alibaba/wan-3.0-prime/text-to-video", prompt: "p", resolution: "1080p" })))
      .toEqual(["invalid_enum_value@resolution"]);
    // …and plain Wan 3.0 is the mirror image.
    expect(codes(safeUnchecked({ model: "alibaba/wan-3.0/text-to-video", prompt: "p", resolution: "1080p" })))
      .toEqual([]);
    expect(codes(safeUnchecked({ model: "alibaba/wan-3.0/text-to-video", prompt: "p", resolution: "1080P" })))
      .toEqual(["invalid_enum_value@resolution"]);
  });

  test("the v1.5-pro fast pair renders 720p only", () => {
    expect(codes(safeUnchecked({ model: "bytedance/seedance-v1.5-pro/text-to-video", prompt: "p", resolution: "480p" })))
      .toEqual([]);
    expect(codes(safeUnchecked({
      model: "bytedance/seedance-v1.5-pro/text-to-video-fast",
      prompt: "p",
      resolution: "480p",
    }))).toEqual(["invalid_enum_value@resolution"]);
  });
});

// ---------------------------------------------------------------------------
// Cross-family params, refused by name
// ---------------------------------------------------------------------------

describe("a param from another family is named, not swallowed", () => {
  test("`seed` is absent from every Seedance 2.5 schema", () => {
    const result = safeUnchecked({ model: "bytedance/seedance-2.5/text-to-video", prompt: "p", seed: 1 });
    expect(codes(result)).toEqual(["unsupported_param@seed"]);
    // …and present on the 2.0 series, v1.5 pro, Wan and Veo.
    for (const model of [
      "bytedance/seedance-2.0/text-to-video",
      "bytedance/seedance-v1.5-pro/text-to-video",
      "alibaba/wan-3.0/text-to-video",
      "google/veo3.1/text-to-video",
    ]) {
      expect(codes(safeUnchecked({ model, prompt: "p", seed: 1 })), model).toEqual([]);
    }
  });

  test("`audio` and `generate_audio` are two families' spellings of one toggle", () => {
    expect(codes(safeUnchecked({ model: "alibaba/wan-3.0/text-to-video", prompt: "p", audio: false })))
      .toEqual([]);
    expect(codes(safeUnchecked({ model: "alibaba/wan-3.0/text-to-video", prompt: "p", generate_audio: false })))
      .toEqual(["unsupported_param@generate_audio"]);
    expect(codes(safeUnchecked({ model: "bytedance/seedance-2.0/text-to-video", prompt: "p", audio: false })))
      .toEqual(["unsupported_param@audio"]);
  });

  test("`negative_prompt` is Veo 3.1's alone", () => {
    expect(codes(safeUnchecked({ model: "google/veo3.1/text-to-video", prompt: "p", negative_prompt: "blurry" })))
      .toEqual([]);
    expect(codes(safeUnchecked({
      model: "bytedance/seedance-2.5/text-to-video",
      prompt: "p",
      negative_prompt: "blurry",
    }))).toEqual(["unsupported_param@negative_prompt"]);
  });

  test("a reference array on a text route names the id to pick instead", () => {
    const result = safeUnchecked({
      model: "bytedance/seedance-2.0/text-to-video",
      prompt: "p",
      reference_images: [IMAGE_URL],
    });
    expect(codes(result)).toEqual(["unsupported_param@reference_images"]);
    if (result.ok) return;
    expect(result.errors[0]!.message).toContain("/reference-to-video");
  });

  test("a frame field on a reference route does the same", () => {
    const result = safeUnchecked({
      model: "bytedance/seedance-2.0/reference-to-video",
      image: IMAGE_URL,
    });
    expect(codes(result)).toEqual(["unsupported_param@image"]);
    if (result.ok) return;
    expect(result.errors[0]!.message).toContain("/image-to-video");
  });

  test("`bitrate_mode` and `output_format` belong to different Seedance tiers", () => {
    expect(codes(safeUnchecked({
      model: "bytedance/seedance-2.5/text-to-video",
      prompt: "p",
      bitrate_mode: "high",
    }))).toEqual(["unsupported_param@bitrate_mode"]);
    expect(codes(safeUnchecked({
      model: "bytedance/seedance-2.0/text-to-video",
      prompt: "p",
      output_format: "mov",
    }))).toEqual(["unsupported_param@output_format"]);
  });
});

// ---------------------------------------------------------------------------
// Degradation
// ---------------------------------------------------------------------------

describe("degradation", () => {
  test("an id Atlas added after this snapshot warns and still routes", () => {
    const result = safeUnchecked({
      model: "kwaivgi/kling-v3.0-pro/text-to-video",
      prompt: "p",
      duration: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((issue) => String(issue.code))).toContain("unknown_model");
    expect((result.params as unknown as { request: { url: string } }).request.url).toBe(
      GENERATE_VIDEO_URL,
    );
  });

  test("a key no Atlas video schema declares is passed through with a warning", () => {
    const result = safeUnchecked({
      model: "bytedance/seedance-2.5/text-to-video",
      prompt: "p",
      future_atlas_control: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.warnings.some(
        (issue) => String(issue.code) === "unknown_param" && issue.path[0] === "future_atlas_control",
      ),
    ).toBe(true);
    // …and it still reaches the wire: loose does not mean dropped.
    expect(JSON.parse(JSON.stringify(result.params))).toMatchObject({ future_atlas_control: true });
  });

  test("the throwing form carries the same issues", () => {
    expect(() =>
      video({ model: "bytedance/seedance-2.0/text-to-video", prompt: "p", duration: 99 } as never),
    ).toThrow(UnmodelValidationError);
  });
});

// ---------------------------------------------------------------------------
// The tables themselves
// ---------------------------------------------------------------------------

describe("the roster and its tables agree", () => {
  test("every curated id has a catalog row, a shape rule, a constraint row and a params row", () => {
    expect(MODELS).toHaveLength(23);
    for (const id of MODELS) {
      expect(videoModels[id as keyof typeof videoModels], `${id} catalog`).toBeDefined();
      expect(videoShapeRules[id], `${id} shape rule`).toBeDefined();
      expect(videoConstraints[id], `${id} constraints`).toBeDefined();
      expect(ATLASCLOUD_LISTED_BASE_PRICE_USD[id], `${id} listed price`).toBeDefined();
    }
    expect(Object.keys(models).sort()).toEqual([...MODELS].sort());
  });

  test("the provider reads its key from ATLASCLOUD_API_KEY", () => {
    expect(provider).toMatchObject({
      id: "atlascloud",
      env: ["ATLASCLOUD_API_KEY"],
      api: "https://api.atlascloud.ai/api/v1",
    });
  });

  test("NO row carries a cost, and the caveat says why", () => {
    for (const row of Object.values(videoModels)) {
      expect((row as { cost?: unknown }).cost, row.id).toBeUndefined();
    }
    expect(ATLASCLOUD_PRICING_CAVEAT).toContain("per-run");
    expect(listedPrice("bytedance/seedance-2.5/text-to-video")).toEqual({
      actual: 0.134,
      origin: 0.134,
      discount: 100,
    });
    expect(listedPrice("nope/nope")).toBeUndefined();
  });

  test("`adaptive` is in the wire enum and is not a shape", () => {
    expect(VIDEO_RATIOS).toContain("adaptive");
    // The adapter filters it; see unified-video.ts. Here the point is only that
    // the wire genuinely has it, which is what makes the filter a choice.
    expect(codes(safeUnchecked({ model: "bytedance/seedance-2.0/text-to-video", prompt: "p", ratio: "adaptive" })))
      .toEqual([]);
  });

  test("constraintsFor exposes the per-model table", () => {
    const rules = video.constraintsFor("bytedance/seedance-2.5/reference-to-video");
    expect(rules).toHaveLength(1);
    expect(rules[0]!.enums?.["resolution"]).toEqual([...SEEDANCE_25_RESOLUTIONS]);
  });
});
