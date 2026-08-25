/**
 * `unmodel/lipsync` → sync., the category's second provider.
 *
 * # The one that makes the category a category
 *
 * `unmodel/lipsync` shipped on fal alone, and four of fal's ten lipsync
 * endpoints are sync.'s models resold — `fal-ai/sync-lipsync/v2` even keeps
 * sync.'s own `model: "lipsync-2"` field on the wire. So the category's five
 * words were, until now, read off one schema with sync.'s fingerprints on it.
 * This adapter is the same models reached at their own API, and the two
 * disagree in exactly the ways a reseller and a vendor disagree:
 *
 * ```ts
 * lipsync({ model: "fal/fal-ai/sync-lipsync/v2", source: { url }, audio: { url } });
 * // → { model: "lipsync-2", video_url: "…", audio_url: "…" }
 * //   POST https://queue.fal.run/fal-ai/sync-lipsync/v2
 *
 * lipsync({ model: "sync/lipsync-2", source: { url }, audio: { url } });
 * // → { model: "lipsync-2", input: [ { type: "video", url: "…" },
 * //                                  { type: "audio", url: "…" } ] }
 * //   POST https://api.sync.so/v2/generate
 * ```
 *
 * Two flat URL fields at the reseller; a typed ARRAY of tagged items at the
 * vendor. That is not a cosmetic difference — the array is what carries several
 * voices, `refId`s, segments and dubbing, none of which fal's flattening can
 * express — and it is the comparison the golden tree pins.
 *
 * # `source` and `audio` are array ITEMS, not fields
 *
 * The whole adapter is this one fact. `input` is `Input[]` and each item is
 * tagged by `type`, so the canonical `source` becomes `input[0]` and the
 * canonical `audio` becomes `input[1]`. `ctx.from` maps both back with their
 * indices, so a finding `sync.lipsync` raises about `input[1].url` arrives at
 * the caller's `audio`.
 *
 * # There is no `seed`
 *
 * sync. publishes no seed anywhere in `CreateGenerationDto` — not on the body,
 * not under `options` — so the canonical `seed` is refused by name rather than
 * dropped. It is the only one of the category's five words this provider cannot
 * serve, and lipsync is mostly deterministic given a clip and a track, so it
 * costs a caller nothing to omit.
 *
 * # Inline bytes are refused, not encoded
 *
 * A media item takes `url` or `assetId`, and both are documented as references
 * sync. FETCHES. Nothing in the JSON body accepts a payload — direct uploads go
 * through the separate multipart form or through `POST /v2/assets/upload` — so a
 * `{ data }` ref is refused here naming the upload endpoint, rather than
 * compiled into a `data:` URI sync. would fail to fetch. (fal's resale of the
 * same models does accept a data URI, which is a real difference between the two
 * routes to one model and is stated on both adapters rather than in prose.)
 *
 * # There is no adapter-wide `unsupported`
 *
 * Risk R7. `temperature` exists at two of the five models, `model_mode` and
 * `prompt` at one, `occlusion_detection_enabled` at three — a provider-wide
 * claim about any of them would be false at most of this roster. Every refusal
 * comes off the row.
 */

import { applyExtras, requireMediaUrl } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { AnyLipsyncAdapter, LipsyncParams } from "../../core/unified/vocabulary/lipsync";
import { lipsync as validator, type SyncLipsyncParams } from "./lipsync";
import { MODELS, SYNC_LIPSYNC_MODEL_PARAMS } from "./lipsync-params";
import { ASSET_UPLOAD_HINT, OPTION_EXTRAS, SOURCE_URL } from "./adapter-shared";

/** The wire body this adapter compiles to — `sync.lipsync`'s own params. */
export type SyncLipsyncWire = SyncLipsyncParams;

/** What a unified lipsync call to `sync/…` returns. */
export type SyncLipsyncResult = ReturnType<typeof validator>;

/** See `fal/unified-image.ts`: `CompiledCall.validate` is not generic. */
type SyncLipsyncValidate = CompiledCall<SyncLipsyncWire, SyncLipsyncResult>["validate"];

export const lipsync = {
  category: "lipsync",
  provider: "sync",
  models: MODELS,
  modelParams: SYNC_LIPSYNC_MODEL_PARAMS,
  compile(
    input: LipsyncParams,
    ctx: CompileContext<LipsyncParams>,
  ): CompiledCall<SyncLipsyncWire, SyncLipsyncResult> {
    const items: Array<Record<string, unknown>> = [];

    // --- the clip ----------------------------------------------------------
    ctx.from(["input", 0, "url"], "source");
    const source = ctx.take(
      requireMediaUrl(input.source, ASSET_UPLOAD_HINT, { path: ["source"], warn: ctx.warn }),
    );
    if (source !== undefined) items.push({ type: "video", url: source });

    // --- the voice track ---------------------------------------------------
    ctx.from(["input", items.length, "url"], "audio");
    const audio = ctx.take(
      requireMediaUrl(input.audio, ASSET_UPLOAD_HINT, { path: ["audio"], warn: ctx.warn }),
    );
    if (audio !== undefined) items.push({ type: "audio", url: audio });

    // --- seed, which this provider does not have ---------------------------
    if (input.seed !== undefined) {
      ctx.from(["seed"], "seed");
      ctx.fail({
        code: "unsupported_param",
        path: ["seed"],
        message:
          "sync. publishes no seed on `POST /v2/generate` — not on the body and not under `options` — " +
          `so \`seed\` has nothing to become at "${ctx.model}". Lipsync is near-deterministic given a ` +
          "clip and a track; `fal/fal-ai/latentsync` is the one endpoint in this category that exposes " +
          "one.",
        meta: { source: SOURCE_URL },
      });
    }

    const body = { model: ctx.model, input: items } as unknown as SyncLipsyncWire;
    applyExtras(input, SYNC_LIPSYNC_MODEL_PARAMS, body, ctx, { nest: OPTION_EXTRAS });

    return { params: body, validate: validator.safe as SyncLipsyncValidate };
  },
} as const satisfies AnyLipsyncAdapter;
