import { describe, expect, test } from "bun:test";
import { HIGGSFIELD_IMAGE_SHAPES } from "./gen/image-narrow.gen";
import { HIGGSFIELD_NO_PUBLIC_PRICING, HIGGSFIELD_RATES } from "./gen/pricing.gen";
import { HIGGSFIELD_VIDEO_SHAPES } from "./gen/video-narrow.gen";
import { HIGGSFIELD_CONTRADICTED_PRICING_CAVEAT, HIGGSFIELD_PRICING_CAVEAT, higgsfieldCostUSD } from "./pricing";
import type { HiggsfieldRate } from "./pricing-types";
import type { HiggsfieldEndpointShape } from "./shape-types";

/**
 * Catalog-coupled on purpose: a figure asserted here is a figure a human read
 * off a Higgsfield page (`data/higgsfield/pricing.json` carries the quote), and
 * a refresh that moves one has to surface as a diff someone reads.
 */

const SEEDANCE = "bytedance/seedance-2.5/text-to-video";
const SEEDANCE_REFERENCE = "bytedance/seedance-2.5/reference-to-video";
const SOUL = "higgsfield-ai/soul/standard";
const GENJUTSU = "higgsfield/genjutsu/motion-transfer/v1.0";

const RATES: Readonly<Record<string, HiggsfieldRate>> = HIGGSFIELD_RATES;
const SHAPES: Readonly<Record<string, HiggsfieldEndpointShape>> = { ...HIGGSFIELD_IMAGE_SHAPES, ...HIGGSFIELD_VIDEO_SHAPES };

describe("higgsfieldCostUSD — what it prices", () => {
  test("a per-second rate keyed by resolution, times the request's duration", () => {
    // "480p: $0.1177; 720p: $0.2647; 1080p: $0.6518. Total price = selected rate × output duration in seconds."
    expect(higgsfieldCostUSD(SEEDANCE, { prompt: "x", resolution: "720p", duration: 5 })).toBe(1.3235);
    expect(higgsfieldCostUSD(SEEDANCE, { prompt: "x", resolution: "1080p", duration: 4 })).toBe(2.6072);
  });

  test("an omitted parameter is priced at the default every source agrees on", () => {
    expect(RATES[SEEDANCE]?.defaults).toEqual({ draft: false, duration: 5, resolution: "720p" });
    expect(higgsfieldCostUSD(SEEDANCE, { prompt: "x" })).toBe(1.3235);
    // An explicit `null` is an omitted field as far as the rate is concerned.
    expect(higgsfieldCostUSD(SOUL, { prompt: "x", resolution: null })).toBe(0.0938);
  });

  test("a clip in a video input selects the with-video table", () => {
    const body = { prompt: "x", resolution: "720p", duration: 5 };
    expect(higgsfieldCostUSD(SEEDANCE_REFERENCE, { ...body, image_urls: ["https://example.com/a.png"] })).toBe(1.3235);
    expect(higgsfieldCostUSD(SEEDANCE_REFERENCE, { ...body, video_urls: ["https://example.com/a.mp4"] })).toBe(1.632);
    expect(higgsfieldCostUSD(SEEDANCE_REFERENCE, { ...body, video_urls: [] })).toBe(1.3235);
  });

  test("a flat per-image rate", () => {
    // "$0.05 per sheet."
    expect(higgsfieldCostUSD("higgsfield/ai-influencer", { prompt: "a fox" })).toBe(0.05);
  });

  test("a sentence the route's own console document contradicts is not a price, whatever it states", () => {
    // Each model page states a rate; each console document says no price is public; the owner has ruled on none of them.
    const bodies = {
      "ideogram/v4.0": { prompt: "a fox" },
      "kling-image/v4.0/text-to-image/series": { prompt: "x", resolution: "4k", series_amount: 3 },
      "minimax/hailuo-2.3/standard/text-to-video": { prompt: "x", duration: 6 },
      "recraft/v4.1/text-to-image": { prompt: "x" },
    };
    for (const [id, body] of Object.entries(bodies)) {
      expect(higgsfieldCostUSD(id, body), id).toBeUndefined();
      expect(RATES[id]?.unpriced, id).toContain(HIGGSFIELD_NO_PUBLIC_PRICING);
    }
  });

  test("Soul: per resolution, and only a batch of one has a price", () => {
    // "Images cost $0.0938 each at 720p and $0.1875 each at 1080p."
    expect(higgsfieldCostUSD(SOUL, { prompt: "x", resolution: "720p" })).toBe(0.0938);
    expect(higgsfieldCostUSD(SOUL, { prompt: "x", resolution: "1080p", batch_size: 1 })).toBe(0.1875);
    // "each" is not tied to the batch anywhere, so four images are not priced as four.
    expect(higgsfieldCostUSD(SOUL, { prompt: "x", resolution: "720p", batch_size: 4 })).toBeUndefined();
    expect(RATES[SOUL]?.contradicted).toBe(true);
  });

  test("a source clip is billed from its declared duration, rounded and capped as the quote says", () => {
    // "480p: $0.1540; 720p: $0.3446; 1080p: $0.8346. Billed duration is the source video duration rounded up to a whole second."
    const body = { video_url: "https://example.com/a.mp4", resolution: "720p" };
    expect(higgsfieldCostUSD(GENJUTSU, body)).toBeUndefined();
    expect(higgsfieldCostUSD(GENJUTSU, body, { sourceSeconds: 12.2 })).toBe(4.4798);
    // "Videos longer than 30 seconds are trimmed to 30 seconds".
    expect(higgsfieldCostUSD(GENJUTSU, body, { sourceSeconds: 95 })).toBe(10.338);
    // "rounded to the nearest whole second" on Kling motion control: $0.1189.
    expect(higgsfieldCostUSD("kling-video/v3/motion-control/pro", {}, { sourceSeconds: 7.4 })).toBe(0.8323);
    expect(higgsfieldCostUSD("kling-video/v3/motion-control/pro", {}, { sourceSeconds: 7.6 })).toBe(0.9512);
  });
});

describe("higgsfieldCostUSD — what it does not", () => {
  test("a duration or count that is not a finite, non-negative number has no price", () => {
    const body = { video_url: "https://example.com/a.mp4", resolution: "720p" };
    for (const sourceSeconds of [Number.NaN, -5, Number.POSITIVE_INFINITY]) {
      expect(higgsfieldCostUSD(GENJUTSU, body, { sourceSeconds })).toBeUndefined();
    }
    expect(higgsfieldCostUSD(SEEDANCE, { prompt: "x", resolution: "720p", duration: -5 })).toBeUndefined();
    expect(higgsfieldCostUSD(SEEDANCE, { prompt: "x", resolution: "720p", duration: Number.NaN })).toBeUndefined();
  });

  test("an unpriced route, an unknown route and an inherited key", () => {
    expect(higgsfieldCostUSD("higgsfield/cinema-studio/4.0", { prompt: "x" })).toBeUndefined();
    expect(higgsfieldCostUSD("higgsfield/genjutsu/restyle/v1.0", { video_url: "https://example.com/a.mp4" })).toBeUndefined();
    expect(higgsfieldCostUSD("maker/brand-new", { prompt: "x" })).toBeUndefined();
    expect(higgsfieldCostUSD("constructor", {})).toBeUndefined();
  });

  test("a value the table has no key for", () => {
    expect(higgsfieldCostUSD(SEEDANCE, { prompt: "x", resolution: "8k", duration: 5 })).toBeUndefined();
    expect(higgsfieldCostUSD(SEEDANCE, { prompt: "x", resolution: "720p", duration: "5" })).toBeUndefined();
  });

  test("a rate keyed by an output resolution the route has no parameter for", () => {
    const id = "kling-video/o3/video-edit";
    expect(RATES[id]?.byUnpublished).toBeString();
    expect(higgsfieldCostUSD(id, { video_urls: ["https://example.com/a.mp4"] }, { sourceSeconds: 8 })).toBeUndefined();
  });

  test("seconds the body does not state: a delivered clip, and the quote's own formula", () => {
    expect(RATES["higgsfield/genjutsu-light/object-swap/v1.0"]?.seconds).toBe("output");
    expect(higgsfieldCostUSD("higgsfield/genjutsu-light/object-swap/v1.0", { resolution: "720p" }, { sourceSeconds: 8 })).toBeUndefined();
    expect(RATES["kling-video/v4.0-flash/video-edit"]?.seconds).toBe("formula");
    expect(higgsfieldCostUSD("kling-video/v4.0-flash/video-edit", { duration: 5 })).toBeUndefined();
  });

  test("a request the quote prices some other way", () => {
    // A draft is "billed per output second at its own resolution".
    expect(higgsfieldCostUSD(SEEDANCE, { prompt: "x", resolution: "720p", duration: 5, draft: true })).toBeUndefined();
    // "For explicit multi-shot requests, output duration is the sum of the shot durations."
    const kling = "kling-video/v3.0/std/text-to-video";
    expect(higgsfieldCostUSD(kling, { prompt: "x", duration: 5 })).toBe(0.357);
    expect(higgsfieldCostUSD(kling, { duration: 5, multi_shots: true })).toBeUndefined();
    // An HDR surcharge, and an element that may be a clip.
    const edit = "kling-video/v4.0/video-edit";
    expect(higgsfieldCostUSD(edit, { resolution: "1080p", duration: 5, dynamic_range: "hdr" })).toBeUndefined();
    expect(higgsfieldCostUSD(edit, { resolution: "1080p", duration: 5, elements: [3] })).toBeUndefined();
  });

  test("a clip attached where the quote has no with-video rate for the request", () => {
    const edit = "kling-video/v4.0/video-edit";
    const body = { duration: 5, video_url: "https://example.com/a.mp4" };
    expect(higgsfieldCostUSD(edit, { ...body, resolution: "1080p" })).toBe(1.168);
    // 4K with a video input is a formula over the input's duration.
    expect(higgsfieldCostUSD(edit, { ...body, resolution: "4k" })).toBeUndefined();
  });
});

describe("the rate table", () => {
  test("every generated route has a row: a rate, or the reason there is none", () => {
    expect(Object.keys(RATES).sort()).toEqual(Object.keys(SHAPES).sort());
    for (const [id, rate] of Object.entries(RATES)) {
      expect(rate.unpriced === undefined, id).toBe(rate.unit !== undefined);
      expect(rate.source, id).toStartWith("https://");
      expect(rate.verified, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test("every key of a `by` table is a value of that field on that route, and every value has a key", () => {
    let tables = 0;
    for (const [id, rate] of Object.entries(RATES)) {
      if (rate.by === undefined || typeof rate.usd !== "object") continue;
      tables += 1;
      const vocabulary = (SHAPES[id]?.props[rate.by]?.enum ?? []).map(String);
      expect(Object.keys(rate.usd).sort(), id).toEqual([...vocabulary].sort());
      for (const key of Object.keys(typeof rate.usdWithVideoInput === "object" ? rate.usdWithVideoInput : {})) {
        expect(vocabulary, id).toContain(key);
      }
    }
    expect(tables).toBeGreaterThan(30);
  });

  test("every parameter a rate reads is one its route declares", () => {
    for (const [id, rate] of Object.entries(RATES)) {
      const read = [rate.by, rate.count, rate.multipliedBy, rate.sourceParam, ...(rate.videoInputs ?? []), ...(rate.undefinedWhen ?? []).map((arm) => arm.param), ...Object.keys(rate.defaults ?? {})];
      for (const name of read) {
        if (name !== undefined) expect(SHAPES[id]?.props[name], `${id}: ${name}`).toBeDefined();
      }
    }
  });

  test("a default is a value the route's own vocabulary admits", () => {
    for (const [id, rate] of Object.entries(RATES)) {
      for (const [name, value] of Object.entries(rate.defaults ?? {})) {
        const vocabulary = SHAPES[id]?.props[name]?.enum;
        if (vocabulary !== undefined) expect(vocabulary as readonly unknown[], `${id}: ${name}`).toContain(value);
      }
    }
  });

  test("the contradicted rates are the four the owner decided to keep and no other, and the caveats say what they are", () => {
    const contradicted = Object.keys(RATES).filter((id) => RATES[id]?.contradicted === true);
    expect(contradicted.sort()).toEqual(["higgsfield-ai/soul/standard", "higgsfield-ai/soul/v2/image-to-image", "higgsfield-ai/soul/v2/standard", "higgsfield/ai-influencer"]);
    expect(HIGGSFIELD_NO_PUBLIC_PRICING).toBe("Public pricing information is not available for this model.");
    expect(HIGGSFIELD_CONTRADICTED_PRICING_CAVEAT).toContain(HIGGSFIELD_NO_PUBLIC_PRICING);
    expect(HIGGSFIELD_PRICING_CAVEAT).toContain("POST estimateUrl(endpoint)");
  });
});
