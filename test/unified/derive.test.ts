/**
 * The shared derivations, exhaustively — and with **zero providers**.
 *
 * This is where the design risk of the unified media surfaces lives. A rename
 * cannot be subtly wrong; "16:9 at 1k on a 32-px grid" can, and it is wrong in
 * the same way at forty providers if it is wrong once. So every shape class
 * gets its edge cases here, in a file that imports nothing but `derive.ts`.
 *
 * The three rules under test throughout:
 *
 *  1. cannot be expressed → an **error**, naming what is accepted;
 *  2. expressed approximately → an `approximated_param` **warning**, naming
 *     both the requested and the achieved value;
 *  3. never a third thing. In particular: never a silent snap, and never a
 *     silent downgrade.
 */
import { describe, expect, test } from "bun:test";
import type { TranslationWarning } from "../../src/core/translate/warnings";
import {
  base64Payload,
  bitsToKbps,
  DEFAULT_CONTAINER,
  formatRatio,
  invertSpeed,
  murfSpeed,
  normalizeAudioFormat,
  parseRatio,
  pixelsToRatio,
  RATIO_MATCH_TOLERANCE,
  ratioDistance,
  ratioValue,
  resolveAudioFormat,
  resolveSizing,
  resolveVoice,
  toPrimaryLanguage,
  TIER_PIXELS,
  toDurationNumber,
  toDurationString,
  toDurationSuffixedString,
  toPixels,
  requireInlineBytes,
  requireMediaUrl,
  resolveImageEditInput,
  resolveImageSlots,
  resolveOperation,
  resolveVideoRoute,
  toMediaUri,
  toRatioEnum,
  toRatioString,
  toSizeEnum,
  toSizeFreeform,
  toSpeed,
  toSpeedPercentDelta,
  toStrength,
  toTier,
  videoRoute,
  VIDEO_ROUTE_LABELS,
  type DeriveContext,
} from "../../src/core/unified/derive";

/** A context that records what was warned, so both halves are assertable. */
function ctxAt(...path: Array<string | number>): DeriveContext & {
  warnings: Array<Omit<TranslationWarning, "from" | "to">>;
} {
  const warnings: Array<Omit<TranslationWarning, "from" | "to">> = [];
  return { path, warn: (w) => warnings.push(w), warnings };
}

// ---------------------------------------------------------------------------
// Ratio parsing
// ---------------------------------------------------------------------------

describe("parseRatio", () => {
  test("accepts every separator providers spell ratios with", () => {
    for (const spelling of ["16:9", "16x9", "16X9", "16*9", "16×9", " 16 : 9 "]) {
      expect(parseRatio(spelling), spelling).toEqual({ width: 16, height: 9 });
    }
  });

  test("reduces to lowest terms, which is what makes 32:18 a 16:9", () => {
    expect(parseRatio("32:18")).toEqual({ width: 16, height: 9 });
    expect(parseRatio("1920:1080")).toEqual({ width: 16, height: 9 });
    expect(parseRatio("100:100")).toEqual({ width: 1, height: 1 });
  });

  test("scales decimals away before reducing", () => {
    expect(parseRatio("1.5:1")).toEqual({ width: 3, height: 2 });
    expect(parseRatio("1.777:1")).toEqual({ width: 1777, height: 1000 });
  });

  test("rejects what is not a ratio", () => {
    for (const spelling of ["", "16", "16:", ":9", "0:9", "16:0", "-16:9", "wide", "16:9:1"]) {
      expect(parseRatio(spelling), spelling).toBeUndefined();
    }
  });

  test("formatRatio and ratioValue round-trip", () => {
    const parsed = parseRatio("1920x1080");
    expect(parsed).toBeDefined();
    expect(formatRatio(parsed!)).toBe("16:9");
    expect(formatRatio(parsed!, "x")).toBe("16x9");
    expect(ratioValue(parsed!)).toBeCloseTo(16 / 9, 12);
  });

  test("ratioDistance is symmetric, which is why it is a log", () => {
    expect(ratioDistance(4 / 3, 3 / 4)).toBeCloseTo(ratioDistance(3 / 4, 4 / 3), 12);
    expect(ratioDistance(2, 2)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// S1 — toRatioEnum
// ---------------------------------------------------------------------------

describe("S1 · toRatioEnum", () => {
  const ALLOWED = ["1:1", "16:9", "9:16", "4:3", "3:4"];

  test("returns the provider's spelling, whatever the caller typed", () => {
    for (const spelling of ["16:9", "16x9", "32:18", " 16 × 9 "]) {
      const ctx = ctxAt("aspectRatio");
      expect(toRatioEnum(spelling, ALLOWED, {}, ctx).value, spelling).toBe("16:9");
      // A spelling change is not a loss.
      expect(ctx.warnings).toEqual([]);
    }
  });

  test("matches a provider that spells its own enum with an x", () => {
    const ctx = ctxAt("aspectRatio");
    expect(toRatioEnum("16:9", ["1x1", "16x9"], {}, ctx).value).toBe("16x9");
  });

  test("a ratio not on the list is an error, never the nearest", () => {
    const ctx = ctxAt("aspectRatio");
    const out = toRatioEnum("21:9", ALLOWED, { source: "https://docs.example/img" }, ctx);
    expect(out.value).toBeUndefined();
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0]!.code).toBe("invalid_enum_value");
    expect(out.issues[0]!.path).toEqual(["aspectRatio"]);
    expect(out.issues[0]!.message).toContain('"16:9"');
    expect(out.issues[0]!.meta).toMatchObject({ allowed: ALLOWED, value: "21:9" });
    expect(out.issues[0]!.meta?.["source"]).toBe("https://docs.example/img");
    expect(ctx.warnings).toEqual([]);
  });

  test("an unparseable ratio is a shape problem, not an enum problem", () => {
    const out = toRatioEnum("widescreen", ALLOWED, {}, ctxAt("aspectRatio"));
    expect(out.issues[0]!.code).toBe("invalid_shape");
  });

  test("the message names the last string segment of the path", () => {
    const out = toRatioEnum("21:9", ALLOWED, {}, ctxAt("image", 0, "aspectRatio"));
    expect(out.issues[0]!.message).toStartWith("`aspectRatio`");
    expect(out.issues[0]!.path).toEqual(["image", 0, "aspectRatio"]);
  });
});

// ---------------------------------------------------------------------------
// S2 — toPixels
// ---------------------------------------------------------------------------

describe("S2 · toPixels", () => {
  test("the canonical case: 16:9 at 1k on a 32px grid is 1344×768, and says so", () => {
    const ctx = ctxAt("aspectRatio");
    const out = toPixels("16:9", "1k", { grid: 32 }, ctx);
    expect(out.value).toEqual({ width: 1344, height: 768 });
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]!.code).toBe("approximated_param");
    // Both numbers, or the word "approximately" means nothing.
    expect(ctx.warnings[0]!.message).toBe(
      "`aspectRatio` 16:9 at 1k does not land on this model's 32px grid: " +
        "1344×768 (1.750:1, requested 1.778:1).",
    );
    expect(ctx.warnings[0]!.meta).toMatchObject({ width: 1344, height: 768, grid: 32 });
  });

  test("an exact fit does not warn — which is what makes the warning mean something", () => {
    const ctx = ctxAt("aspectRatio");
    expect(toPixels("1:1", "1k", { grid: 32 }, ctx).value).toEqual({ width: 1024, height: 1024 });
    expect(ctx.warnings).toEqual([]);
  });

  test("3:2 at 2k on a 64px grid lands exactly, so it is silent", () => {
    const ctx = ctxAt("aspectRatio");
    const out = toPixels("3:2", "2k", { grid: 64 }, ctx);
    expect(out.value).toEqual({ width: 2496, height: 1664 });
    expect(2496 / 1664).toBe(1.5);
    expect(ctx.warnings).toEqual([]);
  });

  test("grid 1 means any integer, and 16:9 at 1k is then within tolerance", () => {
    const ctx = ctxAt("aspectRatio");
    const out = toPixels("16:9", "1k", { grid: 1 }, ctx);
    expect(out.value).toEqual({ width: 1365, height: 768 });
    expect(ctx.warnings).toEqual([]);
  });

  test("snapping is downward — a grid is the visible half of a pixel budget", () => {
    // 1365.33 → 1344 (42 × 32), never 1376 (43 × 32).
    expect(toPixels("16:9", "1k", { grid: 32 }, ctxAt("aspectRatio")).value?.width).toBe(1344);
  });

  test("the tier areas are the ones the design fixed", () => {
    expect(TIER_PIXELS["1k"]).toBe(1024 * 1024);
    expect(TIER_PIXELS["2k"]).toBe(2048 * 2048);
    expect(TIER_PIXELS["4k"]).toBe(3840 * 2160);
    const ctx = ctxAt("aspectRatio");
    expect(toPixels("1:1", "2k", { grid: 1 }, ctx).value).toEqual({ width: 2048, height: 2048 });
    expect(toPixels("16:9", "4k", { grid: 1 }, ctx).value).toEqual({ width: 3840, height: 2160 });
  });

  test("clamps land on the grid, both directions", () => {
    // max 1000 with a 32 grid → 992 (31 × 32), not 1000.
    const capped = toPixels("1:1", "2k", { grid: 32, max: 1000 }, ctxAt("aspectRatio"));
    expect(capped.value).toEqual({ width: 992, height: 992 });

    // 21:9 at 1k is ~1564×670; a 704px floor lifts the short edge to 704
    // (22 × 32), the first grid multiple at or above 700 — not 700 itself.
    const lifted = toPixels("21:9", "1k", { grid: 32, min: 700 }, ctxAt("aspectRatio"));
    expect(lifted.value).toEqual({ width: 1536, height: 704 });
  });

  test("a ratio that cannot fit the bounds at all is an error, not a guess", () => {
    // max below one grid step leaves nothing to snap to.
    const out = toPixels("1:1", "1k", { grid: 64, max: 32 }, ctxAt("aspectRatio"));
    expect(out.value).toBeUndefined();
    expect(out.issues[0]!.code).toBe("invalid_shape");
  });

  test("an unparseable ratio never reaches the arithmetic", () => {
    const out = toPixels("square", "1k", { grid: 8 }, ctxAt("aspectRatio"));
    expect(out.issues[0]!.code).toBe("invalid_shape");
  });
});

// ---------------------------------------------------------------------------
// S3 — toSizeEnum
// ---------------------------------------------------------------------------

describe("S3 · toSizeEnum", () => {
  const TABLE = {
    "1k": { "1:1": "1024x1024", "3:2": "1536x1024", "2:3": "1024x1536" },
    "2k": { "1:1": "2048x2048" },
  } as const;

  test("looks up by reduced ratio, so spelling does not matter", () => {
    const ctx = ctxAt("aspectRatio");
    expect(toSizeEnum("3:2", "1k", TABLE, ctx).value).toBe("1536x1024");
    expect(toSizeEnum("1536:1024", "1k", TABLE, ctx).value).toBe("1536x1024");
    expect(toSizeEnum("1x1", "2k", TABLE, ctx).value).toBe("2048x2048");
    expect(ctx.warnings).toEqual([]);
  });

  test("a tier the model has no sizes for names the tiers it has", () => {
    const out = toSizeEnum("1:1", "4k", TABLE, ctxAt("aspectRatio"));
    expect(out.value).toBeUndefined();
    expect(out.issues[0]!.code).toBe("invalid_enum_value");
    expect(out.issues[0]!.message).toContain("`resolution`");
    expect(out.issues[0]!.meta).toMatchObject({ allowed: ["1k", "2k"] });
  });

  test("a ratio that tier does not offer is a different miss with a different list", () => {
    const out = toSizeEnum("3:2", "2k", TABLE, ctxAt("aspectRatio"));
    expect(out.issues[0]!.code).toBe("invalid_enum_value");
    expect(out.issues[0]!.message).toContain("at 2k");
    expect(out.issues[0]!.meta).toMatchObject({ allowed: ["1:1"], tier: "2k" });
  });

  /**
   * The DALL·E 3 case. A row keyed `"16:9"` whose value is `1792x1024` is
   * 1.750:1 — everybody calls it 16:9 and the pixels disagree, so matching it
   * silently would break "zero warnings means exact" for the single most
   * common ratio there is.
   */
  test("a row whose pixels are not the shape its key claims warns, naming both", () => {
    const ctx = ctxAt("aspectRatio");
    const table = { "1k": { "1:1": "1024x1024", "16:9": "1792x1024" } } as const;
    expect(toSizeEnum("16:9", "1k", table, ctx).value).toBe("1792x1024");
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]!.code).toBe("approximated_param");
    expect(ctx.warnings[0]!.message).toContain("1.750:1");
    expect(ctx.warnings[0]!.message).toContain("requested 1.778:1");
    expect(ctx.warnings[0]!.meta).toMatchObject({
      requested: "16:9",
      achieved: "1792x1024",
      width: 1792,
      height: 1024,
      tier: "1k",
    });
  });

  test("an exact row and a non-pixel row are both silent", () => {
    const ctx = ctxAt("aspectRatio");
    // 1536x1024 IS 3:2, to the last pixel.
    expect(toSizeEnum("3:2", "1k", TABLE, ctx).value).toBe("1536x1024");
    // A value that is not a pixel pair carries no measurable ratio.
    const named = { "1k": { "16:9": "landscape_hd" } } as const;
    expect(toSizeEnum("16:9", "1k", named, ctx).value).toBe("landscape_hd");
    expect(ctx.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// S4 — toSizeFreeform
// ---------------------------------------------------------------------------

describe("S4 · toSizeFreeform", () => {
  test("formats what toPixels computed, including its warning", () => {
    const ctx = ctxAt("aspectRatio");
    expect(toSizeFreeform("16:9", "1k", { grid: 32 }, ctx).value).toBe("1344x768");
    expect(ctx.warnings).toHaveLength(1);
  });

  test("honours the provider's separator", () => {
    const ctx = ctxAt("aspectRatio");
    expect(toSizeFreeform("1:1", "1k", { grid: 1, separator: "*" }, ctx).value).toBe("1024*1024");
    expect(ctx.warnings).toEqual([]);
  });

  test("propagates the failure rather than formatting a partial answer", () => {
    const out = toSizeFreeform("nope", "1k", { grid: 1 }, ctxAt("aspectRatio"));
    expect(out.value).toBeUndefined();
    expect(out.issues).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// S5 — toRatioString
// ---------------------------------------------------------------------------

describe("S5 · toRatioString", () => {
  test("emits the reduced ratio, so one shape has one spelling", () => {
    const ctx = ctxAt("aspectRatio");
    expect(toRatioString("1920:1080", { min: 0.5, max: 2 }, ctx).value).toBe("16:9");
    expect(toRatioString("16x9", {}, ctx).value).toBe("16:9");
    expect(toRatioString("1.5:1", {}, ctx).value).toBe("3:2");
    expect(ctx.warnings).toEqual([]);
  });

  test("honours the provider's separator", () => {
    expect(toRatioString("16:9", { separator: "x" }, ctxAt("aspectRatio")).value).toBe("16x9");
  });

  test("a ratio outside the range is an error naming the range", () => {
    const out = toRatioString("21:9", { min: 0.5, max: 2 }, ctxAt("aspectRatio"));
    expect(out.value).toBeUndefined();
    expect(out.issues[0]!.code).toBe("invalid_shape");
    expect(out.issues[0]!.message).toContain("between 0.5 and 2");
    expect(out.issues[0]!.meta).toMatchObject({ min: 0.5, max: 2 });
  });

  test("the lower bound is enforced too", () => {
    const out = toRatioString("9:21", { min: 0.5, max: 2 }, ctxAt("aspectRatio"));
    expect(out.issues[0]!.code).toBe("invalid_shape");
  });

  test("no bounds means any shape — reduced, which is 7:3 for a 21:9", () => {
    // Surprising the first time and correct every time: an *open* ratio field
    // takes a number, and 21:9 is 7:3. A provider that insists on the literal
    // string "21:9" has an enum, and belongs in toRatioEnum.
    expect(toRatioString("21:9", {}, ctxAt("aspectRatio")).value).toBe("7:3");
  });
});

// ---------------------------------------------------------------------------
// S6 — toTier
// ---------------------------------------------------------------------------

describe("S6 · toTier", () => {
  const TABLE = { "1k": "1K", "2k": "2K" } as const;

  test("maps a tier to whatever the provider calls it", () => {
    expect(toTier("1k", TABLE, ctxAt("resolution")).value).toBe("1K");
    expect(toTier("2k", { "1k": 1024, "2k": 2048 }, ctxAt("resolution")).value).toBe(2048);
  });

  test("a missing tier is an error and NEVER a downgrade", () => {
    const ctx = ctxAt("resolution");
    const out = toTier("4k", TABLE, ctx);
    expect(out.value).toBeUndefined();
    expect(out.issues[0]!.code).toBe("invalid_enum_value");
    expect(out.issues[0]!.meta).toMatchObject({ allowed: ["1k", "2k"], value: "4k" });
    // The failure mode this exists to prevent: quietly serving 1k for a 4k ask.
    expect(ctx.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// pixelsToRatio — the lossy direction
// ---------------------------------------------------------------------------

describe("pixelsToRatio", () => {
  test("with no enum, reduces and always warns — a ratio carries no size", () => {
    const ctx = ctxAt("dimensions");
    expect(pixelsToRatio(1000, 600, undefined, ctx).value).toBe("5:3");
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]!.code).toBe("approximated_param");
    expect(ctx.warnings[0]!.message).toContain("1000×600");
  });

  test("an exact enum match still warns, because the pixels are still lost", () => {
    const ctx = ctxAt("dimensions");
    expect(pixelsToRatio(1920, 1080, ["1:1", "16:9"], ctx).value).toBe("16:9");
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]!.meta).toMatchObject({ chosen: "16:9", distance: 0 });
  });

  test("the nearest inside the tolerance is chosen, and the distance is quoted", () => {
    const ctx = ctxAt("dimensions");
    // 1000×563 is 1.7762:1 — 0.09% from 16:9.
    const out = pixelsToRatio(1000, 563, ["1:1", "16:9", "4:3"], ctx);
    expect(out.value).toBe("16:9");
    expect(ctx.warnings[0]!.message).toContain("nearest shape");
    expect(ctx.warnings[0]!.message).toContain("16:9");
  });

  test("outside the tolerance is unsupported_param — a 3%-off shape is a different shape", () => {
    const ctx = ctxAt("dimensions");
    const out = pixelsToRatio(1000, 600, ["1:1", "16:9"], ctx);
    expect(out.value).toBeUndefined();
    expect(out.issues[0]!.code).toBe("unsupported_param");
    expect(out.issues[0]!.message).toContain("nearest");
    expect(out.issues[0]!.meta).toMatchObject({ nearest: "16:9" });
    expect(ctx.warnings).toEqual([]);
  });

  test("the 2% boundary holds on both sides", () => {
    expect(RATIO_MATCH_TOLERANCE).toBe(0.02);
    // A square request against a candidate exactly `e^d` away from square.
    const candidate = (d: number): string => `${Math.exp(d)}:1`;

    const inside = ctxAt("dimensions");
    const under = pixelsToRatio(1000, 1000, [candidate(0.0199)], inside);
    expect(under.value).toBeDefined();
    expect(inside.warnings).toHaveLength(1);

    const outside = ctxAt("dimensions");
    const over = pixelsToRatio(1000, 1000, [candidate(0.0201)], outside);
    expect(over.value).toBeUndefined();
    expect(over.issues[0]!.code).toBe("unsupported_param");
    expect(outside.warnings).toEqual([]);

    // Symmetric: the same distance the other way is also inside / outside.
    expect(pixelsToRatio(1000, 1000, [candidate(-0.0199)], ctxAt("d")).value).toBeDefined();
    expect(pixelsToRatio(1000, 1000, [candidate(-0.0201)], ctxAt("d")).value).toBeUndefined();
  });

  test("rejects dimensions that are not dimensions", () => {
    for (const [w, h] of [
      [0, 100],
      [100, 0],
      [-1, 100],
      [Number.NaN, 100],
      [Number.POSITIVE_INFINITY, 100],
    ] as const) {
      const out = pixelsToRatio(w, h, undefined, ctxAt("dimensions"));
      expect(out.issues[0]!.code, `${w}×${h}`).toBe("invalid_shape");
    }
  });
});

// ---------------------------------------------------------------------------
// aspectRatio XOR dimensions
// ---------------------------------------------------------------------------

describe("resolveSizing", () => {
  test("reads whichever spelling was used", () => {
    expect(resolveSizing({ aspectRatio: "16:9" }, ctxAt("aspectRatio")).value).toEqual({
      kind: "ratio",
      aspectRatio: "16:9",
    });
    expect(
      resolveSizing({ dimensions: { width: 800, height: 600 } }, ctxAt("dimensions")).value,
    ).toEqual({ kind: "dimensions", dimensions: { width: 800, height: 600 } });
    expect(resolveSizing({}, ctxAt("aspectRatio")).value).toEqual({ kind: "unset" });
  });

  test("both at once is invalid_shape — the type says so too, this is for JS", () => {
    const out = resolveSizing(
      { aspectRatio: "16:9", dimensions: { width: 800, height: 600 } },
      ctxAt("aspectRatio"),
    );
    expect(out.value).toBeUndefined();
    expect(out.issues[0]!.code).toBe("invalid_shape");
    expect(out.issues[0]!.message).toContain("exactly one");
  });
});

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

describe("durations", () => {
  const SORA = [4, 8, 12];

  test("the three encodings agree about the value and differ only in spelling", () => {
    expect(toDurationNumber(8, SORA, ctxAt("duration")).value).toBe(8);
    expect(toDurationString(8, SORA, ctxAt("duration")).value).toBe("8");
    expect(toDurationSuffixedString(8, SORA, ctxAt("duration")).value).toBe("8s");
    expect(toDurationSuffixedString(8, undefined, ctxAt("duration"), "sec").value).toBe("8sec");
  });

  test("an enum miss lists the values — the sora case", () => {
    const out = toDurationNumber(6, SORA, ctxAt("duration"));
    expect(out.value).toBeUndefined();
    expect(out.issues[0]!.code).toBe("invalid_enum_value");
    expect(out.issues[0]!.message).toContain("4, 8, 12");
    expect(out.issues[0]!.meta).toMatchObject({ allowed: SORA, value: 6 });
  });

  test("without an enum, any whole number passes and a fraction does not", () => {
    expect(toDurationNumber(7, undefined, ctxAt("duration")).value).toBe(7);
    const out = toDurationNumber(7.5, undefined, ctxAt("duration"));
    expect(out.value).toBeUndefined();
    expect(out.issues[0]!.code).toBe("invalid_shape");
    expect(out.issues[0]!.message).toContain("whole number");
  });

  test("an enum that lists a fraction beats the integer rule", () => {
    // Checked in that order on purpose: a model offering 2.5s is not a typo.
    expect(toDurationNumber(2.5, [2.5, 5], ctxAt("duration")).value).toBe(2.5);
  });

  test("rejects durations that are not durations", () => {
    for (const value of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = toDurationNumber(value, undefined, ctxAt("duration"));
      expect(out.issues[0]!.code, String(value)).toBe("invalid_shape");
    }
  });

  test("never warns — a duration either fits or it does not", () => {
    const ctx = ctxAt("duration");
    toDurationNumber(8, SORA, ctx);
    toDurationNumber(6, SORA, ctx);
    expect(ctx.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Video inputs — the route a request derives, and how each input is encoded
// ---------------------------------------------------------------------------

const URL_REF = { url: "https://example.com/a.png" };

describe("videoRoute", () => {
  test("the four routes, derived from the inputs and nothing else", () => {
    expect(videoRoute({})).toBe("text");
    expect(videoRoute({ image: URL_REF })).toBe("image");
    expect(videoRoute({ image: [URL_REF] })).toBe("image");
    expect(videoRoute({ image: { ...URL_REF, role: "last" } })).toBe("image");
    expect(videoRoute({ image: { ...URL_REF, role: "reference" } })).toBe("reference");
    expect(videoRoute({ video: { url: "https://example.com/a.mp4" } })).toBe("video");
  });

  test("a clip wins over a still, and a reference over a keyframe", () => {
    // Every provider that takes both treats the clip as the subject…
    expect(videoRoute({ image: URL_REF, video: { url: "x" } })).toBe("video");
    // …and a mixed array is a reference request, because that is the endpoint
    // it would have to go to; the adapter says what happens to the keyframe.
    expect(videoRoute({ image: [URL_REF, { ...URL_REF, role: "reference" }] })).toBe("reference");
  });

  test("an empty array is a text request, not an image one", () => {
    expect(videoRoute({ image: [] })).toBe("text");
  });
});

describe("resolveVideoRoute", () => {
  test("a route the model serves passes through with no issues", () => {
    const out = resolveVideoRoute(
      { image: URL_REF },
      { model: "gen4_turbo", routes: ["image"] },
      ctxAt("image"),
    );
    expect(out).toEqual({ value: "image", issues: [] });
  });

  test("a route it does not serve names the derivation, the alternatives and the fix", () => {
    const out = resolveVideoRoute({}, { model: "gen4_turbo", routes: ["image"] }, ctxAt("image"));
    expect(out.value).toBeUndefined();
    expect(out.issues[0]).toMatchObject({
      code: "unsupported_capability",
      // The error lands on the field that DECIDED the route, which for a text
      // request is the absence of the other two.
      path: ["prompt"],
      meta: { route: "text", routes: ["image"] },
    });
    expect(out.issues[0]!.message).toBe(
      '"gen4_turbo" has no text-to-video route; it serves image-to-video — pass `image`.',
    );
  });

  test("several alternatives are listed in the order the adapter declared them", () => {
    const out = resolveVideoRoute(
      { video: { url: "x" } },
      { model: "kling-v3", routes: ["text", "image"], source: "https://example.com/docs" },
      ctxAt("video"),
    );
    expect(out.issues[0]!.path).toEqual(["video"]);
    expect(out.issues[0]!.message).toContain("it serves text-to-video and image-to-video");
    expect(out.issues[0]!.message).toContain("drop `image`/`video` for a text-only request, or pass `image`");
    expect(out.issues[0]!.meta).toMatchObject({ source: "https://example.com/docs" });
  });

  test("every route has a label, so no message can render `undefined`", () => {
    expect(Object.keys(VIDEO_ROUTE_LABELS).sort()).toEqual(["image", "reference", "text", "video"]);
  });
});

describe("resolveImageSlots", () => {
  test("an omitted role is the first frame — what an unlabelled image means", () => {
    const out = resolveImageSlots(URL_REF, ctxAt("image"));
    expect(out.value).toEqual({ first: URL_REF, references: [] });
  });

  test("splits the three jobs an image can have", () => {
    const last = { ...URL_REF, role: "last" } as const;
    const reference = { ...URL_REF, role: "reference" } as const;
    const out = resolveImageSlots([URL_REF, last, reference, reference], ctxAt("image"));
    expect(out.value).toEqual({ first: URL_REF, last, references: [reference, reference] });
  });

  test("two images claiming one slot is an error naming the index", () => {
    const out = resolveImageSlots([URL_REF, URL_REF], ctxAt("image"));
    expect(out.value).toBeUndefined();
    expect(out.issues[0]).toMatchObject({ code: "invalid_shape", path: ["image", 1] });
    expect(out.issues[0]!.message).toContain('two images claim the "first" frame');
  });

  test("no images at all is an empty set, not a failure", () => {
    expect(resolveImageSlots(undefined, ctxAt("image")).value).toEqual({ references: [] });
  });
});

describe("media references", () => {
  test("toMediaUri passes a URL through and builds a data URI from bytes", () => {
    expect(toMediaUri(URL_REF, ctxAt("image")).value).toBe(URL_REF.url);
    expect(toMediaUri({ data: "AAAA", mimeType: "image/png" }, ctxAt("image")).value).toBe(
      "data:image/png;base64,AAAA",
    );
    // Bytes that already carry the envelope are the same value, spelled the
    // way the caller happened to have it.
    expect(toMediaUri({ data: "data:image/png;base64,AAAA" }, ctxAt("image")).value).toBe(
      "data:image/png;base64,AAAA",
    );
  });

  test("toMediaUri refuses bytes with no media type rather than inventing one", () => {
    const out = toMediaUri({ data: "AAAA" }, ctxAt("image"));
    expect(out.value).toBeUndefined();
    expect(out.issues[0]!.code).toBe("invalid_shape");
    expect(out.issues[0]!.message).toContain("`mimeType`");
  });

  test("requireMediaUrl refuses inline bytes and quotes the provider's fix", () => {
    expect(requireMediaUrl(URL_REF, "Upload first.", ctxAt("image")).value).toBe(URL_REF.url);
    const out = requireMediaUrl({ data: "AAAA", mimeType: "image/png" }, "Upload first.", ctxAt("image"));
    expect(out.value).toBeUndefined();
    expect(out.issues[0]).toMatchObject({ code: "unsupported_param", path: ["image"] });
    expect(out.issues[0]!.message).toEndWith("Upload first.");
  });

  test("requireInlineBytes refuses a URL and unwraps a data URI", () => {
    expect(requireInlineBytes({ data: "AAAA", mimeType: "image/png" }, "x", ctxAt("image")).value)
      .toEqual({ data: "AAAA", mimeType: "image/png" });
    // The field wants the payload, not the envelope.
    expect(requireInlineBytes({ data: "data:image/jpeg;base64,BBBB" }, "x", ctxAt("image")).value)
      .toEqual({ data: "BBBB", mimeType: "image/jpeg" });
    const out = requireInlineBytes(URL_REF, "Read the file.", ctxAt("image"));
    expect(out.value).toBeUndefined();
    expect(out.issues[0]).toMatchObject({ code: "unsupported_param", meta: { url: URL_REF.url } });
  });

  test("none of the media derivations warns — a reference either fits or it does not", () => {
    const ctx = ctxAt("image");
    toMediaUri(URL_REF, ctx);
    requireMediaUrl({ data: "AAAA" }, "x", ctx);
    requireInlineBytes(URL_REF, "x", ctx);
    expect(ctx.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Audio formats
// ---------------------------------------------------------------------------

describe("normalizeAudioFormat", () => {
  test("a codec shorthand becomes an object with the canonical container", () => {
    expect(normalizeAudioFormat("mp3")).toEqual({ format: "mp3", container: "mp3" });
    expect(normalizeAudioFormat("opus")).toEqual({ format: "opus", container: "ogg" });
    expect(normalizeAudioFormat("vorbis")).toEqual({ format: "vorbis", container: "ogg" });
    expect(normalizeAudioFormat("flac")).toEqual({ format: "flac", container: "flac" });
    expect(normalizeAudioFormat("aac")).toEqual({ format: "aac", container: "aac" });
  });

  test("every PCM variant defaults to wav", () => {
    for (const codec of [
      "pcm_s16le",
      "pcm_s24le",
      "pcm_s32le",
      "pcm_f32le",
      "pcm_mulaw",
      "pcm_alaw",
    ] as const) {
      expect(normalizeAudioFormat(codec).container, codec).toBe("wav");
    }
  });

  test("every codec has a default, so the table can never be half-filled", () => {
    for (const [codec, container] of Object.entries(DEFAULT_CONTAINER)) {
      expect(container, codec).toBeDefined();
    }
  });

  test("an explicit container survives; the rest is filled", () => {
    expect(normalizeAudioFormat({ format: "opus", container: "webm" })).toEqual({
      format: "opus",
      container: "webm",
    });
    expect(normalizeAudioFormat({ format: "pcm_s16le", sampleRate: 24000 })).toEqual({
      format: "pcm_s16le",
      container: "wav",
      sampleRate: 24000,
    });
  });

  test("does not mutate its argument", () => {
    const input = { format: "mp3" } as const;
    normalizeAudioFormat(input);
    expect(Object.hasOwn(input, "container")).toBe(false);
  });
});

describe("bitsToKbps", () => {
  test("is exact or it is an error", () => {
    expect(bitsToKbps(128_000, ctxAt("outputFormat", "bitrate")).value).toBe(128);
    expect(bitsToKbps(32_000, ctxAt("outputFormat", "bitrate")).value).toBe(32);
    const out = bitsToKbps(128_500, ctxAt("outputFormat", "bitrate"));
    expect(out.value).toBeUndefined();
    expect(out.issues[0]!.code).toBe("invalid_shape");
    expect(out.issues[0]!.message).toContain("128.5");
  });

  test("rejects non-bitrates", () => {
    for (const value of [0, -1000, Number.NaN]) {
      expect(bitsToKbps(value, ctxAt("outputFormat", "bitrate")).issues[0]!.code).toBe(
        "invalid_shape",
      );
    }
  });
});

describe("resolveAudioFormat", () => {
  const SPEC = {
    codecs: { mp3: "mp3", pcm_s16le: "linear16", opus: "opus" },
    containers: { opus: ["webm"], pcm_s16le: ["wav", "raw"] },
    sampleRates: { pcm_s16le: [16000, 24000, 48000], mp3: [22050, 44100] },
    bitrates: { mp3: [64_000, 128_000] },
    source: "https://docs.example/audio",
  } as const;

  test("the exact path produces no warnings at all", () => {
    const ctx = ctxAt("outputFormat");
    const out = resolveAudioFormat(
      { format: "pcm_s16le", container: "raw", sampleRate: 24000 },
      SPEC,
      ctx,
    );
    expect(out.value).toEqual({
      codec: "pcm_s16le",
      wire: "linear16",
      container: "raw",
      sampleRate: 24000,
    });
    expect(ctx.warnings).toEqual([]);
  });

  test("a codec the model does not encode is an error naming the ones it does", () => {
    const out = resolveAudioFormat("flac", SPEC, ctxAt("outputFormat"));
    expect(out.value).toBeUndefined();
    expect(out.issues[0]!.code).toBe("invalid_enum_value");
    expect(out.issues[0]!.meta).toMatchObject({
      allowed: ["mp3", "pcm_s16le", "opus"],
      source: "https://docs.example/audio",
    });
  });

  test("an explicitly-requested container that is unavailable is the caller's error", () => {
    const ctx = ctxAt("outputFormat");
    const out = resolveAudioFormat({ format: "opus", container: "ogg" }, SPEC, ctx);
    expect(out.value).toBeUndefined();
    expect(out.issues[0]!.code).toBe("invalid_enum_value");
    expect(out.issues[0]!.meta).toMatchObject({ allowed: ["webm"], value: "ogg" });
    expect(ctx.warnings).toEqual([]);
  });

  test("a canonical default container that is unavailable is OUR substitution, so it warns", () => {
    const ctx = ctxAt("outputFormat");
    // `"opus"` means Ogg Opus canonically; this model only serves WebM.
    const out = resolveAudioFormat("opus", SPEC, ctx);
    expect(out.value).toMatchObject({ codec: "opus", wire: "opus", container: "webm" });
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]!.code).toBe("approximated_param");
    expect(ctx.warnings[0]!.message).toContain("webm");
    expect(ctx.warnings[0]!.meta).toMatchObject({ requested: "ogg", achieved: "webm" });
  });

  test("a canonical default that IS available passes silently", () => {
    const ctx = ctxAt("outputFormat");
    expect(resolveAudioFormat("pcm_s16le", SPEC, ctx).value).toMatchObject({ container: "wav" });
    expect(ctx.warnings).toEqual([]);
  });

  test("no container list means the canonical default is sent as-is", () => {
    const ctx = ctxAt("outputFormat");
    expect(resolveAudioFormat("mp3", SPEC, ctx).value).toMatchObject({ container: "mp3" });
    expect(ctx.warnings).toEqual([]);
  });

  test("a rate or bitrate off the list is an error listing the list", () => {
    const rate = resolveAudioFormat(
      { format: "pcm_s16le", container: "wav", sampleRate: 8000 },
      SPEC,
      ctxAt("outputFormat"),
    );
    expect(rate.value).toBeUndefined();
    expect(rate.issues[0]!.code).toBe("invalid_enum_value");
    expect(rate.issues[0]!.message).toContain("outputFormat.sampleRate");

    const bits = resolveAudioFormat(
      { format: "mp3", bitrate: 192_000 },
      SPEC,
      ctxAt("outputFormat"),
    );
    expect(bits.issues[0]!.code).toBe("invalid_enum_value");
    expect(bits.issues[0]!.message).toContain("bits/s");
  });

  test("a documented default is filled in and warned about", () => {
    const ctx = ctxAt("outputFormat");
    const out = resolveAudioFormat(
      "pcm_s16le",
      { ...SPEC, defaults: { sampleRate: 24000 } },
      ctx,
    );
    expect(out.value).toMatchObject({ sampleRate: 24000 });
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]!.code).toBe("approximated_param");
    expect(ctx.warnings[0]!.message).toContain("24000 Hz");
    expect(ctx.warnings[0]!.meta).toMatchObject({ field: "sampleRate", value: 24000 });
  });

  test("required with no documented default is an error, because there is nothing to invent", () => {
    const ctx = ctxAt("outputFormat");
    const out = resolveAudioFormat(
      "pcm_s16le",
      { ...SPEC, required: ["sampleRate"] },
      ctx,
    );
    expect(out.value).toBeUndefined();
    expect(out.issues[0]!.code).toBe("invalid_shape");
    expect(out.issues[0]!.message).toContain("outputFormat.sampleRate");
    expect(out.issues[0]!.message).toContain("16000, 24000, 48000");
    expect(ctx.warnings).toEqual([]);
  });

  test("a field that is neither required nor defaulted is simply absent", () => {
    const ctx = ctxAt("outputFormat");
    const out = resolveAudioFormat("mp3", SPEC, ctx);
    expect(out.value).toBeDefined();
    expect(out.value?.sampleRate).toBeUndefined();
    expect(out.value?.bitrate).toBeUndefined();
    expect(ctx.warnings).toEqual([]);
  });

  test("every failure is collected in one pass, not just the first", () => {
    const out = resolveAudioFormat(
      { format: "mp3", sampleRate: 8000, bitrate: 192_000 },
      SPEC,
      ctxAt("outputFormat"),
    );
    expect(out.issues).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Speed
// ---------------------------------------------------------------------------

describe("speed", () => {
  test("toSpeed is the identity, with the provider's bounds", () => {
    const ctx = ctxAt("speed");
    expect(toSpeed(1.5, { min: 0.25, max: 4 }, ctx).value).toBe(1.5);
    expect(ctx.warnings).toEqual([]);

    const out = toSpeed(5, { min: 0.25, max: 4 }, ctxAt("speed"));
    expect(out.value).toBeUndefined();
    expect(out.issues[0]!.code).toBe("invalid_shape");
    expect(out.issues[0]!.message).toContain("between 0.25 and 4");
  });

  test("invertSpeed is exact, and therefore silent", () => {
    const ctx = ctxAt("speed");
    expect(invertSpeed(1.25, {}, ctx).value).toBe(0.8);
    expect(invertSpeed(2, {}, ctx).value).toBe(0.5);
    expect(invertSpeed(0.5, {}, ctx).value).toBe(2);
    expect(invertSpeed(1, {}, ctx).value).toBe(1);
    expect(ctx.warnings).toEqual([]);
  });

  test("invertSpeed's bounds are canonical, so the message quotes what was typed", () => {
    const out = invertSpeed(3, { min: 0.5, max: 2 }, ctxAt("speed"));
    expect(out.value).toBeUndefined();
    expect(out.issues[0]!.message).toContain("got 3");
  });

  test("both reject a speed that is not a multiplier", () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(toSpeed(value, {}, ctxAt("speed")).issues[0]!.code, String(value)).toBe(
        "invalid_shape",
      );
      expect(invertSpeed(value, {}, ctxAt("speed")).issues[0]!.code, String(value)).toBe(
        "invalid_shape",
      );
    }
  });

  test("murfSpeed is exact when the percentage is whole", () => {
    const ctx = ctxAt("speed");
    expect(murfSpeed(1.25, ctx).value).toBe(25);
    expect(murfSpeed(1, ctx).value).toBe(0);
    expect(murfSpeed(0.7, ctx).value).toBe(-30);
    expect(murfSpeed(1.5, ctx).value).toBe(50);
    expect(murfSpeed(0.5, ctx).value).toBe(-50);
    expect(ctx.warnings).toEqual([]);
  });

  test("murfSpeed rounds, and names the speed it actually achieved", () => {
    const ctx = ctxAt("speed");
    expect(murfSpeed(1.234, ctx).value).toBe(23);
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]!.code).toBe("approximated_param");
    expect(ctx.warnings[0]!.message).toContain("1.23×");
    expect(ctx.warnings[0]!.meta).toMatchObject({ requested: 1.234, achieved: 1.23, wire: 23 });
  });

  test("murfSpeed refuses to clamp — 2× is not 1.5×", () => {
    const ctx = ctxAt("speed");
    const out = murfSpeed(2, ctx);
    expect(out.value).toBeUndefined();
    expect(out.issues[0]!.code).toBe("invalid_shape");
    expect(out.issues[0]!.message).toContain("between 0.5 and 1.5");
    expect(ctx.warnings).toEqual([]);
    expect(murfSpeed(0.4, ctxAt("speed")).value).toBeUndefined();
  });

  test("toSpeedPercentDelta generalises the shape", () => {
    // A provider whose field is per-mille rather than per-cent.
    const ctx = ctxAt("speed");
    expect(toSpeedPercentDelta(1.234, { scale: 1000, min: 0.5, max: 2 }, ctx).value).toBe(234);
    expect(ctx.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fields an endpoint has no home for
// ---------------------------------------------------------------------------

describe("resolveAudioFormat · unavailable fields", () => {
  const CODEC_ONLY = {
    codecs: { mp3: "mp3", pcm_s16le: "pcm" },
    unavailable: ["sampleRate", "bitrate"],
  } as const;

  test("a value with nowhere to go is an error, never a silent drop", () => {
    const ctx = ctxAt("outputFormat");
    const out = resolveAudioFormat({ format: "mp3", sampleRate: 44100 }, CODEC_ONLY, ctx);
    expect(out.value).toBeUndefined();
    expect(out.issues[0]!.code).toBe("unsupported_param");
    expect(out.issues[0]!.message).toContain("`outputFormat.sampleRate` is not configurable");
    expect(out.issues[0]!.meta).toMatchObject({ field: "sampleRate", codec: "mp3", value: 44100 });
    expect(ctx.warnings).toEqual([]);
  });

  test("both halves are reported in one pass", () => {
    const out = resolveAudioFormat(
      { format: "mp3", sampleRate: 44100, bitrate: 128_000 },
      CODEC_ONLY,
      ctxAt("outputFormat"),
    );
    expect(out.issues.map((issue) => issue.meta?.["field"])).toEqual(["sampleRate", "bitrate"]);
  });

  test("an unavailable field is never defaulted into existence either", () => {
    const ctx = ctxAt("outputFormat");
    // A documented default plus an unavailable field is a table bug; the
    // unavailability wins, because inventing a value for a field that cannot be
    // sent would put a warning on the record about nothing.
    const out = resolveAudioFormat(
      "mp3",
      { ...CODEC_ONLY, defaults: { sampleRate: 24000 } },
      ctx,
    );
    expect(out.value).toMatchObject({ codec: "mp3" });
    expect(out.value?.sampleRate).toBeUndefined();
    expect(ctx.warnings).toEqual([]);
  });

  test("the per-codec spelling narrows to one codec (Deepgram's fixed-rate mp3)", () => {
    const SPEC = {
      codecs: { mp3: "mp3", pcm_s16le: "linear16" },
      unavailable: { mp3: ["sampleRate"], pcm_s16le: ["bitrate"] },
    } as const;
    const mp3 = resolveAudioFormat(
      { format: "mp3", sampleRate: 22050 },
      SPEC,
      ctxAt("outputFormat"),
    );
    expect(mp3.issues[0]!.code).toBe("unsupported_param");
    // …while the same rate is fine on the codec that does publish the field.
    const pcm = resolveAudioFormat(
      { format: "pcm_s16le", sampleRate: 22050 },
      SPEC,
      ctxAt("outputFormat"),
    );
    expect(pcm.value).toMatchObject({ sampleRate: 22050 });
  });
});

describe("resolveAudioFormat · defaultsByCodec", () => {
  const SPEC = {
    codecs: { mp3: "mp3", opus: "opus" },
    sampleRates: { mp3: [44100], opus: [48000] },
    defaults: { sampleRate: 44100, bitrate: 128_000 },
    defaultsByCodec: { opus: { sampleRate: 48000 } },
  } as const;

  test("the per-codec default wins over the endpoint-wide one", () => {
    const ctx = ctxAt("outputFormat");
    // ElevenLabs' shape: the endpoint defaults to mp3_44100_128, but Opus is
    // published at 48 kHz only, so 44100 would be a value the API rejects.
    expect(resolveAudioFormat("opus", SPEC, ctx).value).toMatchObject({ sampleRate: 48000 });
    expect(ctx.warnings.map((w) => w.meta?.["value"])).toEqual([48000, 128_000]);
  });

  test("a codec with no override keeps the endpoint-wide default", () => {
    expect(resolveAudioFormat("mp3", SPEC, ctxAt("outputFormat")).value).toMatchObject({
      sampleRate: 44100,
      bitrate: 128_000,
    });
  });
});

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

describe("resolveVoice", () => {
  const ID_ONLY = { accepts: ["id"] } as const;
  const NAME_ONLY = { accepts: ["name"] } as const;
  const BOTH = { accepts: ["name", "id"] } as const;

  test("a bare string is whichever spelling the endpoint takes", () => {
    expect(resolveVoice("v1", ID_ONLY, ctxAt("voice")).value).toEqual({ kind: "id", value: "v1" });
    expect(resolveVoice("astra", NAME_ONLY, ctxAt("voice")).value).toEqual({
      kind: "name",
      value: "astra",
    });
    // With both, the first entry decides — the array is in preference order.
    expect(resolveVoice("Ito", BOTH, ctxAt("voice")).value).toEqual({ kind: "name", value: "Ito" });
  });

  test("the explicit wrappers pass through where they are accepted", () => {
    expect(resolveVoice({ id: "v1" }, ID_ONLY, ctxAt("voice")).value).toEqual({
      kind: "id",
      value: "v1",
    });
    expect(resolveVoice({ name: "Ito" }, BOTH, ctxAt("voice")).value).toEqual({
      kind: "name",
      value: "Ito",
    });
  });

  test("the wrong wrapper is an error, not a coercion", () => {
    const out = resolveVoice({ name: "Kore" }, ID_ONLY, ctxAt("voice"));
    expect(out.value).toBeUndefined();
    expect(out.issues[0]!.code).toBe("invalid_shape");
    expect(out.issues[0]!.message).toContain("`{ name }` has no equivalent here");
    expect(out.issues[0]!.meta).toMatchObject({ accepts: ["id"], got: "name" });

    // …and the same in the other direction.
    expect(resolveVoice({ id: "abc" }, NAME_ONLY, ctxAt("voice")).issues[0]!.code).toBe(
      "invalid_shape",
    );
  });

  test("an empty or non-string voice is a shape error", () => {
    expect(resolveVoice("", ID_ONLY, ctxAt("voice")).issues[0]!.code).toBe("invalid_shape");
    expect(resolveVoice({ id: "" }, ID_ONLY, ctxAt("voice")).issues[0]!.code).toBe("invalid_shape");
    expect(
      resolveVoice({ id: 7 } as unknown as { id: string }, ID_ONLY, ctxAt("voice")).issues[0]!.code,
    ).toBe("invalid_shape");
    expect(
      resolveVoice(7 as unknown as string, ID_ONLY, ctxAt("voice")).issues[0]!.code,
    ).toBe("invalid_shape");
  });

  test("resolving a voice never warns — it is a lookup, not an approximation", () => {
    const ctx = ctxAt("voice");
    resolveVoice({ id: "v1" }, BOTH, ctx);
    resolveVoice("v2", ID_ONLY, ctx);
    expect(ctx.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

describe("toPrimaryLanguage", () => {
  test("a bare language tag passes through, lowercased and silent", () => {
    const ctx = ctxAt("language");
    expect(toPrimaryLanguage("pt", ctx).value).toBe("pt");
    expect(toPrimaryLanguage("EN", ctx).value).toBe("en");
    expect(toPrimaryLanguage("fil", ctx).value).toBe("fil");
    expect(ctx.warnings).toEqual([]);
  });

  test("a dropped region warns, naming both tags", () => {
    const ctx = ctxAt("language");
    expect(toPrimaryLanguage("pt-BR", ctx, { source: "https://docs.example" }).value).toBe("pt");
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]!.code).toBe("approximated_param");
    expect(ctx.warnings[0]!.message).toContain('"pt-BR" was sent as "pt"');
    expect(ctx.warnings[0]!.meta).toMatchObject({
      requested: "pt-BR",
      achieved: "pt",
      dropped: "BR",
      source: "https://docs.example",
    });
  });

  test("underscores and longer subtags are handled the same way", () => {
    const ctx = ctxAt("language");
    expect(toPrimaryLanguage("zh_Hans_CN", ctx).value).toBe("zh");
    expect(ctx.warnings[0]!.meta).toMatchObject({ dropped: "Hans_CN" });
  });

  test("something that is not a language tag is an error", () => {
    const out = toPrimaryLanguage("Brazilian Portuguese", ctxAt("language"));
    expect(out.value).toBeUndefined();
    expect(out.issues[0]!.code).toBe("invalid_shape");
    expect(out.issues[0]!.message).toContain("BCP-47");
  });
});

// ---------------------------------------------------------------------------
// Image-edit inputs and the strength scale
// ---------------------------------------------------------------------------

describe("resolveImageEditInput", () => {
  const blob = new Blob([new Uint8Array(8)], { type: "image/png" });
  const ALL = ["file", "url", "data"] as const;

  test("narrows to the one shape it is", () => {
    expect(resolveImageEditInput({ file: blob }, ALL, ctxAt("image")).value).toEqual({
      kind: "file",
      file: blob,
    });
    expect(resolveImageEditInput({ url: "https://e.com/a.png" }, ALL, ctxAt("image")).value).toEqual(
      { kind: "url", url: "https://e.com/a.png" },
    );
    expect(resolveImageEditInput({ data: "QUJD" }, ALL, ctxAt("image")).value).toEqual({
      kind: "data",
      data: "QUJD",
    });
  });

  test("a shape the route has no field for names the ones it does", () => {
    const out = resolveImageEditInput({ file: blob }, ["data", "url"], ctxAt("image"), {
      hint: "Read it yourself.",
    });
    expect(out.value).toBeUndefined();
    expect(out.issues[0]!.code).toBe("unsupported_param");
    expect(out.issues[0]!.message).toContain("{ data }");
    expect(out.issues[0]!.message).toContain("{ url }");
    // The hint is the half a caller can act on, so it is appended verbatim.
    expect(out.issues[0]!.message).toEndWith("Read it yourself.");
    expect(out.issues[0]!.meta).toMatchObject({ accepts: ["data", "url"], given: "file" });
  });

  test("two shapes at once is a caller who has not decided", () => {
    const out = resolveImageEditInput({ file: blob, url: "https://e.com/a.png" }, ALL, ctxAt("image"));
    expect(out.value).toBeUndefined();
    expect(out.issues[0]!.code).toBe("invalid_shape");
    expect(out.issues[0]!.meta).toMatchObject({ provided: ["file", "url"] });
  });

  test("no shape at all, and a non-object, each say what the route takes", () => {
    for (const value of [{}, null, "https://e.com/a.png", 7]) {
      const out = resolveImageEditInput(value, ["url"], ctxAt("image"));
      expect(out.value).toBeUndefined();
      expect(out.issues[0]!.code).toBe("invalid_shape");
      expect(out.issues[0]!.message).toContain("{ url }");
    }
  });

  test("the wrong JavaScript type inside the right key is caught", () => {
    const notBlob = resolveImageEditInput({ file: "not a blob" }, ["file"], ctxAt("image"));
    expect(notBlob.issues[0]!.message).toContain("must be a Blob or File");
    for (const bad of ["", 7, null]) {
      const out = resolveImageEditInput({ url: bad }, ["url"], ctxAt("image"));
      expect(out.value).toBeUndefined();
      expect(out.issues[0]!.code).toBe("invalid_shape");
    }
  });
});

describe("base64Payload", () => {
  test("unwraps a data URI to its payload and leaves bare base64 alone", () => {
    expect(base64Payload("data:image/png;base64,QUJD")).toBe("QUJD");
    expect(base64Payload("data:,QUJD")).toBe("QUJD");
    expect(base64Payload("QUJD")).toBe("QUJD");
    // A payload containing a comma is not re-split: the first comma ends the
    // header, and everything after it is the payload.
    expect(base64Payload("data:image/png;base64,QU,JD")).toBe("QU,JD");
  });
});

describe("toStrength", () => {
  const NATIVE = { atZero: 0, atOne: 1 };
  const INVERTED = { atZero: 100, atOne: 0, integer: true };

  test("the identity scale is the identity", () => {
    for (const value of [0, 0.25, 0.5, 0.75, 1]) {
      const ctx = ctxAt("strength");
      expect(toStrength(value, NATIVE, ctx).value).toBe(value);
      expect(ctx.warnings).toEqual([]);
    }
  });

  test("an inverted scale runs downhill, and lands on the midpoint exactly", () => {
    expect(toStrength(0, INVERTED, ctxAt("strength")).value).toBe(100);
    expect(toStrength(0.5, INVERTED, ctxAt("strength")).value).toBe(50);
    expect(toStrength(1, INVERTED, ctxAt("strength")).value).toBe(0);
    // Monotonically decreasing — the property a sign error breaks silently.
    const values = [0, 0.25, 0.5, 0.75, 1].map(
      (s) => toStrength(s, INVERTED, ctxAt("strength")).value as number,
    );
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]!).toBeLessThan(values[i - 1]!);
    }
  });

  test("rounding to a whole number warns with both values", () => {
    const ctx = ctxAt("strength");
    expect(toStrength(0.333, INVERTED, ctx).value).toBe(67);
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]!.code).toBe("approximated_param");
    expect(ctx.warnings[0]!.meta).toMatchObject({ requested: 0.333, achieved: 67 });
  });

  test("a value that is already whole does not warn", () => {
    const ctx = ctxAt("strength");
    expect(toStrength(0.25, INVERTED, ctx).value).toBe(75);
    expect(ctx.warnings).toEqual([]);
  });

  test("outside [0, 1] is refused rather than clamped", () => {
    for (const value of [-0.001, 1.001, 50, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = toStrength(value, NATIVE, ctxAt("strength"));
      expect(out.value, String(value)).toBeUndefined();
      expect(out.issues[0]!.code).toBe("invalid_shape");
      expect(out.issues[0]!.message).toContain("0 keeps the source image");
    }
  });
});

describe("resolveOperation", () => {
  const EDIT_ONLY = ["edit"] as const;

  test("the operation a route serves passes through", () => {
    const out = resolveOperation("edit", EDIT_ONLY, ctxAt("operation"));
    expect(out.value).toBe("edit");
    expect(out.issues).toEqual([]);
  });

  test("anything else is an enum error naming what the route does serve", () => {
    for (const value of ["inpaint", "outpaint", "", 7, null, undefined]) {
      const out = resolveOperation(value, EDIT_ONLY, ctxAt("operation"), { hint: "Try X." });
      expect(out.value, String(value)).toBeUndefined();
      expect(out.issues[0]!.code).toBe("invalid_enum_value");
      expect(out.issues[0]!.message).toContain('"edit"');
      expect(out.issues[0]!.message).toEndWith("Try X.");
      expect(out.issues[0]!.meta).toMatchObject({ allowed: ["edit"], value });
    }
  });

  test("a route that serves more than one accepts each of them", () => {
    const both = ["edit", "inpaint"] as const;
    expect(resolveOperation("edit", both, ctxAt("operation")).value).toBe("edit");
    expect(resolveOperation("inpaint", both, ctxAt("operation")).value).toBe("inpaint");
    expect(resolveOperation("outpaint", both, ctxAt("operation")).value).toBeUndefined();
  });
});
