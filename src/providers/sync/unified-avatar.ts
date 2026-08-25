/**
 * `unmodel/avatar` → sync., the category's second provider.
 *
 * # One model, and it is the same model the lipsync adapter serves
 *
 * `sync/sync-3` is reachable from `unmodel/lipsync` AND from `unmodel/avatar`,
 * and the difference is what goes in. That is the split the two categories
 * exist to make, and this is the first provider in the library where it lands
 * on ONE model id rather than on two endpoint ids: at fal the same product is
 * `fal-ai/sync-lipsync/v3` and `fal-ai/sync-lipsync/v3/image-to-video`, two
 * paths; here `model: "sync-3"` never changes and `input[0].type` moves from
 * `"video"` to `"image"`.
 *
 * ```ts
 * lipsync({ model: "sync/sync-3", source: { url: clip },  audio: { url } });
 * // → { model: "sync-3", input: [ { type: "video", url: clip }, … ] }
 *
 * avatar({  model: "sync/sync-3", image:  { url: still }, audio: { url } });
 * // → { model: "sync-3", input: [ { type: "image", url: still }, … ] }
 * ```
 *
 * Same URL, same model, two categories, and the only thing that tells them
 * apart is the tag on the item. Which is why the split has to be a CATEGORY
 * rather than an optional field: a single `source` that meant either would put
 * the discriminator in the caller's head.
 *
 * # `image` is required here
 *
 * The row says `sources: ["image"]`, which types `image` as required rather
 * than optional. Two of fal's eight avatar rows say `sources: []` because their
 * performer is a catalogued id; sync. has no such roster and no field for one,
 * so there is nothing to make optional.
 *
 * # `sync_mode` is gone, and that is a row fact
 *
 * The lipsync rows all declare it; this one does not, because a still has no
 * duration for the audio to mismatch — sync. ignores the field for image
 * inputs. It is refused at the keystroke by the row rather than warned about at
 * run time, which is the difference between the two surfaces: the wire
 * validator still warns, because a raw caller can send it.
 *
 * # Inline bytes are refused, not encoded
 *
 * Same as the lipsync adapter and for the same reason: a media item takes a
 * `url` sync. fetches or an `assetId` from your library, and neither is a
 * payload. sync-3's page names JPEG, PNG and WebP as the formats it fetches.
 */

import { applyExtras, requireMediaUrl } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { AnyAvatarAdapter, AvatarParams } from "../../core/unified/vocabulary/avatar";
import { avatar as validator, type SyncAvatarParams } from "./avatar";
import { MODELS, SYNC_AVATAR_MODEL_PARAMS } from "./avatar-params";
import { ASSET_UPLOAD_HINT, OPTION_EXTRAS, SOURCE_URL } from "./adapter-shared";

/** The wire body this adapter compiles to — `sync.avatar`'s own params. */
export type SyncAvatarWire = SyncAvatarParams;

/** What a unified avatar call to `sync/…` returns. */
export type SyncAvatarResult = ReturnType<typeof validator>;

/** See `fal/unified-image.ts`: `CompiledCall.validate` is not generic. */
type SyncAvatarValidate = CompiledCall<SyncAvatarWire, SyncAvatarResult>["validate"];

export const avatar = {
  category: "avatar",
  provider: "sync",
  models: MODELS,
  modelParams: SYNC_AVATAR_MODEL_PARAMS,
  compile(
    input: AvatarParams,
    ctx: CompileContext<AvatarParams>,
  ): CompiledCall<SyncAvatarWire, SyncAvatarResult> {
    const items: Array<Record<string, unknown>> = [];

    // --- the still ---------------------------------------------------------
    if (input.image === undefined) {
      // `AvatarModelNarrowing` already refuses this at the keystroke, because
      // the row says `sources: ["image"]`. This is the same refusal for
      // JavaScript callers and run-time-built refs.
      ctx.fail({
        code: "invalid_shape",
        path: ["image"],
        message:
          `"${ctx.model}" animates a face you supply and this request has none — \`image\` is required ` +
          "here. sync. has no catalogue of preset performers and no field to name one, so there is " +
          "nothing to animate without a picture.",
        meta: { source: SOURCE_URL },
      });
    } else {
      ctx.from(["input", 0, "url"], "image");
      const still = ctx.take(
        requireMediaUrl(input.image, ASSET_UPLOAD_HINT, { path: ["image"], warn: ctx.warn }),
      );
      if (still !== undefined) items.push({ type: "image", url: still });
    }

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
          `so \`seed\` has nothing to become at "${ctx.model}". Three of fal's eight avatar endpoints ` +
          "expose one; none of sync.'s does.",
        meta: { source: SOURCE_URL },
      });
    }

    const body = { model: ctx.model, input: items } as unknown as SyncAvatarWire;
    applyExtras(input, SYNC_AVATAR_MODEL_PARAMS, body, ctx, { nest: OPTION_EXTRAS });

    return { params: body, validate: validator.safe as SyncAvatarValidate };
  },
} as const satisfies AnyAvatarAdapter;
