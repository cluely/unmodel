/**
 * `unmodel/avatar` → VEED, the category's third provider.
 *
 * # The route with a required word the vocabulary does not have
 *
 * ```ts
 * avatar({ model: "veed/fabric-1.0", image: { url }, audio: { url }, resolution: "480p" });
 * // → { image_url: "…", audio_url: "…", resolution: "480p" }
 * //   POST https://api.veed.io/v1/fabric-1.0
 * ```
 *
 * `resolution` is in `FabricInput.required` and carries no `default`, so VEED
 * answers 422 without it. `unmodel/avatar` has no canonical word for output
 * size on purpose — the clip's shape follows the still's and its length follows
 * the audio's, so both are answers rather than questions — and this is the one
 * route in the category that nonetheless insists. It rides as a per-model
 * extra, typed to VEED's two values, and this adapter refuses the request by
 * NAME when it is absent rather than letting VEED refuse it by number.
 *
 * Defaulting it was the alternative and it was rejected: `"480p"` and `"720p"`
 * are $0.08 and $0.15 per second of output, so a default unmodel invented would
 * be a line item on someone's invoice. The refusal quotes both rates, which is
 * the information the caller actually needs in order to choose.
 *
 * # `image` is required here
 *
 * The row says `sources: ["image"]`. Two rows in this category say `sources:
 * []` — `fal/veed/avatars/audio-to-video` and `fal/argil/avatars/audio-to-video`
 * — and the first of them is THIS VENDOR, reached through fal, animating a
 * catalogued presenter out of a closed enum of ~28 names. That product has no
 * native endpoint: `POST /v1/avatars` answers a real JSON 404 and the OpenAPI
 * document declares no roster and no `avatar_id`. Same vendor, two products,
 * opposite rows — which is the clearest thing this provider adds to the
 * category's `sources` mechanism.
 *
 * # Inline bytes are refused, not encoded
 *
 * Same as the lipsync adapter and for the same reason: VEED publishes no upload
 * arm of any kind, and every media field carries the `^https?://` pattern.
 */

import { applyExtras, requireMediaUrl } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { AnyAvatarAdapter, AvatarParams } from "../../core/unified/vocabulary/avatar";
import { avatar as validator, type VeedAvatarParams } from "./avatar";
import { MODELS, VEED_AVATAR_MODEL_PARAMS } from "./avatar-params";
import { SOURCE_URL, UPLOAD_HINT } from "./adapter-shared";

/** The wire body this adapter compiles to — `veed.avatar`'s own params. */
export type VeedAvatarWire = VeedAvatarParams;

/** What a unified avatar call to `veed/…` returns. */
export type VeedAvatarResult = ReturnType<typeof validator>;

/** See `fal/unified-image.ts`: `CompiledCall.validate` is not generic. */
type VeedAvatarValidate = CompiledCall<VeedAvatarWire, VeedAvatarResult>["validate"];

export const avatar = {
  category: "avatar",
  provider: "veed",
  models: MODELS,
  modelParams: VEED_AVATAR_MODEL_PARAMS,
  compile(
    input: AvatarParams,
    ctx: CompileContext<AvatarParams>,
  ): CompiledCall<VeedAvatarWire, VeedAvatarResult> {
    const body: Record<string, unknown> = {};

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
          "here. VEED's presenter library is a different product with no native endpoint (`POST " +
          "/v1/avatars` is a 404); reach it at `fal/veed/avatars/audio-to-video`, which names a " +
          "presenter instead of taking a picture.",
        meta: { source: SOURCE_URL },
      });
    } else {
      ctx.from(["image_url"], "image");
      const still = ctx.take(
        requireMediaUrl(input.image, UPLOAD_HINT, { path: ["image"], warn: ctx.warn }),
      );
      if (still !== undefined) body["image_url"] = still;
    }

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
          `"${ctx.model}". \`FabricInput\` is three fields and is \`additionalProperties: false\`, so ` +
          "sending one anyway would be a 422 rather than an ignored field.",
        meta: { source: SOURCE_URL },
      });
    }

    applyExtras(input, VEED_AVATAR_MODEL_PARAMS, body, ctx);

    // --- the required extra ------------------------------------------------
    // Checked AFTER `applyExtras`, because that is what puts `resolution` on
    // the body when the caller declared it as a top-level extra.
    //
    // `providerOptions.veed` is read here too, and that is not belt-and-braces:
    // the kernel merges a provider block into the wire body AFTER `compile`
    // returns, so a caller who reached for the escape hatch instead of the
    // typed extra would otherwise be refused for a field that IS on their way
    // to the wire. The schema still requires it, so the refusal is duplicated
    // rather than skipped — this one just arrives with the rates in it.
    const escaped = (input.providerOptions as Record<string, unknown> | undefined)?.["veed"];
    const viaOptions =
      typeof escaped === "object" && escaped !== null
        ? (escaped as Record<string, unknown>)["resolution"]
        : undefined;
    if (body["resolution"] === undefined && viaOptions === undefined) {
      ctx.fail({
        code: "invalid_shape",
        path: ["resolution"],
        message:
          `"${ctx.model}" requires \`resolution\` and VEED publishes no default for it, so a request ` +
          "without one is a 422 with no job created. Pass `resolution: \"480p\"` ($0.08 per second of " +
          'output) or `resolution: "720p"` ($0.15). unmodel does not choose for you here: the two are ' +
          "roughly a 2× difference on the bill.",
        meta: { source: "https://api.veed.io/models/fabric-1.0", allowed: ["480p", "720p"] },
      });
    }

    return {
      params: body as unknown as VeedAvatarWire,
      validate: validator.safe as VeedAvatarValidate,
    };
  },
} as const satisfies AnyAvatarAdapter;
