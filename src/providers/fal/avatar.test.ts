/**
 * `fal.avatar` — the wire contract, and the two endpoints that take no picture.
 *
 * Routing and stripping are `fal.image`'s contract, asserted there. What is
 * asserted here is the thing that made this a category rather than an arm of
 * `fal.lipsync`:
 *
 * 1. **The still is required at six of the eight** and absent from the schema
 *    at the other two, whose performer is a catalogued id out of a closed enum.
 * 2. **`fal-ai/echomimic-v3` requires a `prompt`** where three siblings have no
 *    prompt field at all — which is why `prompt` is a per-model extra in this
 *    category rather than a canonical word.
 * 3. **Five of the eight publish a flat rate**, the best-priced category in
 *    this provider, and every one of them still bills a duration the request
 *    does not carry.
 */

import { describe, expect, test } from "bun:test";
import { avatar } from "./avatar";
import { FAL_AVATAR_ENDPOINTS } from "./gen/endpoints.gen";
import { FAL_AVATAR_SHAPES } from "./gen/avatar-narrow.gen";
import { falPriceNote } from "./pricing";

const STILL = "https://example.com/headshot.png";
const VOICE = "https://example.com/vo.wav";

describe("routing", () => {
  test("every curated endpoint routes to a queue URL that round-trips its id", () => {
    for (const endpoint of FAL_AVATAR_ENDPOINTS) {
      const shape = FAL_AVATAR_SHAPES[endpoint as keyof typeof FAL_AVATAR_SHAPES] as {
        order: readonly string[];
        props: Readonly<Record<string, { req?: true; def?: true; media?: string; enum?: readonly (string | number)[] }>>;
      };
      const body: Record<string, unknown> = { endpoint };
      for (const name of shape.order) {
        const spec = shape.props[name];
        if (spec?.req !== true || spec.def === true) continue;
        // A required ENUM (`avatar_id`, `avatar`) takes its own first value —
        // which is also how this loop proves the two preset-performer routes
        // are callable without a picture.
        body[name] =
          spec.enum !== undefined
            ? spec.enum[0]
            : spec.media === undefined
              ? "a woman speaking to camera"
              : `https://example.com/asset-${name}`;
      }
      const params = avatar(body as never);
      expect(params.request.url, endpoint).toBe(`https://queue.fal.run/${endpoint}`);
      expect(params.request.method).toBe("POST");
    }
  });

  test("the vendor-namespaced VEED and Argil ids route to the PUBLISHED id", () => {
    // fal documents these at `/VEED/avatars/…` and `/Argil/avatars/…` — a
    // different internal casing. The published id is what unmodel submits to.
    expect(
      avatar({ endpoint: "veed/avatars/audio-to-video", audio_url: VOICE, avatar_id: "emily_primary" })
        .request.url,
    ).toBe("https://queue.fal.run/veed/avatars/audio-to-video");
    expect(
      avatar({ endpoint: "argil/avatars/audio-to-video", audio_url: VOICE, avatar: "Emma (UGC)" }).request
        .url,
    ).toBe("https://queue.fal.run/argil/avatars/audio-to-video");
  });
});

describe("the two endpoints with no image field", () => {
  test("VEED animates a catalogued presenter, and refuses one it has never trained", () => {
    const ok = avatar.safe({
      endpoint: "veed/avatars/audio-to-video",
      audio_url: VOICE,
      avatar_id: "marcus_side",
    });
    expect(ok.ok).toBe(true);

    const bad = avatar.safe({
      endpoint: "veed/avatars/audio-to-video",
      audio_url: VOICE,
      avatar_id: "gary",
    } as never);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.some((error) => error.message.includes("emily_primary"))).toBe(true);
  });

  test("a still sent to one of them is a sibling-parameter warning, not a silent pass", () => {
    const result = avatar.safe({
      endpoint: "argil/avatars/audio-to-video",
      audio_url: VOICE,
      avatar: "Emma (UGC)",
      image_url: STILL,
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warning = result.warnings.find((issue) => issue.code === "unknown_param");
    expect(warning?.message).toContain("argil/avatars/audio-to-video");
    expect(warning?.message).toContain('"image_url" is not a parameter');
  });

  test("the six still-driven endpoints require their picture, and say which one", () => {
    for (const endpoint of FAL_AVATAR_ENDPOINTS) {
      const shape = FAL_AVATAR_SHAPES[endpoint as keyof typeof FAL_AVATAR_SHAPES] as {
        props: Readonly<Record<string, { req?: true }>>;
      };
      if (shape.props["image_url"]?.req !== true) continue;
      const missing = avatar.safe({
        endpoint,
        audio_url: VOICE,
        prompt: "a woman speaking to camera",
      } as never);
      expect(missing.ok, endpoint).toBe(false);
      if (missing.ok) continue;
      const issue = missing.errors.find((error) => error.path?.[0] === "image_url");
      expect(issue?.message, endpoint).toContain(endpoint);
    }
  });
});

describe("`prompt` is a per-model fact in this category", () => {
  test("echomimic REQUIRES one; sync.'s image route has no field for it at all", () => {
    const missing = avatar.safe({
      endpoint: "fal-ai/echomimic-v3",
      image_url: STILL,
      audio_url: VOICE,
    } as never);
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.errors.map((error) => error.path?.[0])).toEqual(["prompt"]);

    const surplus = avatar.safe({
      endpoint: "fal-ai/sync-lipsync/v3/image-to-video",
      image_url: STILL,
      audio_url: VOICE,
      prompt: "she turns to the window",
    } as never);
    expect(surplus.ok).toBe(true);
    if (!surplus.ok) return;
    expect(surplus.warnings.some((issue) => issue.code === "unknown_param")).toBe(true);
  });

  test("kling's prompt defaults to \".\" — declared, defaulted, and never required", () => {
    const ok = avatar.safe({
      endpoint: "fal-ai/kling-video/ai-avatar/v2/standard",
      image_url: STILL,
      audio_url: VOICE,
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    // fal marks it required AND defaults it; `checkRequired` subtracts the
    // defaulted ones, which is what stops this from being a false refusal.
    expect(Object.keys(ok.params).sort()).toEqual(["audio_url", "image_url"]);
  });
});

describe("per-endpoint narrowing, from the generated IR", () => {
  test("OmniHuman's resolution enum is two values, and names them", () => {
    const bad = avatar.safe({
      endpoint: "fal-ai/bytedance/omnihuman/v1.5",
      image_url: STILL,
      audio_url: VOICE,
      resolution: "4k",
    } as never);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.some((error) => error.message.includes("1080p"))).toBe(true);
  });

  test("LongCat's step count respects its own bounds", () => {
    const bad = avatar.safe({
      endpoint: "fal-ai/longcat-single-avatar/image-audio-to-video",
      image_url: STILL,
      audio_url: VOICE,
      num_inference_steps: 200,
    } as never);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const issue = bad.errors.find((error) => error.path?.[0] === "num_inference_steps");
    expect(issue?.message).toContain("at most 100");
    expect(issue?.message).toContain("fal-ai/longcat-single-avatar/image-audio-to-video");
  });

  test("the media inputs are references, never bytes", () => {
    const bad = avatar.safe({
      endpoint: "fal-ai/sync-lipsync/v3/image-to-video",
      image_url: "./headshot.png",
      audio_url: VOICE,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const issue = bad.errors.find((error) => error.path?.[0] === "image_url");
    expect(issue?.meta?.["media"]).toBe("image");
    expect(issue?.message).toContain("looks like a local path");
  });
});

describe("degradation", () => {
  test("an endpoint the roster has never seen still compiles and routes", () => {
    const result = avatar.safe({
      endpoint: "fal-ai/bytedance/omnihuman/v2",
      image_url: STILL,
      audio_url: VOICE,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params.request.url).toBe("https://queue.fal.run/fal-ai/bytedance/omnihuman/v2");
    expect(result.warnings.some((issue) => issue.code === "unknown_model")).toBe(true);
  });
});

describe("estimates", () => {
  test("a flat per-second rate still cannot be settled by a request body", () => {
    // The clip's length follows the input audio's, which unmodel never reads.
    // The RATE reaches a caller through the catalog row instead.
    const result = avatar.safe({
      endpoint: "fal-ai/kling-video/ai-avatar/v2/pro",
      image_url: STILL,
      audio_url: VOICE,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate?.costUSD).toBeUndefined();
  });

  test("the one conditional rate names the field that would settle it", () => {
    expect(falPriceNote("fal-ai/longcat-single-avatar/image-audio-to-video")).toContain("resolution");
  });
});

describe("toSdk", () => {
  test('`.toSdk("fal")` nests the body under `input`, as fal\'s client documents', () => {
    const params = avatar({
      endpoint: "fal-ai/sync-lipsync/v3/image-to-video",
      image_url: STILL,
      audio_url: VOICE,
    });
    expect(params.toSdk("fal")).toEqual({ input: { image_url: STILL, audio_url: VOICE } });
  });
});
