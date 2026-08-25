/**
 * `fal.lipsync` — the wire contract, and the `model` collision it exists to
 * prove is survivable.
 *
 * The category is small enough that most of its wire contract is `fal.image`'s
 * (routing, stripping, degradation), asserted there and not repeated. What is
 * asserted HERE is the one thing this provider's whole routing decision was
 * made for: `fal-ai/sync-lipsync/v2` publishes a real `model` body field, it
 * stays on the wire, and the route is still selected by `endpoint`. If the
 * selector were called `model`, one of those two would silently eat the other
 * and the request that went out would name a model nobody chose.
 */

import { describe, expect, test } from "bun:test";
import { lipsync } from "./lipsync";
import { FAL_LIPSYNC_ENDPOINTS } from "./gen/endpoints.gen";

const CLIP = "https://example.com/take-3.mp4";
const VOICE = "https://example.com/vo.wav";

describe("routing", () => {
  test("every curated endpoint routes to a queue URL that round-trips its id", () => {
    for (const endpoint of FAL_LIPSYNC_ENDPOINTS) {
      const params = lipsync({ endpoint, video_url: CLIP, audio_url: VOICE } as never);
      expect(params.request.url).toBe(`https://queue.fal.run/${endpoint}`);
      expect(params.request.method).toBe("POST");
    }
  });

  test("the vendor-namespaced VEED ids route to the PUBLISHED id", () => {
    // fal documents these at `/VEED/lipsync` and `/VEED/lipsync-v2` — a
    // different internal route, differently cased. The id unmodel submits to is
    // the one fal publishes and catalogues.
    expect(lipsync({ endpoint: "veed/lipsync", video_url: CLIP, audio_url: VOICE }).request.url).toBe(
      "https://queue.fal.run/veed/lipsync",
    );
    expect(
      lipsync({ endpoint: "veed/lipsync/v2", video_url: CLIP, audio_url: VOICE }).request.url,
    ).toBe("https://queue.fal.run/veed/lipsync/v2");
  });
});

describe("the `model` field that is not the route", () => {
  test("`model` stays on the wire while `endpoint` routes", () => {
    const params = lipsync({
      endpoint: "fal-ai/sync-lipsync/v2",
      model: "lipsync-2-pro",
      video_url: CLIP,
      audio_url: VOICE,
    });
    // The route came off; the model did not.
    expect(Object.keys(params).sort()).toEqual(["audio_url", "model", "video_url"]);
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      model: "lipsync-2-pro",
      video_url: CLIP,
      audio_url: VOICE,
    });
    expect(params.request.url).toBe("https://queue.fal.run/fal-ai/sync-lipsync/v2");
  });

  test("its vocabulary is enforced, and layer 1 gets there first", () => {
    const bad = lipsync.safe({
      endpoint: "fal-ai/sync-lipsync/v2",
      model: "lipsync-3",
      video_url: CLIP,
      audio_url: VOICE,
    } as never);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const issue = bad.errors.find((error) => error.path?.[0] === "model");
    // The category SCHEMA owns this one, not the IR — and that is the merge
    // rule working rather than a gap. `model` appears on exactly one lipsync
    // endpoint, so the union has nothing to disagree with and emits the exact
    // enum; the IR's per-endpoint check would say the same thing one layer
    // later. Where the IR is load-bearing is the opposite case: a parameter two
    // endpoints spell differently, which the union has to widen.
    expect(issue?.code).toBe("invalid_shape");
    expect(issue?.message).toContain("lipsync-2");
  });

  test("a sibling endpoint has no `model` field, and says so by name", () => {
    // v2/pro is the same model as `model: "lipsync-2-pro"` — as its own
    // endpoint id, which is why it declares no `model` field at all. Sending
    // one is a warning naming the sibling that does take it, not an error: fal
    // ships parameters between refreshes.
    const result = lipsync.safe({
      endpoint: "fal-ai/sync-lipsync/v2/pro",
      model: "lipsync-2-pro",
      video_url: CLIP,
      audio_url: VOICE,
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warning = result.warnings.find((issue) => issue.code === "unknown_param");
    expect(warning?.message).toContain("fal-ai/sync-lipsync/v2/pro");
    expect(warning?.message).toContain("`fal-ai/sync-lipsync/v2`");
  });
});

describe("per-endpoint narrowing, from the generated IR", () => {
  test("`sync_mode` is a five-arm enum here and a boolean at fal.image", () => {
    const bad = lipsync.safe({
      endpoint: "fal-ai/sync-lipsync/v3",
      video_url: CLIP,
      audio_url: VOICE,
      sync_mode: true,
    } as never);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const issue = bad.errors.find((error) => error.path?.[0] === "sync_mode");
    // Every lipsync endpoint spells `sync_mode` the same way, so the union
    // schema carries the exact enum and refuses a boolean at layer 1. At
    // `fal.image` the very same NAME is a boolean — which is why no "common fal
    // params" fragment is ever hoisted across categories.
    expect(issue?.code).toBe("invalid_shape");
    expect(issue?.message).toContain("bounce");

    const ok = lipsync.safe({
      endpoint: "fal-ai/sync-lipsync/v3",
      video_url: CLIP,
      audio_url: VOICE,
      sync_mode: "bounce",
    });
    expect(ok.ok).toBe(true);
  });

  test("`loop_mode` is LatentSync's word and nobody else's", () => {
    const ok = lipsync.safe({
      endpoint: "fal-ai/latentsync",
      video_url: CLIP,
      audio_url: VOICE,
      loop_mode: "pingpong",
    });
    expect(ok.ok).toBe(true);

    const bad = lipsync.safe({
      endpoint: "fal-ai/latentsync",
      video_url: CLIP,
      audio_url: VOICE,
      loop_mode: "reverse",
    } as never);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.some((error) => error.message.includes("pingpong"))).toBe(true);
  });

  test("both media inputs are required, and both are references", () => {
    const missing = lipsync.safe({ endpoint: "fal-ai/sync-lipsync/v3" } as never);
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.errors.map((error) => error.path?.[0]).sort()).toEqual(["audio_url", "video_url"]);

    const local = lipsync.safe({
      endpoint: "fal-ai/sync-lipsync/v3",
      video_url: "/Users/me/take-3.mp4",
      audio_url: VOICE,
    });
    expect(local.ok).toBe(false);
    if (local.ok) return;
    const issue = local.errors.find((error) => error.path?.[0] === "video_url");
    expect(issue?.message).toContain("looks like a local path");
    expect(issue?.meta?.["media"]).toBe("video");
  });

  test("pixverse's audio is OPTIONAL — it can speak the text itself", () => {
    // The one endpoint in the category whose `audio_url` is nullable. unmodel's
    // canonical `audio` is required, so the text arm is reachable only at this
    // surface — which is the deliberate line the excluded kling
    // `/lipsync/text-to-video` row draws.
    const spoken = lipsync.safe({
      endpoint: "fal-ai/pixverse/lipsync",
      video_url: CLIP,
      text: "and then the door opened",
      voice_id: "Emily",
    });
    expect(spoken.ok).toBe(true);
  });
});

describe("degradation", () => {
  test("an endpoint the roster has never seen still compiles and routes", () => {
    const result = lipsync.safe({
      endpoint: "fal-ai/sync-lipsync/v4",
      video_url: CLIP,
      audio_url: VOICE,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params.request.url).toBe("https://queue.fal.run/fal-ai/sync-lipsync/v4");
    expect(result.warnings.some((issue) => issue.code === "unknown_model")).toBe(true);
  });
});

describe("estimates", () => {
  test("a per-minute rate is not a per-request number, so there is none", () => {
    // Every rate in this category bills the OUTPUT clip, whose length is the
    // input clip's — which unmodel never sees. `falPriceNote` says so.
    const params = lipsync({ endpoint: "fal-ai/sync-lipsync/v3", video_url: CLIP, audio_url: VOICE });
    const result = lipsync.safe({
      endpoint: "fal-ai/sync-lipsync/v3",
      video_url: CLIP,
      audio_url: VOICE,
    });
    expect(params.request.url).toContain("sync-lipsync/v3");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate?.costUSD).toBeUndefined();
  });
});

describe("toSdk", () => {
  test('`.toSdk("fal")` nests the body under `input`, as fal\'s client documents', () => {
    const params = lipsync({ endpoint: "fal-ai/sync-lipsync/v3", video_url: CLIP, audio_url: VOICE });
    expect(params.toSdk("fal")).toEqual({ input: { video_url: CLIP, audio_url: VOICE } });
  });
});
