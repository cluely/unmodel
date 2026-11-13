/**
 * `unmodel/upscale` → `revana.upscale`
 * (POST https://api.revana.si/v1/generations).
 *
 * One model today (`recraft-crisp-upscale`), and the smallest mapping in the
 * provider:
 *
 * | canonical | wire (`input.…`) | notes |
 * |---|---|---|
 * | `source` | `image_url` | a public URL — see `toRevanaMediaUrl` |
 * | `prompt` | `prompt` | sent; whether a route steers on one is the route's to say |
 * | `factor` | — | declared unsupported |
 *
 * # The source is the still
 *
 * The model's own summary is "It takes: input.image_url or input.video_url",
 * and the two are different fields. A canonical `{ url }` does not say which
 * medium is behind it, and Revana takes no inline bytes whose media type
 * could — so every row's `sources` is `["image"]` and the source lands on
 * `image_url`. A clip is addressed on `revana.upscale` by name.
 *
 * # There is no multiplier
 *
 * `ModelInput` has no scale field: an upscaler "returns one picture for each
 * picture sent", and nothing in the request sizes the result. So `factor` is
 * refused for every model rather than per row, and the rows type it `never`.
 */

import { applyExtras } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { UpscaleAdapterFor, UpscaleParams } from "../../core/unified/vocabulary/upscale";
import { toRevanaMediaUrl } from "./compile-input";
import { upscale as validator } from "./upscale";
import { MODELS, REVANA_UPSCALE_MODEL_PARAMS } from "./upscale-params";

/**
 * `input`, as this adapter writes it and as `providerOptions.revana.input`
 * completes it — the media fields an upscaler takes, typed as plain strings.
 */
export interface RevanaUpscaleWireInput {
  image_url?: string;
  /** The clip arm: "input.image_url or input.video_url". */
  video_url?: string;
  prompt?: string;
}

/** The wire body this adapter compiles to: `GenerationRequest`, loosely typed. */
export interface RevanaUpscaleWire {
  model: string;
  input: RevanaUpscaleWireInput;
  max_cost_usd?: number;
  max_wait_s?: number;
}

/** What a unified upscale call to `revana/…` returns — see `RevanaVideoResult` in `./unified-video.ts`. */
export type RevanaUpscaleResult = ReturnType<typeof validator<string>>;

/** See `RevanaVideoValidate` in `./unified-video.ts`. */
type RevanaUpscaleValidate = CompiledCall<RevanaUpscaleWire, RevanaUpscaleResult>["validate"];

export const upscale = {
  category: "upscale",
  provider: "revana",
  models: MODELS,
  modelParams: REVANA_UPSCALE_MODEL_PARAMS,
  unsupported: {
    factor:
      "Revana's `ModelInput` has no multiplier field — an upscaler takes the thing to enlarge " +
      "(`input.image_url` or `input.video_url`) and nothing that sizes the result.",
  },
  compile(
    input: UpscaleParams,
    ctx: CompileContext<UpscaleParams>,
  ): CompiledCall<RevanaUpscaleWire, RevanaUpscaleResult> {
    const wire: RevanaUpscaleWireInput = {};
    ctx.from(["input", "image_url"], "source");
    ctx.from(["input", "prompt"], "prompt");

    const source = ctx.take(toRevanaMediaUrl(input.source, { path: ["source"], warn: ctx.warn }));
    if (source !== undefined) wire.image_url = source;
    if (input.prompt !== undefined) wire.prompt = input.prompt;

    const body: RevanaUpscaleWire = { model: ctx.model, input: wire };
    applyExtras(input, REVANA_UPSCALE_MODEL_PARAMS, body, ctx, { at: ["input"] });
    return { params: body, validate: validator.safe as RevanaUpscaleValidate };
  },
} as const satisfies UpscaleAdapterFor<
  typeof REVANA_UPSCALE_MODEL_PARAMS,
  RevanaUpscaleWire,
  RevanaUpscaleResult
>;
