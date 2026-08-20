/**
 * `unmodel/video` → `runway.video` (POST /v1/text_to_video),
 * `runway.videoFromImage` (/v1/image_to_video) and `runway.videoFromVideo`
 * (/v1/video_to_video).
 *
 * # Three routes, and which models are on them is the interesting part
 *
 * Runway's video catalog is thirteen models and *no* model is on all three
 * routes: `gen4_turbo` is image-to-video only, `aleph2` is video-to-video only,
 * and the seedance/hailuo family is on all but the first. So the route
 * derivation is doing real work here — "`gen4_turbo` has no text-to-video
 * route; it serves image-to-video — pass `image`" is the message this category
 * exists to produce, and the model lists behind it are the endpoint modules'
 * own (`TEXT_TO_VIDEO_MODELS` and friends), not a second transcription.
 *
 * # `ratio` is a size, not a shape — again
 *
 * Same field, same problem as `runway.image`: every `ratio` value is a **pixel
 * pair** (`"1280:720"`, `"1920:1080"`, `"3840:2160"`), the list is per model
 * *and* per route, and two entries in one list are routinely the same shape at
 * different sizes. So the canonical pair compiles in two steps:
 *
 * 1. **`resolution` picks the bucket.** Each model's pairs are sorted into
 *    480p / 720p / 1080p / 1440p / 4k by their **short edge**, which is what a
 *    video resolution *is* — 1280:720 and 720:1280 are both 720p, and
 *    `992:432` is 480p. A tier a model has nothing in is an
 *    `invalid_enum_value` from {@link toTier} naming the tiers it does serve.
 * 2. **`aspectRatio` picks the entry.** {@link toRatioEnum} matches on the
 *    reduced ratio, so `"16:9"` finds `"1920:1080"` inside the 1080p bucket —
 *    Runway's own spelling, and no warning, because a spelling change is not a
 *    loss. A shape the bucket has no entry for falls back to
 *    {@link pixelsToRatio}, which takes the nearest within 2% and **always**
 *    warns, naming both shapes and the distance.
 *
 * Three models spell `ratio` as an actual shape instead (`hailuo3` and
 * `grok_imagine_1_5` take `"16:9"`, and `hailuo3` also takes `"adaptive"`);
 * those lists have no pixels to bucket, so the tier does not apply to them and
 * {@link toRatioEnum} answers directly. Which is also why those three models —
 * and `happyhorse_1_0` — are the ones with a real `resolution` field: see
 * below.
 *
 * # `resolution` is a per-model field with three different casings
 *
 * Four models have a `resolution` param, and the spec spells its values
 * differently in each: `hailuo3` takes `"2K"` / `"768P"`, `happyhorse_1_0`
 * `"720P"` / `"1080P"`, and `grok_imagine_1_5` lowercase `"480p"` / `"720p"` /
 * `"1080p"`. The canonical tier maps through a per-model table, and `768P` is
 * the one entry that is not the size it is asked for — a `720p` request on
 * `hailuo3` gets 768 lines and an `approximated_param` saying so.
 *
 * On every other model the tier is the *bucket* above and nothing goes on the
 * wire for it, which is the honest encoding: those models have no resolution
 * field, and the pixel pair in `ratio` already carries the size.
 *
 * # Media is a URI union, and inline bytes need a media type
 *
 * `promptImage`, `promptVideo` and `videoUri` all take "a HTTPS URL, a
 * `runway://` upload URI, or a `data:` URI" — so `{ url }` passes through and
 * `{ data, mimeType }` becomes a data URI, which is the one case in this
 * category where inline bytes are a first-class wire form.
 *
 * The two video fields are not interchangeable: `aleph2` and
 * `gemini_omni_flash` take `videoUri` and every seedance/hailuo arm takes
 * `promptVideo`, so this adapter picks per model from the endpoint's own
 * required-params table rather than sending one and hoping.
 */
import {
  applyExtras,
  EXTRA,
  parseRatio,
  pixelsToRatio,
  resolveImageSlots,
  resolveVideoRoute,
  toDurationNumber,
  toMediaUri,
  toRatioEnum,
  toTier,
  videoRoute,
  type VideoRoute,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  VideoAdapterFor,
  VideoModelParamTable,
  VideoParams,
  VideoResolution,
} from "../../core/unified/vocabulary/video";
import {
  IMAGE_TO_VIDEO_MODELS,
  IMAGE_TO_VIDEO_SOURCE,
  TEXT_TO_VIDEO_MODELS,
  TEXT_TO_VIDEO_SOURCE,
  VIDEO_TO_VIDEO_MODELS,
  VIDEO_TO_VIDEO_SOURCE,
  videoConstraints,
  videoFromImageConstraints,
  videoFromVideoConstraints,
  videoFromVideoRequired,
  type RunwayTargetAspectRatio,
} from "./constraints";
import type {
  RunwayAudioReference,
  RunwayContentModeration,
  RunwayPromptImage,
} from "./shared";
import { video as textValidator, type TextToVideoParams } from "./video";
import { videoFromImage as imageValidator, type ImageToVideoParams } from "./video-from-image";
import {
  videoFromVideo as clipValidator,
  type RunwayVideoKeyframe,
  type VideoToVideoParams,
} from "./video-from-video";

/** Every model with an arm on any of the three video routes. */
const MODELS = [
  "gen4.5",
  "gen4_turbo",
  "veo3.1",
  "veo3.1_fast",
  "hailuo3",
  "happyhorse_1_0",
  "seedance2",
  "seedance2_fast",
  "seedance2_mini",
  "seedance2_5",
  "grok_imagine_1_5",
  "gemini_omni_flash",
  "aleph2",
] as const;

/**
 * Per-model `resolution` tables, one per casing the spec uses.
 *
 * `768P` is the only value that is not the tier it answers for; the warning it
 * carries is raised where the table is read, not here, so the table stays a
 * transcription.
 */
const HAILUO3_RESOLUTIONS: Readonly<Partial<Record<VideoResolution, string>>> = {
  "720p": "768P",
  "1440p": "2K",
};
const HAPPYHORSE_RESOLUTIONS: Readonly<Partial<Record<VideoResolution, string>>> = {
  "720p": "720P",
  "1080p": "1080P",
};
const GROK_RESOLUTIONS: Readonly<Partial<Record<VideoResolution, string>>> = {
  "480p": "480p",
  "720p": "720p",
  "1080p": "1080p",
};

const RESOLUTION_TABLES: Readonly<
  Record<string, Readonly<Partial<Record<VideoResolution, string>>>>
> = {
  hailuo3: HAILUO3_RESOLUTIONS,
  happyhorse_1_0: HAPPYHORSE_RESOLUTIONS,
  grok_imagine_1_5: GROK_RESOLUTIONS,
};

/** The tiers whose wire value is a different number of lines, and what it is. */
const APPROXIMATE_LINES: Readonly<Record<string, number>> = { "768P": 768 };

/** A `ratio` member that is literally a pixel size. */
const PIXEL_PAIR = /^(\d+):(\d+)$/;

/**
 * The lines each canonical tier names.
 *
 * A video resolution is its **short edge**: 1280×720 and 720×1280 are both
 * 720p, and that is the rule this bucketing uses — unlike the image category,
 * where a tier is a total pixel count. `4k` is 2160 lines (UHD), which is what
 * every consumer API means by it.
 */
const TIER_LINES: Readonly<Record<VideoResolution, number>> = {
  "480p": 480,
  "720p": 720,
  "1080p": 1080,
  "1440p": 1440,
  "4k": 2160,
};

const TIERS: readonly VideoResolution[] = ["480p", "720p", "1080p", "1440p", "4k"];

/**
 * Runway's per-model surface — the widest table in the category, because its
 * `ratio` enums are pixel pairs and every pair reduces to a shape.
 *
 * ## What `ratios` means here
 *
 * Not the wire values. `ratio` on most of these models is `"1280:720"`, and
 * what a caller writes is `"16:9"` — {@link toRatioEnum} matches on the reduced
 * ratio and picks the entry inside the tier's bucket. So these lists are the
 * *shapes* those pairs reduce to, deduplicated, which is exactly the set an
 * editor should offer. A shape that is in the enum at one tier and not another
 * is still listed: the tier picks the bucket, and the endpoint answers when the
 * combination has no entry.
 *
 * ## What `resolutions` means here
 *
 * "This tier is reachable on this model, at **some** shape it offers" — which
 * is the only true statement a per-field row can make about a provider whose
 * size and shape are one field. `gen4_turbo` reaches 720p at `16:9` and 1080p
 * at `1:1` and neither at the other, because its enum is a list of pairs rather
 * than a grid.
 *
 * Four models have a real `resolution` field instead, and there the row is the
 * plain enum: `hailuo3` (720p → `768P`, which warns, and 1440p → `2K`),
 * `happyhorse_1_0` (720p/1080p) and `grok_imagine_1_5` (480p/720p/1080p).
 *
 * `aleph2` is the exception twice over. It has **no duration parameter at all**
 * (the output follows the input clip) and no resolution field, so both lists
 * are empty and both fields are compile errors rather than params silently
 * dropped — which is what the adapter does with a `resolution` today when a
 * shape is passed beside it. Its shape control is the `targetAspectRatio`
 * extra, not the deprecated `ratio`, so it declares no `ratios` and the wide
 * vocabulary stands.
 *
 * ## Which extras are here, and which are deliberately not
 *
 * A Runway model can serve up to three routes and the unified surface picks one
 * from the *inputs*, so an extra that exists on only one route body would land
 * on the wrong body for a caller who used another. Three are excluded for
 * exactly that: `referenceVideos` (absent from `ImageToVideoParams`), `mode`
 * (video_to_video only, on a model that serves all four routes) and
 * `referenceAudio` **on `grok_imagine_1_5`** (accepted on text_to_video,
 * denied on image_to_video). All three stay on `providerOptions.runway`.
 *
 * What is left is accepted on every route its model serves:
 * `contentModeration` (gen4.5, gen4_turbo, aleph2), `outputFormat` /
 * `proresProfile` (gen4.5 and aleph2 — `gen4_turbo` denies both),
 * `audio` (the veo3.1 pair and the four seedance2 arms) and `referenceAudio`
 * (hailuo3 and the four seedance2 arms).
 */
const OUTPUT_EXTRAS = {
  outputFormat: EXTRA as "mp4" | "prores" | "png_sequence",
  proresProfile: EXTRA as "422" | "4444" | "422 Proxy" | "422 LT" | "422 HQ" | "4444 XQ",
  contentModeration: EXTRA as RunwayContentModeration,
} as const;

const SEEDANCE_2_EXTRAS = {
  audio: EXTRA as boolean,
  referenceAudio: EXTRA as RunwayAudioReference[],
} as const;

const GEN4_RATIOS = ["1:1", "16:9", "9:16", "69:52", "52:69", "33:14"] as const;
const SEEDANCE_RATIOS = [
  "1:1", "16:9", "9:16", "4:3", "3:4", "21:9",
  "62:27", "54:31", "47:35", "35:47", "31:54",
] as const;

const SEEDANCE_SMALL_ROW = {
  durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  resolutions: ["480p", "720p", "1080p"],
  ratios: SEEDANCE_RATIOS,
  extras: SEEDANCE_2_EXTRAS,
} as const;

const VEO_ROW = {
  durations: [4, 6, 8],
  resolutions: ["720p", "1080p"],
  ratios: ["16:9", "9:16"],
  extras: { audio: EXTRA as boolean },
} as const;

const RUNWAY_VIDEO_MODEL_PARAMS = {
  "gen4.5": {
    durations: [2, 3, 4, 5, 6, 7, 8, 9, 10],
    resolutions: ["720p", "1080p"],
    ratios: GEN4_RATIOS,
    extras: OUTPUT_EXTRAS,
  },
  gen4_turbo: {
    durations: [2, 3, 4, 5, 6, 7, 8, 9, 10],
    resolutions: ["720p", "1080p"],
    ratios: GEN4_RATIOS,
    extras: { contentModeration: EXTRA as RunwayContentModeration },
  },
  "veo3.1": VEO_ROW,
  "veo3.1_fast": VEO_ROW,
  hailuo3: {
    durations: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["720p", "1440p"],
    ratios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"],
    extras: { referenceAudio: EXTRA as RunwayAudioReference[] },
  },
  happyhorse_1_0: {
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["720p", "1080p"],
    ratios: ["1:1", "16:9", "9:16", "277:208", "208:277"],
  },
  seedance2: {
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["480p", "720p", "1080p", "1440p", "4k"],
    ratios: [...SEEDANCE_RATIOS, "1103:473", "1920:823"],
    extras: SEEDANCE_2_EXTRAS,
  },
  seedance2_fast: SEEDANCE_SMALL_ROW,
  seedance2_mini: SEEDANCE_SMALL_ROW,
  seedance2_5: {
    durations: [
      4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
      16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
    ],
    resolutions: ["480p", "720p", "1080p"],
    ratios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "62:27", "47:35", "35:47", "427:240", "240:427"],
    extras: SEEDANCE_2_EXTRAS,
  },
  grok_imagine_1_5: {
    durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["480p", "720p", "1080p"],
    ratios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
  },
  gemini_omni_flash: {
    durations: [3, 4, 5, 6, 7, 8, 9, 10],
    resolutions: ["720p"],
    ratios: ["16:9", "9:16"],
  },
  aleph2: {
    durations: [],
    resolutions: [],
    extras: {
      ...OUTPUT_EXTRAS,
      targetAspectRatio: EXTRA as RunwayTargetAspectRatio,
      keyframes: EXTRA as RunwayVideoKeyframe[],
    },
  },
} as const satisfies VideoModelParamTable;

/** The wire body of whichever of the three routes the inputs select. */
export type RunwayVideoWire = TextToVideoParams | ImageToVideoParams | VideoToVideoParams;

/** What a unified video call to `runway/…` returns — one route's `Validated`. */
export type RunwayVideoResult =
  | ReturnType<typeof textValidator>
  | ReturnType<typeof imageValidator>
  | ReturnType<typeof clipValidator>;

/** See the note on kling's image adapter: `validate` is contravariant. */
type RunwayValidate = CompiledCall<RunwayVideoWire, RunwayVideoResult>["validate"];

/** The body under construction, before the route narrows it. */
interface RunwayDraft {
  model: string;
  promptText?: string;
  ratio?: string;
  duration?: number;
  seed?: number;
  negativePrompt?: string;
  resolution?: string;
  promptImage?: RunwayPromptImage[];
  references?: Array<{ uri: string }>;
  promptVideo?: string;
  videoUri?: string;
}

/**
 * The routes a model serves, read off the endpoint modules' own model lists.
 *
 * An id on none of the three lists is one this snapshot has not seen: it has
 * already drawn `unknown_model`, and refusing every route for it would be a
 * guess dressed as a check, so every route stays open and the endpoint answers.
 */
function routesFor(model: string): readonly VideoRoute[] {
  const routes: VideoRoute[] = [];
  if ((TEXT_TO_VIDEO_MODELS as readonly string[]).includes(model)) routes.push("text", "reference");
  if ((IMAGE_TO_VIDEO_MODELS as readonly string[]).includes(model)) routes.push("image");
  if ((VIDEO_TO_VIDEO_MODELS as readonly string[]).includes(model)) routes.push("video");
  return routes.length > 0 ? routes : ["text", "image", "reference", "video"];
}

/** This (route, model)'s `ratio` enum, from the endpoint's own constraint table. */
function ratiosFor(route: VideoRoute, model: string): readonly string[] | undefined {
  const table =
    route === "image"
      ? videoFromImageConstraints
      : route === "video"
        ? videoFromVideoConstraints
        : videoConstraints;
  const allowed = table[model]?.enums?.["ratio"];
  return allowed === undefined ? undefined : allowed.map(String);
}

/** The tier a pixel pair belongs to: nearest by short edge, in log space. */
function tierOf(spelling: string): VideoResolution | undefined {
  const pixels = PIXEL_PAIR.exec(spelling);
  if (pixels === null) return undefined;
  const width = Number(pixels[1]);
  const height = Number(pixels[2]);
  if (!(width > 0) || !(height > 0)) return undefined;
  const lines = Math.min(width, height);
  let best: VideoResolution = "720p";
  let bestDistance = Infinity;
  for (const tier of TIERS) {
    const distance = Math.abs(Math.log(lines / TIER_LINES[tier]));
    if (distance < bestDistance) {
      best = tier;
      bestDistance = distance;
    }
  }
  return best;
}

/** A `ratio` list bucketed by tier, or `undefined` when it holds no pixel pairs. */
function bucketsOf(
  allowed: readonly string[],
): Readonly<Partial<Record<VideoResolution, readonly string[]>>> | undefined {
  const buckets: Partial<Record<VideoResolution, string[]>> = {};
  let pairs = 0;
  for (const entry of allowed) {
    const tier = tierOf(entry);
    if (tier === undefined) continue;
    pairs += 1;
    (buckets[tier] ??= []).push(entry);
  }
  return pairs === 0 ? undefined : buckets;
}

export const video = {
  category: "video",
  provider: "runway",
  models: MODELS,
  modelParams: RUNWAY_VIDEO_MODEL_PARAMS,
  unsupported: {
    n:
      "every Runway generation route starts one task and answers with `{ id }`; issue one " +
      "request per clip (there is no count on any of the three bodies).",
  },
  compile(
    input: VideoParams,
    ctx: CompileContext<VideoParams>,
  ): CompiledCall<RunwayVideoWire, RunwayVideoResult> {
    const routes = routesFor(ctx.model);
    const derived = ctx.take(
      resolveVideoRoute(
        input,
        { model: ctx.model, routes, source: TEXT_TO_VIDEO_SOURCE },
        { path: ["image"], warn: ctx.warn },
      ),
    );
    const route = derived ?? videoRoute(input);
    // A reference image rides on the text route's `references` array; there is
    // no fourth endpoint.
    const wireRoute: VideoRoute = route === "reference" ? "text" : route;
    const source =
      wireRoute === "image"
        ? IMAGE_TO_VIDEO_SOURCE
        : wireRoute === "video"
          ? VIDEO_TO_VIDEO_SOURCE
          : TEXT_TO_VIDEO_SOURCE;

    ctx.from(["promptText"], "prompt");
    ctx.from(["ratio"], "aspectRatio");
    ctx.from(["promptImage"], "image");
    ctx.from(["references"], "image");
    ctx.from(["promptVideo"], "video");
    ctx.from(["videoUri"], "video");

    const body: RunwayDraft = { model: ctx.model };
    if (input.prompt !== undefined) body.promptText = input.prompt;
    if (input.negativePrompt !== undefined) body.negativePrompt = input.negativePrompt;
    if (input.seed !== undefined) body.seed = input.seed;

    if (input.duration !== undefined) {
      // No `allowed`: each route's per-model `duration` enum (2–10 on gen4.5,
      // 4/6/8 on veo3.1, 4–30 on seedance2_5) answers on the way out.
      const duration = ctx.take(
        toDurationNumber(input.duration, undefined, { path: ["duration"], warn: ctx.warn }),
      );
      if (duration !== undefined) body.duration = duration;
    }

    // --- Size: a per-model `resolution` field, or the `ratio` bucket --------
    const resolutions = RESOLUTION_TABLES[ctx.model];
    const allowed = ratiosFor(wireRoute, ctx.model);
    const buckets = allowed === undefined ? undefined : bucketsOf(allowed);

    if (input.resolution !== undefined && resolutions !== undefined) {
      ctx.from(["resolution"], "resolution");
      const resolution = ctx.take(
        toTier(input.resolution, resolutions, { path: ["resolution"], warn: ctx.warn }),
      );
      if (resolution !== undefined) {
        const lines = APPROXIMATE_LINES[resolution];
        if (lines !== undefined) {
          ctx.warn({
            code: "approximated_param",
            path: ["resolution"],
            message:
              `\`resolution\` ${JSON.stringify(input.resolution)} was sent as ` +
              `${JSON.stringify(resolution)} — "${ctx.model}" renders ${lines} lines at this ` +
              "tier, and it is the nearest size the model offers.",
            meta: { requested: input.resolution, achieved: resolution, lines, source },
          });
        }
        body.resolution = resolution;
      }
    }

    if (input.aspectRatio !== undefined) {
      const derive = { path: ["aspectRatio"], warn: ctx.warn };
      if (allowed === undefined) {
        // No table for this (route, model): the ref has already drawn
        // `unknown_model`, and the shape is passed through in Runway's own
        // punctuation rather than checked against a list that does not
        // describe it.
        const parsed = parseRatio(input.aspectRatio);
        body.ratio = parsed === undefined ? input.aspectRatio : `${parsed.width}:${parsed.height}`;
      } else if (buckets === undefined) {
        // A shape-shaped enum (hailuo3, grok_imagine_1_5): the tier has nothing
        // to narrow, so the ratio answers directly.
        const ratio = ctx.take(toRatioEnum(input.aspectRatio, allowed, { source }, derive));
        if (ratio !== undefined) body.ratio = ratio;
      } else {
        const bucket =
          input.resolution === undefined || resolutions !== undefined
            ? // Either no tier was named, or it went to the model's own
              // `resolution` field — in both cases every pair is a candidate.
              allowed
            : ctx.take(toTier(input.resolution, buckets, { path: ["resolution"], warn: ctx.warn }));
        if (bucket !== undefined) {
          const exact = toRatioEnum(input.aspectRatio, bucket, { source }, derive);
          if (exact.value !== undefined) body.ratio = exact.value;
          else {
            const parsed = parseRatio(input.aspectRatio);
            // Unparseable is `toRatioEnum`'s `invalid_shape`, which is the
            // right answer; a parseable shape with no entry snaps and warns.
            if (parsed === undefined) ctx.take(exact);
            else {
              const snapped = ctx.take(
                pixelsToRatio(parsed.width, parsed.height, bucket, derive),
              );
              if (snapped !== undefined) body.ratio = snapped;
            }
          }
        }
      }
    } else if (input.resolution !== undefined && resolutions === undefined) {
      // A tier and no shape, at a model whose size *is* the ratio: nothing can
      // go on the wire without inventing a shape, so the tier is refused rather
      // than silently dropped. (`ratio` is required by several arms anyway, and
      // that error names the field.)
      ctx.fail({
        code: "unsupported_param",
        path: ["resolution"],
        message:
          `"${ctx.model}" has no \`resolution\` field — its \`ratio\` enum carries the pixel size, ` +
          `so a tier only picks between entries of a shape. Pass \`aspectRatio\` alongside ` +
          "`resolution`, or pick a model with a resolution field (hailuo3, happyhorse_1_0, " +
          "grok_imagine_1_5).",
        meta: { value: input.resolution, source },
      });
    }

    // --- Inputs -------------------------------------------------------------
    const derive = { path: ["image"], warn: ctx.warn };
    const slots = ctx.take(resolveImageSlots(input.image, derive));
    if (slots !== undefined) {
      if (route === "reference") {
        const references: Array<{ uri: string }> = [];
        for (const reference of slots.references) {
          const uri = ctx.take(toMediaUri(reference, derive));
          if (uri !== undefined) references.push({ uri });
        }
        if (references.length > 0) body.references = references;
        if (slots.first !== undefined || slots.last !== undefined) {
          ctx.fail({
            code: "invalid_shape",
            path: ["image"],
            message:
              "Runway's `references` ride on POST /v1/text_to_video and its keyframes on " +
              "POST /v1/image_to_video — one request cannot be both. Send the references and the " +
              "first frame in separate calls.",
            meta: { source },
          });
        }
      } else {
        const images: RunwayPromptImage[] = [];
        const push = (image: (typeof slots)["first"], position: "first" | "last"): void => {
          if (image === undefined) return;
          const uri = ctx.take(toMediaUri(image, derive));
          // `position` is required on most arms and optional on the seedance
          // ones; sending it always is what the required arms need, and the
          // optional ones accept it.
          if (uri !== undefined) images.push({ uri, position });
        };
        push(slots.first, "first");
        push(slots.last, "last");
        if (images.length > 0) body.promptImage = images;
      }
    }

    if (input.video !== undefined) {
      const uri = ctx.take(toMediaUri(input.video, { path: ["video"], warn: ctx.warn }));
      if (uri !== undefined) {
        // Two different fields, and sending the wrong one is a deny rather than
        // a rename: `aleph2` and `gemini_omni_flash` take `videoUri`, every
        // seedance/hailuo arm takes `promptVideo`. The endpoint's own
        // required-params table is what says which.
        const required = videoFromVideoRequired[ctx.model] ?? [];
        if (required.includes("promptVideo")) body.promptVideo = uri;
        else body.videoUri = uri;
      }
    }

    applyExtras(input, RUNWAY_VIDEO_MODEL_PARAMS, body, ctx);

    const validate = (
      wireRoute === "image"
        ? imageValidator.safe
        : wireRoute === "video"
          ? clipValidator.safe
          : textValidator.safe
    ) as RunwayValidate;
    // One cast, at the one place the three routes meet: each validator takes
    // its own arm of the union, and the inputs decided which arm `body` is.
    return { params: body as unknown as RunwayVideoWire, validate };
  },
} as const satisfies VideoAdapterFor<
  typeof RUNWAY_VIDEO_MODEL_PARAMS,
  RunwayVideoWire,
  RunwayVideoResult
>;
