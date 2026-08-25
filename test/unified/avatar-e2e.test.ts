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
import { avatar as heygenAvatar } from "../../src/providers/heygen";
import { avatar as veedAvatar } from "../../src/providers/veed";
import { avatar, createAvatar } from "../../src/unified/avatar";
import { avatar as falAdapter } from "../../src/providers/fal/unified-avatar";
import { avatar as heygenAdapter } from "../../src/providers/heygen/unified-avatar";
import { avatar as syncAdapter } from "../../src/providers/sync/unified-avatar";
import { avatar as veedAdapter } from "../../src/providers/veed/unified-avatar";
import { lipsync } from "../../src/unified/lipsync";

const STILL = { url: "https://example.com/headshot.png" } as const;
const VOICE = { url: "https://example.com/vo-french.wav" } as const;

describe("the pack", () => {
  test("registers exactly the four avatar providers", () => {
    expect([...avatar.providers]).toEqual(["fal", "heygen", "sync", "veed"]);
  });

  test("a provider outside the pack is structural, not a validation error", () => {
    expect(() =>
      avatar({ model: "topaz/Standard V2", image: STILL, audio: VOICE } as never),
    ).toThrow(TranslationUnavailableError);
    const result = avatar.safe({
      model: "topaz/Standard V2",
      image: STILL,
      audio: VOICE,
    } as never);
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

  test("each provider is one adapter, and any of them builds a pack on its own", () => {
    expect(falAdapter.models).toHaveLength(8);
    expect(syncAdapter.models).toHaveLength(1);
    expect(veedAdapter.models).toHaveLength(1);
    // Two of HeyGen's three engines: Avatar III is in the catalog and at the
    // wire address and does not render raw image input, which is the arm this
    // adapter compiles.
    expect(heygenAdapter.models).toHaveLength(2);
    expect([...createAvatar([falAdapter]).providers]).toEqual(["fal"]);
    expect([...createAvatar([syncAdapter]).providers]).toEqual(["sync"]);
    expect([...createAvatar([veedAdapter]).providers]).toEqual(["veed"]);
    expect([...createAvatar([heygenAdapter]).providers]).toEqual(["heygen"]);
  });
});

/**
 * The native half, and the reason this category is a sibling of
 * `unmodel/lipsync` rather than an arm of it.
 *
 * `sync/sync-3` is in BOTH packs, at the same URL, under the same model id. The
 * only thing separating the two requests is the tag on the first input item —
 * so a single `source` that meant either would put the discriminator in the
 * caller's head.
 */
describe("the result is sync.'s own Validated, and it is one id in two categories", () => {
  test("the still is an ITEM, tagged `image`", () => {
    const result = avatar({ model: "sync/sync-3", image: STILL, audio: VOICE });
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      model: "sync-3",
      input: [
        { type: "image", url: STILL.url },
        { type: "audio", url: VOICE.url },
      ],
    });
    expect(result.request.url).toBe("https://api.sync.so/v2/generate");
  });

  test("the same id in the lipsync pack differs by exactly one tag", () => {
    const still = JSON.parse(
      JSON.stringify(avatar({ model: "sync/sync-3", image: STILL, audio: VOICE })),
    ) as { input: Array<{ type: string }> };
    const clip = JSON.parse(
      JSON.stringify(
        lipsync({
          model: "sync/sync-3",
          source: { url: "https://example.com/take-3.mp4" },
          audio: VOICE,
        }),
      ),
    ) as { input: Array<{ type: string }> };
    expect(still.input[0]?.type).toBe("image");
    expect(clip.input[0]?.type).toBe("video");
    expect(still.input[1]?.type).toBe(clip.input[1]?.type);
  });

  test("`image` is required here, because the row says `sources: [\"image\"]`", () => {
    const result = avatar.safe({ model: "sync/sync-3", audio: VOICE } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((issue) => issue.path.join("."))).toContain("image");
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

/**
 * VEED natively, and the one thing this category has nowhere else: a route that
 * requires a word the vocabulary does not have.
 */
describe("the result is VEED's own Validated, and it insists on a resolution", () => {
  test("the still, the track, and the extra that is not optional", () => {
    const result = avatar({
      model: "veed/fabric-1.0",
      image: STILL,
      audio: VOICE,
      resolution: "480p",
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      image_url: STILL.url,
      audio_url: VOICE.url,
      resolution: "480p",
    });
    expect(result.request.url).toBe("https://api.veed.io/v1/fabric-1.0");
    expect(result.warnings).toEqual([]);
  });

  test("omitting it is refused by NAME, with both rates in the message", () => {
    // `FabricInput.resolution` is `required` with no `default`, so VEED answers
    // 422. unmodel does not pick one: the two values are a 2× price difference,
    // so an invented default would be a line item.
    const result = avatar.safe({ model: "veed/fabric-1.0", image: STILL, audio: VOICE } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((error) => error.path.join(".") === "resolution");
    expect(issue?.code).toBe("invalid_shape");
    expect(issue?.message).toContain("$0.08");
    expect(issue?.message).toContain("$0.15");
    expect(issue?.meta?.["allowed"]).toEqual(["480p", "720p"]);
  });

  test("it ends in the SAME validator the hand surface calls", () => {
    const unified = avatar({
      model: "veed/fabric-1.0",
      image: STILL,
      audio: VOICE,
      resolution: "720p",
    });
    const byHand = veedAvatar({
      image_url: STILL.url,
      audio_url: VOICE.url,
      resolution: "720p",
    });
    expect(JSON.parse(JSON.stringify(unified))).toEqual(JSON.parse(JSON.stringify(byHand)));
    expect(unified.request.url).toBe(byHand.request.url);
  });

  test("the same VENDOR is a preset-performer row through fal and a still row here", () => {
    // `POST /v1/avatars` answers a real JSON 404: VEED's presenter library has
    // no native endpoint, so the two products are `sources: []` at fal and
    // `sources: ["image"]` here.
    const preset = avatar({
      model: "fal/veed/avatars/audio-to-video",
      audio: VOICE,
      providerOptions: { fal: { avatar_id: "marcus_side" } },
    });
    expect(JSON.parse(JSON.stringify(preset))).not.toHaveProperty("image_url");
    const native = avatar({
      model: "veed/fabric-1.0",
      image: STILL,
      audio: VOICE,
      resolution: "720p",
    });
    expect(JSON.parse(JSON.stringify(native))).toHaveProperty("image_url", STILL.url);
    expect(veedAdapter.modelParams["fabric-1.0"].sources).toEqual(["image"]);
  });
});

/**
 * HeyGen natively — the route with a real inline-bytes arm, and the one place
 * in the library where two media fields on ONE request disagree about it.
 */
describe("the result is HeyGen's own Validated, and the bytes go in structurally", () => {
  test("the engine is written out, because an omitted one is a price decision", () => {
    const result = avatar({ model: "heygen/avatar_iv", image: STILL, audio: VOICE });
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      type: "image",
      engine: { type: "avatar_iv" },
      image: { type: "url", url: STILL.url },
      audio_url: VOICE.url,
    });
    expect(result.request.url).toBe("https://api.heygen.com/v3/videos");
    expect(result.warnings).toEqual([]);
  });

  test("inline bytes become a base64 ARM, not a data: URI", () => {
    const result = avatar({
      model: "heygen/avatar_v",
      image: { data: "AAECAwQF", mimeType: "image/png" },
      audio: VOICE,
    });
    expect(JSON.parse(JSON.stringify(result))).toMatchObject({
      image: { type: "base64", media_type: "image/png", data: "AAECAwQF" },
    });
  });

  test("a caller's data: URI is unwrapped into the two fields the arm has", () => {
    const result = avatar({
      model: "heygen/avatar_iv",
      image: { data: "data:image/webp;base64,QUJD" } as never,
      audio: VOICE,
    });
    expect(JSON.parse(JSON.stringify(result))).toMatchObject({
      image: { type: "base64", media_type: "image/webp", data: "QUJD" },
    });
  });

  test("the per-engine extras are disjoint, and the refusal names the takers", () => {
    const ok = avatar({
      model: "heygen/avatar_v",
      image: STILL,
      audio: VOICE,
      reference_look_id: "look_abc",
    });
    // `reference_look_id` lives INSIDE Avatar V's own engine config, so the
    // flat row key is nested back rather than sent at the root.
    expect(JSON.parse(JSON.stringify(ok))).toMatchObject({
      engine: { type: "avatar_v", reference_look_id: "look_abc" },
    });

    const wrong = avatar.safe({
      model: "heygen/avatar_v",
      image: STILL,
      audio: VOICE,
      expressiveness: "high",
    } as never);
    expect(wrong.ok).toBe(false);
    if (wrong.ok) return;
    const issue = wrong.errors.find((error) => error.path.join(".") === "expressiveness");
    expect(issue?.code).toBe("unsupported_param");
    expect(issue?.message).toContain("avatar_iv");
  });

  test("it ends in the SAME validator the hand surface calls", () => {
    const unified = avatar({ model: "heygen/avatar_iv", image: STILL, audio: VOICE });
    const byHand = heygenAvatar({
      type: "image",
      engine: { type: "avatar_iv" },
      image: { type: "url", url: STILL.url },
      audio_url: VOICE.url,
    });
    expect(JSON.parse(JSON.stringify(unified))).toEqual(JSON.parse(JSON.stringify(byHand)));
    expect(unified.request.url).toBe(byHand.request.url);
  });

  test("the catalogued-look arm stays reachable at the wire address", () => {
    // It is not in the pack, and the reason is the replacement-arm law: an
    // avatar row can say `image` is required, forbidden or unknown, never
    // optional — and `avatar_iv` serves BOTH arms. The one whose inputs a
    // caller actually has is the one the pack compiles.
    const performer = heygenAvatar({
      type: "avatar",
      avatar_id: "abc123",
      audio_url: VOICE.url,
      engine: { type: "avatar_iii" },
    });
    expect(performer.request.url).toBe("https://api.heygen.com/v3/videos");
    expect(JSON.parse(JSON.stringify(performer))).toHaveProperty("avatar_id", "abc123");

    // …and the arms refuse each other's fields, because both are
    // `additionalProperties: false`.
    const crossed = heygenAvatar.safe({
      type: "avatar",
      avatar_id: "abc123",
      image: { type: "url", url: STILL.url },
      audio_url: VOICE.url,
    });
    expect(crossed.ok).toBe(false);
    if (crossed.ok) return;
    expect(crossed.errors.map((issue) => issue.path.join("."))).toContain("image");
  });

  test("no estimate, and two of the three engine rates are bands", () => {
    // The price table is keyed by engine × AVATAR TYPE, and the avatar type is
    // a property of the look rather than of the request. The rows carry the top
    // of each band; nothing multiplies it by a duration nobody knows.
    const result = avatar.safe({ model: "heygen/avatar_iv", image: STILL, audio: VOICE });
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
