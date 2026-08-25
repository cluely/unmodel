/**
 * `unmodel/avatar` → HeyGen, the category's fourth provider.
 *
 * # The first route in the category with a real inline-bytes arm
 *
 * ```ts
 * avatar({ model: "heygen/avatar_iv", image: { url }, audio: { url } });
 * // → { type: "image", image: { type: "url", url: "…" },
 * //     audio_url: "…", engine: { type: "avatar_iv" } }
 * //   POST https://api.heygen.com/v3/videos
 *
 * avatar({ model: "heygen/avatar_iv", image: { data, mimeType: "image/png" }, audio: { url } });
 * // → { …, image: { type: "base64", media_type: "image/png", data: "…" }, … }
 * ```
 *
 * Three answers now exist in this category for the same canonical `{ data,
 * mimeType }`, and they are three different facts about three wires: fal
 * compiles a `data:` URI into a field that fetches URLs; sync. and VEED refuse
 * it, because their fields fetch and nothing else; HeyGen has a THIRD arm on
 * its own `oneOf` — `{ type: "base64", media_type, data }` — and the bytes go
 * there structurally rather than encoded into a string.
 *
 * And within this one route the two media fields disagree: `image` has that
 * arm and `audio_url` / `audio_asset_id` do not. So inline bytes compile for
 * the still and are refused for the track, at the same model, in the same
 * request. The refusal says so, because a caller who has bytes for both would
 * otherwise read the second error as a contradiction of the first.
 *
 * # There is no `model` field, so the ref writes the ENGINE
 *
 * `engine` is optional on the wire and an omitted one means `avatar_iv` — which
 * is also a four-fold price decision, since Avatar III is $0.0167/sec for a
 * digital twin and Avatar IV is $0.0667. So this adapter always writes the
 * engine out. A body compiled here never depends on a server-side default for
 * something that costs money.
 *
 * # Two rows where the wire address has three engines
 *
 * `avatar_iii` is absent because it does not render raw image input — its own
 * engine config says so — and this adapter compiles the raw-image arm. Which
 * arm, and why, is argued in `./avatar-params.ts`; the short version is that
 * the catalogued-look arm needs an `avatar_id` that is account-scoped and
 * unpublishable, and that an avatar row can say "required", "forbidden" or
 * "unknown" about `image` but never "optional".
 *
 * # There is no `seed`
 *
 * `POST /v3/videos` publishes none, on any arm or engine, so the canonical
 * `seed` is refused by name rather than dropped.
 *
 * # There is no adapter-wide `unsupported`
 *
 * Risk R7. `expressiveness` exists at one of the two engines and
 * `reference_look_id` at the other; a provider-wide claim about either would be
 * false at half this roster. Every refusal comes off the row.
 */

import { applyExtras, requireMediaUrl } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { AnyAvatarAdapter, AvatarParams } from "../../core/unified/vocabulary/avatar";
import { avatar as validator, type HeygenAvatarParams } from "./avatar";
import { HEYGEN_AVATAR_MODEL_PARAMS, MODELS } from "./avatar-params";
import { AUDIO_UPLOAD_HINT, SOURCE_URL } from "./adapter-shared";

/** The wire body this adapter compiles to — `heygen.avatar`'s own params. */
export type HeygenAvatarWire = HeygenAvatarParams;

/** What a unified avatar call to `heygen/…` returns. */
export type HeygenAvatarResult = ReturnType<typeof validator>;

/** See `fal/unified-image.ts`: `CompiledCall.validate` is not generic. */
type HeygenAvatarValidate = CompiledCall<HeygenAvatarWire, HeygenAvatarResult>["validate"];

/** `reference_look_id` is declared flat on the row and lives inside `engine`. */
const NESTED_EXTRAS: Readonly<Record<string, readonly string[]>> = {
  reference_look_id: ["engine"],
};

/** `data:image/png;base64,AAAA` → `["image/png", "AAAA"]`. */
const DATA_URI = /^data:([^;,]*)(?:;[^,]*)*,(.*)$/s;

export const avatar = {
  category: "avatar",
  provider: "heygen",
  models: MODELS,
  modelParams: HEYGEN_AVATAR_MODEL_PARAMS,
  compile(
    input: AvatarParams,
    ctx: CompileContext<AvatarParams>,
  ): CompiledCall<HeygenAvatarWire, HeygenAvatarResult> {
    // `type` and `engine` are both written unconditionally: the first is the
    // arm this adapter serves and the second is a price decision that must not
    // be left to a server-side default.
    const body: Record<string, unknown> = { type: "image", engine: { type: ctx.model } };

    // --- the still ---------------------------------------------------------
    const image = input.image;
    if (image === undefined) {
      // `AvatarModelNarrowing` already refuses this at the keystroke, because
      // both rows say `sources: ["image"]`. This is the same refusal for
      // JavaScript callers and run-time-built refs.
      ctx.fail({
        code: "invalid_shape",
        path: ["image"],
        message:
          `"${ctx.model}" animates a picture you supply and this request has none — \`image\` is ` +
          "required here. HeyGen's other arm animates a catalogued look instead, and its `avatar_id` " +
          "is workspace-scoped: reach it at `heygen.avatar({ type: \"avatar\", avatar_id, … })`.",
        meta: { source: SOURCE_URL },
      });
    } else if ("url" in image) {
      ctx.from(["image", "url"], "image");
      body["image"] = { type: "url", url: image.url };
    } else {
      // The inline arm — structural, not a `data:` string. A caller who already
      // has a data URI gets it unwrapped, because the field wants the payload
      // and the media type separately.
      ctx.from(["image", "data"], "image");
      const match = DATA_URI.exec(image.data);
      const mediaType =
        match?.[1] !== undefined && match[1] !== "" ? match[1] : (image.mimeType ?? undefined);
      const data = match === null ? image.data : (match[2] ?? "");
      if (mediaType === undefined) {
        ctx.fail({
          code: "invalid_shape",
          path: ["image"],
          message:
            "`image` was given as inline bytes with no `mimeType`, and HeyGen's inline arm carries " +
            "the media type as its own field (`{ type: \"base64\", media_type, data }`) rather than " +
            "in a `data:` envelope it could be read out of. Add `mimeType`, or pass a `url`.",
          meta: { source: SOURCE_URL },
        });
      } else {
        body["image"] = { type: "base64", media_type: mediaType, data };
      }
    }

    // --- the voice track ---------------------------------------------------
    // …which does NOT have the still's inline arm. Same route, same request,
    // two different answers, and the hint says why so the pair does not read as
    // a contradiction.
    ctx.from(["audio_url"], "audio");
    const audio = ctx.take(
      requireMediaUrl(input.audio, AUDIO_UPLOAD_HINT, { path: ["audio"], warn: ctx.warn }),
    );
    if (audio !== undefined) body["audio_url"] = audio;

    // --- seed, which this provider does not have ---------------------------
    if (input.seed !== undefined) {
      ctx.from(["seed"], "seed");
      ctx.fail({
        code: "unsupported_param",
        path: ["seed"],
        message:
          "HeyGen publishes no seed on `POST /v3/videos` — not on either arm and not on any engine — " +
          `so \`seed\` has nothing to become at "${ctx.model}". Repeatability here is a property of ` +
          "the LOOK rather than of the request: the same avatar and the same track render the same " +
          "performance.",
        meta: { source: SOURCE_URL },
      });
    }

    applyExtras(input, HEYGEN_AVATAR_MODEL_PARAMS, body, ctx, { nest: NESTED_EXTRAS });

    return {
      params: body as unknown as HeygenAvatarWire,
      validate: validator.safe as HeygenAvatarValidate,
    };
  },
} as const satisfies AnyAvatarAdapter;
