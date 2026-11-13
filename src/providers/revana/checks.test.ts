import { describe, expect, test } from "bun:test";
import { createGenerationValidator, type GenerationSpec } from "./generation";
import type { RevanaModelShape } from "./shape-types";
import type { ValidateResult } from "../../core/result";

/**
 * The check battery, against HAND-WRITTEN shape rows.
 *
 * Deliberately not the generated tables: those move every week, and a rule
 * such as "a model with no `resolutions` takes no `resolution`" should not
 * need re-pinning because Veo gained a tier. Each row below is the smallest
 * shape that exercises one rule; `oracle.test.ts` is where the real rows meet
 * the real API's recorded answers.
 */

const SHAPES = {
  // text + first frame + first-and-last frame; lists everywhere.
  "t2v-i2v": {
    kind: "video",
    tasks: ["text_to_video", "image_to_video", "first_last_frame"],
    media: ["image_url", "end_image_url"],
    resolutions: ["720p", "1080p", "4K"],
    aspectRatios: ["16:9", "9:16"],
    durations: [4, 6, 8],
    audio: true,
  },
  // A range, no ratio list, no resolutions, no sound.
  "ranged-video": {
    kind: "video",
    tasks: ["text_to_video", "reference_to_video"],
    media: ["image_urls"],
    durations: { min: 3, max: 15 },
    maxInputImages: 2,
  },
  "i2v-only": { kind: "video", tasks: ["image_to_video"], media: ["image_url"] },
  "refs-only": { kind: "video", tasks: ["reference_to_video"], media: ["image_urls"], maxInputImages: 3 },
  "v2v-only": { kind: "video", tasks: ["video_to_video"], media: ["video_url"] },
  "talking-head": { kind: "video", tasks: ["image_to_video"], media: ["image_url", "audio_url"] },
  seedance: {
    kind: "video",
    tasks: ["text_to_video", "image_to_video", "first_last_frame", "reference_to_video", "video_to_video"],
    media: ["image_url", "end_image_url", "image_urls", "video_url", "audio_url"],
    resolutions: ["480p", "720p", "1080p"],
    aspectRatios: ["16:9", "adaptive"],
    durations: { min: 4, max: 30 },
    audio: true,
    maxInputImages: 30,
  },
  "t2i-edit": {
    kind: "image",
    tasks: ["text_to_image", "image_to_image"],
    media: ["image_url", "image_urls"],
    resolutions: ["1K", "2K"],
    qualities: ["high", "low"],
    defaultQuality: "low",
    maxInputImages: 2,
    maxImages: 4,
  },
  "t2i-only": { kind: "image", tasks: ["text_to_image"], media: [], maxImages: 4 },
  "edit-only": { kind: "image", tasks: ["image_to_image"], media: ["image_url", "image_urls"], maxImages: 4 },
  upscaler: { kind: "image", tasks: ["upscale"], media: ["image_url", "video_url"], maxImages: 4 },
  narrator: {
    kind: "audio",
    tasks: ["text_to_speech"],
    media: [],
    voices: ["v1", "v2"],
    defaultVoice: "v1",
    maxCharacters: 10,
    languages: [],
    speechFields: ["text", "voice", "stability", "similarity_boost", "speed", "language_code"],
  },
  "cast-reader": {
    kind: "audio",
    tasks: ["text_to_speech"],
    media: [],
    voices: ["v1", "v2"],
    defaultVoice: "v1",
    maxCharacters: 10,
    dialogue: true,
    languages: ["en", "fr"],
    speechFields: ["text", "voice", "dialogue", "stability", "language_code"],
  },
  polyglot: {
    kind: "audio",
    tasks: ["text_to_speech"],
    media: [],
    speechFields: ["text", "voice", "language_code"],
  },
  songwriter: { kind: "audio", tasks: ["text_to_music"], media: [], instrumental: true, outputsPerJob: 2 },
  picky: { kind: "image", tasks: ["text_to_image"], media: [], negativePrompt: true },
} as const satisfies Record<string, RevanaModelShape>;

const NEMESIS: RevanaModelShape = {
  kind: "video",
  tasks: ["video_to_video"],
  media: ["video_url"],
  resolutions: ["480p", "720p", "1080p"],
  maxInputImages: 8,
  guides: ["people", "scene", "clip"],
  sounds: ["none", "original"],
  roles: ["person", "product", "location", "look"],
};

/** `seedance-2.5` and `nemesis` are selected by id, so they need their real ids. */
const ALL_SHAPES: Record<string, RevanaModelShape> = {
  ...SHAPES,
  "seedance-2.5": SHAPES.seedance,
  nemesis: NEMESIS,
};

function validatorFor(extra: Partial<GenerationSpec> = {}) {
  const validator = createGenerationValidator<string>({
    endpoint: "revana.test",
    catalog: {},
    shapes: ALL_SHAPES,
    prices: {},
    elsewhere: { "revana.elsewhere": ["foreign-model"] },
    ...extra,
  });
  return validator.safe as unknown as (params: unknown) => ValidateResult<Record<string, unknown>>;
}

const safe = validatorFor();

/** `code@path` of each error, model-catalog noise aside. */
function errors(model: string, input: Record<string, unknown>, top: Record<string, unknown> = {}): string[] {
  const result = safe({ model, input, ...top });
  return result.ok ? [] : result.errors.map((issue) => `${issue.code}@${issue.path.join(".")}`);
}

function warnings(model: string, input: Record<string, unknown>): string[] {
  return safe({ model, input })
    .warnings.filter((issue) => issue.code !== "unknown_model")
    .map((issue) => `${issue.code}@${issue.path.join(".")}`);
}

/** The sentence of each error. */
function messages(model: string, input: Record<string, unknown>): string[] {
  const result = safe({ model, input });
  return result.ok ? [] : result.errors.map((issue) => issue.message);
}

const IMG = "https://example.com/a.png";
const VID = "https://example.com/a.mp4";
const AUD = "https://example.com/a.mp3";

describe("the wire schema", () => {
  test("`model` and `input` are required, and typed", () => {
    expect(safe({ input: { prompt: "a" } }).ok).toBe(false);
    expect(safe({ model: "t2v-i2v" }).ok).toBe(false);
    expect(errors("t2v-i2v", { prompt: "a", duration: 5.5 })).toEqual(["invalid_shape@input.duration"]);
    expect(errors("t2v-i2v", { prompt: "a", seed: -1 })).toEqual(["invalid_shape@input.seed"]);
    expect(errors("t2v-i2v", { prompt: "a", audio: "true" })).toEqual(["invalid_shape@input.audio"]);
  });

  test("`max_cost_usd` must be positive and has no upper bound; `max_wait_s` is 1–86400 whole seconds", () => {
    expect(errors("t2v-i2v", { prompt: "a" }, { max_cost_usd: 0 })).toEqual(["invalid_shape@max_cost_usd"]);
    // The OpenAPI document says `maximum: 100`; the API prices 101 normally.
    expect(errors("t2v-i2v", { prompt: "a" }, { max_cost_usd: 101 })).toEqual([]);
    expect(errors("t2v-i2v", { prompt: "a" }, { max_wait_s: 0 })).toEqual(["invalid_shape@max_wait_s"]);
    expect(errors("t2v-i2v", { prompt: "a" }, { max_wait_s: 86_401 })).toEqual(["invalid_shape@max_wait_s"]);
    expect(errors("t2v-i2v", { prompt: "a" }, { max_wait_s: 60 })).toEqual([]);
  });

  test("an unknown key passes through with a warning, top-level and inside `input`", () => {
    const result = safe({ model: "t2v-i2v", input: { prompt: "a", promt: "b" }, webhook: "x" });
    expect(result.ok).toBe(true);
    // (This harness hands the validator an empty catalog, hence the filter.)
    const found = result.warnings.filter((w) => w.code !== "unknown_model");
    expect(found.map((w) => `${w.code}@${w.path.join(".")}`).sort()).toEqual([
      "unknown_param@input.promt",
      "unknown_param@webhook",
    ]);
  });
});

describe("resolution, aspect ratio, quality", () => {
  test("a listed setting is matched ignoring case, as the API matches it", () => {
    expect(errors("t2v-i2v", { prompt: "a", resolution: "4k", aspect_ratio: "16:9" })).toEqual([]);
    expect(errors("t2v-i2v", { prompt: "a", resolution: "1080P" })).toEqual([]);
    expect(errors("t2i-edit", { prompt: "a", quality: "HIGH" })).toEqual([]);
  });

  test("a value outside the list is refused", () => {
    expect(errors("t2v-i2v", { prompt: "a", resolution: "480p" })).toEqual(["invalid_enum_value@input.resolution"]);
    expect(errors("t2v-i2v", { prompt: "a", aspect_ratio: "1:1" })).toEqual(["invalid_enum_value@input.aspect_ratio"]);
    expect(errors("t2i-edit", { prompt: "a", quality: "ultra" })).toEqual(["invalid_enum_value@input.quality"]);
  });

  test("a model with no `resolutions` takes no `resolution` at all", () => {
    expect(errors("ranged-video", { prompt: "a", resolution: "720p" })).toEqual(["unsupported_param@input.resolution"]);
  });

  test("a model with no ratio list takes any SHAPE, and only a shape", () => {
    for (const ratio of ["16:9", "1.5:1", " 16:9", "auto", "Adaptive"]) {
      expect(errors("ranged-video", { prompt: "a", aspect_ratio: ratio })).toEqual([]);
    }
    for (const ratio of ["16/9", "square", ".5:1", "16:9:1"]) {
      expect(errors("ranged-video", { prompt: "a", aspect_ratio: ratio })).toEqual(["invalid_shape@input.aspect_ratio"]);
    }
  });

  test("a model with no `qualities` accepts `quality` unchecked", () => {
    expect(errors("t2v-i2v", { prompt: "a", quality: "anything" })).toEqual([]);
  });
});

describe("duration and sound", () => {
  test("a list is an enum and a range is inclusive", () => {
    expect(errors("t2v-i2v", { prompt: "a", duration: 6 })).toEqual([]);
    expect(errors("t2v-i2v", { prompt: "a", duration: 5 })).toEqual(["invalid_enum_value@input.duration"]);
    expect(errors("ranged-video", { prompt: "a", duration: 3 })).toEqual([]);
    expect(errors("ranged-video", { prompt: "a", duration: 15 })).toEqual([]);
    expect(errors("ranged-video", { prompt: "a", duration: 16 })).toEqual(["invalid_enum_value@input.duration"]);
    expect(errors("ranged-video", { prompt: "a", duration: 2 })).toEqual(["invalid_enum_value@input.duration"]);
  });

  test("a video model with no `durations` sets its own length; a picture has none", () => {
    expect(errors("i2v-only", { image_url: IMG, duration: 5 })).toEqual(["unsupported_param@input.duration"]);
    expect(errors("t2i-only", { prompt: "a", duration: 5 })).toEqual(["unsupported_param@input.duration"]);
  });

  test("`audio: true` needs a model that makes sound; `audio: false` never fails", () => {
    expect(errors("t2v-i2v", { prompt: "a", audio: true })).toEqual([]);
    expect(errors("ranged-video", { prompt: "a", audio: true })).toEqual(["unsupported_capability@input.audio"]);
    expect(errors("ranged-video", { prompt: "a", audio: false })).toEqual([]);
    expect(errors("t2i-only", { prompt: "a", audio: true })).toEqual(["unsupported_capability@input.audio"]);
  });
});

describe("media: one combination per request", () => {
  test("the combination is decided by the highest-ranking field, and must be one the model offers", () => {
    expect(errors("t2v-i2v", { prompt: "a", image_url: IMG })).toEqual([]);
    expect(errors("t2v-i2v", { prompt: "a", image_url: IMG, end_image_url: IMG })).toEqual([]);
    expect(errors("t2v-i2v", { prompt: "a", image_urls: [IMG] })).toEqual(["unsupported_capability@input.image_urls"]);
    expect(errors("t2v-i2v", { prompt: "a", video_url: VID })).toEqual(["unsupported_capability@input.video_url"]);
    expect(errors("i2v-only", { prompt: "a", image_url: IMG, end_image_url: IMG })).toEqual([
      "unsupported_capability@input.end_image_url",
    ]);
    expect(errors("t2i-only", { prompt: "a", image_url: IMG })).toEqual(["unsupported_capability@input.image_url"]);
  });

  test("a lower-ranking field rides along instead of being refused", () => {
    // References beside a first frame, on a model that lists only `image_url`.
    expect(errors("i2v-only", { prompt: "a", image_url: IMG, image_urls: [IMG] })).toEqual([]);
    // The character picture of a motion-control model, beside its clip.
    expect(errors("v2v-only", { prompt: "a", video_url: VID, image_url: IMG })).toEqual([]);
    expect(errors("v2v-only", { prompt: "a", video_url: VID, image_urls: [IMG] })).toEqual([]);
    // …but a first frame on a references-only model is its own combination.
    expect(errors("refs-only", { prompt: "a", image_url: IMG, image_urls: [IMG] })).toEqual([
      "unsupported_capability@input.image_url",
    ]);
  });

  test("a model that cannot run on a prompt alone says what it takes", () => {
    const result = safe({ model: "i2v-only", input: { prompt: "a" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain("It takes: `input.image_url`.");
  });

  test("`end_image_url` needs the first frame", () => {
    expect(errors("t2v-i2v", { prompt: "a", end_image_url: IMG })).toEqual(["invalid_shape@input.end_image_url"]);
  });

  test("`audio_url` is refused where the model takes none and required where it does", () => {
    expect(errors("t2v-i2v", { prompt: "a", audio_url: AUD })).toEqual(["unsupported_capability@input.audio_url"]);
    expect(errors("talking-head", { prompt: "a", image_url: IMG })).toEqual(["invalid_shape@input.audio_url"]);
    expect(errors("talking-head", { prompt: "a", image_url: IMG, audio_url: AUD })).toEqual([]);
  });

  test("the reference cap holds for pictures always, and for video only when made FROM references", () => {
    expect(errors("t2i-edit", { prompt: "a", image_urls: [IMG, IMG, IMG] })).toEqual(["unsupported_capability@input.image_urls"]);
    expect(errors("t2i-edit", { prompt: "a", image_url: IMG, image_urls: [IMG, IMG, IMG] })).toEqual([
      "unsupported_capability@input.image_urls",
    ]);
    expect(errors("ranged-video", { prompt: "a", image_urls: [IMG, IMG, IMG] })).toEqual([
      "unsupported_capability@input.image_urls",
    ]);
    expect(errors("ranged-video", { prompt: "a", image_urls: [IMG, IMG] })).toEqual([]);
  });

  test("every reference must be a public https URL", () => {
    expect(errors("t2v-i2v", { prompt: "a", image_url: "http://example.com/a.png" })).toEqual(["invalid_shape@input.image_url"]);
    expect(errors("t2v-i2v", { prompt: "a", image_url: "data:image/png;base64,AAAA" })).toEqual(["invalid_shape@input.image_url"]);
    expect(errors("t2i-edit", { prompt: "a", image_urls: [IMG, "ftp://x"] })).toEqual(["invalid_shape@input.image_urls.1"]);
  });
});

describe("prompt", () => {
  test("a video request needs one when made from a prompt or from references — not from a frame or a clip", () => {
    expect(errors("t2v-i2v", {})).toEqual(["invalid_shape@input.prompt"]);
    expect(errors("t2v-i2v", { image_url: IMG })).toEqual([]);
    expect(errors("v2v-only", { video_url: VID })).toEqual([]);
    expect(errors("refs-only", { image_urls: [IMG] })).toEqual(["invalid_shape@input.prompt"]);
  });

  test("a picture model that generates from text needs one on every request, an edit included", () => {
    expect(errors("t2i-edit", { image_url: IMG })).toEqual(["invalid_shape@input.prompt"]);
    // An edit-only model's missing prompt is a route's complaint, not the model's.
    expect(errors("edit-only", { image_url: IMG })).toEqual([]);
  });

  test("an empty prompt is refused; an upscaler has none", () => {
    expect(errors("t2v-i2v", { prompt: "" })).toEqual(["invalid_shape@input.prompt"]);
    expect(errors("upscaler", { image_url: IMG })).toEqual([]);
    expect(errors("upscaler", { image_urls: [IMG] })).toEqual([]);
    expect(errors("upscaler", {})).toEqual(["unsupported_capability@input.image_url"]);
  });
});

describe("picture count", () => {
  test("`num_images` and `n` are one field, capped at `maxImages`, on picture models only", () => {
    expect(errors("t2i-only", { prompt: "a", num_images: 4 })).toEqual([]);
    expect(errors("t2i-only", { prompt: "a", n: 4 })).toEqual([]);
    expect(errors("t2i-only", { prompt: "a", num_images: 5 })).toEqual(["invalid_enum_value@input.num_images"]);
    expect(errors("t2i-only", { prompt: "a", n: 5 })).toEqual(["invalid_enum_value@input.n"]);
    expect(errors("t2i-only", { prompt: "a", n: 2, num_images: 2 })).toEqual(["invalid_shape@input.n"]);
    expect(errors("t2v-i2v", { prompt: "a", num_images: 2 })).toEqual(["unsupported_param@input.num_images"]);
    expect(errors("upscaler", { image_url: IMG, num_images: 2 })).toEqual(["unsupported_param@input.num_images"]);
    expect(errors("upscaler", { image_url: IMG, n: 2 })).toEqual(["unsupported_param@input.n"]);
  });

  test("a count of ONE is taken by every model, whatever it makes", () => {
    for (const field of ["num_images", "n"]) {
      expect(errors("t2v-i2v", { prompt: "a", [field]: 1 })).toEqual([]);
      expect(errors("upscaler", { image_url: IMG, [field]: 1 })).toEqual([]);
      expect(errors("narrator", { text: "hi", [field]: 1 })).toEqual([]);
      expect(errors("songwriter", { style: "folk", [field]: 1 })).toEqual([]);
    }
    expect(errors("narrator", { text: "hi", num_images: 2 })).toEqual(["unsupported_param@input.num_images"]);
    expect(errors("songwriter", { style: "folk", n: 2 })).toEqual(["unsupported_param@input.n"]);
    expect(errors("t2v-i2v", { prompt: "a", num_images: 1, n: 1 })).toEqual(["invalid_shape@input.n"]);
    expect(messages("songwriter", { style: "folk", n: 2 })[0]).toContain("makes sound");
  });
});

describe("`generate_audio` — `audio` under its second name", () => {
  test("is checked as `audio` and reported as what was sent", () => {
    expect(errors("t2v-i2v", { prompt: "a", generate_audio: true })).toEqual([]);
    expect(errors("ranged-video", { prompt: "a", generate_audio: false })).toEqual([]);
    expect(errors("ranged-video", { prompt: "a", generate_audio: true })).toEqual([
      "unsupported_capability@input.generate_audio",
    ]);
    expect(messages("ranged-video", { prompt: "a", generate_audio: true })[0]).toContain("`input.generate_audio`");
    expect(errors("t2i-only", { prompt: "a", generate_audio: true })).toEqual(["unsupported_capability@input.generate_audio"]);
    expect(errors("narrator", { text: "hi", generate_audio: true })).toEqual(["unsupported_param@input.generate_audio"]);
    expect(errors("songwriter", { style: "folk", generate_audio: true })).toEqual(["unsupported_param@input.generate_audio"]);
    expect(warnings("t2v-i2v", { prompt: "a", generate_audio: true })).toEqual([]);
  });

  test("both names at once is refused, even when they agree", () => {
    expect(errors("t2v-i2v", { prompt: "a", generate_audio: true, audio: true })).toEqual([
      "invalid_shape@input.generate_audio",
    ]);
  });

  test("SeedanceInput takes it; NemesisInput has no `audio` under either name", () => {
    expect(errors("seedance-2.5", { prompt: "a", generate_audio: true })).toEqual([]);
    expect(errors("nemesis", { video_url: VID, image_urls: [IMG], generate_audio: true })).toEqual([
      "unsupported_param@input.generate_audio",
    ]);
  });

  test("a non-boolean is the wire schema's to refuse", () => {
    expect(errors("t2v-i2v", { prompt: "a", generate_audio: "true" })).toEqual(["invalid_shape@input.generate_audio"]);
  });
});

describe("fields that belong to another kind of model", () => {
  test("speech and music fields are refused on a picture or video model", () => {
    expect(errors("t2v-i2v", { prompt: "a", text: "hi" })).toEqual(["unsupported_param@input.text"]);
    expect(errors("t2v-i2v", { prompt: "a", voice: "v1" })).toEqual(["unsupported_param@input.voice"]);
    expect(errors("t2i-only", { prompt: "a", lyrics: "la" })).toEqual(["unsupported_param@input.lyrics"]);
  });

  test("`negative_prompt` draws a WARNING where no route took it, and nothing where one does", () => {
    expect(errors("t2i-only", { prompt: "a", negative_prompt: "blur" })).toEqual([]);
    expect(warnings("t2i-only", { prompt: "a", negative_prompt: "blur" })).toEqual(["unsupported_param@input.negative_prompt"]);
    expect(warnings("picky", { prompt: "a", negative_prompt: "blur" })).toEqual([]);
  });
});

describe("task", () => {
  test("needs a clip, belongs to video models, and may be spelled once", () => {
    expect(errors("v2v-only", { prompt: "a", video_url: VID }, { task: "video_edit" })).toEqual([]);
    expect(errors("v2v-only", { prompt: "a", video_url: VID, task: "video_edit" })).toEqual([]);
    expect(errors("t2v-i2v", { prompt: "a" }, { task: "video_edit" })).toEqual(["invalid_shape@input.video_url"]);
    expect(errors("t2i-only", { prompt: "a" }, { task: "video_edit" })).toEqual(["unsupported_param@task"]);
    expect(errors("v2v-only", { prompt: "a", video_url: VID, task: "video_edit" }, { task: "video_extend" })).toEqual([
      "invalid_shape@input.task",
    ]);
    expect(errors("v2v-only", { prompt: "a", video_url: VID }, { task: "bogus" })).toEqual(["invalid_shape@task"]);
  });
});

describe("speech", () => {
  test("`text` is required unless `dialogue`; `prompt` stands in for it only when it is absent", () => {
    expect(errors("narrator", {})).toEqual(["invalid_shape@input.text"]);
    expect(errors("narrator", { text: "hi" })).toEqual([]);
    expect(errors("narrator", { prompt: "hi" })).toEqual([]);
    expect(errors("narrator", { text: "hi", prompt: "x" })).toEqual(["invalid_shape@input.prompt"]);
  });

  test("`text` is capped at `maxCharacters`", () => {
    expect(errors("narrator", { text: "a".repeat(10) })).toEqual([]);
    expect(errors("narrator", { text: "a".repeat(11) })).toEqual(["unsupported_capability@input.text"]);
  });

  test("`voice` must be one of the model's; a model that lists none takes any", () => {
    expect(errors("narrator", { text: "hi", voice: "v2" })).toEqual([]);
    expect(errors("narrator", { text: "hi", voice: "nope" })).toEqual(["invalid_enum_value@input.voice"]);
    expect(errors("polyglot", { text: "hi", voice: "anything" })).toEqual([]);
  });

  test("`dialogue` exists on the models that take it, and replaces `text` + `voice`", () => {
    expect(errors("cast-reader", { dialogue: [{ text: "a", voice: "v1" }, { text: "b" }] })).toEqual([]);
    expect(errors("cast-reader", { text: "x", dialogue: [{ text: "a" }] })).toEqual(["invalid_shape@input.dialogue"]);
    expect(errors("cast-reader", { dialogue: [{ text: "a", voice: "nope" }] })).toEqual([
      "invalid_enum_value@input.dialogue.0.voice",
    ]);
    expect(errors("cast-reader", { dialogue: [] })).toEqual(["invalid_shape@input.dialogue"]);
    expect(errors("cast-reader", { dialogue: [{ text: "a", pace: 1 }] })).toEqual(["invalid_shape@input.dialogue.0"]);
    expect(errors("narrator", { dialogue: [{ text: "a" }] })).toContain("unsupported_param@input.dialogue");
  });

  test("`language_code`: an enum where listed, refused on an empty list, free where unlisted", () => {
    expect(errors("cast-reader", { text: "hi", language_code: "EN" })).toEqual([]);
    expect(errors("cast-reader", { text: "hi", language_code: "zz" })).toEqual(["invalid_enum_value@input.language_code"]);
    expect(errors("narrator", { text: "hi", language_code: "en" })).toEqual(["unsupported_param@input.language_code"]);
    expect(errors("polyglot", { text: "hi", language_code: "zz" })).toEqual([]);
  });

  test("only the fields the model takes; the bounds are the API's", () => {
    expect(errors("narrator", { text: "hi", stability: 0.5, similarity_boost: 1, speed: 0.7 })).toEqual([]);
    expect(errors("cast-reader", { text: "hi", speed: 1 })).toEqual(["unsupported_param@input.speed"]);
    expect(errors("narrator", { text: "hi", speed: 1.3 })).toEqual(["invalid_shape@input.speed"]);
    expect(errors("narrator", { text: "hi", stability: 2 })).toEqual(["invalid_shape@input.stability"]);
    expect(errors("narrator", { text: "hi", seed: 1 })).toEqual(["unsupported_param@input.seed"]);
  });
});

describe("music", () => {
  test("needs `style` or `lyrics`; a prompt alone is refused", () => {
    expect(errors("songwriter", { style: "folk" })).toEqual([]);
    expect(errors("songwriter", { lyrics: "la" })).toEqual([]);
    expect(errors("songwriter", { prompt: "a song" })).toEqual(["invalid_shape@input.style"]);
  });

  test("`lyrics` and `instrumental: true` exclude each other", () => {
    expect(errors("songwriter", { lyrics: "la", instrumental: true })).toEqual(["invalid_shape@input.instrumental"]);
    expect(errors("songwriter", { lyrics: "la", instrumental: false })).toEqual([]);
    expect(errors("songwriter", { style: "folk", instrumental: true })).toEqual([]);
  });

  test("the prompt is the idea, at most 3000 characters, and nothing else applies", () => {
    expect(errors("songwriter", { style: "folk", prompt: "a".repeat(3000) })).toEqual([]);
    expect(errors("songwriter", { style: "folk", prompt: "a".repeat(3001) })).toEqual(["unsupported_capability@input.prompt"]);
    expect(errors("songwriter", { style: "folk", duration: 30 })).toEqual(["unsupported_param@input.duration"]);
    expect(errors("songwriter", { style: "folk", text: "x" })).toEqual(["unsupported_param@input.text"]);
  });
});

describe("SeedanceInput", () => {
  test("is matched exactly, case included, and has no seed, negative prompt or quality", () => {
    expect(errors("seedance-2.5", { prompt: "a", resolution: "1080p", aspect_ratio: "adaptive" })).toEqual([]);
    expect(errors("seedance-2.5", { prompt: "a", resolution: "1080P" })).toEqual(["invalid_enum_value@input.resolution"]);
    expect(errors("seedance-2.5", { prompt: "a", seed: 1 })).toEqual(["unsupported_param@input.seed"]);
    expect(errors("seedance-2.5", { prompt: "a", negative_prompt: "x" })).toEqual(["unsupported_param@input.negative_prompt"]);
    expect(errors("seedance-2.5", { prompt: "a", audio_url: AUD })).toEqual(["unsupported_param@input.audio_url"]);
  });

  test("requires a prompt, bounds the duration, and keeps the clip's length on an edit", () => {
    expect(errors("seedance-2.5", { image_url: IMG })).toEqual(["invalid_shape@input.prompt"]);
    expect(errors("seedance-2.5", { prompt: "a", duration: 3 })).toEqual(["invalid_enum_value@input.duration"]);
    expect(errors("seedance-2.5", { prompt: "a", video_url: VID, duration: 5 })).toEqual(["invalid_shape@input.duration"]);
    expect(errors("seedance-2.5", { prompt: "a", video_url: VID })).toEqual([]);
  });

  test("an exact first frame cannot be combined with reference media", () => {
    expect(errors("seedance-2.5", { prompt: "a", image_url: IMG, image_urls: [IMG] })).toEqual(["invalid_shape@input.image_url"]);
    expect(errors("seedance-2.5", { prompt: "a", end_image_url: IMG })).toEqual(["invalid_shape@input.end_image_url"]);
    expect(errors("seedance-2.5", { prompt: "a", image_urls: [IMG], video_urls: [VID], audio_urls: [AUD] })).toEqual([]);
    expect(errors("seedance-2.5", { prompt: "a", video_urls: Array(11).fill(VID) })).toEqual([
      "unsupported_capability@input.video_urls",
    ]);
  });
});

describe("NemesisInput", () => {
  const base = { video_url: VID, image_urls: [IMG] };

  test("requires the clip and the references, and takes an empty prompt", () => {
    expect(errors("nemesis", base)).toEqual([]);
    expect(errors("nemesis", { ...base, prompt: "" })).toEqual([]);
    expect(errors("nemesis", { image_urls: [IMG] })).toEqual(["invalid_shape@input.video_url"]);
    expect(errors("nemesis", { video_url: VID })).toEqual(["invalid_shape@input.image_urls"]);
  });

  test("one role per picture, from the list", () => {
    expect(errors("nemesis", { ...base, roles: ["product"] })).toEqual([]);
    expect(errors("nemesis", { ...base, roles: ["person", "product"] })).toEqual(["invalid_shape@input.roles"]);
    expect(errors("nemesis", { ...base, roles: ["hero"] })).toEqual(["invalid_enum_value@input.roles.0"]);
  });

  test("its enums are exact, its references capped, and it has no duration", () => {
    expect(errors("nemesis", { ...base, guide: "scene", sound: "none", face_mesh: true, target_frame: false })).toEqual([]);
    expect(errors("nemesis", { ...base, guide: "zzz" })).toEqual(["invalid_enum_value@input.guide"]);
    expect(errors("nemesis", { ...base, resolution: "720P" })).toEqual(["invalid_enum_value@input.resolution"]);
    expect(errors("nemesis", { video_url: VID, image_urls: Array(9).fill(IMG) })).toEqual([
      "unsupported_capability@input.image_urls",
    ]);
    expect(errors("nemesis", { ...base, duration: 5 })).toEqual(["unsupported_param@input.duration"]);
  });
});

describe("views and foreign ids", () => {
  const editOnly = validatorFor({
    view: {
      ids: ["t2i-edit", "edit-only"],
      does: "edit a picture",
      wide: "revana.image",
      needsOneOf: ["image_url", "image_urls"],
    },
  });

  test("a view refuses a model that is not its own and names the wide address", () => {
    const result = editOnly({ model: "t2i-only", input: { prompt: "a" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => `${e.code}@${e.path.join(".")}`)).toEqual(["unsupported_capability@model"]);
    expect(result.errors[0]?.message).toContain("`revana.image` validates it");
  });

  test("a view refuses a request that lacks the input that makes it the view's", () => {
    const result = editOnly({ model: "t2i-edit", input: { prompt: "a" } });
    expect(result.ok).toBe(false);
    expect(editOnly({ model: "t2i-edit", input: { prompt: "a", image_url: IMG } }).ok).toBe(true);
  });

  test("a model another address serves is signposted, never refused", () => {
    const result = safe({ model: "foreign-model", input: { prompt: "a" } });
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code).sort()).toEqual(["unknown_model", "unsupported_capability"]);
    expect(result.warnings.find((w) => w.code === "unsupported_capability")?.message).toContain("`revana.elsewhere` validates");
  });

  test("an id nobody knows is only an unknown model — its body passes untouched", () => {
    const result = safe({ model: "brand-new", input: { prompt: "a", some_new_field: 1 } });
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});
