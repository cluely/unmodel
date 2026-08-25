/**
 * `unmodel/avatar`, end to end through the ready-made pack.
 *
 * The golden matrix next door pins *what* each ref compiles to; this pins what
 * a caller gets back, and the one thing this category has that none of its
 * siblings do: a canonical field that is REQUIRED at six models and has no wire
 * field at all at the other two.
 */
import { describe, expect, test } from "bun:test";
import { UnmodelValidationError } from "../../src/core/issues";
import { TranslationUnavailableError } from "../../src/core/translate/errors";
import { avatar as falAvatar } from "../../src/providers/fal";
import { avatar, createAvatar } from "../../src/unified/avatar";
import { avatar as falAdapter } from "../../src/providers/fal/unified-avatar";
import { lipsync } from "../../src/unified/lipsync";

const STILL = { url: "https://example.com/headshot.png" } as const;
const VOICE = { url: "https://example.com/vo-french.wav" } as const;

describe("the pack", () => {
  test("registers exactly the one avatar provider", () => {
    expect([...avatar.providers]).toEqual(["fal"]);
  });

  test("a provider outside the pack is structural, not a validation error", () => {
    expect(() =>
      avatar({ model: "heygen/avatar-4", image: STILL, audio: VOICE } as never),
    ).toThrow(TranslationUnavailableError);
    const result = avatar.safe({ model: "heygen/avatar-4", image: STILL, audio: VOICE } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.meta?.["structural"]).toBe(true);
    expect(result.errors[0]?.message).toContain("not a avatar provider in this build");
  });

  test("a model the adapter does not list warns but still compiles and routes", () => {
    const result = avatar.safe({
      model: "fal/fal-ai/bytedance/omnihuman/v9",
      image: STILL,
      audio: VOICE,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((issue) => issue.code === "unknown_model")).toBe(true);
    const params = result.params as unknown as { request: { url: string } };
    expect(params.request.url).toBe("https://queue.fal.run/fal-ai/bytedance/omnihuman/v9");
  });

  test("the eight endpoints are one adapter, and the pack is that adapter", () => {
    expect(falAdapter.models).toHaveLength(8);
    expect([...createAvatar([falAdapter]).providers]).toEqual(["fal"]);
  });
});

describe("the result is fal's own Validated", () => {
  test("the enumerable body IS the fetch payload, and the route is not in it", () => {
    const result = avatar({
      model: "fal/fal-ai/sync-lipsync/v3/image-to-video",
      image: STILL,
      audio: VOICE,
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      image_url: STILL.url,
      audio_url: VOICE.url,
    });
    expect(result.request.url).toBe("https://queue.fal.run/fal-ai/sync-lipsync/v3/image-to-video");
    expect(result.toSdk("fal")).toEqual({
      input: { image_url: STILL.url, audio_url: VOICE.url },
    });
    expect(result.warnings).toEqual([]);
  });

  test("it ends in the SAME validator the hand surface calls", () => {
    const unified = avatar({
      model: "fal/fal-ai/kling-video/ai-avatar/v2/pro",
      image: STILL,
      audio: VOICE,
    });
    const byHand = falAvatar({
      endpoint: "fal-ai/kling-video/ai-avatar/v2/pro",
      image_url: STILL.url,
      audio_url: VOICE.url,
    });
    expect(JSON.parse(JSON.stringify(unified))).toEqual(JSON.parse(JSON.stringify(byHand)));
    expect(unified.request.url).toBe(byHand.request.url);
  });

  test("no estimate, even where the rate is flat", () => {
    // Five of the eight publish one per-second or per-minute number, and none
    // of them can be settled from a request body: the clip's length follows the
    // input audio's, which unmodel never reads. The RATE reaches a caller
    // through the catalog row instead.
    const result = avatar.safe({
      model: "fal/fal-ai/kling-video/ai-avatar/v2/pro",
      image: STILL,
      audio: VOICE,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate?.costUSD).toBeUndefined();
  });
});

describe("`image` is required, forbidden, or wide — and never silently dropped", () => {
  test("a still-driven route requires it, at the canonical path", () => {
    const result = avatar.safe({
      model: "fal/fal-ai/bytedance/omnihuman/v1.5",
      audio: VOICE,
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((error) => error.path.join(".") === "image");
    expect(issue?.code).toBe("invalid_shape");
    expect(issue?.message).toContain("required here");
  });

  test("a performer-driven route refuses it, naming the field it wants instead", () => {
    const result = avatar.safe({
      model: "fal/veed/avatars/audio-to-video",
      image: STILL,
      audio: VOICE,
      providerOptions: { fal: { avatar_id: "emily_primary" } },
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((error) => error.path.join(".") === "image");
    expect(issue?.code).toBe("unsupported_param");
    expect(issue?.message).toContain("catalogued performer");
    expect(issue?.message).toContain("avatar_id");
    expect(issue?.meta?.["wire"]).toBe("avatar_id");
  });

  test("…and without it, the performer route compiles cleanly", () => {
    const result = avatar({
      model: "fal/veed/avatars/audio-to-video",
      audio: VOICE,
      providerOptions: { fal: { avatar_id: "marcus_side" } },
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      audio_url: VOICE.url,
      avatar_id: "marcus_side",
    });
    expect(result.warnings).toEqual([]);
  });

  test("inline bytes become a data: URI rather than a multipart upload", () => {
    // fal takes every file input as a REFERENCE — an https URL or a data URI —
    // and unmodel never uploads. That is the whole media contract here.
    const result = avatar({
      model: "fal/fal-ai/sync-lipsync/v3/image-to-video",
      image: { data: "AAECAwQF", mimeType: "image/png" },
      audio: VOICE,
    });
    expect(JSON.parse(JSON.stringify(result))).toMatchObject({
      image_url: "data:image/png;base64,AAECAwQF",
    });
  });
});

describe("the split from unmodel/lipsync, exercised", () => {
  /**
   * One vendor, one model, two routes, two entry points. This is the clearest
   * statement of the categories' boundary there is, and it is asserted rather
   * than argued: the same product name resolves in both packs, to different
   * endpoints, taking different media.
   */
  test("sync-lipsync/v3 and v3/image-to-video are two entry points", () => {
    const clip = lipsync({
      model: "fal/fal-ai/sync-lipsync/v3",
      source: { url: "https://example.com/take-3.mp4" },
      audio: VOICE,
    });
    const still = avatar({
      model: "fal/fal-ai/sync-lipsync/v3/image-to-video",
      image: STILL,
      audio: VOICE,
    });
    expect(clip.request.url).toBe("https://queue.fal.run/fal-ai/sync-lipsync/v3");
    expect(still.request.url).toBe("https://queue.fal.run/fal-ai/sync-lipsync/v3/image-to-video");
    expect(JSON.parse(JSON.stringify(clip))).toHaveProperty("video_url");
    expect(JSON.parse(JSON.stringify(still))).toHaveProperty("image_url");
  });

  test("neither ref resolves in the other pack's roster", () => {
    expect(falAdapter.models).not.toContain("fal-ai/sync-lipsync/v3");
    const crossed = lipsync.safe({
      model: "fal/fal-ai/sync-lipsync/v3/image-to-video",
      source: { url: "https://example.com/take-3.mp4" },
      audio: VOICE,
    });
    expect(crossed.ok).toBe(true);
    if (!crossed.ok) return;
    // It degrades rather than failing — the roster is a snapshot everywhere in
    // this library — but it degrades LOUDLY, which is the answer a caller who
    // reached for the wrong entry point needs.
    expect(crossed.warnings.some((issue) => issue.code === "unknown_model")).toBe(true);
  });
});

describe("providerOptions", () => {
  test("carries the per-model knobs the vocabulary has no word for", () => {
    const result = avatar({
      model: "fal/fal-ai/bytedance/omnihuman/v1.5",
      image: STILL,
      audio: VOICE,
      providerOptions: { fal: { turbo_mode: true, resolution: "720p" } },
    });
    const body = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    expect(body["turbo_mode"]).toBe(true);
    expect(body["resolution"]).toBe("720p");
  });

  test("and is still validated by fal's own IR on the way out", () => {
    const result = avatar.safe({
      model: "fal/fal-ai/bytedance/omnihuman/v1.5",
      image: STILL,
      audio: VOICE,
      providerOptions: { fal: { resolution: "4k" } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.message.includes("1080p"))).toBe(true);
  });
});

describe("the throwing form", () => {
  test("throws UnmodelValidationError labelled with the category", () => {
    expect(() =>
      avatar({ model: "fal/veed/avatars/audio-to-video", image: STILL, audio: VOICE } as never),
    ).toThrow(UnmodelValidationError);
    try {
      avatar({ model: "fal/veed/avatars/audio-to-video", image: STILL, audio: VOICE } as never);
    } catch (error) {
      expect((error as UnmodelValidationError).message).toContain("unmodel/avatar");
      expect((error as UnmodelValidationError).message).toContain("image");
    }
  });
});
