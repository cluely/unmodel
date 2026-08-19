/**
 * `unmodel/image` → `krea.image`
 * (POST https://api.krea.ai/generate/image/krea/krea-2/{variant}).
 *
 * # The model is the route, and it still goes in the body
 *
 * Krea 2 has no `model` field on the wire: the variant is the last segment of
 * the URL. The endpoint module handles that by taking `model` as a pseudo-param,
 * checking it against the catalog, and stripping it in `finalize` into
 * `krea2Url(model)` — so this adapter must emit `model: ctx.model`, and what
 * comes back is a body without it and a `.request.url` ending
 * `/generate/image/krea/krea-2/large`.
 *
 * The ids carry a slash (`krea-2/large`), which is exactly why the kernel
 * splits a ref on its **first** slash: `krea/krea-2/large` is provider `krea`,
 * model `krea-2/large`.
 *
 * # The defaults case: two required fields nobody asked for
 *
 * `prompt`, `aspect_ratio` and `resolution` are all in the request schema's
 * `required` list, and the body is `additionalProperties: false`. Two
 * consequences run through everything below.
 *
 * First, **a minimal request cannot stay minimal**, and the two required fields
 * get opposite answers — because "required with no documented default" and
 * "required with exactly one legal value" are different facts:
 *
 * - `resolution` → `"1K"`, **silently**. `KREA_RESOLUTIONS` has one member, so
 *   there is no other scale Krea could have served and nothing was decided on
 *   the caller's behalf. The literal `"1K"` goes in the body, so the request
 *   stays reproducible the day a 2K scale appears. Asking for `2k` or `4k` is
 *   an `invalid_enum_value` naming the one tier that exists — never a downgrade.
 * - `aspectRatio` → an **error**. The OpenAPI document marks `aspect_ratio`
 *   required, lists eight values and documents no default, so there is nothing
 *   to send unless the caller chooses. `resolveAudioFormat` answers this exact
 *   situation the same way ("there is nothing honest to invent"), and one
 *   library must not have two answers to it. A square would not be a neutral
 *   choice; it would be one of eight, made quietly, by the wrong party.
 *
 * Second, **the wire body is closed**, so nothing may be emitted speculatively.
 * `krea2Schema` is a `z.strictObject` — the one place in this repo where an
 * unknown key is an error rather than a warning, because
 * `additionalProperties: false` makes it a certain 400 — and this adapter
 * therefore writes exactly five keys and no more. Everything else Krea 2 offers
 * (`creativity`, the `intensity` / `complexity` / `movement` sliders, `styles`,
 * `image_style_references`, `moodboards`, `image_url` + `strength`) reaches the
 * body through `providerOptions.krea`, where it is checked by the same strict
 * schema.
 *
 * # Size
 *
 * | canonical | wire | class |
 * |---|---|---|
 * | `aspectRatio` | `aspect_ratio` | **S1** — a closed eight-value enum |
 * | `resolution` | `resolution` | **S6** — a table of exactly one row |
 * | `dimensions` | `aspect_ratio` | lossy: pixels → the nearest offered shape, always warned |
 *
 * `2k` and `4k` are `invalid_enum_value` errors naming the one tier that
 * exists, never a quiet downgrade to 1K — `toTier` guarantees that, and it is
 * the single most expensive kind of silent approximation there is, because it
 * is invisible until someone looks at the output.
 *
 * The ratio enum includes `"2.35:1"`, which is why `toRatioEnum` reduces
 * decimals before matching: a caller writing `"47:20"` gets Krea's own
 * spelling back, and neither spelling is an approximation of the other.
 *
 * # What Krea 2 does not have
 *
 * No count field (one image per request), no negative prompt, no output-format
 * field, and no delivery choice — the POST returns `{ job_id, status, … }` and
 * the image arrives from `GET /jobs/{job_id}` or an `X-Webhook-URL` header,
 * both of which are transport. All four are declared gaps.
 *
 * `seed` is the one plain pass-through: same name, same meaning, no `ctx.from`.
 */
import {
  pixelsToRatio,
  resolveSizing,
  toRatioEnum,
  toTier,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall, UnifiedAdapter } from "../../core/unified/types";
import type { ResolutionTier } from "../../core/unified/vocabulary/common";
import type { ImageParams } from "../../core/unified/vocabulary/image";
import {
  KREA_ASPECT_RATIOS,
  image as validator,
  type KreaAspectRatio,
  type KreaResolution,
} from "./image";

/**
 * The three Krea 2 variants — the whole of `./models.ts`. They share one
 * request schema byte-for-byte; only the price differs.
 *
 * Krea also proxies ~50 third-party models on sibling routes
 * (`/generate/image/{vendor}/{model}`), each with its own per-vendor request
 * schema. Those belong to their own providers, so a ref naming one warns as
 * `unknown_model` here.
 */
const MODELS = ["krea-2/medium", "krea-2/large", "krea-2/medium-turbo"] as const;

const SOURCE = "https://api.krea.ai/openapi.json";

/**
 * Canonical tier → `resolution`. Exactly one row, because `KREA_RESOLUTIONS`
 * has exactly one member — so `2k` and `4k` are errors that name `"1k"`.
 */
const KREA_TIERS: Readonly<Partial<Record<ResolutionTier, KreaResolution>>> = { "1k": "1K" };

/**
 * The placeholder the unreachable arms below fall back to.
 *
 * Not a default and never sent: a request that named no shape has already
 * failed by the time the body is built, and a request that named an
 * unexpressible one has too. It exists because the body's two required fields
 * are typed as required, and `??` is cheaper than a cast.
 */
const UNREACHABLE_RATIO: KreaAspectRatio = "1:1";

/**
 * The wire body this adapter compiles to.
 *
 * Five keys, no index signature and no optional extras: the schema is closed,
 * `ExactKeys` compares this key set against `Krea2Params` directly, and a wire
 * type that promised more than the adapter emits would be documentation of
 * something that never happens.
 */
export interface KreaImageWire {
  /** Route selector — stripped in `finalize` and interpolated into `.request.url`. */
  model: string;
  prompt: string;
  aspect_ratio: KreaAspectRatio;
  resolution: KreaResolution;
  seed?: number;
}

/** What a unified image call to `krea/…` returns: `krea.image`'s `Validated`. */
export type KreaImageResult = ReturnType<typeof validator>;

export const image = {
  category: "image",
  provider: "krea",
  models: MODELS,
  unsupported: {
    n:
      "The Krea 2 request schema has no count field — Krea generates one image per request; " +
      "issue N requests to get N images.",
    negativePrompt:
      "The Krea 2 request schema has no negative-prompt field; describe what to avoid inside " +
      "`prompt`, or steer the result with `creativity` / the K2 sliders through " +
      "`providerOptions.krea`.",
    outputFormat:
      "The Krea 2 request schema has no output-format field — the encoding of a finished job " +
      "is Krea's to choose and is reported on `GET /jobs/{job_id}`, so a format could only be " +
      "dropped. The body is `additionalProperties: false`, so sending one anyway is a 400.",
    outputDelivery:
      "POST /generate/image/krea/krea-2/{variant} is an async-job API: it answers with " +
      "`{ job_id, status, … }` and the image arrives from `GET /jobs/{job_id}` or the " +
      "`X-Webhook-URL` request header. There is no delivery to choose — both are transport.",
  },
  compile(
    input: ImageParams,
    ctx: CompileContext<ImageParams>,
  ): CompiledCall<KreaImageWire, KreaImageResult> {
    ctx.from(["aspect_ratio"], "aspectRatio");

    const sizing = ctx.take(resolveSizing(input, { path: ["aspectRatio"], warn: ctx.warn }));
    let ratio: KreaAspectRatio | undefined;

    if (sizing?.kind === "ratio") {
      // `toRatioEnum` returns a member of the list it was handed, and the list
      // handed to it IS `KREA_ASPECT_RATIOS` — so the narrowing is a fact about
      // the call, not an assumption about the value.
      ratio = ctx.take(
        toRatioEnum(sizing.aspectRatio, KREA_ASPECT_RATIOS, { source: SOURCE }, {
          path: ["aspectRatio"],
          warn: ctx.warn,
        }),
      ) as KreaAspectRatio | undefined;
    } else if (sizing?.kind === "dimensions") {
      // No pixel field on this route: the size is thrown away and only the
      // shape survives, so `pixelsToRatio` warns even on an exact match.
      ctx.from(["aspect_ratio"], "dimensions");
      ratio = ctx.take(
        pixelsToRatio(sizing.dimensions.width, sizing.dimensions.height, KREA_ASPECT_RATIOS, {
          path: ["dimensions"],
          warn: ctx.warn,
        }),
      ) as KreaAspectRatio | undefined;
    } else {
      // Required, and Krea documents no default. `resolveAudioFormat` answers
      // this exact situation with an `invalid_shape` — "there is nothing
      // honest to invent" — and one library must not have two answers to it.
      // A square is not a neutral choice, it is a choice: eight shapes are on
      // offer and picking one on the caller's behalf is precisely the kind of
      // decision this surface exists to stop making quietly.
      ctx.fail({
        code: "invalid_shape",
        path: ["aspectRatio"],
        message:
          "`aspect_ratio` is required by Krea 2 and it documents no default, so there is nothing " +
          `to send unless you choose one. Set \`aspectRatio\` — one of ${KREA_ASPECT_RATIOS.map(
            (value) => JSON.stringify(value),
          ).join(", ")} — or \`dimensions\`, whose shape is read off the pixels.`,
        meta: { allowed: [...KREA_ASPECT_RATIOS], source: SOURCE },
      });
    }

    // `resolution` is required too, and unlike the shape it has exactly one
    // legal value: `KREA_RESOLUTIONS` is `["1K"]`. Sending it when the caller
    // said nothing is therefore forced rather than chosen — there is no other
    // scale Krea could have served — and the body carries the literal `"1K"`,
    // so the request stays reproducible whatever Krea ships next. Nothing was
    // approximated, so nothing warns. A caller who asks for `2k` or `4k` gets
    // `toTier`'s `invalid_enum_value` naming the one tier that exists.
    const resolution = ctx.take(
      toTier(input.resolution ?? "1k", KREA_TIERS, { path: ["resolution"], warn: ctx.warn }),
    );

    // Both required fields are assembled before the body exists, so the body is
    // never half-built. The `??` arms are unreachable in a request that
    // survives: they can only fire when a derivation failed, and a compile
    // error stops the request before the kernel merges or validates anything.
    const body: KreaImageWire = {
      model: ctx.model,
      prompt: input.prompt,
      aspect_ratio: ratio ?? UNREACHABLE_RATIO,
      resolution: resolution ?? "1K",
    };
    if (input.seed !== undefined) body.seed = input.seed;

    return { params: body, validate: validator.safe };
  },
} as const satisfies UnifiedAdapter<ImageParams, KreaImageWire, KreaImageResult>;
