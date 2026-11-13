/**
 * `unmodel/avatar` → `revana.avatar`
 * (POST https://api.revana.si/v1/generations).
 *
 * A still and a sound, each a public URL (`toRevanaMediaUrl`):
 *
 * | canonical | wire (`input.…`) |
 * |---|---|
 * | `image` | `image_url` |
 * | `audio` | `audio_url` — "A sound to drive the video" |
 * | `seed` | `seed` |
 *
 * Every row's `sources` is `["image"]`, so `image` is required: these models
 * animate a picture the caller supplies, and Revana has no catalogued
 * performer to name instead.
 *
 * `prompt` is a per-model extra — every `ModelInput` model has the field and
 * this vocabulary has no word for it. It is the one extra worth knowing about
 * here: routes for the avatar models were seen to refuse a request without one
 * ("needs prompt", docs/research/revana.md), which is a fact about today's
 * routes and so not a rule `revana.avatar` or this adapter enforces.
 *
 * `unmodel/avatar` has no `duration` and no `resolution` — the clip's length
 * follows the sound — so the ones some of these rows list ride on
 * `providerOptions.revana.input`.
 *
 * The roster is `revana.avatar`'s — the curated `views.avatar` ids. Any other
 * Revana id sent here, the `SeedanceInput` and `NemesisInput` models included,
 * is refused by that address by name.
 */

import { applyExtras } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { AvatarAdapterFor, AvatarParams } from "../../core/unified/vocabulary/avatar";
import { avatar as validator } from "./avatar";
import { MODELS, REVANA_AVATAR_MODEL_PARAMS } from "./avatar-params";
import { toRevanaMediaUrl } from "./compile-input";

/**
 * `input`, as this adapter writes it and as `providerOptions.revana.input`
 * completes it, with a media reference typed as the plain string the caller
 * supplied.
 */
export interface RevanaAvatarWireInput {
  image_url?: string;
  audio_url?: string;
  seed?: number;
  /** A per-model extra. */
  prompt?: string;
  /** Listed by some of these models; no canonical word in `unmodel/avatar`. */
  resolution?: string;
  duration?: number;
}

/** The wire body this adapter compiles to: `GenerationRequest`, loosely typed. */
export interface RevanaAvatarWire {
  model: string;
  input: RevanaAvatarWireInput;
  max_cost_usd?: number;
  max_wait_s?: number;
}

/** What a unified avatar call to `revana/…` returns — see `RevanaVideoResult` in `./unified-video.ts`. */
export type RevanaAvatarResult = ReturnType<typeof validator<string>>;

/** See `RevanaVideoValidate` in `./unified-video.ts`. */
type RevanaAvatarValidate = CompiledCall<RevanaAvatarWire, RevanaAvatarResult>["validate"];

export const avatar = {
  category: "avatar",
  provider: "revana",
  models: MODELS,
  modelParams: REVANA_AVATAR_MODEL_PARAMS,
  compile(
    input: AvatarParams,
    ctx: CompileContext<AvatarParams>,
  ): CompiledCall<RevanaAvatarWire, RevanaAvatarResult> {
    const wire: RevanaAvatarWireInput = {};
    ctx.from(["input", "image_url"], "image");
    ctx.from(["input", "audio_url"], "audio");
    ctx.from(["input", "seed"], "seed");

    if (input.image !== undefined) {
      const image = ctx.take(toRevanaMediaUrl(input.image, { path: ["image"], warn: ctx.warn }));
      if (image !== undefined) wire.image_url = image;
    }
    const audio = ctx.take(toRevanaMediaUrl(input.audio, { path: ["audio"], warn: ctx.warn }));
    if (audio !== undefined) wire.audio_url = audio;
    if (input.seed !== undefined) wire.seed = input.seed;

    const body: RevanaAvatarWire = { model: ctx.model, input: wire };
    applyExtras(input, REVANA_AVATAR_MODEL_PARAMS, body, ctx, { at: ["input"] });
    return { params: body, validate: validator.safe as RevanaAvatarValidate };
  },
} as const satisfies AvatarAdapterFor<
  typeof REVANA_AVATAR_MODEL_PARAMS,
  RevanaAvatarWire,
  RevanaAvatarResult
>;
