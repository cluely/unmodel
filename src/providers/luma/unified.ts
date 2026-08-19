/**
 * `unmodel/image` → Luma Dream Machine's Photon route
 * (POST https://api.lumalabs.ai/dream-machine/v1/generations/image).
 *
 * # The smallest image surface in the category
 *
 * The whole generation body is `{ model, prompt, aspect_ratio, format }` plus
 * four reference-image fields and the async plumbing (`sync`, `sync_timeout`,
 * `callback_url`). There is no size, no seed, no negative prompt and no image
 * count — which makes this adapter mostly a list of honest refusals, and makes
 * it the clearest illustration of the rule those refusals come from: a param
 * the provider cannot express is an **error**, because a caller who wrote
 * `seed: 7` and got a different image every call has been lied to by the
 * translation layer, not by Luma.
 *
 * | canonical | wire | class |
 * |---|---|---|
 * | `prompt` | `prompt` | rename (identical name, so no `ctx.from`) |
 * | `model` (ref tail) | `model` | rename — `photon-1` is also the server default |
 * | `aspectRatio` | `aspect_ratio` | **S1** {@link toRatioEnum}, seven values |
 * | `dimensions` | `aspect_ratio` | {@link pixelsToRatio} — nearest shape, always warns |
 * | `outputFormat` | `format` | value rename: `jpeg` → `"jpg"`; `webp` errors |
 * | `outputDelivery` | — | `"url"` is what the route does; `"base64"` errors |
 * | `resolution`, `n`, `seed`, `negativePrompt` | — | declared gaps |
 *
 * # Size
 *
 * `aspect_ratio` is a closed seven-value enum (`LUMA_ASPECT_RATIOS`, the same
 * list Luma documents for video, image and both reframe routes), and it is the
 * *only* control over the output geometry — Photon has no width, height or
 * resolution field, so the pixel size is Luma's to pick.
 *
 * That makes `aspectRatio` a pure S1 rename and `dimensions` a real loss.
 * {@link pixelsToRatio} is used rather than declaring `dimensions` unsupported
 * because the request is still expressible — 1920×1080 *is* 16:9 here, and
 * refusing it would push callers into computing the ratio themselves and
 * losing the warning. What it is not, is exact: the helper warns on every
 * call, including a perfect ratio match, precisely because the pixel count
 * cannot survive the trip. A shape more than 2% from all seven is an
 * `unsupported_param` naming the nearest, rather than a silent reshape.
 *
 * # Why `resolution`, `n`, `seed` and `negativePrompt` are declared gaps
 *
 * - **`resolution`** — the Dream Machine API *does* have a resolution field,
 *   on the **video** routes (540p/720p/1080p/4k). The image route does not
 *   have one, and borrowing the video vocabulary for it would be inventing an
 *   API. Photon derives its pixel size from `aspect_ratio` alone.
 * - **`n`** — one generation per POST; the response is a single job with a
 *   single asset.
 * - **`seed`** — the image route publishes no reproducibility control at all.
 *   (`ImageGenerationsParams` in `./image.ts` is the full wire surface; there
 *   is no seed on it.)
 * - **`negativePrompt`** — no negative-prompt field; Photon steers away from
 *   things through the prompt text.
 *
 * # Delivery is a URL, and it arrives later
 *
 * This is an **async job API**: the POST answers with a generation object in
 * state `queued`, and the image shows up at `assets.image` — a Luma CDN URL —
 * once the job completes (poll `GET /generations/{id}`, or set `callback_url`,
 * or set `sync: true` to hold the connection until it is done). Either way the
 * payload that eventually lands is a link, never inline bytes. So
 * `outputDelivery: "url"` needs no field and loses nothing, and
 * `outputDelivery: "base64"` is an `unsupported_param` — the same shape as
 * OpenAI's GPT image models, with the two values swapped.
 *
 * `sync`, `sync_timeout`, `callback_url` and the four reference-image inputs
 * (`image_ref`, `style_ref`, `character_ref`, `modify_image_ref`) have no
 * canonical spelling in this category and stay reachable through
 * `providerOptions.luma`.
 */
import { pixelsToRatio, resolveSizing, toRatioEnum } from "../../core/unified/derive";
import type { CompileContext, CompiledCall, UnifiedAdapter } from "../../core/unified/types";
import type { ImageParams } from "../../core/unified/vocabulary/image";
import { image as validator } from "./image";
// `./shared`, not `./generations`, for the same bundle reason `./image.ts`
// gives: the ratio list lives beside the URL prefix so that an image entry
// never drags the video validator's schema, checks and pricing table in.
import { LUMA_ASPECT_RATIOS, type LumaAspectRatio } from "./shared";

/** The two Photon rows in the route-scoped catalog — the ref union for `luma/…`. */
const MODELS = ["photon-1", "photon-flash-1"] as const;

const IMAGE_GENERATION_DOCS = "https://docs.lumalabs.ai/docs/image-generation";

/**
 * The wire body this adapter compiles to — the four fields of
 * `ImageGenerationsParams` a text-to-image request needs.
 *
 * `model` is written even though it is optional on the wire and defaults to
 * `photon-1` server-side: the ref named a model, and a request whose body does
 * not say which model it wants is a request that changes meaning the day Luma
 * moves its default.
 */
export interface LumaImageWire {
  model: string;
  prompt: string;
  aspect_ratio?: LumaAspectRatio;
  format?: "jpg" | "png";
}

/** What a unified call to `luma/…` returns: `luma.image`'s own `Validated`. */
export type LumaImageResult = ReturnType<typeof validator>;

/**
 * Canonical encoding → Luma's `format`.
 *
 * `jpeg` → `"jpg"` is a spelling difference and not a loss: it is the same
 * codec, so it is a rename in the same sense `input` ← `text` is one, and it
 * does not warn. `webp` has no entry — Luma documents exactly two values — and
 * lands in the `invalid_enum_value` branch below.
 */
const FORMAT: Readonly<Record<string, "jpg" | "png">> = { png: "png", jpeg: "jpg" };

export const image = {
  category: "image",
  provider: "luma",
  models: MODELS,
  unsupported: {
    resolution:
      "POST /generations/image has no size, resolution or dimension field — Photon derives the " +
      "pixel size from `aspect_ratio` alone. (The Dream Machine API's `resolution` belongs to " +
      "the video routes, and borrowing it here would be inventing an API.)",
    n:
      "Luma generates one image per request — POST /generations/image answers with a single " +
      "generation carrying a single asset; issue N requests to get N images.",
    seed:
      "POST /generations/image has no seed field — the Dream Machine image route publishes no " +
      "reproducibility control, so a seed could only be dropped.",
    negativePrompt:
      "POST /generations/image has no negative-prompt field; describe what to avoid inside " +
      "`prompt` instead.",
  },
  compile(
    input: ImageParams,
    ctx: CompileContext<ImageParams>,
  ): CompiledCall<LumaImageWire, LumaImageResult> {
    const body: LumaImageWire = { model: ctx.model, prompt: input.prompt };
    ctx.from(["aspect_ratio"], "aspectRatio");
    ctx.from(["format"], "outputFormat");

    const sizing = ctx.take(resolveSizing(input, { path: ["aspectRatio"], warn: ctx.warn }));
    if (sizing?.kind === "ratio") {
      const ratio = ctx.take(
        toRatioEnum(sizing.aspectRatio, LUMA_ASPECT_RATIOS, { source: IMAGE_GENERATION_DOCS }, {
          path: ["aspectRatio"],
          warn: ctx.warn,
        }),
      );
      // The value came out of LUMA_ASPECT_RATIOS itself; the cast only restores
      // the literal type the derivation widened to `string`.
      if (ratio !== undefined) body.aspect_ratio = ratio as LumaAspectRatio;
    } else if (sizing?.kind === "dimensions") {
      ctx.from(["aspect_ratio"], "dimensions");
      const { width, height } = sizing.dimensions;
      const ratio = ctx.take(
        pixelsToRatio(width, height, LUMA_ASPECT_RATIOS, { path: ["dimensions"], warn: ctx.warn }),
      );
      if (ratio !== undefined) body.aspect_ratio = ratio as LumaAspectRatio;
    }

    if (input.outputFormat !== undefined) {
      const format = FORMAT[input.outputFormat];
      if (format === undefined) {
        ctx.fail({
          code: "invalid_enum_value",
          path: ["outputFormat"],
          message:
            `\`format\` on POST /generations/image is "jpg" or "png"; ` +
            `${JSON.stringify(input.outputFormat)} is not encoded by Photon.`,
          meta: { allowed: ["png", "jpeg"], value: input.outputFormat, source: IMAGE_GENERATION_DOCS },
        });
      } else {
        body.format = format;
      }
    }

    if (input.outputDelivery === "base64") {
      ctx.fail({
        code: "unsupported_param",
        path: ["outputDelivery"],
        message:
          '`outputDelivery: "base64"` has no equivalent here — POST /generations/image is an ' +
          "async job whose completed generation carries `assets.image`, a Luma CDN URL. There is " +
          'no field that returns inline bytes, so "url" is the only delivery this route has.',
        meta: { value: input.outputDelivery, source: IMAGE_GENERATION_DOCS },
      });
    }

    return { params: body, validate: validator.safe };
  },
} as const satisfies UnifiedAdapter<ImageParams, LumaImageWire, LumaImageResult>;
