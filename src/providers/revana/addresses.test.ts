import { describe, expect, test } from "bun:test";
import { avatar } from "./avatar";
import { image } from "./image";
import { imageEdit } from "./image-edit";
import { lipsync } from "./lipsync";
import { music } from "./music";
import { tts } from "./tts";
import { upscale } from "./upscale";
import { video } from "./video";
import { models, provider } from "./models";
import {
  REVANA_AVATAR_MODELS,
  REVANA_CHAT_MODELS,
  REVANA_IMAGE_EDIT_MODELS,
  REVANA_IMAGE_MODELS,
  REVANA_LIPSYNC_MODELS,
  REVANA_MUSIC_MODELS,
  REVANA_TTS_MODELS,
  REVANA_UPSCALE_MODELS,
  REVANA_VIDEO_MODELS,
} from "./gen/ids.gen";
import { REVANA_MUSIC_SHAPES } from "./gen/shapes-music.gen";
import { REVANA_TTS_SHAPES } from "./gen/shapes-tts.gen";
import { REVANA_IMAGE_SHAPES } from "./gen/shapes-image.gen";
import { REVANA_VIDEO_SHAPES } from "./gen/shapes-video.gen";
import {
  BALANCE_URL,
  GENERATIONS_QUOTE_URL,
  GENERATIONS_URL,
  MODELS_URL,
  REVANA_BASE_URL,
  UPLOADS_URL,
  generationContentUrl,
  generationUrl,
} from "./urls";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

/**
 * The eight media addresses, against the generated tables. The rules
 * themselves are pinned on hand-written rows in `checks.test.ts`; this file is
 * about the things that are per ADDRESS — which ids each serves, what a view
 * refuses, where a foreign id is pointed — plus one real row per kind, so the
 * wiring from catalog to check is exercised end to end.
 */

type Loose = (params: unknown, options?: ValidateOptions) => ValidateResult<Record<string, unknown>>;
const loose = (validator: { safe: unknown }): Loose => validator.safe as Loose;

const codes = (result: ValidateResult<Record<string, unknown>>): string[] =>
  result.ok ? [] : result.errors.map((issue) => `${issue.code}@${issue.path.join(".")}`);

const IMG = "https://example.com/a.png";
const VID = "https://example.com/a.mp4";
const AUD = "https://example.com/a.mp3";

describe("the Revana routes", () => {
  test("every media address posts to one URL; the helpers hang off the same base", () => {
    expect(REVANA_BASE_URL).toBe("https://api.revana.si/v1");
    expect(GENERATIONS_URL).toBe("https://api.revana.si/v1/generations");
    expect(GENERATIONS_QUOTE_URL).toBe("https://api.revana.si/v1/generations/quote");
    expect(MODELS_URL).toBe("https://api.revana.si/v1/models");
    expect(BALANCE_URL).toBe("https://api.revana.si/v1/balance");
    expect(UPLOADS_URL).toBe("https://api.revana.si/v1/uploads");
  });

  test("the poll and download URLs escape the id; the first file has no index", () => {
    expect(generationUrl("gen_1 2")).toBe("https://api.revana.si/v1/generations/gen_1%202");
    expect(generationContentUrl("gen_1")).toBe("https://api.revana.si/v1/generations/gen_1/content");
    expect(generationContentUrl("gen_1", 1)).toBe("https://api.revana.si/v1/generations/gen_1/content");
    expect(generationContentUrl("gen_1", 3)).toBe("https://api.revana.si/v1/generations/gen_1/content/3");
  });
});

describe("the result", () => {
  const params = video({
    model: "veo-3.1",
    input: { prompt: "A fox walks through snow", resolution: "1080p", duration: 8, audio: true },
    max_cost_usd: 4,
  });

  test("its enumerable properties are the wire body, byte for byte", () => {
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      model: "veo-3.1",
      input: { prompt: "A fox walks through snow", resolution: "1080p", duration: 8, audio: true },
      max_cost_usd: 4,
    });
  });

  test("`.request` is the POST, with no credential anywhere on it", () => {
    expect(params.request).toEqual({
      url: "https://api.revana.si/v1/generations",
      method: "POST",
      headers: { "content-type": "application/json" },
    });
  });

  test("`.toSdk(\"revana\")` is the body unchanged — Revana ships no SDK", () => {
    expect(params.toSdk("revana")).toEqual(JSON.parse(JSON.stringify(params)));
  });

  test("the throwing form throws the library's error, naming the address", () => {
    const call = () => loose(video)({ model: "veo-3.1", input: { prompt: "a", resolution: "480p" } });
    expect(codes(call())).toEqual(["invalid_enum_value@input.resolution"]);
    try {
      (video as unknown as (p: unknown) => unknown)({ model: "veo-3.1", input: { prompt: "a", resolution: "480p" } });
      throw new Error("expected a validation error");
    } catch (error) {
      expect(UnmodelValidationError.isInstance(error)).toBe(true);
      expect((error as Error).message).toContain("revana.video");
      expect((error as Error).message).toContain("720p, 1080p, 4K");
    }
  });
});

describe("which ids each address serves", () => {
  test("the four wide addresses partition the media catalog by kind", () => {
    const wide = [...REVANA_VIDEO_MODELS, ...REVANA_IMAGE_MODELS, ...REVANA_TTS_MODELS, ...REVANA_MUSIC_MODELS];
    expect(new Set(wide).size).toBe(wide.length);
    const rows = [REVANA_VIDEO_SHAPES, REVANA_IMAGE_SHAPES, REVANA_TTS_SHAPES, REVANA_MUSIC_SHAPES];
    expect<string[]>([...wide].sort()).toEqual(rows.flatMap((table) => Object.keys(table)).sort());
  });

  test("every view is a subset of its wide address", () => {
    const within = (view: readonly string[], wideIds: readonly string[]): boolean => view.every((id) => wideIds.includes(id));
    expect(within(REVANA_IMAGE_EDIT_MODELS, REVANA_IMAGE_MODELS)).toBe(true);
    expect(within(REVANA_UPSCALE_MODELS, REVANA_IMAGE_MODELS)).toBe(true);
    expect(within(REVANA_LIPSYNC_MODELS, REVANA_VIDEO_MODELS)).toBe(true);
    expect(within(REVANA_AVATAR_MODELS, REVANA_VIDEO_MODELS)).toBe(true);
    for (const view of [REVANA_IMAGE_EDIT_MODELS, REVANA_UPSCALE_MODELS, REVANA_LIPSYNC_MODELS, REVANA_AVATAR_MODELS]) {
      expect(view.length).toBeGreaterThan(0);
    }
  });

  test("the merged catalog is every id, once, and each row names itself", () => {
    const ids = [...REVANA_VIDEO_MODELS, ...REVANA_IMAGE_MODELS, ...REVANA_TTS_MODELS, ...REVANA_MUSIC_MODELS, ...REVANA_CHAT_MODELS];
    expect(Object.keys(models).sort()).toEqual([...ids].sort());
    for (const [id, row] of Object.entries(models)) expect<string>(row.id).toBe(id);
    expect(provider).toEqual({
      id: "revana",
      name: "Revana",
      env: ["REVANA_API_KEY"],
      doc: "https://revana.si/docs",
      api: "https://api.revana.si/v1",
    });
  });
});

describe("the wide addresses never refuse what a view serves", () => {
  test("`revana.video` validates an avatar and a lip-sync request", () => {
    expect(loose(video)({ model: "omnihuman-2.0", input: { prompt: "a", image_url: IMG, audio_url: AUD } }).ok).toBe(true);
    expect(loose(video)({ model: "bytedance-lipsync", input: { video_url: VID, audio_url: AUD } }).ok).toBe(true);
  });

  test("`revana.image` validates an edit and an upscale", () => {
    expect(loose(image)({ model: "flux-kontext-pro", input: { prompt: "a", image_url: IMG } }).ok).toBe(true);
    expect(loose(image)({ model: "recraft-crisp-upscale", input: { image_url: IMG } }).ok).toBe(true);
  });
});

describe("the views", () => {
  test("`revana.imageEdit` needs a model that edits, and the picture to edit", () => {
    expect(loose(imageEdit)({ model: "flux-kontext-pro", input: { prompt: "a", image_url: IMG } }).ok).toBe(true);
    expect(loose(imageEdit)({ model: "flux-kontext-pro", input: { prompt: "a", image_urls: [IMG] } }).ok).toBe(true);
    expect(codes(loose(imageEdit)({ model: "flux-kontext-pro", input: { prompt: "a" } }))).toEqual(["invalid_shape@input.image_url"]);
    const foreign = loose(imageEdit)({ model: "imagen-4", input: { prompt: "a" } });
    expect(codes(foreign)).toEqual(["unsupported_capability@model"]);
    expect(foreign.ok ? "" : foreign.errors[0]?.message).toContain("`revana.image` validates it");
  });

  test("`revana.upscale` serves the upscalers, and needs the thing to enlarge", () => {
    expect(loose(upscale)({ model: "recraft-crisp-upscale", input: { image_url: IMG } }).ok).toBe(true);
    // The API takes the picture as `image_urls` too, under either of its names.
    expect(loose(upscale)({ model: "recraft-crisp-upscale", input: { image_urls: [IMG] } }).ok).toBe(true);
    expect(loose(upscale)({ model: "recraft-crisp-upscale", input: { reference_images: [IMG] } }).ok).toBe(true);
    expect(codes(loose(upscale)({ model: "recraft-crisp-upscale", input: {} }))).toContain("invalid_shape@input.image_url");
    expect(codes(loose(upscale)({ model: "nano-banana-pro", input: { prompt: "a", image_url: IMG } }))).toEqual([
      "unsupported_capability@model",
    ]);
  });

  test("`revana.lipsync` and `revana.avatar` serve the curated ids, and need the sound", () => {
    expect(loose(lipsync)({ model: "bytedance-lipsync", input: { video_url: VID, audio_url: AUD } }).ok).toBe(true);
    expect(codes(loose(lipsync)({ model: "bytedance-lipsync", input: { video_url: VID } }))).toEqual(["invalid_shape@input.audio_url"]);
    expect(codes(loose(lipsync)({ model: "veo-3.1", input: { prompt: "a" } }))).toEqual(["unsupported_capability@model"]);

    expect(loose(avatar)({ model: "omnihuman-2.0", input: { prompt: "a", image_url: IMG, audio_url: AUD } }).ok).toBe(true);
    expect(codes(loose(avatar)({ model: "omnihuman-2.0", input: { prompt: "a", image_url: IMG } }))).toEqual(["invalid_shape@input.audio_url"]);
    expect(codes(loose(avatar)({ model: "bytedance-lipsync", input: { video_url: VID, audio_url: AUD } }))).toEqual([
      "unsupported_capability@model",
    ]);
  });
});

describe("a model id from another address", () => {
  test("is pointed at its own address, and the request still goes through", () => {
    const result = loose(video)({ model: "nano-banana-pro", input: { prompt: "a" } });
    expect(result.ok).toBe(true);
    const pointer = result.warnings.find((w) => w.code === "unsupported_capability");
    expect(pointer?.message).toContain("`revana.image` validates");
    expect(loose(image)({ model: "elevenlabs-v3", input: { text: "hi" } }).warnings.map((w) => w.message).join(" ")).toContain(
      "`revana.tts` validates",
    );
    expect(loose(tts)({ model: "suno-v6", input: { style: "folk" } }).warnings.map((w) => w.message).join(" ")).toContain(
      "`revana.music` validates",
    );
  });

  test("an id Revana added after the snapshot is an unknown model and nothing more", () => {
    const result = loose(music)({ model: "suno-v7", input: { style: "folk", tempo: 120 } });
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});

describe("one real row per kind, end to end", () => {
  test("video: veo-3.1's lists reach the check", () => {
    expect(codes(loose(video)({ model: "veo-3.1", input: { prompt: "a", duration: 5 } }))).toEqual(["invalid_enum_value@input.duration"]);
    expect(codes(loose(video)({ model: "veo-3.1", input: { prompt: "a", image_urls: [IMG] } }))).toEqual([
      "unsupported_capability@input.image_urls",
    ]);
  });

  test("image: nano-banana-pro's caps reach the check", () => {
    expect(codes(loose(image)({ model: "nano-banana-pro", input: { prompt: "a", num_images: 5 } }))).toEqual([
      "invalid_enum_value@input.num_images",
    ]);
    expect(codes(loose(image)({ model: "nano-banana-pro", input: { prompt: "a", image_urls: Array(15).fill(IMG) } }))).toEqual([
      "unsupported_capability@input.image_urls",
    ]);
  });

  test("speech: elevenlabs-v3's voices and dialogue reach the check", () => {
    expect(loose(tts)({ model: "elevenlabs-v3", input: { dialogue: [{ text: "a", voice: "EkK5I93UQWFDigLMpZcX" }] } }).ok).toBe(true);
    expect(codes(loose(tts)({ model: "elevenlabs-v3", input: { text: "a", voice: "alloy" } }))).toEqual(["invalid_enum_value@input.voice"]);
    expect(codes(loose(tts)({ model: "elevenlabs-v4", input: { text: "a", language_code: "en" } }))).toEqual([
      "unsupported_param@input.language_code",
    ]);
  });

  test("music: suno-v6 needs a style or lyrics", () => {
    expect(codes(loose(music)({ model: "suno-v6", input: { prompt: "a song" } }))).toEqual(["invalid_shape@input.style"]);
  });
});

describe("the estimate", () => {
  test("is the listed price when the request states what it is priced by, and absent otherwise", () => {
    const priced = loose(video)({ model: "veo-3.1", input: { prompt: "a", resolution: "720p", duration: 4, audio: false } });
    expect(priced.ok && priced.estimate.costUSD).toBe(0.8);
    const unpriced = loose(video)({ model: "veo-3.1", input: { prompt: "a" } });
    expect(unpriced.ok && unpriced.estimate.costUSD).toBeUndefined();
  });

  test("drives `maxCostUSD`: a listed price over budget is a refusal that cannot be wrong", () => {
    const input = { prompt: "a", resolution: "720p", duration: 8, audio: true };
    expect(codes(loose(video)({ model: "veo-3.1", input }, { maxCostUSD: 1 }))).toEqual(["over_budget@model"]);
    expect(loose(video)({ model: "veo-3.1", input }, { maxCostUSD: 10 }).ok).toBe(true);
  });
});
