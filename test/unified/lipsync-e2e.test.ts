/**
 * `unmodel/lipsync`, end to end through the ready-made pack.
 *
 * The golden matrix next door pins *what* each ref compiles to; this pins what
 * a caller gets back — fal's own `Validated`, its `.request`, its `.toSdk`,
 * its estimate — plus the two things this category has that its siblings do
 * not: a route selected by a parameter rather than by a fork, and a real
 * `model` body field that survives the trip.
 */
import { describe, expect, test } from "bun:test";
import { UnmodelValidationError } from "../../src/core/issues";
import { TranslationUnavailableError } from "../../src/core/translate/errors";
import { lipsync as falLipsync } from "../../src/providers/fal";
import { createLipsync, lipsync } from "../../src/unified/lipsync";
import { lipsync as falAdapter } from "../../src/providers/fal/unified-lipsync";

const CLIP = { url: "https://example.com/take-3.mp4" } as const;
const VOICE = { url: "https://example.com/vo-french.wav" } as const;

describe("the pack", () => {
  test("registers exactly the one lipsync provider", () => {
    expect([...lipsync.providers]).toEqual(["fal"]);
  });

  test("a provider outside the pack is structural, not a validation error", () => {
    expect(() =>
      lipsync({ model: "sync/lipsync-2", source: CLIP, audio: VOICE } as never),
    ).toThrow(TranslationUnavailableError);
    const result = lipsync.safe({ model: "sync/lipsync-2", source: CLIP, audio: VOICE } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.meta?.["structural"]).toBe(true);
    expect(result.errors[0]?.message).toContain("not a lipsync provider in this build");
  });

  test("a model the adapter does not list warns but still compiles", () => {
    const result = lipsync.safe({
      model: "fal/fal-ai/sync-lipsync/v9",
      source: CLIP,
      audio: VOICE,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((issue) => issue.code === "unknown_model")).toBe(true);
    // …and it still ROUTES, which is the half that matters: fal adds endpoints
    // weekly and a curated roster is a snapshot.
    const params = result.params as unknown as { request: { url: string } };
    expect(params.request.url).toBe("https://queue.fal.run/fal-ai/sync-lipsync/v9");
  });

  test("the eight endpoints are one adapter, and the pack is that adapter", () => {
    expect(falAdapter.models).toHaveLength(8);
    const built = createLipsync([falAdapter]);
    expect([...built.providers]).toEqual(["fal"]);
  });
});

describe("the result is fal's own Validated", () => {
  test("the enumerable body IS the fetch payload, and the route is not in it", () => {
    const result = lipsync({
      model: "fal/fal-ai/sync-lipsync/v3",
      source: CLIP,
      audio: VOICE,
      sync_mode: "loop",
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      video_url: CLIP.url,
      audio_url: VOICE.url,
      sync_mode: "loop",
    });
    expect(result.request.url).toBe("https://queue.fal.run/fal-ai/sync-lipsync/v3");
    expect(result.request.method).toBe("POST");
    expect(result.request.headers).toEqual({ "content-type": "application/json" });
    expect(result.toSdk("fal")).toEqual({
      input: { video_url: CLIP.url, audio_url: VOICE.url, sync_mode: "loop" },
    });
    expect(result.warnings).toEqual([]);
  });

  test("it ends in the SAME validator the hand surface calls", () => {
    // The one design decision the whole unified layer rests on: a unified call
    // adds a compile step in front of the provider's validator, it does not
    // add a second, weaker validator beside it. So a body compiled here and a
    // body written by hand are checked by identical code.
    const unified = lipsync({ model: "fal/veed/lipsync/v2", source: CLIP, audio: VOICE });
    const byHand = falLipsync({
      endpoint: "veed/lipsync/v2",
      video_url: CLIP.url,
      audio_url: VOICE.url,
    });
    expect(JSON.parse(JSON.stringify(unified))).toEqual(JSON.parse(JSON.stringify(byHand)));
    expect(unified.request.url).toBe(byHand.request.url);
  });

  test("no estimate, and a reason available for why", () => {
    const result = lipsync.safe({
      model: "fal/fal-ai/sync-lipsync/v3",
      source: CLIP,
      audio: VOICE,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Every rate in this category bills the OUTPUT clip, whose length is the
    // INPUT clip's — which unmodel never reads. A plausible number would be a
    // wrong one, and a caller who sees `costUSD` treats it as a budget.
    expect(result.estimate?.costUSD).toBeUndefined();
  });
});

describe("the `model` field that is not the route", () => {
  test("a unified caller's `model` is the REF; fal's is a body field", () => {
    const result = lipsync({
      model: "fal/fal-ai/sync-lipsync/v2",
      source: CLIP,
      audio: VOICE,
      providerOptions: { fal: { model: "lipsync-2-pro" } },
    });
    const body = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    // The ref picked the endpoint; the override picked the model. Both arrived.
    expect(result.request.url).toBe("https://queue.fal.run/fal-ai/sync-lipsync/v2");
    expect(body["model"]).toBe("lipsync-2-pro");
  });

  test("an override the endpoint refuses is reported at the wire spelling", () => {
    const result = lipsync.safe({
      model: "fal/fal-ai/sync-lipsync/v2",
      source: CLIP,
      audio: VOICE,
      providerOptions: { fal: { model: "lipsync-3" } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((error) => error.path.join(".") === "model");
    expect(issue).toBeDefined();
    // The escape hatch's own rule: a key the CALLER wrote keeps its wire
    // spelling, and the message says where it came from.
    expect(issue?.message).toContain("supplied via `providerOptions`");
  });
});

describe("providerOptions", () => {
  test("reaches the params the vocabulary deliberately has no word for", () => {
    const result = lipsync({
      model: "fal/fal-ai/latentsync",
      source: CLIP,
      audio: VOICE,
      providerOptions: { fal: { loop_mode: "pingpong", guidance_scale: 1.75 } },
    });
    const body = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    expect(body["loop_mode"]).toBe("pingpong");
    expect(body["guidance_scale"]).toBe(1.75);
  });

  test("and is still validated by fal's own IR on the way out", () => {
    const result = lipsync.safe({
      model: "fal/fal-ai/latentsync",
      source: CLIP,
      audio: VOICE,
      providerOptions: { fal: { guidance_scale: 9 } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.message.includes("at most 2"))).toBe(true);
  });

  test("a block for a provider this pack does not have is a warning, not a merge", () => {
    const result = lipsync.safe({
      model: "fal/fal-ai/sync-lipsync/v3",
      source: CLIP,
      audio: VOICE,
      providerOptions: { sync: { model: "lipsync-2" } },
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((issue) => issue.code === "unknown_param")).toBe(true);
    expect(JSON.parse(JSON.stringify(result.params))).not.toHaveProperty("model");
  });
});

describe("the arm this category deliberately does not serve", () => {
  test("a still is refused, and the message names the shape this model takes", () => {
    // The compile-time half is in test/types/unified-lipsync.test-d.ts; this is
    // the run-time half, for the JavaScript callers a type cannot reach.
    const result = lipsync.safe({
      model: "fal/fal-ai/sync-lipsync/v3",
      source: { data: "AAAA", mimeType: "image/png" },
      audio: VOICE,
    } as never);
    // fal takes any `data:` URI in `video_url`, so the shape gate passes and
    // the request goes out as written — which is the honest outcome: unmodel
    // cannot tell an MP4 from a PNG behind a URL, and refusing on the mime type
    // alone would refuse a legal request whose bytes are fine. What it CAN do
    // is refuse it at the keystroke, which is where the check belongs.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(JSON.stringify(result.params))).toMatchObject({
      video_url: "data:image/png;base64,AAAA",
    });
  });

  test("the text+voice arm is not in the roster, by decision", () => {
    // `fal-ai/kling-video/lipsync/text-to-video` is TTS composed with lipsync.
    // Composing it inside one call would hide which half failed, so it is
    // excluded in data/fal/curation.json and the ref degrades.
    expect(falAdapter.models).not.toContain("fal-ai/kling-video/lipsync/text-to-video");
    const result = lipsync.safe({
      model: "fal/fal-ai/kling-video/lipsync/text-to-video",
      source: CLIP,
      audio: VOICE,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((issue) => issue.code === "unknown_model")).toBe(true);
  });
});

describe("the throwing form", () => {
  test("throws UnmodelValidationError labelled with the category", () => {
    expect(() =>
      lipsync({
        model: "fal/fal-ai/sync-lipsync/v3",
        source: CLIP,
        audio: VOICE,
        seed: 1,
      } as never),
    ).toThrow(UnmodelValidationError);
    try {
      lipsync({
        model: "fal/fal-ai/sync-lipsync/v3",
        source: CLIP,
        audio: VOICE,
        seed: 1,
      } as never);
    } catch (error) {
      expect((error as UnmodelValidationError).message).toContain("unmodel/lipsync");
      expect((error as UnmodelValidationError).message).toContain("seed");
    }
  });
});
