/**
 * What the three `higgsfield/…` adapters compile the same way: a refusal that
 * names the route, a media reference, and the words a picture route spells
 * alike whether it generates or edits.
 *
 * A module of its own because three adapter leaves share it and none of them
 * may reach another (each category pack must pay for exactly one). It imports
 * the kernel's derivations, so it is for the `unified-<category>.ts` leaves
 * only — never for `./values.ts`, which publishes the `*-params.ts` leaves and
 * must stay off the kernel.
 *
 * # Every refusal is about a ROUTE
 *
 * Higgsfield is one URL template in front of many vendors' models, so a
 * parameter one route has is routinely absent from the next: `seed` is on 22
 * of the 86 video routes, `negative_prompt` on 9. There is no adapter-wide
 * "Higgsfield cannot do X" for any word a route's schema can carry; each
 * refusal here is derived from the route's own generated row and counts the
 * sibling routes that do take the word.
 *
 * # A route unmodel has no row for
 *
 * A ref outside the roster draws `unknown_model` from the kernel and compiles
 * with no row. The words Higgsfield spells one way everywhere, value included
 * (`prompt`, `seed`, `negative_prompt`, `aspect_ratio`, `duration`), are sent
 * on under that spelling, and the route's own validator has the last word.
 * The words whose parameter differs by route (a count, a picture, a clip) or
 * whose VALUE does (a size is `1k`, `720p` or `480P`; an encoding is `jpg`)
 * cannot be: {@link refuseWithoutRow} says so and names the escape hatch.
 */

import {
  pixelsToRatio,
  requireMediaUrl,
  sizingField,
  toRatioEnum,
  type DeriveContext,
  type Sizing,
} from "../../core/unified/derive";
import type { CompileIssue, Derived } from "../../core/unified/types";
import type { Warn } from "../../core/translate/warnings";
import type { ImageOutputFormat } from "../../core/unified/vocabulary/common";
import type { ModelParams } from "../../core/unified/vocabulary/model-params";
import { HIGGSFIELD_DOC_URLS } from "./gen/endpoints.gen";
import type { HiggsfieldParamRowBase, HiggsfieldPictureFields } from "./param-types";
import { HIGGSFIELD_UPLOAD_HINT } from "./urls";

/** The page that documents a route, or `undefined` for one unmodel has no row for. */
export function docsOf(route: string): string | undefined {
  return Object.hasOwn(HIGGSFIELD_DOC_URLS, route)
    ? HIGGSFIELD_DOC_URLS[route as keyof typeof HIGGSFIELD_DOC_URLS]
    : undefined;
}

/** The slice of a compile context a refusal needs. */
interface RefusalContext {
  readonly model: string;
  fail(issue: CompileIssue): void;
}

/** A pack's routes, as a refusal counts them. */
export interface RouteTable {
  /** "image", "image-edit" or "video", as the sentence says it. */
  readonly noun: string;
  readonly rows: Readonly<Record<string, HiggsfieldParamRowBase>>;
}

/**
 * One `unsupported_param` for a canonical word whose wire parameter this
 * route does not declare, counting the sibling routes that do.
 */
export function refuseWord(ctx: RefusalContext, canonical: string, wire: string, table: RouteTable): void {
  const ids = Object.keys(table.rows);
  const takers = ids.filter((id) => table.rows[id]?.keys.includes(wire) === true);
  ctx.fail({
    code: "unsupported_param",
    path: [canonical],
    message:
      `\`${ctx.model}\` declares no \`${wire}\` parameter, so \`${canonical}\` has nothing to become. ` +
      (takers.length === 0
        ? `No Higgsfield ${table.noun} route takes it.`
        : `${takers.length} of the ${ids.length} Higgsfield ${table.noun} routes ${takers.length === 1 ? "does" : "do"} take it` +
          `${takers.length <= 4 ? `: ${takers.map((id) => `\`${id}\``).join(", ")}` : ""}.`) +
      " Higgsfield serves many vendors' models from one URL template, so this is a fact about the route, not about Higgsfield.",
    meta: { wire, source: docsOf(ctx.model), declared: [...(table.rows[ctx.model]?.keys ?? [])] },
  });
}

/**
 * The refusal for a word Higgsfield's routes spell more than one way, at a
 * route unmodel has no row for. `spellings` are what it could be: parameter
 * names for a count or a picture, values for a size or an encoding.
 */
export function refuseWithoutRow(ctx: RefusalContext, canonical: string, spellings: readonly string[]): void {
  ctx.fail({
    code: "unsupported_param",
    path: [canonical],
    message:
      `unmodel has no row for \`${ctx.model}\`, and Higgsfield's routes spell \`${canonical}\` as ` +
      `${spellings.map((name) => `\`${name}\``).join(" or ")} — which one this route takes is not something to guess. ` +
      "Set the route's own parameter through `providerOptions.higgsfield`, or call the route by id at `unmodel/higgsfield`.",
    meta: { spellings: [...spellings] },
  });
}

/** How Higgsfield's routes spell a picture size, between them. */
export const TIER_SPELLINGS = ["1k", "2K", "720p", "480P"] as const;

/**
 * A media reference as the public URL Higgsfield fetches.
 *
 * No route takes bytes: "Use a presigned upload URL when your input media is
 * not already available through a public HTTPS URL"
 * (https://docs.higgsfield.ai/docs/concepts/file-uploads.md). So inline bytes
 * are refused with the upload route, and never wrapped into a `data:` URI the
 * API would be asked to fetch.
 */
export function toHiggsfieldMediaUrl(
  ref: { url: string } | { data: string; mimeType?: string },
  ctx: DeriveContext,
): Derived<string> {
  return requireMediaUrl(ref, HIGGSFIELD_UPLOAD_HINT, ctx);
}

/** A picture route's row, generation or editing. */
export type PictureRow = ModelParams & HiggsfieldParamRowBase & HiggsfieldPictureFields;

/** The canonical words {@link applyPictureWords} reads. */
interface PictureWords {
  seed?: number;
  n?: number;
  outputFormat?: ImageOutputFormat;
}

/** The wire parameters {@link applyPictureWords} and {@link toPictureAspectRatio} write. */
export interface PictureWire {
  aspect_ratio?: string;
  seed?: number;
  /** Higgsfield's own routes: how many images one request renders. */
  batch_size?: number;
  /** The Kling Image series routes: how many related images. */
  series_amount?: number;
  output_format?: string;
}

/** The slice of a compile context the picture derivations need. */
interface PictureContext extends RefusalContext {
  readonly warn: Warn;
  from(
    wirePath: Array<string | number>,
    canonical: "seed" | "n" | "outputFormat" | "size" | "aspectRatio" | "dimensions",
  ): void;
  take<T>(derived: Derived<T>): T | undefined;
}

/** The two spellings of a count, for a route with no row. */
const COUNT_SPELLINGS = ["batch_size", "series_amount"] as const;

/**
 * `seed`, `n` and `outputFormat`, where the route has a parameter for them.
 *
 * Nothing is range-checked here: what a route's `batch_size` lists or its
 * `seed` bounds is `./checks.ts`'s to say, once, and the provenance declared
 * below is what brings that finding back to the word the caller wrote —
 * including "`series_amount` is required", which arrives at `n`.
 */
export function applyPictureWords(
  input: PictureWords,
  body: PictureWire,
  row: PictureRow | undefined,
  table: RouteTable,
  ctx: PictureContext,
): void {
  ctx.from(["seed"], "seed");
  ctx.from(["output_format"], "outputFormat");
  if (row?.countWire !== undefined) ctx.from([row.countWire], "n");

  if (input.seed !== undefined) {
    if (row === undefined || row.keys.includes("seed")) body.seed = input.seed;
    else refuseWord(ctx, "seed", "seed", table);
  }

  if (input.n !== undefined) {
    if (row === undefined) refuseWithoutRow(ctx, "n", COUNT_SPELLINGS);
    else if (row.countWire !== undefined) body[row.countWire] = input.n;
    else refuseCount(ctx, table);
  }

  if (input.outputFormat !== undefined) {
    if (row === undefined) {
      refuseWithoutRow(ctx, "outputFormat", ["jpg", "jpeg"]);
    } else if (row.formatWire === undefined) {
      refuseWord(ctx, "outputFormat", "output_format", table);
    } else {
      const spelling = row.formatWire[input.outputFormat];
      if (spelling === undefined) {
        const offered = Object.keys(row.formatWire);
        ctx.fail({
          code: "invalid_enum_value",
          path: ["outputFormat"],
          message:
            `\`outputFormat\` must be ${offered.map((value) => `"${value}"`).join(" or ")} on \`${ctx.model}\`; ` +
            `got "${input.outputFormat}".`,
          meta: { allowed: offered, value: input.outputFormat, source: docsOf(ctx.model) },
        });
      } else {
        body.output_format = spelling;
      }
    }
  }
}

/** `n` at a route that renders one picture per request. */
function refuseCount(ctx: RefusalContext, table: RouteTable): void {
  const takers = Object.keys(table.rows).filter((id) => (table.rows[id] as PictureRow | undefined)?.countWire !== undefined);
  ctx.fail({
    code: "unsupported_param",
    path: ["n"],
    message:
      `\`${ctx.model}\` renders one image per request: it declares no count parameter, so \`n\` has nothing to become. ` +
      `${takers.length} of the ${Object.keys(table.rows).length} Higgsfield ${table.noun} routes do take one` +
      `${takers.length > 0 && takers.length <= 6 ? `: ${takers.map((id) => `\`${id}\``).join(", ")}` : ""}. ` +
      "Submit the request once per image.",
    meta: { source: docsOf(ctx.model) },
  });
}

/**
 * `aspect_ratio` for a picture, from whichever size word the caller wrote.
 *
 * Every Higgsfield picture route sizes by SHAPE, from a closed list, and none
 * takes pixels. So `aspectRatio` is matched against the route's list and sent
 * in the route's spelling, and `dimensions` / a `WxH` `size` are sent as the
 * listed shape they describe, with the `approximated_param` that conversion
 * always carries. A size literal that is not `WxH` never reaches here:
 * `resolveSizing` refuses it, because no row lists one.
 */
export function toPictureAspectRatio(
  sizing: Sizing,
  row: PictureRow | undefined,
  table: RouteTable,
  ctx: PictureContext,
): string | undefined {
  if (sizing.kind !== "ratio" && sizing.kind !== "dimensions") return undefined;
  const field = sizingField(sizing);
  ctx.from(["aspect_ratio"], field);
  if (row !== undefined && !row.keys.includes("aspect_ratio")) {
    refuseWord(ctx, field, "aspect_ratio", table);
    return undefined;
  }
  const derive: DeriveContext = { path: [field], warn: ctx.warn };
  const ratios = row?.ratios;
  const spelling =
    sizing.kind === "ratio"
      ? sizing.aspectRatio
      : ctx.take(pixelsToRatio(sizing.dimensions.width, sizing.dimensions.height, ratios, derive));
  if (spelling === undefined || ratios === undefined) return spelling;
  return ctx.take(toRatioEnum(spelling, ratios, { source: docsOf(ctx.model) }, derive));
}
