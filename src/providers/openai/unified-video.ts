/**
 * `unmodel/video` → `openai.video` (POST /v1/videos — Sora 2).
 *
 * # Two enums, and both of them are strings
 *
 * Sora's whole output vocabulary is two closed enums that happen to be spelled
 * as strings: `seconds` (`"4"`/`"8"`/`"12"`/`"16"`/`"20"`) and `size` (a pixel
 * pair). That makes this the shortest of the ten video adapters and the one
 * where the canonical spelling differs most visibly from the wire:
 *
 * | canonical | wire | class |
 * |---|---|---|
 * | `duration: 8` | `seconds: "8"` | {@link toDurationString} over a closed list |
 * | `resolution` + `aspectRatio` | `size: "1280x720"` | **S3** — a per-model size table |
 * | `image` | `input_reference.image_url` | first frame only |
 *
 * A duration this endpoint does not offer is an `invalid_enum_value` listing
 * the five it does — never the nearest, because 6 seconds of video is not
 * approximately 8 seconds of video, it is a different clip at a different
 * price.
 *
 * # `size` is a tier and a shape, and pro has one more tier
 *
 * sora-2 renders 720p only ("Use `sora-2-pro` for higher-resolution exports");
 * sora-2-pro adds 1080p. The 1024p pair (`1792x1024` / `1024x1792`) has no
 * canonical tier name — it is not a video resolution anyone markets — so it is
 * deliberately absent from the tables below and reachable through
 * `providerOptions.openai.size`, which is what that escape hatch is for.
 *
 * Two defaults are the endpoint's own rather than this file's, which is why
 * neither warns:
 *
 * - a request that names a **shape** and no tier gets 720p, the only tier every
 *   Sora model renders and the one the documented default (`720x1280`) is in;
 * - a request that names a **tier** and no shape gets that tier's portrait
 *   entry, because the documented default *is* portrait.
 *
 * # Everything else is a declared gap
 *
 * `seconds`, `size`, `prompt` and `input_reference` are the whole JSON body.
 * There is no seed, no negative prompt, no sample count and no video input on
 * this route, so all four are declared rather than dropped — and `video`'s
 * message names the thing a caller reaching for it actually wants, which is a
 * different API entirely.
 */
import {
  resolveImageSlots,
  resolveVideoRoute,
  toDurationString,
  toMediaUri,
  toSizeEnum,
  unsupportedSlot,
  type SizeTable,
  type VideoRoute,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  VideoAdapterFor,
  VideoModelParamTable,
  VideoParams,
  VideoResolution,
} from "../../core/unified/vocabulary/video";
import { video as videoValidator, type VideoInputReference } from "./video";

/** The five ids POST /v1/videos documents — the `openai/…` ref union. */
const MODELS = [
  "sora-2",
  "sora-2-pro",
  "sora-2-2025-10-06",
  "sora-2-2025-12-08",
  "sora-2-pro-2025-10-06",
] as const;

const VIDEOS_CREATE_DOCS = "https://developers.openai.com/api/docs/api-reference/videos/create";

/**
 * `seconds`, from the video-generation guide — the create reference's enum
 * lags it by two values, and `videoConstraints` (which re-checks this on the
 * way out) carries the same five.
 */
const SORA_SECONDS = [4, 8, 12, 16, 20] as const;

/** 720p is every Sora model's tier; 1080p is sora-2-pro's. */
const BASE_SIZES: SizeTable<VideoResolution> = {
  "720p": { "16:9": "1280x720", "9:16": "720x1280" },
};

const PRO_SIZES: SizeTable<VideoResolution> = {
  "720p": { "16:9": "1280x720", "9:16": "720x1280" },
  "1080p": { "16:9": "1920x1080", "9:16": "1080x1920" },
};

/** The two shapes both size tables are keyed by. */
const SORA_RATIOS = ["16:9", "9:16"] as const;

/**
 * Sora's per-model surface — the shortest table in this category, because the
 * whole body is four fields and none of them is a param the vocabulary has no
 * word for.
 *
 * The two rows differ in exactly one entry, which is the difference the
 * documentation leads with: "Use `sora-2-pro` for higher-resolution exports".
 * The dated snapshots repeat their base model's row rather than aliasing it,
 * because a snapshot is a frozen model and the day one of them diverges the
 * table should say so in one place.
 *
 * No `extras`: `input_reference.file_id` is the only unclaimed field on the
 * body and it is the *other* spelling of the canonical `image` — the endpoint
 * requires exactly one of the two — so it stays on `providerOptions.openai`.
 */
const SORA_BASE_ROW = {
  durations: SORA_SECONDS,
  resolutions: ["720p"],
  ratios: SORA_RATIOS,
} as const;

const SORA_PRO_ROW = {
  durations: SORA_SECONDS,
  resolutions: ["720p", "1080p"],
  ratios: SORA_RATIOS,
} as const;

const OPENAI_VIDEO_MODEL_PARAMS = {
  "sora-2": SORA_BASE_ROW,
  "sora-2-2025-10-06": SORA_BASE_ROW,
  "sora-2-2025-12-08": SORA_BASE_ROW,
  "sora-2-pro": SORA_PRO_ROW,
  "sora-2-pro-2025-10-06": SORA_PRO_ROW,
} as const satisfies VideoModelParamTable;

/** The shape a tier resolves to when the caller named no shape at all. */
const DEFAULT_SHAPE = "9:16";

/** Sora's own default tier — the one `720x1280` is in. */
const DEFAULT_TIER: VideoResolution = "720p";

/** Every model's route set: this endpoint is text-to-video with a first frame. */
const ROUTES: readonly VideoRoute[] = ["text", "image"];

/** The wire body this adapter compiles to — the loose arm of `VideosBody`. */
export interface OpenaiVideoWire {
  model: string;
  prompt: string;
  seconds?: string;
  size?: string;
  input_reference?: VideoInputReference;
  [key: string]: unknown;
}

/** What a unified video call to `openai/…` returns: `openai.video`'s `Validated`. */
export type OpenaiVideoResult = ReturnType<typeof videoValidator>;

const isPro = (model: string): boolean => model.startsWith("sora-2-pro");

export const video = {
  category: "video",
  provider: "openai",
  models: MODELS,
  modelParams: OPENAI_VIDEO_MODEL_PARAMS,
  unsupported: {
    video:
      "POST /v1/videos generates a clip from a prompt and an optional first frame; it has no " +
      "input video field, and no Sora route extends or restyles an existing clip.",
    negativePrompt:
      "POST /v1/videos has no negative-prompt field; describe what to avoid inside `prompt`.",
    seed:
      "POST /v1/videos has no seed field — Sora output is not reproducible from the request, so " +
      "a seed could only be dropped.",
    n:
      "POST /v1/videos starts one job and answers with one video id; issue one request per clip " +
      "(there is no `n` on the body).",
  },
  compile(
    input: VideoParams,
    ctx: CompileContext<VideoParams>,
  ): CompiledCall<OpenaiVideoWire, OpenaiVideoResult> {
    ctx.from(["seconds"], "duration");
    ctx.from(["size"], "resolution");
    ctx.from(["input_reference"], "image");
    ctx.from(["input_reference", "image_url"], "image");

    // `prompt` is required on this body and optional in the vocabulary — an
    // image-only request is a legitimate request at four of the ten providers
    // and not at this one, where `input_reference` is a first frame that
    // *guides* a prompt rather than replacing it. Reported here rather than
    // left to the endpoint's schema so the message says which of the two it is.
    if (input.prompt === undefined) {
      ctx.fail({
        code: "invalid_shape",
        path: ["prompt"],
        message:
          "`prompt` is required by POST /v1/videos, including when `image` is set — " +
          "`input_reference` is a first frame the prompt describes motion from, not a " +
          "replacement for it.",
        meta: { source: VIDEOS_CREATE_DOCS },
      });
    }
    // Empty only when the check above failed, which is an error the kernel has
    // already collected — the body is never validated in that case.
    const body: OpenaiVideoWire = { model: ctx.model, prompt: input.prompt ?? "" };

    ctx.take(
      resolveVideoRoute(
        input,
        { model: ctx.model, routes: ROUTES, source: VIDEOS_CREATE_DOCS },
        { path: ["image"], warn: ctx.warn },
      ),
    );

    if (input.duration !== undefined) {
      const seconds = ctx.take(
        toDurationString(input.duration, [...SORA_SECONDS], { path: ["duration"], warn: ctx.warn }),
      );
      if (seconds !== undefined) body.seconds = seconds;
    }

    // Size: a shape, a tier, or neither. The table is the model's; the two
    // defaults are the endpoint's, so filling either one is exact.
    const table = isPro(ctx.model) ? PRO_SIZES : BASE_SIZES;
    if (input.aspectRatio !== undefined || input.resolution !== undefined) {
      if (input.aspectRatio !== undefined) ctx.from(["size"], "aspectRatio");
      const size = ctx.take(
        toSizeEnum(input.aspectRatio ?? DEFAULT_SHAPE, input.resolution ?? DEFAULT_TIER, table, {
          path: [input.aspectRatio !== undefined ? "aspectRatio" : "resolution"],
          warn: ctx.warn,
        }),
      );
      if (size !== undefined) body.size = size;
    }

    const slots = ctx.take(resolveImageSlots(input.image, { path: ["image"], warn: ctx.warn }));
    if (slots !== undefined) {
      if (slots.last !== undefined) {
        ctx.take(
          unsupportedSlot(
            "last",
            ctx.model,
            "`input_reference` is the FIRST frame and the only image field on this body; Sora " +
              "has no last-frame interpolation.",
            { path: ["image"], warn: ctx.warn },
          ),
        );
      }
      if (slots.references.length > 0) {
        ctx.take(
          unsupportedSlot(
            "reference",
            ctx.model,
            "`input_reference` is a first frame, not a subject or style reference — it " +
              "must match the output resolution, and Sora has no reference field.",
            { path: ["image"], warn: ctx.warn },
          ),
        );
      }
      if (slots.first !== undefined) {
        const uri = ctx.take(
          toMediaUri(slots.first, { path: ["image"], warn: ctx.warn }),
        );
        // "Provide exactly one of `image_url` or `file_id`" — a Files API
        // handle has no canonical spelling, so this side always writes the URL
        // one, and `providerOptions.openai.input_reference` reaches the other.
        if (uri !== undefined) body.input_reference = { image_url: uri };
      }
    }

    return { params: body, validate: videoValidator.safe };
  },
} as const satisfies VideoAdapterFor<
  typeof OPENAI_VIDEO_MODEL_PARAMS,
  OpenaiVideoWire,
  OpenaiVideoResult
>;
