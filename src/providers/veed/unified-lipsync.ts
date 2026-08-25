/**
 * `unmodel/lipsync` → VEED, the category's third provider and its second
 * native one.
 *
 * # The one with nothing on it
 *
 * ```ts
 * lipsync({ model: "veed/lipsync-2.0", source: { url }, audio: { url } });
 * // → { video_url: "…", audio_url: "…" }
 * //   POST https://api.veed.io/v1/lipsync-2.0
 * ```
 *
 * Two fields, both canonical, and no third thing to say. Every other adapter in
 * this category has a row full of per-model extras; this one's is `{}`, because
 * `Lipsync20Input` declares exactly `video_url` and `audio_url` and is
 * `additionalProperties: false`. A route with no dials is not a gap in the
 * adapter — it is what the vendor published, and it is the cleanest available
 * evidence for the category's central vocabulary decision (see
 * `./lipsync-params.ts`).
 *
 * # There is no `seed`
 *
 * Not on the body, not under a nested object, not anywhere in VEED's ten
 * operations. So the canonical `seed` is refused by name rather than dropped.
 *
 * # Inline bytes are refused, not encoded
 *
 * VEED has no upload arm and every media field carries the pattern
 * `^[Hh][Tt][Tt][Pp][Ss]?://`, so a `data:` URI is a 422 with no job created.
 * The refusal names the one thing that works, and names the fal route to the
 * same model for callers who have bytes rather than a URL.
 *
 * # There is no adapter-wide `unsupported`
 *
 * Risk R7 — and here it is nearly moot, because the roster is one model. The
 * refusals are still written off the row rather than declared provider-wide, so
 * a second VEED lipsync generation joins by adding a row and nothing else.
 */

import { requireMediaUrl } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { AnyLipsyncAdapter, LipsyncParams } from "../../core/unified/vocabulary/lipsync";
import { lipsync as validator, type VeedLipsyncParams } from "./lipsync";
import { MODELS, VEED_LIPSYNC_MODEL_PARAMS } from "./lipsync-params";
import { SOURCE_URL, UPLOAD_HINT } from "./adapter-shared";

/** The wire body this adapter compiles to — `veed.lipsync`'s own params. */
export type VeedLipsyncWire = VeedLipsyncParams;

/** What a unified lipsync call to `veed/…` returns. */
export type VeedLipsyncResult = ReturnType<typeof validator>;

/** See `fal/unified-image.ts`: `CompiledCall.validate` is not generic. */
type VeedLipsyncValidate = CompiledCall<VeedLipsyncWire, VeedLipsyncResult>["validate"];

export const lipsync = {
  category: "lipsync",
  provider: "veed",
  models: MODELS,
  modelParams: VEED_LIPSYNC_MODEL_PARAMS,
  compile(
    input: LipsyncParams,
    ctx: CompileContext<LipsyncParams>,
  ): CompiledCall<VeedLipsyncWire, VeedLipsyncResult> {
    const body: Record<string, unknown> = {};

    // --- the clip ----------------------------------------------------------
    ctx.from(["video_url"], "source");
    const source = ctx.take(
      requireMediaUrl(input.source, UPLOAD_HINT, { path: ["source"], warn: ctx.warn }),
    );
    if (source !== undefined) body["video_url"] = source;

    // --- the voice track ---------------------------------------------------
    ctx.from(["audio_url"], "audio");
    const audio = ctx.take(
      requireMediaUrl(input.audio, UPLOAD_HINT, { path: ["audio"], warn: ctx.warn }),
    );
    if (audio !== undefined) body["audio_url"] = audio;

    // --- seed, which this provider does not have ---------------------------
    if (input.seed !== undefined) {
      ctx.from(["seed"], "seed");
      ctx.fail({
        code: "unsupported_param",
        path: ["seed"],
        message:
          "VEED publishes no seed on any of its ten operations, so `seed` has nothing to become at " +
          `"${ctx.model}". \`Lipsync20Input\` is \`video_url\` and \`audio_url\` and is ` +
          "`additionalProperties: false`, so sending one anyway would be a 422 rather than an " +
          "ignored field.",
        meta: { source: SOURCE_URL },
      });
    }

    // No `applyExtras` call, and that is deliberate rather than an omission:
    // the row's `extras` is `{}` because the wire has no third field. The
    // helper would be a no-op over an empty name set, and leaving it out is
    // one fewer thing to read as "extras are handled somewhere".
    return {
      params: body as unknown as VeedLipsyncWire,
      validate: validator.safe as VeedLipsyncValidate,
    };
  },
} as const satisfies AnyLipsyncAdapter;
