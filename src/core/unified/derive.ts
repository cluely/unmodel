/**
 * The derivations every adapter shares.
 *
 * ## What this file is for
 *
 * Mapping a unified param to a wire param is a rename about sixty percent of
 * the time. The other forty percent is arithmetic — and it is the same
 * arithmetic at forty providers, done slightly differently each time, with
 * slightly different opinions about what to do when it does not come out
 * even. That is where a translation layer's credibility is won or lost, so it
 * lives in one file with one set of rules and an exhaustive test suite that
 * needs no provider at all.
 *
 * ## The rules, once
 *
 * - **Cannot be expressed → error.** A ratio outside the provider's enum, a
 *   tier it has no size for, a codec it does not encode. `invalid_enum_value`
 *   when the value is out of an enumerated domain, `invalid_shape` when it is
 *   out of a numeric range or the wrong kind of number, `unsupported_param`
 *   when the *param* has no equivalent at all.
 * - **Expressed approximately → warn.** Snapped to a grid, rounded to a step,
 *   matched to the nearest enum. `approximated_param`, naming the requested
 *   value *and* the achieved one, because "approximately" is useless without
 *   both numbers.
 * - **Never silently.** There is no third branch. A tier with no entry is not
 *   quietly downgraded to the next one down; a ratio 3% off the nearest enum
 *   is not quietly snapped. Both of those are the behaviour that makes people
 *   stop trusting a portability layer, and each one is a test below.
 *
 * The consequence is the contract the whole surface rests on: **zero warnings
 * means the request mapped exactly.**
 *
 * ## The uniform shape
 *
 * Every function here takes its inputs, a spec describing the provider's
 * capability, and a {@link DeriveContext} last; and returns a
 * {@link Derived}. Issues come back in the return value (which is what makes
 * these testable without a kernel); warnings go to `ctx.warn` (which is what
 * makes them route-stamped without every function knowing the route).
 *
 * Ratio arguments are typed `string`, not `AspectRatio`, on purpose. Adapters
 * pass an `AspectRatio` and lose nothing; the wider type is what keeps the
 * `invalid_shape` branch honest, because these functions also answer for
 * JavaScript callers and for provider tables that spell their own enums
 * `"16x9"`. A parameter whose invalid case the type system forbids is a
 * parameter whose invalid case nobody tests.
 */
import type { AudioContainer, AudioFormat, AudioFormatCodec, AudioFormatRequest } from "./vocabulary/audio";
import type { AspectRatio, Dimensions, ResolutionTier } from "./vocabulary/common";
import type { Voice } from "./vocabulary/speech";
import type { CompileIssue, Derived } from "./types";
import type { Warn } from "../translate/warnings";

// ---------------------------------------------------------------------------
// The uniform shape
// ---------------------------------------------------------------------------

/**
 * Where a derivation's findings go.
 *
 * `path` is the **canonical** path the finding is about (`["aspectRatio"]`,
 * `["outputFormat", "sampleRate"]`) — passed in rather than guessed, because
 * the same derivation serves `ImageParams.aspectRatio` and
 * `VideoParams.aspectRatio` and, in the edit category, a field nested one
 * level deeper.
 */
export interface DeriveContext {
  readonly path: ReadonlyArray<string | number>;
  readonly warn: Warn;
}

/** A successful derivation. */
function ok<T>(value: T): Derived<T> {
  return { value, issues: [] };
}

/** A failed one. `value` stays absent, which is how callers tell. */
function bad(ctx: DeriveContext, issue: Omit<CompileIssue, "path">): Derived<never> {
  return { issues: [{ ...issue, path: [...ctx.path] }] };
}

/**
 * The param name a message should quote — the last string segment of the
 * canonical path, so `["outputFormat", "sampleRate"]` reads as `sampleRate`
 * and a message never has to be told its own name.
 */
function paramOf(ctx: DeriveContext): string {
  for (let i = ctx.path.length - 1; i >= 0; i -= 1) {
    const segment = ctx.path[i];
    if (typeof segment === "string") return segment;
  }
  return "value";
}

/** The repo-wide way to render an allowed set inside a message. */
function list(values: ReadonlyArray<string | number>): string {
  return values.map((value) => JSON.stringify(value)).join(", ");
}

// ---------------------------------------------------------------------------
// Ratios — parsing and reduction
// ---------------------------------------------------------------------------

/** A ratio as two numbers, already reduced to lowest terms. */
export interface Ratio {
  width: number;
  height: number;
}

const RATIO_SPELLING = /^\s*(\d+(?:\.\d+)?)\s*[:x*×]\s*(\d+(?:\.\d+)?)\s*$/i;

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

/**
 * `"16x9"` → `{ width: 16, height: 9 }`; `"1.5:1"` → `{ width: 3, height: 2 }`.
 *
 * Accepts `:`, `x`, `*` and `×` as separators and reduces to lowest terms, so
 * every spelling of the same shape compares equal — which is the only reason
 * `"32:18"` matching a provider's `"16:9"` is a *match* and not a lucky guess.
 *
 * Decimals are scaled to integers before reduction (up to six places), because
 * `` `${number}:${number}` `` admits `"1.5:1"` and refusing it would be a
 * surprise the type does not warn about.
 *
 * `undefined` for anything unparseable or non-positive — callers turn that
 * into an issue with their own path and message.
 */
export function parseRatio(spelling: string): Ratio | undefined {
  const match = RATIO_SPELLING.exec(spelling);
  if (match === null) return undefined;
  let width = Number(match[1]);
  let height = Number(match[2]);
  if (!(width > 0) || !(height > 0)) return undefined;
  // Scale away the decimals so gcd has integers to work with.
  for (let i = 0; i < 6 && (!Number.isInteger(width) || !Number.isInteger(height)); i += 1) {
    width *= 10;
    height *= 10;
  }
  width = Math.round(width);
  height = Math.round(height);
  const divisor = gcd(width, height);
  return { width: width / divisor, height: height / divisor };
}

/** `{ width: 16, height: 9 }` → `"16:9"`, in whichever separator is asked for. */
export function formatRatio(ratio: Ratio, separator = ":"): string {
  return `${ratio.width}${separator}${ratio.height}`;
}

/** The numeric value of a ratio: width ÷ height. */
export function ratioValue(ratio: Ratio): number {
  return ratio.width / ratio.height;
}

/** Two ratios are the same shape when their reduced forms are identical. */
function sameRatio(a: Ratio, b: Ratio): boolean {
  return a.width === b.width && a.height === b.height;
}

/**
 * The distance between two ratios, as `|ln(a / b)|`.
 *
 * Log-space because it is symmetric: 4:3 is exactly as far from 3:4 as 3:4 is
 * from 4:3, which `|a / b − 1|` gets wrong by a factor of the ratio itself.
 * For the small drifts that matter here, `ln(1 + x) ≈ x`, so a threshold of
 * `0.02` reads as "2%" and is one within a rounding error.
 */
export function ratioDistance(a: number, b: number): number {
  return Math.abs(Math.log(a / b));
}

// ---------------------------------------------------------------------------
// S1 — ratio → the provider's closed enum
// ---------------------------------------------------------------------------

/** Options every enum-shaped derivation accepts. */
export interface EnumOptions {
  /** Docs URL, threaded into `meta.source` the way the provider tables do. */
  source?: string;
}

/**
 * **S1.** The commonest image shape: the provider takes one of a fixed list of
 * ratio strings, and the answer is that provider's own spelling of the
 * caller's ratio.
 *
 * Matching is on the **reduced** ratio, not the string, so `"16x9"`,
 * `"32:18"` and `"16:9"` all match an allowed `"16:9"` and come back as
 * `"16:9"` — the spelling the provider wants, whatever the caller typed. No
 * warning: a spelling change is not a loss.
 *
 * A ratio with no match is an **error**, never a snap to the nearest. The
 * caller asked for a shape; silently returning a different one is how a
 * portability layer earns a reputation for being unpredictable. Callers who
 * *want* nearest-match behaviour have {@link pixelsToRatio}, which warns.
 */
export function toRatioEnum(
  ratio: string,
  allowed: readonly string[],
  options: EnumOptions,
  ctx: DeriveContext,
): Derived<string> {
  const parsed = parseRatio(ratio);
  if (parsed === undefined) {
    return bad(ctx, {
      code: "invalid_shape",
      message: `\`${paramOf(ctx)}\` must be a "W:H" ratio; got ${JSON.stringify(ratio)}.`,
      meta: { value: ratio, ...(options.source !== undefined && { source: options.source }) },
    });
  }
  for (const candidate of allowed) {
    const other = parseRatio(candidate);
    if (other !== undefined && sameRatio(parsed, other)) return ok(candidate);
  }
  return bad(ctx, {
    code: "invalid_enum_value",
    message: `\`${paramOf(ctx)}\` must be one of ${list(allowed)}; got ${JSON.stringify(ratio)}.`,
    meta: {
      allowed: [...allowed],
      value: ratio,
      ...(options.source !== undefined && { source: options.source }),
    },
  });
}

// ---------------------------------------------------------------------------
// S2 — ratio + tier → a grid-snapped pixel pair
// ---------------------------------------------------------------------------

/**
 * Target pixel counts per tier.
 *
 * `1k` and `2k` are the square of the tier's own name (1024², 2048²) because
 * that is what every provider that offers "1K" actually delivers for a square
 * image. `4k` is UHD's 3840×2160 rather than 4096² — "4K" in every consumer
 * API means the video standard, and using the DCI number would make every 4K
 * request 1% larger than the caller expects for no reason anyone asked for.
 */
export const TIER_PIXELS: Readonly<Record<ResolutionTier, number>> = Object.freeze({
  "1k": 1_048_576, // 1024 × 1024
  "2k": 4_194_304, // 2048 × 2048
  "4k": 8_294_400, // 3840 × 2160
});

/** How far a snapped ratio may drift before it is worth telling the caller. */
export const RATIO_DRIFT_TOLERANCE = 0.005;

export interface PixelRules {
  /** Both dimensions must be a multiple of this. `1` for "any integer". */
  grid: number;
  /** Per-dimension floor, in pixels. */
  min?: number;
  /** Per-dimension ceiling, in pixels. */
  max?: number;
  source?: string;
}

/**
 * **S2.** Ratio + tier → `{ width, height }` on the provider's pixel grid.
 *
 * Solves `w × h = tierArea` at the requested ratio, then snaps both
 * dimensions **down** to the grid and clamps them into `[min, max]`.
 *
 * ## Why down and not nearest
 *
 * A grid is nearly always the visible half of a pixel *budget*: the provider
 * that insists on multiples of 32 also caps total pixels, and rounding a
 * 1365-px edge up to 1376 can push a request over a cap the caller never saw.
 * Rounding down cannot. The cost is up to one grid step of area, which is
 * covered by the drift warning; the cost of the other choice is a 400 nobody
 * can explain.
 *
 * So `16:9` at `1k` on a 32-px grid is 1344×768 — an exact 768 on the short
 * edge, 1365.33 floored to 1344 on the long one — and the 1.6% ratio drift
 * that produces is reported:
 *
 * > `aspectRatio` 16:9 at 1k does not land on this model's 32px grid:
 * > 1344×768 (1.750:1, requested 1.778:1).
 */
export function toPixels(
  ratio: string,
  tier: ResolutionTier,
  rules: PixelRules,
  ctx: DeriveContext,
): Derived<Dimensions> {
  const parsed = parseRatio(ratio);
  if (parsed === undefined) {
    return bad(ctx, {
      code: "invalid_shape",
      message: `\`${paramOf(ctx)}\` must be a "W:H" ratio; got ${JSON.stringify(ratio)}.`,
      meta: { value: ratio },
    });
  }
  const area = TIER_PIXELS[tier];
  const requested = ratioValue(parsed);
  const grid = Math.max(1, Math.trunc(rules.grid));

  const idealHeight = Math.sqrt(area / requested);
  const height = snap(idealHeight, grid, rules);
  const width = snap(requested * idealHeight, grid, rules);
  if (width <= 0 || height <= 0) {
    return bad(ctx, {
      code: "invalid_shape",
      message:
        `\`${paramOf(ctx)}\` ${ratio} at ${tier} does not fit this model's ` +
        `${grid}px grid within ${rules.min ?? 0}–${rules.max ?? "∞"}px per side.`,
      meta: { ratio, tier, grid, min: rules.min, max: rules.max },
    });
  }

  const achieved = width / height;
  if (ratioDistance(achieved, requested) > RATIO_DRIFT_TOLERANCE) {
    ctx.warn({
      code: "approximated_param",
      path: [...ctx.path],
      message:
        `\`${paramOf(ctx)}\` ${ratio} at ${tier} does not land on this model's ${grid}px grid: ` +
        `${width}×${height} (${achieved.toFixed(3)}:1, requested ${requested.toFixed(3)}:1).`,
      meta: {
        requested: ratio,
        width,
        height,
        requestedRatio: requested,
        achievedRatio: achieved,
        grid,
        ...(rules.source !== undefined && { source: rules.source }),
      },
    });
  }
  return ok({ width, height });
}

/**
 * Floor to the grid, then clamp — with the clamps themselves moved onto the
 * grid (`min` up, `max` down), because a bound that is not a grid multiple is
 * not a reachable value.
 *
 * `max` is applied last, so a table whose `min` exceeds its `max` yields a
 * value that respects the ceiling. That combination is a bug in the table
 * rather than in the request, and of the two ways to be wrong, "smaller than
 * the documented minimum" is a 400 you can read, while "larger than the
 * documented maximum" is the one that costs money.
 */
function snap(value: number, grid: number, rules: PixelRules): number {
  let snapped = Math.floor(value / grid) * grid;
  if (rules.min !== undefined) snapped = Math.max(snapped, Math.ceil(rules.min / grid) * grid);
  if (rules.max !== undefined) snapped = Math.min(snapped, Math.floor(rules.max / grid) * grid);
  return snapped;
}

// ---------------------------------------------------------------------------
// S3 — ratio + tier → the provider's closed size enum
// ---------------------------------------------------------------------------

/**
 * Tier → (reduced ratio → the provider's size string).
 *
 * The inner keys are canonical `"W:H"` spellings; they are re-parsed and
 * reduced on lookup, so a table may write `"16:9"` and match a caller's
 * `"32:18"`.
 */
export type SizeTable = Readonly<
  Partial<Record<ResolutionTier, Readonly<Record<string, string>>>>
>;

/**
 * **S3.** Ratio + tier → one of the provider's documented size strings
 * (`"1024x1024"`, `"1792x1024"`).
 *
 * Two ways to miss, and they are different mistakes with different fixes, so
 * they get different messages: a tier the model has no sizes for at all, and a
 * ratio that tier does not offer. Neither falls back.
 *
 * ## The row key is a label; the pixels are the truth
 *
 * A provider's size enum is *not* obliged to be honest about its own shapes.
 * DALL·E 3 documents `1792x1024` as its landscape size and everyone calls it
 * 16:9 — but 1792 ÷ 1024 is 1.750, not 1.778. A table that keys that entry
 * `"16:9"` (which it must, or a caller asking for 16:9 could not reach it) is
 * therefore promising a shape the pixels do not deliver, and a silent match
 * would break the one equivalence the whole surface rests on.
 *
 * So the chosen value is measured: if it parses as `WxH` and its real ratio
 * drifts from the requested one by more than {@link RATIO_DRIFT_TOLERANCE},
 * the difference is an `approximated_param` naming both numbers. Enum values
 * that are not pixel pairs (`"1K"`, `"square_hd"`) carry no measurable ratio
 * and are matched on their key alone, as before.
 */
export function toSizeEnum(
  ratio: string,
  tier: ResolutionTier,
  table: SizeTable,
  ctx: DeriveContext,
): Derived<string> {
  const tiers = Object.keys(table) as ResolutionTier[];
  const row = table[tier];
  if (row === undefined) {
    return bad(ctx, {
      code: "invalid_enum_value",
      message: `\`resolution\` must be one of ${list(tiers)} for this model; got ${JSON.stringify(tier)}.`,
      meta: { allowed: tiers, value: tier },
    });
  }
  const parsed = parseRatio(ratio);
  if (parsed === undefined) {
    return bad(ctx, {
      code: "invalid_shape",
      message: `\`${paramOf(ctx)}\` must be a "W:H" ratio; got ${JSON.stringify(ratio)}.`,
      meta: { value: ratio },
    });
  }
  for (const [key, size] of Object.entries(row)) {
    const candidate = parseRatio(key);
    if (candidate === undefined || !sameRatio(parsed, candidate)) continue;
    warnSizeDrift(size, ratioValue(parsed), ratio, tier, ctx);
    return ok(size);
  }
  const offered = Object.keys(row);
  return bad(ctx, {
    code: "invalid_enum_value",
    message:
      `\`${paramOf(ctx)}\` must be one of ${list(offered)} at ${tier} for this model; ` +
      `got ${JSON.stringify(ratio)}.`,
    meta: { allowed: offered, value: ratio, tier },
  });
}

const PIXEL_PAIR = /^(\d+)\s*[x×*]\s*(\d+)$/i;

/**
 * Warns when a size enum's pixels are a different shape from the ratio its row
 * is keyed by — the DALL·E 3 `1792x1024` case explained on {@link toSizeEnum}.
 *
 * Silent for values that are not pixel pairs, and silent inside the tolerance:
 * a table is allowed to round, it is not allowed to round *invisibly*.
 */
function warnSizeDrift(
  size: string,
  requested: number,
  spelling: string,
  tier: ResolutionTier,
  ctx: DeriveContext,
): void {
  const match = PIXEL_PAIR.exec(size);
  if (match === null) return;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0) || !(height > 0)) return;
  const achieved = width / height;
  if (ratioDistance(achieved, requested) <= RATIO_DRIFT_TOLERANCE) return;
  ctx.warn({
    code: "approximated_param",
    path: [...ctx.path],
    message:
      `\`${paramOf(ctx)}\` ${spelling} at ${tier} has no exact size on this model: ` +
      `${JSON.stringify(size)} was sent, which is ${achieved.toFixed(3)}:1 ` +
      `(requested ${requested.toFixed(3)}:1).`,
    meta: {
      requested: spelling,
      achieved: size,
      width,
      height,
      requestedRatio: requested,
      achievedRatio: achieved,
      tier,
    },
  });
}

// ---------------------------------------------------------------------------
// S4 — ratio + tier → a free-form "WxH" string
// ---------------------------------------------------------------------------

export interface FreeformRules extends PixelRules {
  /** What goes between the numbers. `"x"` almost everywhere; `"*"` at a few. */
  separator?: string;
}

/**
 * **S4.** The providers that take an arbitrary `"1344x768"` rather than an
 * enum. {@link toPixels} does the arithmetic — including the drift warning —
 * and this only formats, so the two shapes cannot disagree about what 16:9 at
 * 1k is.
 */
export function toSizeFreeform(
  ratio: string,
  tier: ResolutionTier,
  rules: FreeformRules,
  ctx: DeriveContext,
): Derived<string> {
  const pixels = toPixels(ratio, tier, rules, ctx);
  if (pixels.value === undefined) return { issues: pixels.issues };
  return ok(`${pixels.value.width}${rules.separator ?? "x"}${pixels.value.height}`);
}

// ---------------------------------------------------------------------------
// S5 — ratio → an open ratio string with numeric bounds
// ---------------------------------------------------------------------------

export interface RatioStringRules {
  /** Lowest `width / height` the provider accepts. */
  min?: number;
  /** Highest `width / height` the provider accepts. */
  max?: number;
  separator?: string;
  source?: string;
}

/**
 * **S5.** The providers that take any `"W:H"` within a range rather than a
 * list. No approximation is possible or needed — the ratio either fits the
 * range or it does not — so this either returns a spelling or errors, and
 * never warns.
 *
 * The spelling is the **reduced** one: `"21:9"` goes out as `"7:3"` and
 * `"1920:1080"` as `"16:9"`. One spelling per shape, so the bounds check and
 * the provider are looking at the same number and two callers who meant the
 * same thing send the same body. A provider that documents *particular*
 * spellings has an enum whether or not its schema says so, and belongs in
 * {@link toRatioEnum} — which returns that provider's own spelling verbatim.
 */
/**
 * A ratio bound, rendered the way the value beside it is.
 *
 * The bounds are stored as the numbers they are — `9 / 21` and `21 / 9`, so the
 * comparison is exact at the boundary the provider itself accepts — and a raw
 * `0.42857142857142855` in an error message is noise that makes a real limit
 * look like a bug. Three decimals, matching the `toFixed(3)` the message uses
 * for the value being rejected.
 */
function bound(value: number | undefined, fallback: number | string): number | string {
  return value === undefined ? fallback : Number(value.toFixed(3));
}

export function toRatioString(
  ratio: string,
  rules: RatioStringRules,
  ctx: DeriveContext,
): Derived<string> {
  const parsed = parseRatio(ratio);
  if (parsed === undefined) {
    return bad(ctx, {
      code: "invalid_shape",
      message: `\`${paramOf(ctx)}\` must be a "W:H" ratio; got ${JSON.stringify(ratio)}.`,
      meta: { value: ratio },
    });
  }
  const value = ratioValue(parsed);
  if ((rules.min !== undefined && value < rules.min) || (rules.max !== undefined && value > rules.max)) {
    return bad(ctx, {
      code: "invalid_shape",
      message:
        `\`${paramOf(ctx)}\` must be between ${bound(rules.min, 0)} and ${bound(rules.max, "∞")} ` +
        `(width ÷ height); ${ratio} is ${value.toFixed(3)}.`,
      meta: {
        min: rules.min,
        max: rules.max,
        value,
        ratio,
        ...(rules.source !== undefined && { source: rules.source }),
      },
    });
  }
  return ok(formatRatio(parsed, rules.separator ?? ":"));
}

// ---------------------------------------------------------------------------
// S6 — tier → whatever the provider calls that tier
// ---------------------------------------------------------------------------

/**
 * **S6.** Tier → the provider's own name for it (`"1K"`, `1024`, `"hd"`).
 *
 * A missing tier is an `invalid_enum_value` naming the tiers that exist, and
 * **never** a downgrade to the next one down. Silently serving 1k for a 4k
 * request is the single most expensive kind of quiet approximation there is:
 * it is invisible in the response, it is invisible in the warnings, and the
 * caller finds out when someone looks at the output.
 */
export function toTier<T>(
  tier: ResolutionTier,
  table: Readonly<Partial<Record<ResolutionTier, T>>>,
  ctx: DeriveContext,
): Derived<T> {
  const value = table[tier];
  if (value === undefined) {
    const offered = Object.keys(table);
    return bad(ctx, {
      code: "invalid_enum_value",
      message: `\`${paramOf(ctx)}\` must be one of ${list(offered)} for this model; got ${JSON.stringify(tier)}.`,
      meta: { allowed: offered, value: tier },
    });
  }
  return ok(value);
}

// ---------------------------------------------------------------------------
// Pixels → ratio, the lossy direction
// ---------------------------------------------------------------------------

/**
 * `{ width: 1000, height: 600 }` → `"5:3"` for a provider that takes only a
 * shape.
 *
 * **Always warns**, even on an exact match, and that is the point: a ratio
 * cannot carry a pixel count, so a caller who asked for 1000×600 and got a
 * shape has lost something no matter how well the shape matched. Suppressing
 * the warning for the exact-ratio case would break the equivalence the whole
 * surface rests on — zero warnings has to mean the request mapped exactly, and
 * this one never does.
 *
 * With `allowed`, the nearest entry within {@link RATIO_MATCH_TOLERANCE} (in
 * log space — see {@link ratioDistance}) is chosen; beyond it the pixels are
 * `unsupported_param`, because a 3%-off shape is a different shape.
 */
export const RATIO_MATCH_TOLERANCE = 0.02;

export function pixelsToRatio(
  width: number,
  height: number,
  allowed: readonly string[] | undefined,
  ctx: DeriveContext,
): Derived<string> {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return bad(ctx, {
      code: "invalid_shape",
      message: `\`${paramOf(ctx)}\` must be positive pixel dimensions; got ${width}×${height}.`,
      meta: { width, height },
    });
  }
  const requested = width / height;
  const reduced = parseRatio(`${width}:${height}`);
  // `width`/`height` are finite positives, so the parse cannot fail; the guard
  // keeps the type honest without a cast.
  const exact = reduced === undefined ? `${width}:${height}` : formatRatio(reduced);

  if (allowed === undefined) {
    ctx.warn({
      code: "approximated_param",
      path: [...ctx.path],
      message:
        `\`${paramOf(ctx)}\` ${width}×${height} was sent as the aspect ratio ${exact} — ` +
        `this model takes a shape, not a pixel size, so the exact dimensions are not expressible.`,
      meta: { width, height, ratio: exact },
    });
    return ok(exact);
  }

  let best: { spelling: string; distance: number; value: number } | undefined;
  for (const candidate of allowed) {
    const parsed = parseRatio(candidate);
    if (parsed === undefined) continue;
    const distance = ratioDistance(ratioValue(parsed), requested);
    if (best === undefined || distance < best.distance) {
      best = { spelling: candidate, distance, value: ratioValue(parsed) };
    }
  }
  if (best === undefined || best.distance > RATIO_MATCH_TOLERANCE) {
    return bad(ctx, {
      code: "unsupported_param",
      message:
        `\`${paramOf(ctx)}\` ${width}×${height} (${exact}) has no equivalent on this model, ` +
        `which accepts ${list(allowed)}${best === undefined ? "" : `; the nearest, ${JSON.stringify(best.spelling)}, is ${(best.distance * 100).toFixed(1)}% away`}.`,
      meta: {
        width,
        height,
        ratio: exact,
        allowed: [...allowed],
        ...(best !== undefined && { nearest: best.spelling, distance: best.distance }),
      },
    });
  }
  ctx.warn({
    code: "approximated_param",
    path: [...ctx.path],
    message:
      best.distance === 0
        ? `\`${paramOf(ctx)}\` ${width}×${height} was sent as the aspect ratio ${JSON.stringify(best.spelling)} — ` +
          `this model takes a shape, not a pixel size, so the exact dimensions are not expressible.`
        : `\`${paramOf(ctx)}\` ${width}×${height} (${exact}) was sent as the nearest shape this model offers, ` +
          `${JSON.stringify(best.spelling)} (${(best.distance * 100).toFixed(1)}% away); the exact dimensions are not expressible.`,
    meta: {
      width,
      height,
      ratio: exact,
      chosen: best.spelling,
      distance: best.distance,
    },
  });
  return ok(best.spelling);
}

// ---------------------------------------------------------------------------
// aspectRatio XOR dimensions
// ---------------------------------------------------------------------------

/** Which of the two spellings of size the caller used. */
export type Sizing =
  | { kind: "ratio"; aspectRatio: AspectRatio }
  | { kind: "dimensions"; dimensions: Dimensions }
  | { kind: "unset" };

/**
 * Reads the size decision off a request.
 *
 * The type already makes `{ aspectRatio, dimensions }` a compile error; this
 * is the runtime half, for JavaScript callers and anyone who casts. Reported
 * as `invalid_shape` at the root of the pair, because the fault is the
 * *combination* — pointing at either field alone would suggest deleting the
 * wrong one.
 */
export function resolveSizing(
  input: { aspectRatio?: AspectRatio; dimensions?: Dimensions },
  ctx: DeriveContext,
): Derived<Sizing> {
  const hasRatio = input.aspectRatio !== undefined;
  const hasDimensions = input.dimensions !== undefined;
  if (hasRatio && hasDimensions) {
    return bad(ctx, {
      code: "invalid_shape",
      message:
        "`aspectRatio` and `dimensions` are two spellings of one decision; supply exactly one. " +
        "Use `dimensions` when the pixel size matters and `aspectRatio` when only the shape does.",
      meta: { aspectRatio: input.aspectRatio, dimensions: input.dimensions },
    });
  }
  if (hasRatio) return ok({ kind: "ratio", aspectRatio: input.aspectRatio as AspectRatio });
  if (hasDimensions) return ok({ kind: "dimensions", dimensions: input.dimensions as Dimensions });
  return ok({ kind: "unset" });
}

/**
 * The answer to `dimensions` **and** `resolution`, at a provider whose size
 * field takes pixels.
 *
 * The two are not the XOR pair — that is `aspectRatio` versus `dimensions`, and
 * {@link resolveSizing} owns it. This is the other overlap, and whether it is a
 * conflict depends entirely on what the provider's size vocabulary is:
 *
 * - At a provider that takes a **shape** (`aspect_ratio` + a tier name), the two
 *   are complementary: the pixels supply the shape, the tier supplies the size,
 *   and both are used. Nothing to reject.
 * - At a provider that takes **pixels**, `dimensions` has already said
 *   everything a tier could say, and the two can disagree — 1024×1024 with
 *   `resolution: "4k"` is a request with two different answers in it.
 *
 * Only the second kind calls this. Ignoring the tier there is the exact failure
 * the loss contract exists to prevent: a caller who wrote `4k` and got 1 MP has
 * no warning, no error, and no way to find out except by looking at the output.
 */
export function redundantTier(tier: ResolutionTier, ctx: DeriveContext): Derived<never> {
  return bad(ctx, {
    code: "invalid_shape",
    message:
      `\`resolution\` ${JSON.stringify(tier)} has nothing to add beside \`dimensions\` on this ` +
      "model, whose size field takes pixels — the pixel count is already fixed, and the two can " +
      "disagree. Drop `resolution`, or use `aspectRatio` to size by tier instead.",
    meta: { value: tier },
  });
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

function checkDuration(
  seconds: number,
  allowed: readonly number[] | undefined,
  ctx: DeriveContext,
): CompileIssue[] {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return bad(ctx, {
      code: "invalid_shape",
      message: `\`${paramOf(ctx)}\` must be a positive number of seconds; got ${JSON.stringify(seconds)}.`,
      meta: { value: seconds },
    }).issues;
  }
  if (allowed !== undefined) {
    if (allowed.includes(seconds)) return [];
    return bad(ctx, {
      code: "invalid_enum_value",
      message: `\`${paramOf(ctx)}\` must be one of ${list(allowed)} seconds for this model; got ${seconds}.`,
      meta: { allowed: [...allowed], value: seconds },
    }).issues;
  }
  if (!Number.isInteger(seconds)) {
    return bad(ctx, {
      code: "invalid_shape",
      message: `\`${paramOf(ctx)}\` must be a whole number of seconds for this model; got ${seconds}.`,
      meta: { value: seconds },
    }).issues;
  }
  return [];
}

/**
 * Duration as a **number** of seconds — the plainest encoding, and the one
 * that needs the least explanation when it fails.
 *
 * With `allowed`, only those exact values pass and a miss is an
 * `invalid_enum_value` listing them (`4, 8, 12` for Sora). Without it, any
 * whole number does and a fraction is an `invalid_shape` — a provider that
 * documents an integer field will reject `7.5` at the API, so rejecting it
 * here costs a round trip less.
 *
 * Note the ordering: `allowed` is checked *first*, so a model that genuinely
 * offers `2.5` seconds is not rejected by the integer rule for a fractional
 * value it explicitly lists.
 */
export function toDurationNumber(
  seconds: number,
  allowed: readonly number[] | undefined,
  ctx: DeriveContext,
): Derived<number> {
  const issues = checkDuration(seconds, allowed, ctx);
  return issues.length > 0 ? { issues } : ok(seconds);
}

/** The same, as a bare string: `8` → `"8"`. */
export function toDurationString(
  seconds: number,
  allowed: readonly number[] | undefined,
  ctx: DeriveContext,
): Derived<string> {
  const issues = checkDuration(seconds, allowed, ctx);
  return issues.length > 0 ? { issues } : ok(String(seconds));
}

/** And with the unit glued on: `5` → `"5s"` (Luma, Runway). */
export function toDurationSuffixedString(
  seconds: number,
  allowed: readonly number[] | undefined,
  ctx: DeriveContext,
  suffix = "s",
): Derived<string> {
  const issues = checkDuration(seconds, allowed, ctx);
  return issues.length > 0 ? { issues } : ok(`${seconds}${suffix}`);
}

// ---------------------------------------------------------------------------
// Audio formats
// ---------------------------------------------------------------------------

/**
 * The container a codec ends up in when the caller did not say.
 *
 * These are canonical defaults, not provider defaults: they answer "what does
 * an `.opus` file usually mean" (Ogg), not "what does this API return". A
 * provider that disagrees declares it in its {@link AudioFormatSpec}, and
 * filling *that* in is what warns.
 */
export const DEFAULT_CONTAINER: Readonly<Record<AudioFormatCodec, AudioContainer>> = Object.freeze({
  mp3: "mp3",
  aac: "aac",
  flac: "flac",
  opus: "ogg",
  vorbis: "ogg",
  pcm_s16le: "wav",
  pcm_s24le: "wav",
  pcm_s32le: "wav",
  pcm_f32le: "wav",
  pcm_mulaw: "wav",
  pcm_alaw: "wav",
});

/**
 * `"mp3"` → `{ format: "mp3", container: "mp3" }`; an object passes through
 * with only its container filled.
 *
 * Pure: no issues, no warnings. Filling a *container* is not an approximation
 * — `"opus"` unqualified means Ogg Opus to everybody — whereas inventing a
 * sample rate or a bitrate is, and that happens in
 * {@link resolveAudioFormat} where it can be warned about.
 */
export function normalizeAudioFormat(request: AudioFormatRequest): AudioFormat {
  const base: AudioFormat = typeof request === "string" ? { format: request } : { ...request };
  return { ...base, container: base.container ?? DEFAULT_CONTAINER[base.format] };
}

/**
 * `128000` → `128`.
 *
 * Errors on anything that is not a whole number of kbps rather than rounding,
 * because a bitrate that "nearly" matches a provider's enum is a bitrate the
 * provider rejects — and a silent round here would hide which of the two
 * numbers was wrong.
 */
export function bitsToKbps(bits: number, ctx: DeriveContext): Derived<number> {
  if (!Number.isFinite(bits) || bits <= 0) {
    return bad(ctx, {
      code: "invalid_shape",
      message: `\`${paramOf(ctx)}\` must be a positive bitrate in bits per second; got ${JSON.stringify(bits)}.`,
      meta: { value: bits },
    });
  }
  if (bits % 1000 !== 0) {
    return bad(ctx, {
      code: "invalid_shape",
      message:
        `\`${paramOf(ctx)}\` is ${bits} bits/s, which is not a whole number of kbps ` +
        `(${bits / 1000}); this model's field is in kbps. Use a multiple of 1000.`,
      meta: { value: bits, kbps: bits / 1000 },
    });
  }
  return ok(bits / 1000);
}

/**
 * A numeric field of {@link AudioFormat} an endpoint may require or default.
 *
 * `container` is deliberately not here: {@link normalizeAudioFormat} always
 * supplies one, so it can never be *absent* — only unavailable, which is a
 * different check with a different answer (see {@link resolveAudioFormat}).
 */
export type AudioFormatField = "sampleRate" | "bitrate";

/**
 * What one endpoint can encode — declared as data so the same resolver serves
 * every *placement*.
 *
 * Placement is the part that varies wildly and the part this deliberately says
 * nothing about: one provider takes `"mp3_44100_128"` as a single enum,
 * another `encoding` + `sample_rate` + `bit_rate` as three fields, a third a
 * `container` query param with the codec in the path. All three describe the
 * same *capability*, so all three write the same spec here and assemble the
 * {@link ResolvedAudioFormat} into their own shape afterwards.
 */
export interface AudioFormatSpec {
  /** Canonical codec → this endpoint's spelling of it. Absent = not offered. */
  codecs: Readonly<Partial<Record<AudioFormatCodec, string>>>;
  /**
   * Containers accepted per codec, **in preference order**. Omit a codec to
   * accept whatever container the canonical default supplies.
   *
   * Order matters because the first entry is what a caller who never mentioned
   * a container gets when the canonical default is not on the list.
   */
  containers?: Readonly<Partial<Record<AudioFormatCodec, readonly AudioContainer[]>>>;
  /** Sample rates in Hz, per codec. Omit to accept any. */
  sampleRates?: Readonly<Partial<Record<AudioFormatCodec, readonly number[]>>>;
  /** Bitrates in **bits per second**, per codec. Omit to accept any. */
  bitrates?: Readonly<Partial<Record<AudioFormatCodec, readonly number[]>>>;
  /**
   * Fields this endpoint has **no field for at all** — either endpoint-wide
   * (`["sampleRate", "bitrate"]` for an API whose format param is a bare
   * codec) or per codec (Deepgram fixes mp3 at 22050 Hz and has no bitrate for
   * linear16).
   *
   * Setting one is an `unsupported_param` **error**, never a silent drop: a
   * caller who asked for 48 kHz and got whatever the provider felt like has
   * been lied to, and the whole surface rests on that not happening. It is
   * separate from an empty `sampleRates` list because the two are different
   * facts with different fixes — "this model offers other rates" versus "this
   * model does not let you choose".
   */
  unavailable?:
    | readonly AudioFormatField[]
    | Readonly<Partial<Record<AudioFormatCodec, readonly AudioFormatField[]>>>;
  /**
   * Fields the wire format requires and the provider documents no default
   * for. Absent from the request → `invalid_shape`, because there is nothing
   * honest to invent.
   */
  required?: readonly AudioFormatField[];
  /**
   * Fields the provider documents a default for. Filling one in is a real
   * choice made on the caller's behalf, so it warns `approximated_param`
   * naming the value used — which is the difference between a request you can
   * reproduce and one you cannot.
   */
  defaults?: AudioFormatDefaults;
  /**
   * Per-codec overrides of {@link defaults}, merged over it.
   *
   * For the endpoints whose documented default genuinely depends on the codec:
   * ElevenLabs defaults to `mp3_44100_128`, but its Opus is published at 48 kHz
   * only, so filling 44100 there would invent a value the API rejects.
   */
  defaultsByCodec?: Readonly<Partial<Record<AudioFormatCodec, AudioFormatDefaults>>>;
  source?: string;
}

/** The two numeric halves of an encoding an endpoint may document a default for. */
export interface AudioFormatDefaults {
  /** Hz. */
  sampleRate?: number;
  /** Bits per second. */
  bitrate?: number;
}

/** An encoding this endpoint can actually produce, ready to be placed. */
export interface ResolvedAudioFormat {
  codec: AudioFormatCodec;
  /** The endpoint's own spelling of the codec. */
  wire: string;
  container?: AudioContainer;
  /** Hz. */
  sampleRate?: number;
  /** Bits per second. */
  bitrate?: number;
}

/**
 * Canonical audio format + one endpoint's capability → the encoding to send.
 *
 * Four checks, in the order a caller would want to hear about them: the codec
 * exists here, the container is one this codec is offered in, the rate is
 * offered, the bitrate is offered. Then the gaps: required-and-absent is an
 * error, documented-default-and-absent is a filled value and a warning.
 */
export function resolveAudioFormat(
  request: AudioFormatRequest,
  spec: AudioFormatSpec,
  ctx: DeriveContext,
): Derived<ResolvedAudioFormat> {
  const format = normalizeAudioFormat(request);
  const wire = spec.codecs[format.format];
  if (wire === undefined) {
    const offered = Object.keys(spec.codecs);
    return bad(ctx, {
      code: "invalid_enum_value",
      message:
        `\`${paramOf(ctx)}\` codec ${JSON.stringify(format.format)} is not encoded by this model, ` +
        `which offers ${list(offered)}.`,
      meta: {
        allowed: offered,
        value: format.format,
        ...(spec.source !== undefined && { source: spec.source }),
      },
    });
  }

  const issues: CompileIssue[] = [];
  const codec = format.format;
  const resolved: ResolvedAudioFormat = { codec, wire };

  // The container the caller actually typed, as distinct from the canonical
  // default `normalizeAudioFormat` supplies. The difference decides whether an
  // unavailable container is the caller's problem (an error) or ours (a
  // substitution, which warns).
  const asked = typeof request === "string" ? undefined : request.container;
  const containers = spec.containers?.[codec];
  if (containers === undefined) {
    resolved.container = format.container;
  } else if (asked !== undefined && !containers.includes(asked)) {
    issues.push(
      ...bad(ctx, {
        code: "invalid_enum_value",
        message:
          `\`${paramOf(ctx)}\` container ${JSON.stringify(asked)} is not available for ` +
          `${JSON.stringify(codec)} on this model, which offers ${list(containers)}.`,
        meta: { allowed: [...containers], value: asked, codec },
      }).issues,
    );
  } else if (asked !== undefined) {
    resolved.container = asked;
  } else if (format.container !== undefined && containers.includes(format.container)) {
    resolved.container = format.container;
  } else {
    // The canonical default (`opus` → Ogg) is not what this model serves.
    // Substituting is right — the caller named a codec, not a wrapper — but it
    // is a substitution, so it is on the record.
    const substitute = containers[0];
    resolved.container = substitute;
    ctx.warn({
      code: "approximated_param",
      path: [...ctx.path],
      message:
        `\`${paramOf(ctx)}\` ${JSON.stringify(codec)} normally means a ${format.container} container; ` +
        `this model serves it in ${JSON.stringify(substitute)}, which is what was sent.`,
      meta: {
        codec,
        requested: format.container,
        achieved: substitute,
        ...(spec.source !== undefined && { source: spec.source }),
      },
    });
  }

  // The fields this endpoint has no home for. Checked before `fill`, because a
  // field that cannot be sent must not also be defaulted or demanded.
  const missing = unavailableFields(spec, codec);
  for (const field of missing) {
    if (format[field] === undefined) continue;
    issues.push(
      ...bad(ctx, {
        code: "unsupported_param",
        message:
          `\`${paramOf(ctx)}.${field}\` is not configurable on this model — it publishes no ` +
          `${field === "sampleRate" ? "sample-rate" : "bitrate"} field for ${JSON.stringify(codec)}, ` +
          `so the value could only be dropped.`,
        meta: {
          field,
          codec,
          value: format[field],
          ...(spec.source !== undefined && { source: spec.source }),
        },
      }).issues,
    );
  }

  const defaults: AudioFormatDefaults = { ...spec.defaults, ...spec.defaultsByCodec?.[codec] };

  if (!missing.includes("sampleRate")) {
    const rate = fill(
      { field: "sampleRate", unit: "Hz", value: format.sampleRate, codec, spec, ctx, issues },
      spec.sampleRates?.[codec],
      defaults.sampleRate,
    );
    if (rate !== undefined) resolved.sampleRate = rate;
  }

  if (!missing.includes("bitrate")) {
    const bitrate = fill(
      { field: "bitrate", unit: "bits/s", value: format.bitrate, codec, spec, ctx, issues },
      spec.bitrates?.[codec],
      defaults.bitrate,
    );
    if (bitrate !== undefined) resolved.bitrate = bitrate;
  }

  return issues.length > 0 ? { issues } : ok(resolved);
}

const NO_FIELDS: readonly AudioFormatField[] = Object.freeze([]);

/** {@link AudioFormatSpec.unavailable}, in either spelling, for one codec. */
function unavailableFields(
  spec: AudioFormatSpec,
  codec: AudioFormatCodec,
): readonly AudioFormatField[] {
  const declared = spec.unavailable;
  if (declared === undefined) return NO_FIELDS;
  if (Array.isArray(declared)) return declared as readonly AudioFormatField[];
  return (
    (declared as Readonly<Partial<Record<AudioFormatCodec, readonly AudioFormatField[]>>>)[codec] ??
    NO_FIELDS
  );
}

interface FillRequest {
  field: AudioFormatField;
  /** For the message: `"Hz"` / `"bits/s"`. */
  unit: string;
  value: number | undefined;
  codec: AudioFormatCodec;
  spec: AudioFormatSpec;
  ctx: DeriveContext;
  issues: CompileIssue[];
}

/**
 * One numeric field of an audio format: validate what was given, or invent
 * what the docs promise and say so, or refuse when there is nothing to invent.
 */
function fill(
  request: FillRequest,
  allowed: readonly number[] | undefined,
  documented: number | undefined,
): number | undefined {
  const { field, unit, value, codec, spec, ctx, issues } = request;
  const name = `${paramOf(ctx)}.${field}`;
  if (value !== undefined) {
    if (allowed !== undefined && !allowed.includes(value)) {
      issues.push(
        ...bad(ctx, {
          code: "invalid_enum_value",
          message:
            `\`${name}\` must be one of ${list(allowed)} ${unit} for ` +
            `${JSON.stringify(codec)} on this model; got ${value}.`,
          meta: { allowed: [...allowed], value, codec, field },
        }).issues,
      );
      return undefined;
    }
    return value;
  }
  if (documented !== undefined) {
    ctx.warn({
      code: "approximated_param",
      path: [...ctx.path],
      message:
        `\`${name}\` was not set, so this model's documented default of ${documented} ${unit} ` +
        `was sent — the request is only reproducible for as long as that default holds.`,
      meta: {
        field,
        value: documented,
        codec,
        ...(spec.source !== undefined && { source: spec.source }),
      },
    });
    return documented;
  }
  if (spec.required?.includes(field) === true) {
    issues.push(
      ...bad(ctx, {
        code: "invalid_shape",
        message:
          `\`${name}\` is required by this model and it documents no default. ` +
          `Set it explicitly${allowed === undefined ? "" : ` — one of ${list(allowed)} ${unit}`}.`,
        meta: { field, codec, ...(allowed !== undefined && { allowed: [...allowed] }) },
      }).issues,
    );
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Speed
// ---------------------------------------------------------------------------

export interface SpeedRules {
  min?: number;
  max?: number;
  source?: string;
}

/**
 * The identity mapping, with the provider's bounds enforced.
 *
 * Most TTS APIs take the same multiplier the vocabulary uses, so most adapters
 * need exactly this — and they need it to be a *function*, because "check the
 * bounds" is the step that gets skipped when it is a rename.
 */
export function toSpeed(speed: number, rules: SpeedRules, ctx: DeriveContext): Derived<number> {
  const issue = outOfSpeedRange(speed, rules, ctx);
  return issue ?? ok(speed);
}

/**
 * `1 / speed` — for the providers whose field is a **time** scale rather than
 * a rate (Rime's `speedAlpha` and `timeScaleFactor`, where 0.5 means twice as
 * fast).
 *
 * Exact, and therefore silent: the reciprocal loses nothing, and warning about
 * a lossless conversion would dilute the warnings that matter.
 *
 * `rules.min` / `rules.max` are in **canonical** speed units, like every other
 * function here — an adapter whose docs say "`speedAlpha` 0.5–2.0" writes
 * `{ min: 0.5, max: 2 }` after taking the reciprocals of *both* bounds and
 * swapping them, which is a one-line edit in its table and keeps every message
 * in this file quoting the number the caller typed.
 */
export function invertSpeed(speed: number, rules: SpeedRules, ctx: DeriveContext): Derived<number> {
  const issue = outOfSpeedRange(speed, rules, ctx);
  return issue ?? ok(1 / speed);
}

/** Murf's `rate` range, as a speed multiplier: −50…+50 percent. */
export const PERCENT_DELTA_SPEED_MIN = 0.5;
export const PERCENT_DELTA_SPEED_MAX = 1.5;

export interface PercentDeltaRules extends SpeedRules {
  /** Percent per unit of the wire field. `100` — the default — means percent. */
  scale?: number;
}

/**
 * `1.25` → `25`: a signed percentage away from normal, which is how Murf's
 * `rate` (and a couple of others) spell speed.
 *
 * Integral, so it is the one speed encoding that genuinely loses precision:
 * `1.234` becomes `23`, i.e. 1.23×. That rounding is an `approximated_param`
 * naming the speed actually achieved, because the difference between "you
 * asked for 1.234" and "you got 1.23" is exactly the kind of thing a caller
 * comparing two providers' output needs to know.
 *
 * Values outside 0.5–1.5 are an error, not a clamp. A clamp would turn "twice
 * as fast" into "1.5× as fast" and say nothing.
 */
export function toSpeedPercentDelta(
  speed: number,
  rules: PercentDeltaRules,
  ctx: DeriveContext,
): Derived<number> {
  const min = rules.min ?? PERCENT_DELTA_SPEED_MIN;
  const max = rules.max ?? PERCENT_DELTA_SPEED_MAX;
  const issue = outOfSpeedRange(speed, { ...rules, min, max }, ctx);
  if (issue !== undefined) return issue;
  const scale = rules.scale ?? 100;
  const delta = Math.round((speed - 1) * scale);
  const achieved = 1 + delta / scale;
  if (achieved !== speed) {
    ctx.warn({
      code: "approximated_param",
      path: [...ctx.path],
      message:
        `\`${paramOf(ctx)}\` ${speed} is not representable on this model, whose speed field is a ` +
        `whole percentage away from normal; ${delta} was sent, i.e. ${achieved}×.`,
      meta: {
        requested: speed,
        achieved,
        wire: delta,
        ...(rules.source !== undefined && { source: rules.source }),
      },
    });
  }
  return ok(delta);
}

/**
 * {@link toSpeedPercentDelta} at Murf's documented bounds — the endpoint the
 * shape is named for, so an adapter reads as what it is rather than as a
 * configuration exercise.
 */
export function murfSpeed(speed: number, ctx: DeriveContext): Derived<number> {
  return toSpeedPercentDelta(speed, {}, ctx);
}

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

/** The two things a provider's voice field can be. */
export type VoiceSpelling = "id" | "name";

/** One endpoint's answer to "what is a voice here". */
export interface VoiceRules {
  /**
   * The spellings this endpoint's voice field accepts, **in preference
   * order** — the first entry is what a bare string means here.
   *
   * Most APIs take an opaque id (`voice_id`, `voice_uuid`, `reference_id`); a
   * few take a catalog name (Rime's `speaker`); OpenAI and Hume take both, and
   * cannot tell which you meant from the shape of a string, which is the whole
   * reason {@link Voice} has three arms.
   */
  accepts: readonly VoiceSpelling[];
  source?: string;
}

/** A voice this endpoint can actually address. */
export interface ResolvedVoice {
  kind: VoiceSpelling;
  value: string;
}

/**
 * Canonical {@link Voice} + one endpoint's spelling → the voice to send.
 *
 * The wrong wrapper is an **error**, not a coercion: `{ name: "Kore" }` at an
 * API whose field is a UUID is not a voice it can look up, and sending the
 * string anyway would produce a 404 the caller cannot connect to what they
 * wrote. A bare string is never wrong — it is defined as "whichever spelling
 * this provider takes", which is `accepts[0]`.
 */
export function resolveVoice(
  voice: Voice,
  rules: VoiceRules,
  ctx: DeriveContext,
): Derived<ResolvedVoice> {
  const spellings = rules.accepts.length > 0 ? rules.accepts : (["id"] as const);
  const bare = spellings[0] as VoiceSpelling;
  const empty = (): Derived<never> =>
    bad(ctx, {
      code: "invalid_shape",
      message: `\`${paramOf(ctx)}\` must be a non-empty voice ${bare}.`,
      meta: { value: voice, ...(rules.source !== undefined && { source: rules.source }) },
    });

  if (typeof voice === "string") {
    return voice.length === 0 ? empty() : ok({ kind: bare, value: voice });
  }
  if (voice === null || typeof voice !== "object") {
    return bad(ctx, {
      code: "invalid_shape",
      message: `\`${paramOf(ctx)}\` must be a voice ${bare}, \`{ id }\` or \`{ name }\`; got ${JSON.stringify(voice)}.`,
      meta: { value: voice },
    });
  }
  const kind: VoiceSpelling = "id" in voice ? "id" : "name";
  const value = kind === "id" ? (voice as { id: unknown }).id : (voice as { name: unknown }).name;
  if (typeof value !== "string") {
    return bad(ctx, {
      code: "invalid_shape",
      message: `\`${paramOf(ctx)}.${kind}\` must be a string; got ${JSON.stringify(value)}.`,
      meta: { value },
    });
  }
  if (value.length === 0) return empty();
  if (!spellings.includes(kind)) {
    return bad(ctx, {
      code: "invalid_shape",
      message:
        `\`${paramOf(ctx)}\` on this model is a voice ${spellings.join(" or ")}, so ` +
        `\`{ ${kind} }\` has no equivalent here — pass the ${bare} instead ` +
        `(a bare string is read as one).`,
      meta: {
        accepts: [...spellings],
        got: kind,
        value,
        ...(rules.source !== undefined && { source: rules.source }),
      },
    });
  }
  return ok({ kind, value });
}

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

// The underscore spelling (`pt_BR`) is not BCP-47, but it is what half the
// world's locale plumbing emits, and refusing it would be a purity nobody
// benefits from — the primary subtag is unambiguous either way.
const LANGUAGE_TAG = /^([A-Za-z]{2,3})(?:[-_]([A-Za-z0-9_-]+))?$/;

/**
 * BCP-47 → the primary subtag, for the endpoints whose language field is a
 * bare ISO 639-1 code.
 *
 * **Warns whenever a subtag is dropped.** `"pt-BR"` and `"pt-PT"` are not the
 * same request, and an API that only takes `"pt"` cannot tell them apart — so
 * a caller who asked for Brazilian Portuguese and got Portuguese needs to hear
 * about it exactly once, here, rather than in the audio.
 */
export function toPrimaryLanguage(
  language: string,
  ctx: DeriveContext,
  options: EnumOptions = {},
): Derived<string> {
  const match = LANGUAGE_TAG.exec(language.trim());
  if (match === null) {
    return bad(ctx, {
      code: "invalid_shape",
      message: `\`${paramOf(ctx)}\` must be a BCP-47 language tag (e.g. "en", "pt-BR"); got ${JSON.stringify(language)}.`,
      meta: { value: language, ...(options.source !== undefined && { source: options.source }) },
    });
  }
  const primary = (match[1] as string).toLowerCase();
  const subtag = match[2];
  if (subtag !== undefined) {
    ctx.warn({
      code: "approximated_param",
      path: [...ctx.path],
      message:
        `\`${paramOf(ctx)}\` ${JSON.stringify(language)} was sent as ${JSON.stringify(primary)} — ` +
        `this model's language field is a bare ISO 639-1 code, so the regional subtag ` +
        `${JSON.stringify(subtag)} is not expressible and the accent it selects is the model's default.`,
      meta: {
        requested: language,
        achieved: primary,
        dropped: subtag,
        ...(options.source !== undefined && { source: options.source }),
      },
    });
  }
  return ok(primary);
}

/** Shared bounds check, always in canonical speed units. */
function outOfSpeedRange(
  speed: number,
  rules: SpeedRules,
  ctx: DeriveContext,
): Derived<never> | undefined {
  if (!Number.isFinite(speed) || speed <= 0) {
    return bad(ctx, {
      code: "invalid_shape",
      message: `\`${paramOf(ctx)}\` must be a positive multiplier (1 = normal); got ${JSON.stringify(speed)}.`,
      meta: { value: speed },
    });
  }
  if ((rules.min !== undefined && speed < rules.min) || (rules.max !== undefined && speed > rules.max)) {
    return bad(ctx, {
      code: "invalid_shape",
      message:
        `\`${paramOf(ctx)}\` must be between ${rules.min ?? 0} and ${rules.max ?? "∞"} for this model; ` +
        `got ${speed}.`,
      meta: {
        min: rules.min,
        max: rules.max,
        value: speed,
        ...(rules.source !== undefined && { source: rules.source }),
      },
    });
  }
  return undefined;
}
