/**
 * `unmodel/video` → `google.video` (POST models/{model}:predictLongRunning — Veo).
 *
 * # One route, four modes, and the mode is the shape of `instances[0]`
 *
 * Veo does not have four endpoints; it has one, whose instance object grows a
 * field per mode: `image` is the first frame, `lastFrame` the closing one,
 * `referenceImages` up to three assets to carry forward, and `video` a clip to
 * extend. So the route derivation this category defines
 * ({@link resolveVideoRoute}) maps onto *fields* here rather than onto URLs —
 * and the per-model half of it is real: reference images are Veo 3.1 and 3.1
 * Fast (and, ambiguously, Lite), extension is 3.1 and 3.1 Fast, and
 * `gemini-omni-flash-preview` is text-and-image only.
 *
 * | canonical | wire | notes |
 * |---|---|---|
 * | `prompt` | `instances[0].prompt` | |
 * | `image` (first / last) | `instances[0].image` / `.lastFrame` | inline bytes only |
 * | `image` (`role: "reference"`) | `instances[0].referenceImages[]` | `referenceType: "asset"` |
 * | `video` | `instances[0].video` | `uri` or `encodedVideo` |
 * | `duration` | `parameters.durationSeconds` | plain seconds — the easy encoding |
 * | `resolution` | `parameters.resolution` | `720p` / `1080p` / `4k`, per model |
 * | `aspectRatio` | `parameters.aspectRatio` | 16:9 or 9:16, and nothing else |
 * | `negativePrompt` | `parameters.negativePrompt` | |
 * | `seed` | `parameters.seed` | |
 * | `n` | `parameters.sampleCount` | 1 on Veo 3.x, 1–2 on Veo 2 |
 *
 * Everything in that table is sent as given and re-checked by the endpoint's own
 * per-model tables (`videoConstraints` / `videoFamilyRules`), which is why this
 * adapter has almost no per-model logic of its own: those tables are a
 * transcription of the Veo parameters table, and a second copy here would be a
 * second opinion about the same page. What the caller sees is that opinion
 * remapped onto the word they wrote — "`parameters.durationSeconds` must be one
 * of 4, 6, 8" arrives at `duration`.
 *
 * # The one thing this API cannot take is a URL
 *
 * `GoogleVeoImage` is `{ bytesBase64Encoded, mimeType }` or
 * `{ inlineData: { data, mimeType } }`, and `gcsUri` — the field that would
 * fetch an image — is Vertex AI-only. So `image: { url }` is an
 * `unsupported_param` naming the gap rather than a URL smuggled into a base64
 * field. `video` is the exception and keeps its URL form, because extension is
 * defined in terms of the `video.uri` a previous generation returned.
 *
 * # 480p and 1440p do not exist here
 *
 * `parameters.resolution` documents exactly `720p`, `1080p` and `4k`, so the
 * other two canonical tiers are an `invalid_enum_value` listing those three —
 * not a silent downgrade to 720p, which is the approximation that costs the
 * most and shows up nowhere.
 */
import {
  applyExtras,
  EXTRA,
  requireInlineBytes,
  resolveImageSlots,
  resolveVideoRoute,
  toDurationNumber,
  toRatioEnum,
  toTier,
  type VideoRoute,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  VideoAdapterFor,
  VideoImageInput,
  VideoModelParamTable,
  VideoParams,
  VideoResolution,
} from "../../core/unified/vocabulary/video";
import { VEO_DOCS_URL } from "./constraints";
import {
  video as validator,
  type GoogleVeoImage,
  type GoogleVeoInstance,
  type GoogleVeoParameters,
  type GoogleVeoReferenceImage,
} from "./video";

/**
 * Every model `:predictLongRunning` serves, Veo and the one non-Veo id — the
 * `google/…` ref union, and the same list `videoModels` catalogs.
 */
const MODELS = [
  "veo-3.1-generate-preview",
  "veo-3.1-fast-generate-preview",
  "veo-3.1-lite-generate-preview",
  "veo-3.0-generate-001",
  "veo-3.0-fast-generate-001",
  "veo-2.0-generate-001",
  "gemini-omni-flash-preview",
] as const;

/** Reference images: Veo 3.1, 3.1 Fast, and Lite (documented both ways). */
const REFERENCE_MODELS: ReadonlySet<string> = new Set([
  "veo-3.1-generate-preview",
  "veo-3.1-fast-generate-preview",
  "veo-3.1-lite-generate-preview",
]);

/** Video extension: Veo 3.1 and Veo 3.1 Fast. */
const EXTENSION_MODELS: ReadonlySet<string> = new Set([
  "veo-3.1-generate-preview",
  "veo-3.1-fast-generate-preview",
]);

/** `parameters.resolution` — the three tiers the Veo parameters table lists. */
const RESOLUTIONS: Readonly<Partial<Record<VideoResolution, string>>> = {
  "720p": "720p",
  "1080p": "1080p",
  "4k": "4k",
};

/** `parameters.aspectRatio` — "Every Veo model generates 16:9 or 9:16". */
const ASPECT_RATIOS = ["16:9", "9:16"] as const;

/**
 * Veo's per-model surface.
 *
 * Three facts the wire tables carry and the vocabulary can now state up front:
 *
 * - **`durationSeconds`** is 4/6/8 across Veo 3.x, 5–8 on Veo 2 and 3–10 on
 *   Omni. Closed enums, all three, so they narrow rather than staying `number`.
 * - **`resolution` does not exist on Veo 2.** `videoConstraints` denies it
 *   ("output is 720p"), which is exactly what `resolutions: []` says — the
 *   caller's `resolution` types as `never` and the mistake is caught before the
 *   request is built rather than after it is sent.
 * - **`4k` is Veo 3.x-minus-Lite.** Lite stops at 1080p and Omni at 720p.
 *
 * What the rows deliberately do NOT say: `1080p` and `4k` on Veo 3.x also
 * require `duration: 8`, and `personGeneration: "allow_all"` is refused on an
 * image-driven request. Both are *pairings* rather than per-field enums —
 * `checkParameterPairings` owns them, and a row cannot express a rule about two
 * fields at once without inventing a second table that would then disagree.
 *
 * Both extras nest under `parameters` and are re-checked there by the
 * endpoint's own tables, which is why `personGeneration` can carry a different
 * union per model: Veo 3.x has two values, Veo 2 has three (it is the only
 * family with `dont_allow`), and Omni's entry carries no enum at all — the Veo
 * rules are `veo-`-prefix-gated — so nothing narrower than `string` would be
 * true there.
 */
const VEO_3_EXTRAS = {
  personGeneration: EXTRA as "allow_all" | "allow_adult",
  enhancePrompt: EXTRA as boolean,
} as const;

const VEO_3_ROW = {
  durations: [4, 6, 8],
  resolutions: ["720p", "1080p", "4k"],
  ratios: ASPECT_RATIOS,
  extras: VEO_3_EXTRAS,
} as const;

const GOOGLE_VIDEO_MODEL_PARAMS = {
  "veo-3.1-generate-preview": VEO_3_ROW,
  "veo-3.1-fast-generate-preview": VEO_3_ROW,
  "veo-3.1-lite-generate-preview": {
    durations: [4, 6, 8],
    resolutions: ["720p", "1080p"],
    ratios: ASPECT_RATIOS,
    extras: VEO_3_EXTRAS,
  },
  "veo-3.0-generate-001": VEO_3_ROW,
  "veo-3.0-fast-generate-001": VEO_3_ROW,
  "veo-2.0-generate-001": {
    durations: [5, 6, 7, 8],
    resolutions: [],
    ratios: ASPECT_RATIOS,
    extras: {
      personGeneration: EXTRA as "allow_all" | "allow_adult" | "dont_allow",
      enhancePrompt: EXTRA as boolean,
    },
  },
  "gemini-omni-flash-preview": {
    durations: [3, 4, 5, 6, 7, 8, 9, 10],
    resolutions: ["720p"],
    ratios: ASPECT_RATIOS,
    extras: {
      personGeneration: EXTRA as string,
      enhancePrompt: EXTRA as boolean,
    },
  },
} as const satisfies VideoModelParamTable;

/** The wire body this adapter compiles to — the loose arm of `GenerateVideosBody`. */
export interface GoogleVideoWire {
  model: string;
  /** Exactly one instance; `parameters.sampleCount` asks for more videos. */
  instances: GoogleVeoInstance[];
  parameters?: GoogleVeoParameters;
}

/** What a unified video call to `google/…` returns: `google.video`'s `Validated`. */
export type GoogleVideoResult = ReturnType<typeof validator>;

/** The routes a model serves, from the Veo docs' feature table. */
function routesFor(model: string): readonly VideoRoute[] {
  const routes: VideoRoute[] = ["text", "image"];
  if (REFERENCE_MODELS.has(model)) routes.push("reference");
  if (EXTENSION_MODELS.has(model)) routes.push("video");
  return routes;
}

export const video = {
  category: "video",
  provider: "google",
  models: MODELS,
  modelParams: GOOGLE_VIDEO_MODEL_PARAMS,
  compile(
    input: VideoParams,
    ctx: CompileContext<VideoParams>,
  ): CompiledCall<GoogleVideoWire, GoogleVideoResult> {
    ctx.from(["instances", 0, "prompt"], "prompt");
    ctx.from(["instances", 0, "image"], "image");
    ctx.from(["instances", 0, "lastFrame"], "image");
    ctx.from(["instances", 0, "referenceImages"], "image");
    ctx.from(["instances", 0, "video"], "video");
    ctx.from(["parameters", "durationSeconds"], "duration");
    ctx.from(["parameters", "resolution"], "resolution");
    ctx.from(["parameters", "aspectRatio"], "aspectRatio");
    ctx.from(["parameters", "negativePrompt"], "negativePrompt");
    ctx.from(["parameters", "sampleCount"], "n");
    ctx.from(["parameters", "seed"], "seed");

    const instance: GoogleVeoInstance = {};
    const parameters: GoogleVeoParameters = {};
    if (input.prompt !== undefined) instance.prompt = input.prompt;

    ctx.take(
      resolveVideoRoute(
        input,
        { model: ctx.model, routes: routesFor(ctx.model), source: VEO_DOCS_URL },
        { path: ["image"], warn: ctx.warn },
      ),
    );

    /** One canonical image as the inline-bytes object both spellings accept. */
    const toVeoImage = (image: VideoImageInput): GoogleVeoImage | undefined => {
      const bytes = ctx.take(
        requireInlineBytes(
          image,
          "The Gemini API takes image bytes inline (`bytesBase64Encoded`); `gcsUri`, the field " +
            "that would fetch a URL, is Vertex AI-only. Read the file and pass `{ data, mimeType }`.",
          { path: ["image"], warn: ctx.warn },
        ),
      );
      if (bytes === undefined) return undefined;
      return {
        bytesBase64Encoded: bytes.data,
        ...(bytes.mimeType !== undefined && { mimeType: bytes.mimeType }),
      };
    };

    const slots = ctx.take(resolveImageSlots(input.image, { path: ["image"], warn: ctx.warn }));
    if (slots !== undefined) {
      if (slots.first !== undefined) {
        const image = toVeoImage(slots.first);
        if (image !== undefined) instance.image = image;
      }
      if (slots.last !== undefined) {
        const image = toVeoImage(slots.last);
        if (image !== undefined) instance.lastFrame = image;
      }
      if (slots.references.length > 0) {
        const references: GoogleVeoReferenceImage[] = [];
        for (const reference of slots.references) {
          const image = toVeoImage(reference);
          // "asset" rather than "style": an asset reference is what a subject
          // or product carried into the shot is, and it is the value the REST
          // docs use in their example. `providerOptions` reaches "style".
          if (image !== undefined) references.push({ image, referenceType: "asset" });
        }
        if (references.length > 0) instance.referenceImages = references;
      }
    }

    if (input.video !== undefined) {
      instance.video =
        "url" in input.video
          ? { uri: input.video.url }
          : { encodedVideo: input.video.data, encoding: "video/mp4" };
    }

    if (input.duration !== undefined) {
      // No `allowed` list: `videoFamilyRules` carries 4/6/8 for Veo 3.x, 5–8
      // for Veo 2 and 3–10 for Omni, and it answers on the way out with the
      // model's own numbers, remapped onto `duration`.
      const seconds = ctx.take(
        toDurationNumber(input.duration, undefined, { path: ["duration"], warn: ctx.warn }),
      );
      if (seconds !== undefined) parameters.durationSeconds = seconds;
    }

    if (input.resolution !== undefined) {
      const resolution = ctx.take(
        toTier(input.resolution, RESOLUTIONS, { path: ["resolution"], warn: ctx.warn }),
      );
      if (resolution !== undefined) parameters.resolution = resolution as "720p" | "1080p" | "4k";
    }

    if (input.aspectRatio !== undefined) {
      const ratio = ctx.take(
        toRatioEnum(
          input.aspectRatio,
          ASPECT_RATIOS,
          { source: VEO_DOCS_URL },
          { path: ["aspectRatio"], warn: ctx.warn },
        ),
      );
      if (ratio !== undefined) parameters.aspectRatio = ratio as "16:9" | "9:16";
    }

    if (input.negativePrompt !== undefined) parameters.negativePrompt = input.negativePrompt;
    if (input.seed !== undefined) parameters.seed = input.seed;
    if (input.n !== undefined) parameters.sampleCount = input.n;

    const body: GoogleVideoWire = { model: ctx.model, instances: [instance] };
    // Omitted when empty: `parameters` is optional on the wire, and an empty
    // object is a key the request did not need. Written before `applyExtras`,
    // which nests into `parameters` and creates it when this request had none.
    if (Object.keys(parameters).length > 0) body.parameters = parameters;
    applyExtras(input, GOOGLE_VIDEO_MODEL_PARAMS, body, ctx, { at: ["parameters"] });
    return { params: body, validate: validator.safe };
  },
} as const satisfies VideoAdapterFor<
  typeof GOOGLE_VIDEO_MODEL_PARAMS,
  GoogleVideoWire,
  GoogleVideoResult
>;
