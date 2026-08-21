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
import type { ImageEditInputKind } from "./vocabulary/image-edit";
import type { Voice } from "./vocabulary/tts";
import type {
  AudioInputKind,
  Diarization,
  TimestampGranularity,
} from "./vocabulary/stt";
import type { VideoImageInput, VideoInput } from "./vocabulary/video";
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
 *
 * `Tier` is a parameter, defaulting to the image vocabulary's `1k`/`2k`/`4k`.
 * The video vocabulary names its sizes `480p`…`4k` instead, and the arithmetic
 * below cares about neither: a tier is a key into the provider's table and the
 * *value* is what carries meaning. One parameterised table type rather than two
 * is what keeps Sora's `size` lookup and DALL·E's the same code — including the
 * drift measurement, which is the part worth sharing. The functions take the
 * tier as a bare `string` for the same reason ratios are bare strings here (see
 * the file header): an adapter passes its vocabulary's type and loses nothing,
 * and the invalid case stays reachable so it stays tested.
 */
export type SizeTable<Tier extends string = ResolutionTier> = Readonly<
  Partial<Record<Tier, Readonly<Record<string, string>>>>
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
  tier: string,
  table: SizeTable<string>,
  ctx: DeriveContext,
): Derived<string> {
  const tiers = Object.keys(table);
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
  tier: string,
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
 * **S6.** Tier → the provider's own name for it (`"1K"`, `1024`, `"hd"`,
 * `"768P"`).
 *
 * Serves both size vocabularies: the image tiers (`1k`/`2k`/`4k`) and the video
 * ones (`480p`…`4k`), which is why the key is a bare `string` — the table an
 * adapter declares is what says which tiers exist, and the message quotes that
 * table's own keys.
 *
 * A missing tier is an `invalid_enum_value` naming the tiers that exist, and
 * **never** a downgrade to the next one down. Silently serving 1k for a 4k
 * request is the single most expensive kind of quiet approximation there is:
 * it is invisible in the response, it is invisible in the warnings, and the
 * caller finds out when someone looks at the output.
 */
export function toTier<T>(
  tier: string,
  table: Readonly<Partial<Record<string, T>>>,
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

/**
 * Which of the three spellings of size the caller used.
 *
 * A `WxH` `size` arrives as `kind: "dimensions"` **with** its original
 * spelling on `size`, which is the whole reason adding the field cost no
 * adapter a new branch: the pixel pair is what every adapter already compiles,
 * and `size` is there only so the ones with a verbatim string field can send
 * exactly what the caller wrote, and so provenance can name the field they
 * actually used.
 *
 * `kind: "size"` is the residue — a `size` that is not a pixel pair at all
 * (`"auto"`). Only the adapters whose wire enum contains such a literal ever
 * see one, because {@link resolveSizing} refuses anything not in the model's
 * declared list.
 */
export type Sizing =
  | { kind: "ratio"; aspectRatio: AspectRatio }
  | { kind: "dimensions"; dimensions: Dimensions; size?: string }
  | { kind: "size"; size: string }
  | { kind: "unset" };

/** `"1536x1024"` → `{ width: 1536, height: 1024 }`; anything else → `undefined`. */
export function parseSizeString(size: string): Dimensions | undefined {
  const match = PIXEL_PAIR.exec(size.trim());
  if (match === null) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0) || !(height > 0)) return undefined;
  return { width, height };
}

/** What {@link resolveSizing} needs to know about the model to read a `size`. */
export interface SizingRules {
  /**
   * The model's declared `size` values. Only consulted for a `size` that is
   * *not* a `WxH` pair: a literal in the list passes through, and one that is
   * not is an `invalid_enum_value` here rather than an unrecognised string on
   * the wire. Pixel pairs are never checked here — bounds and enums are the
   * provider validator's job, and doing it twice would mean two lists.
   */
  readonly sizes?: readonly string[];
}

/**
 * One row of an adapter's per-model table, as sizing rules.
 *
 * Exists so an adapter can write `sizeRules(TABLE, ctx.model)` rather than
 * casting its `as const` table to an indexable one at every call site:
 * `ctx.model` is a `string` (a ref can name a model this build has never heard
 * of), and a table declared `as const` has no index signature.
 */
export function sizeRules(table: ModelRowTable, model: string): SizingRules {
  return (table[model] as SizingRules | undefined) ?? {};
}

/**
 * An adapter's per-model table, as much of it as `derive.ts` needs to know.
 *
 * `object` rather than a shape with optional members, deliberately: a row that
 * declares only `ratios` has no property in common with a `{ sizes?: … }`, and
 * TypeScript's weak-type check would reject it — correctly, for a type meant
 * to be *written*, and unhelpfully for one meant to be *read*. The two readers
 * below cast to what they need, once each.
 */
export type ModelRowTable = Readonly<Record<string, object>>;

/**
 * Reads the size decision off a request.
 *
 * The type already makes `{ aspectRatio, dimensions }` a compile error; this
 * is the runtime half, for JavaScript callers and anyone who casts. Reported
 * as `invalid_shape` at the root of the group, because the fault is the
 * *combination* — pointing at any one field alone would suggest deleting the
 * wrong one.
 */
export function resolveSizing(
  input: { size?: string; aspectRatio?: AspectRatio; dimensions?: Dimensions },
  ctx: DeriveContext,
  rules: SizingRules = {},
): Derived<Sizing> {
  const written: string[] = [];
  if (input.size !== undefined) written.push("size");
  if (input.aspectRatio !== undefined) written.push("aspectRatio");
  if (input.dimensions !== undefined) written.push("dimensions");
  if (written.length > 1) {
    return bad(ctx, {
      code: "invalid_shape",
      message:
        `\`${written.join("` and `")}\` are ${written.length === 3 ? "three" : "two"} spellings of one ` +
        "decision; supply exactly one. Use `size` for the provider's own spelling, `dimensions` when " +
        "the pixel size is computed, and `aspectRatio` when only the shape matters.",
      meta: {
        ...(input.size !== undefined && { size: input.size }),
        ...(input.aspectRatio !== undefined && { aspectRatio: input.aspectRatio }),
        ...(input.dimensions !== undefined && { dimensions: input.dimensions }),
      },
    });
  }
  if (input.aspectRatio !== undefined) return ok({ kind: "ratio", aspectRatio: input.aspectRatio });
  if (input.dimensions !== undefined) return ok({ kind: "dimensions", dimensions: input.dimensions });
  if (input.size !== undefined) {
    const dimensions = parseSizeString(input.size);
    if (dimensions !== undefined) return ok({ kind: "dimensions", dimensions, size: input.size });
    if (rules.sizes?.includes(input.size) === true) return ok({ kind: "size", size: input.size });
    const literals = rules.sizes?.filter((value) => parseSizeString(value) === undefined) ?? [];
    return {
      // `["size"]`, not `ctx.path`: adapters pass the ratio path because that
      // is the commonest arm, and a finding about a `size` the caller wrote
      // has to name `size`.
      issues: [
        {
          code: "invalid_enum_value",
          path: ["size"],
          message:
            `\`size\` must be a "WIDTHxHEIGHT" string${
              literals.length === 0 ? "" : ` or one of ${list(literals)}`
            } for this model; got ${JSON.stringify(input.size)}.`,
          meta: {
            value: input.size,
            ...(rules.sizes !== undefined && { allowed: [...rules.sizes] }),
          },
        },
      ],
    };
  }
  return ok({ kind: "unset" });
}

/**
 * The canonical field a {@link Sizing} came from, for `ctx.from`.
 *
 * Provenance has to name the word the caller wrote, and after `size` joined
 * the group that is no longer decidable from `kind` alone — a `WxH` `size` and
 * a `dimensions` pair are the same `kind` on purpose.
 */
export function sizingField(sizing: Sizing | undefined): "size" | "aspectRatio" | "dimensions" {
  if (sizing === undefined) return "aspectRatio";
  if (sizing.kind === "size") return "size";
  if (sizing.kind === "ratio") return "aspectRatio";
  if (sizing.kind === "dimensions") return sizing.size === undefined ? "dimensions" : "size";
  return "aspectRatio";
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
export function redundantTier(
  tier: ResolutionTier,
  ctx: DeriveContext,
  /** Which spelling of the pixel count the caller used — `size` says it too. */
  beside: "dimensions" | "size" = "dimensions",
): Derived<never> {
  return bad(ctx, {
    code: "invalid_shape",
    message:
      `\`resolution\` ${JSON.stringify(tier)} has nothing to add beside \`${beside}\` on this ` +
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

/**
 * How far off an integer a floating-point product may land and still be read
 * as that integer.
 *
 * `90 * 1000` is exactly 90000, but `0.1 * 1000` is 100.00000000000001 in
 * IEEE-754 — so a bare `Number.isInteger` check would reject a duration the
 * caller wrote as a perfectly ordinary decimal. A microsecond of slack is
 * three orders of magnitude below anything an audio API can act on and
 * comfortably above the error a single multiplication can introduce.
 */
const MILLISECOND_EPSILON = 1e-6;

/**
 * Seconds → **milliseconds**, exactly, or not at all.
 *
 * Half the music category's providers count in milliseconds and half in
 * seconds, which makes ×1000 the one conversion this vocabulary cannot avoid.
 * It is deliberately **silent**: a thousandfold unit change is not an
 * approximation — 90 seconds *is* 90000 ms, with nothing lost and nothing
 * invented — so warning about it would spend the warning channel's credibility
 * on arithmetic that is exact. What is *not* exact is a duration that lands
 * between two milliseconds, and that is an `invalid_shape` naming the value
 * rather than a rounded one nobody asked for.
 */
export function toMilliseconds(seconds: number, ctx: DeriveContext): Derived<number> {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return bad(ctx, {
      code: "invalid_shape",
      message: `\`${paramOf(ctx)}\` must be a positive number of seconds; got ${JSON.stringify(seconds)}.`,
      meta: { value: seconds },
    });
  }
  const exact = seconds * 1000;
  const rounded = Math.round(exact);
  if (Math.abs(exact - rounded) > MILLISECOND_EPSILON) {
    return bad(ctx, {
      code: "invalid_shape",
      // `toFixed(3)` on the way into the *message* only: a product like
      // `12.3456 * 1000` is 12345.599999999999 in IEEE-754, and quoting that
      // back at someone who wrote `12.3456` reads as a bug in unmodel rather
      // than as the rounding decision they have to make. `meta` keeps the
      // unrounded number for anything that needs to compute with it.
      message:
        `\`${paramOf(ctx)}\` ${seconds} is ${Number(exact.toFixed(3))} ms, and this model's ` +
        "length field counts whole milliseconds. Round it yourself rather than have unmodel " +
        "pick a length for you.",
      meta: { value: seconds, milliseconds: exact },
    });
  }
  return ok(rounded);
}

// ---------------------------------------------------------------------------
// Video inputs — the route a request derives, and how each input is encoded
// ---------------------------------------------------------------------------

/**
 * Which generation route a video request *is*, derived from its inputs rather
 * than chosen by the caller.
 *
 * This is the one rule the whole category rests on, so it lives here and not in
 * ten adapters:
 *
 * | the request carries | the route |
 * |---|---|
 * | `video` | `"video"` — extend / restyle / edit a clip |
 * | `image` tagged `role: "reference"` | `"reference"` — carry a subject or style forward |
 * | any other `image` | `"image"` — first frame, or first *and* last |
 * | none of those | `"text"` |
 *
 * `video` wins over `image` because every provider that takes both treats the
 * clip as the subject and the stills as guidance, and `reference` is checked
 * before the plain image case because it is a different *endpoint* at four of
 * the ten providers — which is precisely why the caller tags the role rather
 * than picking a function name.
 *
 * A mixed array (one reference plus one first frame) resolves to `"reference"`,
 * and the adapter for a provider whose reference route has no first-frame slot
 * says so at `image` — a better error than silently dropping one of them.
 */
export type VideoRoute = "text" | "image" | "reference" | "video";

/** What each route is called in prose, for the message below. */
export const VIDEO_ROUTE_LABELS: Readonly<Record<VideoRoute, string>> = Object.freeze({
  text: "text-to-video",
  image: "image-to-video",
  reference: "reference-to-video",
  video: "video-to-video",
});

/** The canonical field that decided a route — where its error belongs. */
const ROUTE_PATH: Readonly<Record<VideoRoute, string>> = Object.freeze({
  text: "prompt",
  image: "image",
  reference: "image",
  video: "video",
});

/** What to do instead, per route a model *does* serve. */
const ROUTE_FIX: Readonly<Record<VideoRoute, string>> = Object.freeze({
  text: "drop `image`/`video` for a text-only request",
  image: "pass `image`",
  reference: 'pass `image` with `role: "reference"`',
  video: "pass `video`",
});

/** The inputs a route is derived from — the two fields, and nothing else. */
export interface VideoRouteInputs {
  image?: VideoImageInput | readonly VideoImageInput[];
  video?: VideoInput;
}

/** The route a request derives to. Pure: it reports nothing and cannot fail. */
export function videoRoute(input: VideoRouteInputs): VideoRoute {
  if (input.video !== undefined) return "video";
  const images = input.image === undefined ? [] : toImageArray(input.image);
  if (images.length === 0) return "text";
  return images.some((image) => image.role === "reference") ? "reference" : "image";
}

/**
 * The route a request derives to, checked against the routes this model serves.
 *
 * The error names the derivation rather than the field: a caller who passed an
 * image to `runway/gen4.5` and one who passed none are making different
 * mistakes, and "has no text-to-video route; it serves image-to-video — pass
 * `image`" tells the second one what to type. Which routes a model serves is
 * per model at six of the ten providers, so it is the adapter's table.
 */
export function resolveVideoRoute(
  input: VideoRouteInputs,
  spec: { model: string; routes: readonly VideoRoute[]; source?: string },
  ctx: DeriveContext,
): Derived<VideoRoute> {
  const route = videoRoute(input);
  if (spec.routes.includes(route)) return ok(route);
  const served = spec.routes.map((r) => VIDEO_ROUTE_LABELS[r]);
  const fixes = spec.routes.map((r) => ROUTE_FIX[r]);
  return {
    issues: [
      {
        code: "unsupported_capability",
        path: [ROUTE_PATH[route]],
        message:
          `"${spec.model}" has no ${VIDEO_ROUTE_LABELS[route]} route; it serves ` +
          `${served.length === 0 ? "no video route at all" : served.join(" and ")}` +
          `${fixes.length === 0 ? "" : ` — ${fixes.join(", or ")}`}.`,
        meta: {
          route,
          routes: [...spec.routes],
          ...(spec.source !== undefined && { source: spec.source }),
        },
      },
    ],
  };
}

/** `image` in either of its two spellings, always as an array. */
export function toImageArray(
  image: VideoImageInput | readonly VideoImageInput[],
): readonly VideoImageInput[] {
  return Array.isArray(image) ? image : [image as VideoImageInput];
}

/**
 * The `image` field, split into the three slots a provider has wire fields for.
 *
 * An omitted `role` is `"first"`, which is what an unlabelled image means
 * everywhere — and two images claiming the same slot is an error, not a
 * last-one-wins: a caller who passed two first frames meant something the
 * request cannot express, and picking one silently discards the other.
 */
export interface ImageSlots {
  first?: VideoImageInput;
  last?: VideoImageInput;
  references: readonly VideoImageInput[];
}

export function resolveImageSlots(
  image: VideoImageInput | readonly VideoImageInput[] | undefined,
  ctx: DeriveContext,
): Derived<ImageSlots> {
  const references: VideoImageInput[] = [];
  let first: VideoImageInput | undefined;
  let last: VideoImageInput | undefined;
  if (image === undefined) return ok({ references });
  for (const [index, entry] of toImageArray(image).entries()) {
    const role = entry.role ?? "first";
    if (role === "reference") {
      references.push(entry);
      continue;
    }
    const taken = role === "first" ? first : last;
    if (taken !== undefined) {
      return {
        issues: [
          {
            code: "invalid_shape",
            path: [...ctx.path, index],
            message:
              `two images claim the ${JSON.stringify(role)} frame; a video has one of each. ` +
              'Use `role: "reference"` for the images that are not keyframes.',
            meta: { role },
          },
        ],
      };
    }
    if (role === "first") first = entry;
    else last = entry;
  }
  return ok({ ...(first !== undefined && { first }), ...(last !== undefined && { last }), references });
}

/** A slot the provider has no wire field for. */
export function unsupportedSlot(
  slot: "last" | "reference",
  model: string,
  reason: string,
  ctx: DeriveContext,
): Derived<never> {
  return bad(ctx, {
    code: "unsupported_param",
    message:
      slot === "last"
        ? `\`role: "last"\` has no wire field on "${model}": ${reason}`
        : `\`role: "reference"\` has no wire field on "${model}": ${reason}`,
    meta: { slot },
  });
}

/**
 * A media reference as the string a provider that documents "a URL or a base64
 * data URI" wants.
 *
 * Inline bytes need a media type to become a data URI, and the canonical
 * `mimeType` is where it comes from — so bytes without one are an
 * `invalid_shape` naming the field rather than a `data:;base64,` string that
 * every one of these APIs rejects. Bytes that already carry a `data:` prefix
 * pass through untouched: that is the same value, spelled the way the caller
 * happened to have it.
 */
export function toMediaUri(
  ref: { url: string } | { data: string; mimeType?: string },
  ctx: DeriveContext,
): Derived<string> {
  if ("url" in ref) return ok(ref.url);
  if (ref.data.startsWith("data:")) return ok(ref.data);
  if (ref.mimeType === undefined) {
    return bad(ctx, {
      code: "invalid_shape",
      message:
        `\`${paramOf(ctx)}\` was given as inline bytes with no \`mimeType\`, and this model takes ` +
        "a URL or a `data:` URI — which cannot be built without the media type. Add `mimeType`, " +
        "or pass a `url`.",
      meta: {},
    });
  }
  return ok(`data:${ref.mimeType};base64,${ref.data}`);
}

/**
 * A media reference at a provider whose field is a **URL only** — no inline
 * bytes anywhere on the route.
 *
 * An error rather than a data URI, because a `data:` string in a field the API
 * fetches as a URL is a 400 with a confusing message; naming the upload the
 * provider does document is the fix the caller can act on.
 */
export function requireMediaUrl(
  ref: { url: string } | { data: string; mimeType?: string },
  hint: string,
  ctx: DeriveContext,
): Derived<string> {
  if ("url" in ref) return ok(ref.url);
  if (ref.data.startsWith("http://") || ref.data.startsWith("https://")) return ok(ref.data);
  return bad(ctx, {
    code: "unsupported_param",
    message: `\`${paramOf(ctx)}\` must be a URL on this model — inline bytes have no wire field. ${hint}`,
    meta: {},
  });
}

/** Inline bytes at a provider whose field is **base64 only** — no URL form. */
export function requireInlineBytes(
  ref: { url: string } | { data: string; mimeType?: string },
  hint: string,
  ctx: DeriveContext,
): Derived<{ data: string; mimeType?: string }> {
  if (!("url" in ref)) {
    // A `data:` URI the caller happened to have: unwrap it, because the field
    // wants the payload and not the envelope.
    const match = /^data:([^;,]*)(?:;[^,]*)*,(.*)$/s.exec(ref.data);
    if (match !== null) {
      const mimeType = match[1] === undefined || match[1] === "" ? ref.mimeType : match[1];
      return ok({ data: match[2] ?? "", ...(mimeType !== undefined && { mimeType }) });
    }
    return ok({ data: ref.data, ...(ref.mimeType !== undefined && { mimeType: ref.mimeType }) });
  }
  return bad(ctx, {
    code: "unsupported_param",
    message: `\`${paramOf(ctx)}\` must be inline bytes on this model — a URL has no wire field. ${hint}`,
    meta: { url: ref.url },
  });
}

// ---------------------------------------------------------------------------
// Transcription inputs
// ---------------------------------------------------------------------------

/** `audio`, once it is known which of the four shapes it is. */
export type AudioSource =
  | { kind: "file"; file: Blob }
  | { kind: "url"; url: string }
  | { kind: "fileId"; fileId: string }
  | { kind: "data"; data: string; mimeType?: string };

/** How each kind is spelled in a message — the field the caller would write. */
const AUDIO_SPELLING: Readonly<Record<AudioInputKind, string>> = Object.freeze({
  file: "{ file }",
  url: "{ url }",
  fileId: "{ fileId }",
  data: "{ data }",
});

/**
 * Every audio kind, in one order, derived from the spelling table.
 *
 * The *presence scan* has to look at all four — a `{ data }` handed to a
 * URL-only route must be recognised as `data` and refused by name, not read as
 * "this object names no audio" — so this is a different list from the
 * `accepts` one, and it is derived rather than written out so a fifth kind
 * cannot be added to the vocabulary and forgotten here.
 */
const AUDIO_KINDS = Object.keys(AUDIO_SPELLING) as readonly AudioInputKind[];

/** `data:<type>[;param…],<payload>` — the envelope a `{ data }` may arrive in. */
const DATA_URI = /^data:([^;,]*)(?:;[^,]*)*,(.*)$/s;

/** ``["url", "fileId"]`` → ``"`url` or `fileId`"`` — the keys, as prose. */
function audioKeyList(kinds: readonly AudioInputKind[]): string {
  const quoted = kinds.map((kind) => `\`${kind}\``);
  if (quoted.length <= 1) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
}

/**
 * `audio` narrowed to the one shape it is, checked against what the route takes.
 *
 * The runtime half of the category's flagship promise. The compile-time half
 * (`SttValidator`, driven by the same `audioInputs` array) already
 * rejects a `Blob` at a URL-only route — but only for a caller in TypeScript
 * with a literal ref, so this is what answers for everyone else: JavaScript,
 * a ref assembled at runtime, and a request that came in over the wire.
 *
 * The parameter is `unknown` on purpose. A parameter whose invalid case the
 * type system forbids is a parameter whose invalid case nobody tests, and this
 * function's whole job is the invalid cases.
 *
 * Two shapes at once is an error rather than a precedence rule: `{ url, file }`
 * is a caller who has not decided, and every one of these APIs rejects the
 * combination too — picking one silently would send audio the caller did not
 * choose, at a price per minute.
 *
 * **Every sentence below names the kinds from `accepts`**, never a written-out
 * list of the four. A message that enumerated the whole vocabulary would tell a
 * caller about shapes this route cannot take, and — the reason it is a rule
 * rather than a preference — would have to be edited by hand every time the
 * vocabulary grew one, which is exactly the edit the `"data"` kind found
 * missing here.
 */
export function resolveAudioInput(
  audio: unknown,
  accepts: readonly AudioInputKind[],
  ctx: DeriveContext,
  options: { source?: string; hint?: string } = {},
): Derived<AudioSource> {
  const offered = accepts.map((kind) => AUDIO_SPELLING[kind]).join(" or ");
  const meta = {
    accepts: [...accepts],
    ...(options.source !== undefined && { source: options.source }),
  };
  if (audio === null || typeof audio !== "object") {
    return bad(ctx, {
      code: "invalid_shape",
      message:
        `\`${paramOf(ctx)}\` must be an object naming where the audio is; this model takes ${offered}.`,
      meta: { ...meta, value: audio },
    });
  }
  const record = audio as Record<string, unknown>;
  // Scanned over ALL the kinds, so `{ data }` at a URL-only route is refused as
  // a `data` this route has no field for rather than reported as an object that
  // names no audio at all.
  const present = AUDIO_KINDS.filter((key) => record[key] !== undefined);
  if (present.length === 0) {
    return bad(ctx, {
      code: "invalid_shape",
      message:
        `\`${paramOf(ctx)}\` names no audio — it takes ${offered}, and this object sets none of ` +
        `${audioKeyList(accepts)}.`,
      meta,
    });
  }
  if (present.length > 1) {
    return bad(ctx, {
      code: "invalid_shape",
      message:
        `\`${paramOf(ctx)}\` carries ${present.map((key) => `\`${key}\``).join(" and ")} at once; ` +
        `exactly one key says where the audio is, and this model takes ${offered}.`,
      meta: { ...meta, provided: present },
    });
  }
  const kind = present[0] as AudioInputKind;
  if (!accepts.includes(kind)) {
    return bad(ctx, {
      code: "unsupported_param",
      message:
        `\`${paramOf(ctx)}\` was given as \`${AUDIO_SPELLING[kind]}\`, which this model has no wire ` +
        `field for — it takes ${offered}.${options.hint === undefined ? "" : ` ${options.hint}`}`,
      meta: { ...meta, given: kind },
    });
  }
  if (kind === "file") {
    const file = record["file"];
    if (!(file instanceof Blob)) {
      return bad(ctx, {
        code: "invalid_shape",
        message: `\`${paramOf(ctx)}.file\` must be a Blob or File; got ${typeof file}.`,
        meta,
      });
    }
    return ok({ kind, file });
  }
  const value = record[kind];
  if (typeof value !== "string" || value === "") {
    return bad(ctx, {
      code: "invalid_shape",
      message: `\`${paramOf(ctx)}.${kind}\` must be a non-empty string; got ${JSON.stringify(value)}.`,
      meta,
    });
  }
  if (kind === "url") return ok({ kind, url: value });
  if (kind === "fileId") return ok({ kind, fileId: value });

  // `data`. A caller who happens to have a `data:` URI passes it here and means
  // the bytes — every wire field in this category is documented "base64" — so
  // the envelope is unwrapped and its media type is kept when the canonical
  // `mimeType` did not supply one. The explicit field wins when both are
  // present: it is the vocabulary's word for this fact, and the prefix is
  // packaging the caller may not have chosen.
  const declared = record["mimeType"];
  if (declared !== undefined && (typeof declared !== "string" || declared === "")) {
    return bad(ctx, {
      code: "invalid_shape",
      message: `\`${paramOf(ctx)}.mimeType\` must be a non-empty string; got ${JSON.stringify(declared)}.`,
      meta,
    });
  }
  const envelope = DATA_URI.exec(value);
  const data = envelope === null ? value : (envelope[2] ?? "");
  const embedded = envelope?.[1];
  const mimeType =
    declared ?? (embedded === undefined || embedded === "" ? undefined : embedded);
  return ok({ kind, data, ...(mimeType !== undefined && { mimeType }) });
}

// ---------------------------------------------------------------------------
// Image-edit inputs, operation and strength
// ---------------------------------------------------------------------------

/**
 * The `operation` discriminant, checked against what this route serves.
 *
 * The type already makes `operation: "inpaint"` a compile error while `"edit"`
 * is the only member — but a discriminant that is *only* a type is a silent
 * drop waiting for a JavaScript caller: the field would compile to nothing and
 * the request would quietly be an edit. It is checked here for the same reason
 * every other canonical field is, and it is generic in the set because the next
 * operation to land will land at some providers and not others.
 *
 * Reported as `invalid_enum_value` naming what the route does serve, with the
 * adapter's hint pointing at the wire-only sibling that does the job today.
 */
export function resolveOperation<O extends string>(
  operation: unknown,
  accepts: readonly O[],
  ctx: DeriveContext,
  options: { hint?: string; source?: string } = {},
): Derived<O> {
  if (typeof operation === "string" && (accepts as readonly string[]).includes(operation)) {
    return ok(operation as O);
  }
  return bad(ctx, {
    code: "invalid_enum_value",
    message:
      `\`${paramOf(ctx)}\` must be ${list(accepts)} on this model; got ${JSON.stringify(operation)}.` +
      (options.hint === undefined ? "" : ` ${options.hint}`),
    meta: {
      allowed: [...accepts],
      value: operation,
      ...(options.source !== undefined && { source: options.source }),
    },
  });
}

/** `image`, once it is known which of the three shapes it is. */
export type ImageEditSource =
  | { kind: "file"; file: Blob }
  | { kind: "url"; url: string }
  | { kind: "data"; data: string };

/** How each kind is spelled in a message — the field the caller would write. */
const IMAGE_EDIT_SPELLING: Readonly<Record<ImageEditInputKind, string>> = Object.freeze({
  file: "{ file }",
  url: "{ url }",
  data: "{ data }",
});

/**
 * `image` narrowed to the one shape it is, checked against what the route takes.
 *
 * The runtime half of the category's flagship promise, and a sibling of
 * {@link resolveAudioInput} in every respect that matters: the compile-time
 * half (`ImageEditValidator`, driven by the same `imageInputs` array) already
 * rejects a `Blob` at a JSON-only route — but only for a caller in TypeScript
 * with a literal ref, so this is what answers for everyone else.
 *
 * A separate function rather than a generic shared with the audio one, because
 * the two categories' kind sets do not overlap (`fileId` there, `data` here)
 * and the prose that makes each message useful is about the *thing* — "where
 * the audio is" against "which picture to edit". Merging them would buy a
 * kilobyte and cost every message its subject.
 *
 * Two shapes at once is an error rather than a precedence rule: `{ url, file }`
 * is a caller who has not decided, and picking one silently would edit a
 * picture they did not choose, at a price per image.
 */
export function resolveImageEditInput(
  image: unknown,
  accepts: readonly ImageEditInputKind[],
  ctx: DeriveContext,
  options: { source?: string; hint?: string } = {},
): Derived<ImageEditSource> {
  const offered = accepts.map((kind) => IMAGE_EDIT_SPELLING[kind]).join(" or ");
  const meta = {
    accepts: [...accepts],
    ...(options.source !== undefined && { source: options.source }),
  };
  const hint = options.hint === undefined ? "" : ` ${options.hint}`;
  if (image === null || typeof image !== "object") {
    return bad(ctx, {
      code: "invalid_shape",
      message: `\`${paramOf(ctx)}\` must be an object naming the picture to edit; this model takes ${offered}.`,
      meta: { ...meta, value: image },
    });
  }
  const record = image as Record<string, unknown>;
  const present = (["file", "url", "data"] as const).filter((key) => record[key] !== undefined);
  if (present.length === 0) {
    return bad(ctx, {
      code: "invalid_shape",
      message:
        `\`${paramOf(ctx)}\` names no picture — it takes ${offered}, and this object has none of ` +
        "`file`, `url` or `data`.",
      meta,
    });
  }
  if (present.length > 1) {
    return bad(ctx, {
      code: "invalid_shape",
      message:
        `\`${paramOf(ctx)}\` carries ${present.map((key) => `\`${key}\``).join(" and ")} at once; ` +
        "exactly one of `file`, `url` or `data` says which picture to edit.",
      meta: { ...meta, provided: present },
    });
  }
  const kind = present[0] as ImageEditInputKind;
  if (!accepts.includes(kind)) {
    return bad(ctx, {
      code: "unsupported_param",
      message:
        `\`${paramOf(ctx)}\` was given as \`${IMAGE_EDIT_SPELLING[kind]}\`, which this model has no ` +
        `wire field for — it takes ${offered}.${hint}`,
      meta: { ...meta, given: kind },
    });
  }
  if (kind === "file") {
    const file = record["file"];
    if (!(file instanceof Blob)) {
      return bad(ctx, {
        code: "invalid_shape",
        message: `\`${paramOf(ctx)}.file\` must be a Blob or File; got ${typeof file}.`,
        meta,
      });
    }
    return ok({ kind, file });
  }
  const value = record[kind];
  if (typeof value !== "string" || value === "") {
    return bad(ctx, {
      code: "invalid_shape",
      message: `\`${paramOf(ctx)}.${kind}\` must be a non-empty string; got ${JSON.stringify(value)}.`,
      meta,
    });
  }
  return kind === "url" ? ok({ kind, url: value }) : ok({ kind, data: value });
}

/**
 * The raw base64 payload of an inline-bytes reference.
 *
 * A caller who happens to have a `data:` URI passes it through `{ data }` and
 * means the bytes, not the envelope — so the prefix is stripped for the routes
 * whose field is documented "base64", and a bare base64 string is returned
 * unchanged. Distinct from {@link requireInlineBytes}, which answers the same
 * question for the `{ url } | { data }` pair and carries a media type along.
 */
export function base64Payload(data: string): string {
  const match = /^data:[^;,]*(?:;[^,]*)*,(.*)$/s.exec(data);
  return match === null ? data : (match[1] ?? "");
}

/**
 * Where a provider's own strength scale starts and ends.
 *
 * The two endpoints are stated as the wire values at canonical `0` and `1`
 * rather than as a `{ min, max, invert }` triple, because that is the thing an
 * adapter can read off the provider's documentation without doing any algebra —
 * and because it makes the **direction** data rather than code. Ideogram's
 * `image_weight` is "how strongly the output should resemble the input", so it
 * runs `{ atZero: 100, atOne: 0 }`; Recraft's `strength` is "0 = almost
 * identical to the input", so it runs `{ atZero: 0, atOne: 1 }`. The inversion
 * is one number swapped, in one place, next to the sentence that justifies it.
 */
export interface StrengthRules {
  /** The wire value that means "keep the source" — canonical `strength: 0`. */
  atZero: number;
  /** The wire value that means "ignore the source" — canonical `strength: 1`. */
  atOne: number;
  /** Round to a whole number, warning when rounding moves the value. */
  integer?: boolean;
  source?: string;
}

/**
 * Canonical `strength` (0 = keep the source, 1 = ignore it) → the provider's own
 * scale.
 *
 * Linear between the two declared endpoints, which is the only defensible
 * reading of a dial nobody documents a curve for — and it lands exactly on the
 * midpoint, so `strength: 0.5` is `image_weight: 50` at Ideogram, which is that
 * route's own default. That coincidence is worth having: the canonical "half"
 * and the provider's "no opinion" are the same request.
 *
 * Out of `[0, 1]` is an `invalid_shape` rather than a clamp. A clamp would take
 * `strength: 1.5` — which is not a stronger edit, it is a misunderstanding — and
 * silently make it mean `1`, at which point the caller has no way to learn that
 * the scale was not what they thought.
 */
export function toStrength(
  strength: number,
  rules: StrengthRules,
  ctx: DeriveContext,
): Derived<number> {
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
    return bad(ctx, {
      code: "invalid_shape",
      message:
        `\`${paramOf(ctx)}\` must be between 0 and 1 — 0 keeps the source image, 1 ignores it; ` +
        `got ${JSON.stringify(strength)}.`,
      meta: {
        value: strength,
        min: 0,
        max: 1,
        ...(rules.source !== undefined && { source: rules.source }),
      },
    });
  }
  const exact = rules.atZero + strength * (rules.atOne - rules.atZero);
  if (rules.integer !== true) return ok(exact);
  const rounded = Math.round(exact);
  if (rounded !== exact) {
    ctx.warn({
      code: "approximated_param",
      path: [...ctx.path],
      message:
        `\`${paramOf(ctx)}\` ${strength} is ${exact} on this model's scale, which takes whole ` +
        `numbers: ${rounded} was sent.`,
      meta: {
        requested: strength,
        achieved: rounded,
        exact,
        scale: [rules.atZero, rules.atOne],
        ...(rules.source !== undefined && { source: rules.source }),
      },
    });
  }
  return ok(rounded);
}

/**
 * Which of `diarization`'s four fields this provider has a wire slot for.
 *
 * `enabled` is not listed: an adapter that declares `diarization` supported at
 * all can express the on/off decision, and one that cannot declares the whole
 * field `unsupported` instead — where the kernel's uniform message applies.
 */
export interface DiarizationRules {
  /** An exact speaker count (`speakers_expected`, `num_speakers`, …). */
  speakers?: boolean;
  minSpeakers?: boolean;
  maxSpeakers?: boolean;
  source?: string;
}

/** The counts, after the ones this provider cannot express have been refused. */
export interface ResolvedDiarization {
  enabled: boolean;
  speakers?: number;
  minSpeakers?: number;
  maxSpeakers?: number;
}

/**
 * `diarization`, checked field by field against what the provider offers.
 *
 * Every count the provider has no field for is an `unsupported_param` at its
 * own canonical path (`["diarization", "maxSpeakers"]`), never a drop — the
 * commonest way a transcription request quietly does something other than what
 * was asked is a speaker bound that went nowhere, and the caller is billed for
 * the run either way.
 *
 * A count sent with `enabled: false` is an error too: it asks the provider to
 * configure a feature the same request turns off, which is a request that has
 * not decided rather than one the wire can carry.
 */
export function resolveDiarization(
  diarization: Diarization,
  rules: DiarizationRules,
  ctx: DeriveContext,
): Derived<ResolvedDiarization> {
  const issues: CompileIssue[] = [];
  const resolved: ResolvedDiarization = { enabled: diarization.enabled === true };
  const counts = [
    ["speakers", diarization.speakers, rules.speakers === true],
    ["minSpeakers", diarization.minSpeakers, rules.minSpeakers === true],
    ["maxSpeakers", diarization.maxSpeakers, rules.maxSpeakers === true],
  ] as const;

  for (const [field, value, supported] of counts) {
    if (value === undefined) continue;
    if (!resolved.enabled) {
      issues.push({
        code: "invalid_shape",
        path: [...ctx.path, field],
        message:
          `\`${paramOf(ctx)}.${field}\` was given with \`enabled: false\` — a speaker count ` +
          "configures diarization, so a request that sets one has not decided whether it wants it.",
        meta: { value },
      });
      continue;
    }
    if (!supported) {
      issues.push({
        code: "unsupported_param",
        path: [...ctx.path, field],
        message: `\`${paramOf(ctx)}.${field}\` has no wire field on this model.`,
        meta: { value, ...(rules.source !== undefined && { source: rules.source }) },
      });
      continue;
    }
    if (!Number.isInteger(value) || value < 1) {
      issues.push({
        code: "invalid_shape",
        path: [...ctx.path, field],
        message: `\`${paramOf(ctx)}.${field}\` must be a positive integer; got ${JSON.stringify(value)}.`,
        meta: { value },
      });
      continue;
    }
    resolved[field] = value;
  }

  if (
    resolved.minSpeakers !== undefined &&
    resolved.maxSpeakers !== undefined &&
    resolved.minSpeakers > resolved.maxSpeakers
  ) {
    issues.push({
      code: "invalid_shape",
      path: [...ctx.path, "minSpeakers"],
      message:
        `\`${paramOf(ctx)}.minSpeakers\` (${resolved.minSpeakers}) is greater than ` +
        `\`${paramOf(ctx)}.maxSpeakers\` (${resolved.maxSpeakers}).`,
      meta: { min: resolved.minSpeakers, max: resolved.maxSpeakers },
    });
  }
  return issues.length === 0 ? ok(resolved) : { issues };
}

/**
 * `timestamps`, mapped onto the granularities one provider actually offers.
 *
 * `"none"` returns `undefined` — "omit the field", which is what asking for no
 * timing means on every wire in the category — and a granularity the provider
 * does not offer is an `invalid_enum_value` naming the ones it does. There is
 * deliberately no nearest-match: word timings when segments were asked for is
 * a different response shape, not an approximation of one, and a caller
 * parsing the result would find out by exception.
 */
export function toTimestampGranularity<G extends TimestampGranularity>(
  requested: TimestampGranularity,
  supported: readonly G[],
  ctx: DeriveContext,
  options: EnumOptions = {},
): Derived<G | undefined> {
  if (requested === "none") return ok(undefined);
  if ((supported as readonly TimestampGranularity[]).includes(requested)) {
    return ok(requested as G);
  }
  return bad(ctx, {
    code: "invalid_enum_value",
    message:
      `\`${paramOf(ctx)}\` ${JSON.stringify(requested)} is not a granularity this model reports; ` +
      `it offers ${list([...supported, "none"])}.`,
    meta: {
      allowed: [...supported, "none"],
      value: requested,
      ...(options.source !== undefined && { source: options.source }),
    },
  });
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

// ---------------------------------------------------------------------------
// Per-model extras
// ---------------------------------------------------------------------------

/**
 * The value side of a `modelParams` extras entry: `undefined` at run time, and
 * whatever the cast says at compile time.
 *
 * ```ts
 * const GPT_IMAGE_2_EXTRAS = { background: EXTRA as "opaque" | "auto" | null } as const;
 * ```
 *
 * `never` rather than `unknown` so the cast is an ordinary assertion in both
 * directions and needs no `as unknown as`. What it buys is a single
 * declaration that `Object.keys` can read *and* `typeof` can read — see
 * `vocabulary/model-params.ts` for the argument in full.
 */
export const EXTRA: never = undefined as never;

/** The minimum an adapter's per-model row has to look like from here. */
interface ExtrasRow {
  readonly extras?: Readonly<Record<string, unknown>>;
}

/** What {@link applyExtras} needs off the compile context. */
export interface ExtrasContext {
  readonly model: string;
  fail(issue: CompileIssue): void;
  from(wirePath: Array<string | number>, canonical: string): void;
}

/** Where the extras land, when they are not top-level wire keys. */
export interface ExtrasOptions {
  /**
   * The wire path they nest under — `["parameters"]` for Imagen's `:predict`
   * body. Missing objects along the path are created. Empty (the default)
   * means the body root, which is what most endpoints want.
   */
  readonly at?: readonly string[];
  /**
   * Per-key overrides of {@link at}, for a provider whose extras do not all
   * live under one prefix.
   *
   * Kling is why this exists, and it is not an edge case: its path-addressed
   * routes put `audio` under `settings` and `watermark_info` under `options`,
   * while its `/v1/videos/*` routes put `watermark_info` at the body root. One
   * `applyExtras` call has to serve all of them, because the refusal check
   * ("`cfg_scale` is not a parameter kling-3.0 accepts") reads the *whole*
   * table — splitting the table by prefix would split that check too, and an
   * extra that belongs to the other half would then be silently dropped
   * instead of refused.
   */
  readonly nest?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Copies a model's declared extras onto the wire body, verbatim, and refuses
 * one the model does not take.
 *
 * **Identity, deliberately.** An extra is already spelled the way the provider
 * spells it — that is what makes it an extra rather than a canonical word — so
 * there is nothing to translate and nothing to approximate. The value goes
 * across untouched and `ctx.from` maps the wire path back to the same name, so
 * a finding the *provider's* validator raises about it arrives at the key the
 * caller typed. Which is the second half of the design: these are re-checked
 * by the endpoint's own schema and deny tables, so an untyped caller who
 * passes `background: "transparent"` to `gpt-image-2` still gets the deny
 * error citing the recorded 400 — the types are the fast path, not the only
 * one.
 *
 * A key some *other* model on this adapter takes is an `unsupported_param`
 * naming the models that do, rather than a silent pass-through to a schema
 * that would reject it under a name the caller does not recognise.
 *
 * Runs **before** `providerOptions` is merged, so the escape hatch still wins.
 */
export function applyExtras(
  params: object,
  rows: ModelRowTable,
  wire: object,
  ctx: ExtrasContext,
  options: ExtrasOptions = {},
): void {
  // The canonical vocabulary has no index signature — deliberately, it is a
  // closed list of words — and an extra is by definition a key it does not
  // name. Same on the wire side, where the body is a discriminated union of
  // route arms. Both casts are said once, here, rather than at every adapter.
  const input = params as Readonly<Record<string, unknown>>;
  const body = wire as Record<string, unknown>;
  const table = rows as Readonly<Record<string, ExtrasRow>>;
  const row = table[ctx.model];
  // An unrecognised model has already drawn `unknown_model` from the kernel,
  // and the same sentence applies here: model-dependent checks are skipped, so
  // an extra rides through to the provider's schema rather than being refused
  // by a table that does not know this model.
  const known = row !== undefined;
  const mine = row?.extras;
  for (const key of extraNames(table)) {
    const value = input[key];
    if (value === undefined) continue;
    if (known && (mine === undefined || !Object.hasOwn(mine, key))) {
      const takers = Object.keys(table).filter((id) => {
        const extras = table[id]?.extras;
        return extras !== undefined && Object.hasOwn(extras, key);
      });
      ctx.fail({
        code: "unsupported_param",
        path: [key],
        message:
          `\`${key}\` is not a parameter "${ctx.model}" accepts; it is taken by ${list(takers)}.`,
        meta: { value, models: takers },
      });
      continue;
    }
    const path = [...(options.nest?.[key] ?? options.at ?? []), key];
    ctx.from(path, key);
    place(body, path, value);
  }
}

/** Every extra name any model in one table declares, deduplicated. */
function extraNames(table: Readonly<Record<string, ExtrasRow>>): readonly string[] {
  const names = new Set<string>();
  for (const row of Object.values(table)) {
    if (row.extras === undefined) continue;
    for (const key of Object.keys(row.extras)) names.add(key);
  }
  return [...names];
}

/**
 * Writes `value` at `path`, creating the plain objects along the way and
 * **merging** rather than replacing when both sides are plain objects.
 *
 * The merge is what lets a nested extra share a wire object with a canonical
 * param: Imagen's `outputOptions` carries `mimeType` (compiled from
 * `outputFormat`) and `compressionQuality` (an extra), and replacing the
 * object would silently delete whichever of the two was written first. Same
 * rule the kernel's `deepMerge` uses for `providerOptions`, for the same
 * reason.
 *
 * An **array** already on the path is walked by index rather than replaced —
 * `["utterances", "0", "description"]` reaches into the utterance the compiler
 * built. Hume is why: its body has no `text` field at all, so `text`, `voice`
 * and `speed` compile into `utterances[0]`, and its acting direction
 * (`description`) is a sibling of them. Without this, the first segment would
 * find an array, decide it was not a plain record, and overwrite the utterance
 * with `{}` — turning a per-model extra into a request that lost its text.
 */
function place(body: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let node = body;
  for (let i = 0; i < path.length - 1; i += 1) {
    const segment = path[i] as string;
    const next = node[segment];
    if (!isPlainRecord(next) && !Array.isArray(next)) node[segment] = {};
    node = node[segment] as Record<string, unknown>;
  }
  const key = path[path.length - 1] as string;
  const existing = node[key];
  node[key] =
    isPlainRecord(existing) && isPlainRecord(value) ? { ...existing, ...value } : value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
