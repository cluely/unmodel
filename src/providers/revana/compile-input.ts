/**
 * What every `revana/…` adapter compiles the same way: a media reference, a
 * picture's shape, and a size tier.
 *
 * A module of its own because eight adapter leaves share it and none of them
 * may reach another (each category pack must pay for exactly one). It imports
 * the kernel's derivations, so it is for the `unified-<category>.ts` leaves
 * only — never for `./values.ts`, which publishes the `*-params.ts` leaves and
 * must stay off the kernel.
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
import { REVANA_MODELS_SOURCE } from "./checks";
import { UPLOADS_URL } from "./urls";

/**
 * A media reference as the public URL Revana fetches.
 *
 * "Media must be public https URLs that download directly": there is no
 * base64 field, no `data:` URI and no file id anywhere on the route, so inline
 * bytes are refused here with the one thing that does work. A `{ url }` is
 * passed on as written — whether it is `https:` is the wire validator's rule
 * (`./checks.ts`), stated once.
 */
export function toRevanaMediaUrl(
  ref: { url: string } | { data: string; mimeType?: string },
  ctx: DeriveContext,
): Derived<string> {
  return requireMediaUrl(
    ref,
    `Revana fetches every reference itself and takes no inline bytes: \`POST ${UPLOADS_URL}\` answers a public URL for a local file — pass that as \`{ url }\`.`,
    ctx,
  );
}

/** The slice of a compile context the two derivations below need. */
interface SizeContext {
  readonly model: string;
  readonly warn: Warn;
  fail(issue: CompileIssue): void;
  from(wirePath: Array<string | number>, canonical: "size" | "aspectRatio" | "dimensions"): void;
  take<T>(derived: Derived<T>): T | undefined;
}

/**
 * `input.aspect_ratio` for a picture, from whichever size word the caller
 * wrote.
 *
 * Revana sizes a picture by SHAPE (`aspect_ratio`) and, separately, by tier
 * (`resolution`); there is no pixel field. So `aspectRatio` maps exactly, and
 * `dimensions` / a `WxH` `size` are sent as the shape they describe with the
 * `approximated_param` that conversion always carries.
 *
 * `ratios` is the model's listed shapes — the answer is then the catalog's own
 * spelling, because the API matches the list as strings (`1.5:1` is refused
 * where `3:2` is listed). `undefined` is a model that lists none: the field is
 * free-form there ("must look like 16:9"), so the caller's ratio goes through
 * as written.
 */
export function toPictureAspectRatio(
  sizing: Sizing,
  ratios: readonly string[] | undefined,
  ctx: SizeContext,
): string | undefined {
  if (sizing.kind !== "ratio" && sizing.kind !== "dimensions") return undefined;
  const field = sizingField(sizing);
  const derive: DeriveContext = { path: [field], warn: ctx.warn };
  ctx.from(["input", "aspect_ratio"], field);

  const spelling =
    sizing.kind === "ratio"
      ? sizing.aspectRatio
      : ctx.take(pixelsToRatio(sizing.dimensions.width, sizing.dimensions.height, ratios, derive));
  if (spelling === undefined || ratios === undefined) return spelling;
  return ctx.take(toRatioEnum(spelling, ratios, { source: REVANA_MODELS_SOURCE }, derive));
}

/**
 * A canonical size tier in the spelling a model's catalog row lists, or a
 * refusal naming the tiers it has.
 *
 * `wire` is the generated map (`gen/<category>-params.gen.ts`). A tier it lacks
 * is an error rather than the next tier down, and the message says where the
 * model's other sizes are still reachable: Revana lists several a canonical
 * word does not cover (`2K` on a video model, `1MP` on a picture one).
 */
export function toRevanaTier(
  tier: string,
  wire: Readonly<Partial<Record<string, string>>>,
  ctx: Pick<SizeContext, "model" | "fail">,
): string | undefined {
  const spelling = wire[tier];
  if (spelling !== undefined) return spelling;
  const offered = Object.keys(wire);
  ctx.fail({
    code: "invalid_enum_value",
    path: ["resolution"],
    message:
      (offered.length === 0
        ? `"${ctx.model}" lists resolutions, but none of them is a canonical tier`
        : `\`resolution\` must be ${offered.map((value) => `"${value}"`).join(" or ")} on "${ctx.model}"`) +
      `; got "${tier}". The sizes Revana lists for this model in its own words (\`GET /v1/models\`, ` +
      "`options.resolutions`) are reachable through `providerOptions.revana.input.resolution`.",
    meta: { allowed: offered, value: tier, source: REVANA_MODELS_SOURCE },
  });
  return undefined;
}
