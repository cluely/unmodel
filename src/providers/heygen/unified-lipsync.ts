/**
 * `unmodel/lipsync` → HeyGen, the category's fourth provider.
 *
 * # The ref writes a MODE, because there is no model field
 *
 * ```ts
 * lipsync({ model: "heygen/lipsync-speed", source: { url }, audio: { url } });
 * // → { video: { type: "url", url: "…" }, audio: { type: "url", url: "…" }, mode: "speed" }
 * //   POST https://api.heygen.com/v3/lipsyncs
 * ```
 *
 * `mode: "speed" | "precision"` is the only thing separating two products with
 * two documentation pages and a 2× price difference, so unmodel catalogs them
 * as two ids and this adapter writes the wire value back from the ref. It is
 * written UNCONDITIONALLY, including for `"speed"`, which is HeyGen's own
 * default: a ref that names a price should not depend on a server-side default
 * to get it.
 *
 * That makes three shapes of route selector in this one category. At fal the
 * selector is a pseudo-param stripped into the URL; at sync. and Topaz it is a
 * real `model` field that survives onto the wire; here it is a real field that
 * survives onto the wire under a DIFFERENT NAME from the id that produced it.
 * At VEED there is no selector at all — the model is the path.
 *
 * # `source` and `audio` are objects, not URLs
 *
 * `CreateLipsyncRequest.video` and `.audio` are each a `oneOf` on `type`:
 * `{ type: "url", url }` or `{ type: "asset_id", asset_id }`. So the canonical
 * `{ url }` becomes a two-field object rather than a string, and `ctx.from`
 * maps `video.url` back to `source` so a finding HeyGen's validator raises
 * about the wrong coordinate still arrives at the caller's word.
 *
 * # Inline bytes are refused, and the sibling route accepts them
 *
 * The `AssetBase64` arm exists in HeyGen's spec and is NOT on this route's
 * `oneOf` — `POST /v3/videos`'s `image` has it and `POST /v3/lipsyncs`'s
 * `video` and `audio` do not. So `heygen/…` refuses bytes here and compiles
 * them at `unmodel/avatar`, which is one vendor's own asymmetry rather than a
 * decision made here.
 *
 * # There is no `seed`
 *
 * Not on this route, not on the video route. The canonical `seed` is refused by
 * name rather than dropped.
 *
 * # There is no adapter-wide `unsupported`
 *
 * Risk R7 — and at this provider the two rows genuinely are identical, because
 * `mode` changes the price and the pipeline rather than the request surface.
 * The refusals are still written off the row, so a third mode joins by adding a
 * row.
 */

import { applyExtras, requireMediaUrl } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { AnyLipsyncAdapter, LipsyncParams } from "../../core/unified/vocabulary/lipsync";
import { lipsync as validator, type HeygenLipsyncParams } from "./lipsync";
import { HEYGEN_LIPSYNC_MODEL_PARAMS, MODELS } from "./lipsync-params";
import { HEYGEN_LIPSYNC_MODE_BY_MODEL } from "./shared";
import { LIPSYNC_SOURCE_URL, LIPSYNC_UPLOAD_HINT } from "./adapter-shared";

/** The wire body this adapter compiles to — `heygen.lipsync`'s own params. */
export type HeygenLipsyncWire = HeygenLipsyncParams;

/** What a unified lipsync call to `heygen/…` returns. */
export type HeygenLipsyncResult = ReturnType<typeof validator>;

/** See `fal/unified-image.ts`: `CompiledCall.validate` is not generic. */
type HeygenLipsyncValidate = CompiledCall<HeygenLipsyncWire, HeygenLipsyncResult>["validate"];

/**
 * The id → `mode` map, widened to a string index.
 *
 * The table is `as const` and keyed by literal id, which is the point of it;
 * `ctx.model` is a `string` at run time, so the lookup needs the index the
 * literal table deliberately does not have.
 */
const MODE_BY_MODEL: Readonly<Record<string, string | undefined>> = HEYGEN_LIPSYNC_MODE_BY_MODEL;

export const lipsync = {
  category: "lipsync",
  provider: "heygen",
  models: MODELS,
  modelParams: HEYGEN_LIPSYNC_MODEL_PARAMS,
  compile(
    input: LipsyncParams,
    ctx: CompileContext<LipsyncParams>,
  ): CompiledCall<HeygenLipsyncWire, HeygenLipsyncResult> {
    const body: Record<string, unknown> = {};

    // --- the clip ----------------------------------------------------------
    ctx.from(["video", "url"], "source");
    const source = ctx.take(
      requireMediaUrl(input.source, LIPSYNC_UPLOAD_HINT, { path: ["source"], warn: ctx.warn }),
    );
    if (source !== undefined) body["video"] = { type: "url", url: source };

    // --- the voice track ---------------------------------------------------
    ctx.from(["audio", "url"], "audio");
    const audio = ctx.take(
      requireMediaUrl(input.audio, LIPSYNC_UPLOAD_HINT, { path: ["audio"], warn: ctx.warn }),
    );
    if (audio !== undefined) body["audio"] = { type: "url", url: audio };

    // --- the mode, which is what the ref actually names ---------------------
    // An unrostered ref has already drawn `unknown_model` from the kernel; it
    // reaches HeyGen's own validator without a `mode`, which is the same thing
    // an omitted `mode` means there (`"speed"`).
    const mode = MODE_BY_MODEL[ctx.model];
    if (mode !== undefined) body["mode"] = mode;

    // --- seed, which this provider does not have ---------------------------
    if (input.seed !== undefined) {
      ctx.from(["seed"], "seed");
      ctx.fail({
        code: "unsupported_param",
        path: ["seed"],
        message:
          "HeyGen publishes no seed on `POST /v3/lipsyncs`, so `seed` has nothing to become at " +
          `"${ctx.model}". \`fal/fal-ai/latentsync\` is the one endpoint in this category that ` +
          "exposes one.",
        meta: { source: LIPSYNC_SOURCE_URL },
      });
    }

    applyExtras(input, HEYGEN_LIPSYNC_MODEL_PARAMS, body, ctx);

    return {
      params: body as unknown as HeygenLipsyncWire,
      validate: validator.safe as HeygenLipsyncValidate,
    };
  },
} as const satisfies AnyLipsyncAdapter;
