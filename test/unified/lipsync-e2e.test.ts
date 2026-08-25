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
import { lipsync as heygenLipsync } from "../../src/providers/heygen";
import { createLipsync, lipsync } from "../../src/unified/lipsync";
import { lipsync as falAdapter } from "../../src/providers/fal/unified-lipsync";
import { lipsync as heygenAdapter } from "../../src/providers/heygen/unified-lipsync";
import { lipsync as syncAdapter } from "../../src/providers/sync/unified-lipsync";
import { lipsync as veedAdapter } from "../../src/providers/veed/unified-lipsync";

const CLIP = { url: "https://example.com/take-3.mp4" } as const;
const VOICE = { url: "https://example.com/vo-french.wav" } as const;

describe("the pack", () => {
  test("registers exactly the four lipsync providers", () => {
    expect([...lipsync.providers]).toEqual(["fal", "heygen", "sync", "veed"]);
  });

  test("a provider outside the pack is structural, not a validation error", () => {
    expect(() =>
      lipsync({ model: "topaz/Standard V2", source: CLIP, audio: VOICE } as never),
    ).toThrow(TranslationUnavailableError);
    const result = lipsync.safe({
      model: "topaz/Standard V2",
      source: CLIP,
      audio: VOICE,
    } as never);
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

  test("each provider is one adapter, and any of them builds a pack on its own", () => {
    expect(falAdapter.models).toHaveLength(10);
    expect(syncAdapter.models).toHaveLength(5);
    expect(veedAdapter.models).toHaveLength(1);
    expect(heygenAdapter.models).toHaveLength(2);
    expect([...createLipsync([falAdapter]).providers]).toEqual(["fal"]);
    expect([...createLipsync([syncAdapter]).providers]).toEqual(["sync"]);
    expect([...createLipsync([veedAdapter]).providers]).toEqual(["veed"]);
    expect([...createLipsync([heygenAdapter]).providers]).toEqual(["heygen"]);
  });
});

/**
 * The native half, and the shape that made sync. worth adding: `input` is an
 * ARRAY of tagged items rather than two flat URL fields, which is what carries
 * every request mode fal's flattening of the same models cannot express.
 */
describe("the result is sync.'s own Validated", () => {
  test("the clip and the track are ITEMS, and `model` stays on the body", () => {
    const result = lipsync({ model: "sync/lipsync-2", source: CLIP, audio: VOICE });
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      model: "lipsync-2",
      input: [
        { type: "video", url: CLIP.url },
        { type: "audio", url: VOICE.url },
      ],
    });
    expect(result.request.url).toBe("https://api.sync.so/v2/generate");
    expect(result.request.method).toBe("POST");
    expect(result.request.headers).toEqual({ "content-type": "application/json" });
  });

  test("the six `options` dials nest, and the row is the gate", () => {
    const ok = lipsync({
      model: "sync/lipsync-2",
      source: CLIP,
      audio: VOICE,
      sync_mode: "remap",
      temperature: 0.9,
    });
    expect(JSON.parse(JSON.stringify(ok))).toMatchObject({
      options: { sync_mode: "remap", temperature: 0.9 },
    });

    // `temperature` is a lipsync-2-family dial, and sync-3 does expressiveness
    // natively — so the row refuses it rather than sending a no-op.
    const refused = lipsync.safe({
      model: "sync/sync-3",
      source: CLIP,
      audio: VOICE,
      temperature: 0.9,
    } as never);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.errors.map((issue) => issue.path.join("."))).toContain("temperature");
  });

  test("`seed` is refused by name — sync. publishes none anywhere", () => {
    const result = lipsync.safe({
      model: "sync/lipsync-2",
      source: CLIP,
      audio: VOICE,
      seed: 7,
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((error) => error.path.join(".") === "seed");
    expect(issue?.code).toBe("unsupported_param");
  });

  test("the arity rule the wire states is enforced before the wire does", () => {
    // `dubParams` takes the voice out of the clip's own track, so an audio
    // input alongside it is a contradiction — `generation_input_dub_audio_conflict`
    // is its own error code at sync., which is how often it happens.
    const result = lipsync.safe({
      model: "sync/lipsync-2",
      source: CLIP,
      audio: VOICE,
      dubParams: { providerName: "elevenlabs", targetLang: "fr" },
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((issue) => issue.path.join("."))).toContain("dubParams");
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
      providerOptions: { topaz: { model: "Standard V2" } },
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((issue) => issue.code === "unknown_param")).toBe(true);
    expect(JSON.parse(JSON.stringify(result.params))).not.toHaveProperty("model");
  });

  test("…and a block for the OTHER provider in the pack is ignored, not merged", () => {
    // The sharper half of the same rule now that there are two: `sync` IS a
    // provider in this pack, and a `sync` block on a `fal` ref still must not
    // reach fal's wire.
    const result = lipsync.safe({
      model: "fal/fal-ai/sync-lipsync/v3",
      source: CLIP,
      audio: VOICE,
      providerOptions: { sync: { outputFileName: "take-3" } },
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(JSON.stringify(result.params))).not.toHaveProperty("outputFileName");
  });
});

/**
 * The two natives added with this wave, and the two ends of the range they
 * bracket: the smallest request surface in the library, and the only ref in the
 * category that names a PRICE rather than a model.
 */
describe("the result is VEED's own Validated, and there is nothing else in it", () => {
  test("two fields, both canonical, and no third thing to say", () => {
    const result = lipsync({ model: "veed/lipsync-2.0", source: CLIP, audio: VOICE });
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      video_url: CLIP.url,
      audio_url: VOICE.url,
    });
    expect(result.request.url).toBe("https://api.veed.io/v1/lipsync-2.0");
    expect(result.request.method).toBe("POST");
    expect(result.warnings).toEqual([]);
    // The model id never reaches the wire here, because at VEED the model IS
    // the path — a fourth shape of route selector in one category.
    expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty("model");
  });

  test("inline bytes are refused by name, and the message names the fal route", () => {
    const result = lipsync.safe({
      model: "veed/lipsync-2.0",
      source: { data: "AAECAwQF", mimeType: "video/mp4" },
      audio: VOICE,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((error) => error.path.join(".") === "source");
    expect(issue?.code).toBe("unsupported_param");
    expect(issue?.message).toContain("publishes no upload endpoint");
    expect(issue?.message).toContain("fal/veed/lipsync/v2");
  });

  test("`seed` is refused rather than dropped, and there is nothing else to refuse", () => {
    const seeded = lipsync.safe({ model: "veed/lipsync-2.0", source: CLIP, audio: VOICE, seed: 7 });
    expect(seeded.ok).toBe(false);
    if (seeded.ok) return;
    expect(seeded.errors.map((issue) => issue.path.join("."))).toContain("seed");
    // …and the row genuinely has no extras, which is what makes `seed` the only
    // canonical word this provider has to answer for.
    expect(
      Object.keys(
        (veedAdapter.modelParams["lipsync-2.0"] as { extras: Record<string, unknown> }).extras,
      ),
    ).toEqual([]);
  });

  test("no estimate, even though VEED publishes an exact per-second rate", () => {
    // $0.07/sec, `rounding: "exact"`, in the spec's own `x-veed-pricing`. What
    // is missing is the DURATION, which is the input clip's, behind a URL.
    const result = lipsync.safe({ model: "veed/lipsync-2.0", source: CLIP, audio: VOICE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate?.costUSD).toBeUndefined();
  });
});

describe("the result is HeyGen's own Validated, and the ref names a price", () => {
  test("the ref becomes `mode`, and the media fields become tagged objects", () => {
    const result = lipsync({ model: "heygen/lipsync-precision", source: CLIP, audio: VOICE });
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      video: { type: "url", url: CLIP.url },
      audio: { type: "url", url: VOICE.url },
      mode: "precision",
    });
    expect(result.request.url).toBe("https://api.heygen.com/v3/lipsyncs");
    expect(result.warnings).toEqual([]);
  });

  test("the default mode is written out rather than left to the server", () => {
    // `mode` defaults to `"speed"` at HeyGen. A ref that names a price should
    // not depend on a server-side default to get it, so the adapter writes it.
    const result = lipsync({ model: "heygen/lipsync-speed", source: CLIP, audio: VOICE });
    expect(JSON.parse(JSON.stringify(result))).toHaveProperty("mode", "speed");
  });

  test("the two ids are one wire field, and they differ only in price", () => {
    const speed = JSON.parse(
      JSON.stringify(lipsync({ model: "heygen/lipsync-speed", source: CLIP, audio: VOICE })),
    ) as Record<string, unknown>;
    const precision = JSON.parse(
      JSON.stringify(lipsync({ model: "heygen/lipsync-precision", source: CLIP, audio: VOICE })),
    ) as Record<string, unknown>;
    expect(Object.keys(speed).sort()).toEqual(Object.keys(precision).sort());
    expect({ ...speed, mode: undefined }).toEqual({ ...precision, mode: undefined });
  });

  test("it ends in the SAME validator the hand surface calls", () => {
    const unified = lipsync({ model: "heygen/lipsync-speed", source: CLIP, audio: VOICE });
    const byHand = heygenLipsync({
      video: { type: "url", url: CLIP.url },
      audio: { type: "url", url: VOICE.url },
      mode: "speed",
    });
    expect(JSON.parse(JSON.stringify(unified))).toEqual(JSON.parse(JSON.stringify(byHand)));
    expect(unified.request.url).toBe(byHand.request.url);
  });

  test("the duration-mismatch extra is a BOOLEAN here, and it arrives typed", () => {
    const result = lipsync({
      model: "heygen/lipsync-speed",
      source: CLIP,
      audio: VOICE,
      enable_dynamic_duration: false,
      start_time: 2,
      end_time: 8,
    });
    const body = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    expect(body["enable_dynamic_duration"]).toBe(false);
    expect(body["start_time"]).toBe(2);
    expect(body["end_time"]).toBe(8);
  });

  test("a backwards partial-lipsync window is refused by HeyGen's own validator", () => {
    const result = lipsync.safe({
      model: "heygen/lipsync-speed",
      source: CLIP,
      audio: VOICE,
      start_time: 9,
      end_time: 3,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((issue) => issue.path.join("."))).toContain("start_time");
  });

  test("inline bytes are refused, and the sibling category accepts them", () => {
    const result = lipsync.safe({
      model: "heygen/lipsync-speed",
      source: { data: "AAECAwQF", mimeType: "video/mp4" },
      audio: VOICE,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((error) => error.path.join(".") === "source");
    expect(issue?.code).toBe("unsupported_param");
    expect(issue?.message).toContain("no inline arm");
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
