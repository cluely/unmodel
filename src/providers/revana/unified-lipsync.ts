/**
 * `unmodel/lipsync` → `revana.lipsync`
 * (POST https://api.revana.si/v1/generations).
 *
 * A clip and a sound, each a public URL (`toRevanaMediaUrl`):
 *
 * | canonical | wire (`input.…`) |
 * |---|---|
 * | `source` | `video_url` |
 * | `audio` | `audio_url` — "A sound to drive the video" |
 * | `seed` | `seed` |
 *
 * `prompt` is a per-model extra: every `ModelInput` model has the field and
 * this vocabulary has no word for it.
 *
 * The roster is `revana.lipsync`'s — the curated `views.lipsync` ids. Any other
 * Revana id sent here, the `SeedanceInput` and `NemesisInput` models included,
 * is refused by that address by name ("serves the Revana models that re-voice
 * a clip to a sound … `revana.video` validates it").
 */

import { applyExtras } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { LipsyncAdapterFor, LipsyncParams } from "../../core/unified/vocabulary/lipsync";
import { toRevanaMediaUrl } from "./compile-input";
import { lipsync as validator } from "./lipsync";
import { MODELS, REVANA_LIPSYNC_MODEL_PARAMS } from "./lipsync-params";

/**
 * `input`, as this adapter writes it and as `providerOptions.revana.input`
 * completes it, with a media reference typed as the plain string the caller
 * supplied.
 */
export interface RevanaLipsyncWireInput {
  video_url?: string;
  audio_url?: string;
  seed?: number;
  /** A per-model extra. */
  prompt?: string;
}

/** The wire body this adapter compiles to: `GenerationRequest`, loosely typed. */
export interface RevanaLipsyncWire {
  model: string;
  input: RevanaLipsyncWireInput;
  max_cost_usd?: number;
  max_wait_s?: number;
}

/** What a unified lipsync call to `revana/…` returns — see `RevanaVideoResult` in `./unified-video.ts`. */
export type RevanaLipsyncResult = ReturnType<typeof validator<string>>;

/** See `RevanaVideoValidate` in `./unified-video.ts`. */
type RevanaLipsyncValidate = CompiledCall<RevanaLipsyncWire, RevanaLipsyncResult>["validate"];

export const lipsync = {
  category: "lipsync",
  provider: "revana",
  models: MODELS,
  modelParams: REVANA_LIPSYNC_MODEL_PARAMS,
  compile(
    input: LipsyncParams,
    ctx: CompileContext<LipsyncParams>,
  ): CompiledCall<RevanaLipsyncWire, RevanaLipsyncResult> {
    const wire: RevanaLipsyncWireInput = {};
    ctx.from(["input", "video_url"], "source");
    ctx.from(["input", "audio_url"], "audio");
    ctx.from(["input", "seed"], "seed");

    const source = ctx.take(toRevanaMediaUrl(input.source, { path: ["source"], warn: ctx.warn }));
    if (source !== undefined) wire.video_url = source;
    const audio = ctx.take(toRevanaMediaUrl(input.audio, { path: ["audio"], warn: ctx.warn }));
    if (audio !== undefined) wire.audio_url = audio;
    if (input.seed !== undefined) wire.seed = input.seed;

    const body: RevanaLipsyncWire = { model: ctx.model, input: wire };
    applyExtras(input, REVANA_LIPSYNC_MODEL_PARAMS, body, ctx, { at: ["input"] });
    return { params: body, validate: validator.safe as RevanaLipsyncValidate };
  },
} as const satisfies LipsyncAdapterFor<
  typeof REVANA_LIPSYNC_MODEL_PARAMS,
  RevanaLipsyncWire,
  RevanaLipsyncResult
>;
