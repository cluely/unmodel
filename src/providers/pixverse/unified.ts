/**
 * `unmodel/video` → `pixverse.video` (POST /openapi/v2/video/text/generate).
 *
 * # Three required fields, and none of them has a server default
 *
 * PixVerse's text-to-video body marks `prompt`, `aspect_ratio`, `duration` and
 * `quality` required, and documents no value for the last three when they are
 * omitted — because they cannot be omitted. That makes this the one video
 * adapter that *fills* rather than only translating, and every filled value is
 * an `approximated_param` naming what was sent:
 *
 * | canonical | wire | filled with | why that value |
 * |---|---|---|---|
 * | `aspectRatio` | `aspect_ratio` | `"16:9"` | the shape every model's enum leads with |
 * | `duration` | `duration` | `5` | the shortest every model offers, so it is the cheapest |
 * | `resolution` | `quality` | `"540p"` | the middle tier, and the only one on every model |
 *
 * Filling beats failing here because the request is otherwise complete and the
 * three warnings say exactly what to pin — but "zero warnings means the
 * request mapped exactly" still holds, which is why a prompt-only request to
 * PixVerse carries three of them and a fully specified one carries none.
 *
 * # `quality` is a resolution with a marketing name
 *
 * The wire enum is `360p` / `540p` / `720p` / `1080p`. Two of those are
 * canonical tiers and map straight through; `360p` and `540p` have no
 * canonical spelling and are reachable through `providerOptions.pixverse`,
 * which is also where the fill above can be overridden. `480p`, `1440p` and
 * `4k` are `invalid_enum_value` naming what exists.
 *
 * # The image route needs a handle this vocabulary cannot mint
 *
 * `pixverse.videoFromImage` takes `img_id: number` — an integer minted by
 * `POST /openapi/v2/image/upload`, a multipart request unmodel does not make.
 * A URL or a base64 image cannot become one without that round trip, so
 * `image` is a declared gap whose message names the upload endpoint rather
 * than an adapter that silently ignores the frame.
 */
import { applyExtras, toDurationNumber, toRatioEnum, toTier } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  VideoAdapterFor,
  VideoParams,
  VideoResolution,
} from "../../core/unified/vocabulary/video";
import {
  DOCS_BASE,
  LEGACY_ASPECT_RATIOS,
  WIDE_ASPECT_RATIOS,
  type PixverseAspectRatio,
  type PixverseQualityValue,
} from "./shared";
import { video as validator, type TextToVideoParams } from "./video";
import { MODELS, PIXVERSE_VIDEO_MODEL_PARAMS } from "./video-params";

const SOURCE = `${DOCS_BASE}/text-to-video-generation-13016634e0`;

/** v6 and c1 add 2:3, 3:2 and 21:9 to the legacy five. */
const WIDE_RATIO_MODELS: ReadonlySet<string> = new Set(["v6", "c1"]);

/** `quality` — the two documented tiers the canonical vocabulary names. */
const QUALITIES: Readonly<Partial<Record<VideoResolution, PixverseQualityValue>>> = {
  "720p": "720p",
  "1080p": "1080p",
};

/** What a required field is filled with when the caller named nothing. */
const DEFAULT_RATIO = "16:9";
const DEFAULT_DURATION = 5;
const DEFAULT_QUALITY: PixverseQualityValue = "540p";

/** The wire body this adapter compiles to — `pixverse.video`'s own param type. */
export interface PixverseVideoWire extends TextToVideoParams {}

/** What a unified video call to `pixverse/…` returns: `pixverse.video`'s `Validated`. */
export type PixverseVideoResult = ReturnType<typeof validator>;

export const video = {
  category: "video",
  provider: "pixverse",
  models: MODELS,
  modelParams: PIXVERSE_VIDEO_MODEL_PARAMS,
  unsupported: {
    image:
      "POST /openapi/v2/video/image/generate takes `img_id`, an integer minted by " +
      "POST /openapi/v2/image/upload (a multipart request unmodel does not make) — a URL or " +
      "inline bytes cannot become one without that upload. Upload first, then call " +
      "`pixverse.videoFromImage` with the id you get back.",
    video:
      "PixVerse's transition, extend, restyle and lip-sync routes each take their own inputs and " +
      "are not validated here; POST /openapi/v2/video/text/generate has no video field.",
    negativePrompt:
      "the text-to-video body has no negative-prompt field (PixVerse's image route does); " +
      "describe what to avoid inside `prompt`.",
    n:
      "each request generates one video and answers with one `video_id`; issue one request per " +
      "clip (there is no count on the body).",
  },
  compile(
    input: VideoParams,
    ctx: CompileContext<VideoParams>,
  ): CompiledCall<PixverseVideoWire, PixverseVideoResult> {
    ctx.from(["aspect_ratio"], "aspectRatio");
    ctx.from(["quality"], "resolution");

    const ratios: readonly string[] = WIDE_RATIO_MODELS.has(ctx.model)
      ? WIDE_ASPECT_RATIOS
      : LEGACY_ASPECT_RATIOS;

    /** A required field the caller left out: fill it, and say so. */
    const filled = <T>(field: string, value: T, why: string): T => {
      ctx.warn({
        code: "approximated_param",
        path: [field],
        message:
          `\`${field}\` is required by POST /openapi/v2/video/text/generate and PixVerse ` +
          `documents no default, so ${JSON.stringify(value)} was sent — ${why}. Set ` +
          `\`${field}\` to choose.`,
        meta: { achieved: value, source: SOURCE },
      });
      return value;
    };

    let ratio: string | undefined;
    if (input.aspectRatio === undefined) {
      ratio = filled("aspectRatio", DEFAULT_RATIO, "the shape every model's enum leads with");
    } else {
      ratio = ctx.take(
        toRatioEnum(
          input.aspectRatio,
          ratios,
          { source: SOURCE },
          { path: ["aspectRatio"], warn: ctx.warn },
        ),
      );
    }

    let duration: number | undefined;
    if (input.duration === undefined) {
      duration = filled("duration", DEFAULT_DURATION, "the shortest clip every model offers");
    } else {
      // No `allowed`: `checkDuration` in ./shared carries this model's own list
      // (5/8, 5/8/10, or the 1–15 range on v6 and c1) plus the quality
      // exclusions, and answers on the way out at `duration`.
      duration = ctx.take(
        toDurationNumber(input.duration, undefined, { path: ["duration"], warn: ctx.warn }),
      );
    }

    let quality: PixverseQualityValue | undefined;
    if (input.resolution === undefined) {
      quality = filled("resolution", DEFAULT_QUALITY, "the tier every model renders");
    } else {
      quality = ctx.take(
        toTier(input.resolution, QUALITIES, { path: ["resolution"], warn: ctx.warn }),
      );
    }

    // The empty/zero fallbacks are only reachable when a derivation above
    // failed, which is an error the kernel has already collected — the body is
    // never validated in that case.
    const body: PixverseVideoWire = {
      model: ctx.model,
      prompt: input.prompt ?? "",
      aspect_ratio: (ratio ?? DEFAULT_RATIO) as PixverseAspectRatio,
      duration: duration ?? DEFAULT_DURATION,
      quality: quality ?? DEFAULT_QUALITY,
    };

    if (input.prompt === undefined) {
      ctx.fail({
        code: "invalid_shape",
        path: ["prompt"],
        message:
          "`prompt` is required by POST /openapi/v2/video/text/generate — it is the only input " +
          "this route has, so there is nothing to generate from without it.",
        meta: { source: SOURCE },
      });
    }

    if (input.seed !== undefined) body.seed = input.seed;

    applyExtras(input, PIXVERSE_VIDEO_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies VideoAdapterFor<
  typeof PIXVERSE_VIDEO_MODEL_PARAMS,
  PixverseVideoWire,
  PixverseVideoResult
>;
