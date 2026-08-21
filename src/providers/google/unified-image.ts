/**
 * `unmodel/image` → `google.image` (POST models/{model}:predict — Imagen 4).
 *
 * # The vocabulary this endpoint actually has
 *
 * An Imagen `:predict` body is two nested objects and nothing else:
 * `{ model, instances: [{ prompt }], parameters: { … } }`, with `model` a
 * pseudo-param the validator strips into `.request.url`. Every canonical param
 * that survives compilation lands *inside* `parameters`, which is why every
 * `ctx.from` below points two levels down: a finding the provider raises at
 * `parameters.sampleImageSize` has to reach the caller as `resolution`, or it
 * names a field nobody using this surface has ever typed.
 *
 * # Size is a shape and a tier — there is no pixel field
 *
 * | canonical | wire | class |
 * |---|---|---|
 * | `aspectRatio` | `parameters.aspectRatio` | **S1** — a closed five-value enum |
 * | `resolution` | `parameters.sampleImageSize` | **S6** — `"1K"` / `"2K"`, Standard and Ultra only |
 * | `dimensions` | — | no field exists; a declared gap |
 *
 * The two are independent here, which is unusual and pleasant: a request that
 * names only a shape sends only `aspectRatio` (Imagen's own default size
 * applies), and one that names only a tier sends only `sampleImageSize`
 * (Imagen's own default shape, 1:1, applies). Neither is an approximation, so
 * neither warns — and `16:9` at `1k` is the case where zero warnings is
 * literally true, because both halves have an exact wire spelling.
 *
 * `dimensions` is the gap. Imagen takes a shape and a tier and has no width or
 * height field on any route, so pixels could only be honoured by inventing the
 * nearest of five shapes and throwing the size away. That is declared in
 * `unsupported` rather than handled in `compile`: it is true of all three
 * models, so the kernel can say so uniformly before compiling anything.
 *
 * # Per-model: Fast has no size field at all
 *
 * "imageSize … This is only supported for the Standard and Ultra models" — so
 * `imagen-4.0-fast-generate-001` denies `sampleImageSize` outright (see
 * `imageConstraints`), and a `resolution` on Fast is an error naming the two
 * models that can serve it. It is *not* silently dropped and it is *not*
 * silently treated as 1K: the guide documents which models take the field, not
 * what the models without it produce, so inventing an answer would be a claim
 * this file cannot back.
 *
 * # Everything else
 *
 * - `n` → `parameters.sampleCount`. 1–4; the provider's own enum table says so
 *   and reports the miss, remapped onto `n`.
 * - `outputFormat` → `parameters.outputOptions.mimeType`, and only PNG and JPEG
 *   exist there. WebP is an `invalid_enum_value`, not a guess: the Imagen guide
 *   documents `outputMimeType` as `image/jpeg` / `image/png`, and a MIME type
 *   the API does not encode is not made true by sending it.
 * - `outputDelivery` has no field, because there is nothing to choose:
 *   `:predict` answers with `{ predictions: [{ bytesBase64Encoded, mimeType }] }`
 *   unconditionally. Asking for `"base64"` is therefore exact and free; asking
 *   for `"url"` is an error, since the Cloud Storage output that would produce
 *   one (`storageUri`) is Vertex AI-only and this route rejects it.
 * - `seed` and `negativePrompt` are Vertex AI-only on this API — @google/genai
 *   throws client-side for both in Gemini Developer API mode — so they are
 *   declared gaps rather than params quietly dropped on the way to a request
 *   that would silently ignore them.
 *
 * Everything Imagen has that the vocabulary does not — `personGeneration`,
 * `guidanceScale`, `safetySetting`, `outputOptions` — is typed per model on
 * {@link GOOGLE_IMAGE_MODEL_PARAMS} and copied verbatim into `parameters`, and
 * is checked by the same constraint tables either way. `providerOptions.google`
 * still reaches the rest (`storageUri`, `addWatermark`, `enhancePrompt` — all
 * Vertex-only and all denied here, which is the point of checking).
 */
import {
  applyExtras,
  EXTRA,
  pixelsToRatio,
  resolveSizing,
  sizingField,
  toRatioEnum,
  toTier,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  ImageAdapterFor,
  ImageOutputFormat,
  ImageParams,
  ModelParamTable,
} from "../../core/unified/vocabulary/image";
// The enum and the docs URL come from the same table the provider's own
// runtime check reads, so the compile-time list and the validation-time list
// cannot drift apart.
import { IMAGEN_ASPECT_RATIOS, IMAGEN_DOCS_URL } from "./constraints";
import {
  image as validator,
  type GoogleImagenInstance,
  type GoogleImagenOutputOptions,
  type GoogleImagenPersonGeneration,
} from "./image";

/** The three Imagen 4 codes the Gemini API documents — the `google/…` ref union. */
const MODELS = [
  "imagen-4.0-generate-001",
  "imagen-4.0-ultra-generate-001",
  "imagen-4.0-fast-generate-001",
] as const;

/**
 * The three Imagen rows.
 *
 * No `sizes` anywhere — `models.{model}:predict` has no width, height or `WxH`
 * field on any route, which is the same fact `unsupported.dimensions` states
 * below — so `size` types as `never` and an editor offers the five shapes.
 *
 * The `tiers` split is the whole reason this is a per-**model** table: Standard
 * and Ultra publish `sampleImageSize: "1K" | "2K"`, and Fast has no such field
 * ("only supported for the Standard and Ultra models"). An empty `tiers` makes
 * `resolution` on Fast a compile error, which is the same answer the
 * `unsupported_param` below gives a JavaScript caller.
 *
 * The extras are Imagen's own `parameters` keys, and they land under
 * `parameters` rather than at the body root — the one adapter so far that
 * needs `applyExtras`'s `at`. `outputOptions` shares its wire object with the
 * `mimeType` compiled from `outputFormat`; `place` merges rather than
 * replaces, so setting both keeps both.
 */
const IMAGEN_EXTRAS = {
  personGeneration: EXTRA as GoogleImagenPersonGeneration,
  safetySetting: EXTRA as string,
  includeSafetyAttributes: EXTRA as boolean,
  includeRaiReason: EXTRA as boolean,
  language: EXTRA as string,
  guidanceScale: EXTRA as number,
  outputOptions: EXTRA as Omit<GoogleImagenOutputOptions, "mimeType">,
} as const;

const GOOGLE_IMAGE_MODEL_PARAMS = {
  "imagen-4.0-generate-001": {
    ratios: IMAGEN_ASPECT_RATIOS,
    tiers: ["1k", "2k"],
    extras: IMAGEN_EXTRAS,
  },
  "imagen-4.0-ultra-generate-001": {
    ratios: IMAGEN_ASPECT_RATIOS,
    tiers: ["1k", "2k"],
    extras: IMAGEN_EXTRAS,
  },
  "imagen-4.0-fast-generate-001": {
    ratios: IMAGEN_ASPECT_RATIOS,
    tiers: [],
    extras: IMAGEN_EXTRAS,
  },
} as const satisfies ModelParamTable;

/**
 * The ids whose `parameters` object has no `sampleImageSize` — the Fast model,
 * per the guide's "only supported for the Standard and Ultra models".
 *
 * A set of one, and a set rather than an equality test because the next Imagen
 * generation will bring another Fast row and this is where it goes. An id
 * unmodel does not know is treated as size-capable: it has already drawn an
 * `unknown_model` warning, and the Standard arm is the shape every documented
 * model but one uses.
 */
const NO_IMAGE_SIZE_MODELS: ReadonlySet<string> = new Set(["imagen-4.0-fast-generate-001"]);

/** `sampleImageSize`: "The supported values are 1K and 2K. Default is 1K." */
const IMAGE_SIZES = { "1k": "1K", "2k": "2K" } as const;

/** `outputOptions.mimeType`: the two encodings the guide documents. */
const MIME_TYPES: Readonly<Partial<Record<ImageOutputFormat, string>>> = {
  png: "image/png",
  jpeg: "image/jpeg",
};

/**
 * `parameters` — the loose arm of `GoogleImagenParameters`.
 *
 * `aspectRatio` and `sampleImageSize` are `string` here rather than their exact
 * unions (`GoogleImagenAspectRatio`, `GoogleImagenImageSize`) because that is
 * what a compiled value is: `toRatioEnum` returns the provider's own spelling
 * out of `IMAGEN_ASPECT_RATIOS`, and the validator re-checks it against the
 * same list. The exact unions stay exported from `./image` for hand-written
 * calls, where a literal can be checked at the call site.
 */
export interface GoogleImageWireParameters {
  /** 1–4. SDK: numberOfImages. */
  sampleCount?: number;
  /** One of `IMAGEN_ASPECT_RATIOS`. */
  aspectRatio?: string;
  /** `"1K"` / `"2K"`. SDK: imageSize. Standard and Ultra only. */
  sampleImageSize?: string;
  /** SDK: outputMimeType / outputCompressionQuality. */
  outputOptions?: GoogleImagenOutputOptions;
  [key: string]: unknown;
}

/**
 * The wire body this adapter compiles to — the loose arm of
 * `GenerateImagesBody`, whose three top-level keys are the whole body.
 *
 * No index signature here, unlike most of these wire types: `UnknownImagenBody`
 * has none either, so `ExactKeys` would read one as three excess keys and the
 * endpoint's own `safe` would stop accepting this type. Extension happens one
 * level down, in `parameters`, which is where every Imagen param lives anyway.
 */
export interface GoogleImageWire {
  model: string;
  /** Exactly one instance; `parameters.sampleCount` asks for more images. */
  instances: GoogleImagenInstance[];
  parameters?: GoogleImageWireParameters;
}

/** What a unified image call to `google/…` returns: `google.image`'s `Validated`. */
export type GoogleImageResult = ReturnType<
  typeof validator<GoogleImageWire["model"], GoogleImageWire>
>;

export const image = {
  category: "image",
  provider: "google",
  models: MODELS,
  modelParams: GOOGLE_IMAGE_MODEL_PARAMS,
  unsupported: {
    dimensions:
      "Imagen sizes by shape and tier — `parameters.aspectRatio` (one of " +
      '"1:1", "3:4", "4:3", "9:16", "16:9") plus `parameters.sampleImageSize` ("1K"/"2K") — ' +
      "and models.{model}:predict has no width or height field on any route, so exact pixels " +
      "could only be honoured by dropping the size. Use `aspectRatio` and `resolution`.",
    seed:
      "`seed` is Vertex AI-only: the Gemini API's models.{model}:predict rejects it, and " +
      "@google/genai throws client-side for it in Gemini Developer API mode. Imagen output on " +
      "this API is not reproducible.",
    negativePrompt:
      "`negativePrompt` is Vertex AI-only: the Gemini API's models.{model}:predict rejects it, " +
      "and @google/genai throws client-side for it in Gemini Developer API mode. Describe what " +
      "to avoid inside `prompt` instead.",
  },
  compile(
    input: ImageParams,
    ctx: CompileContext<ImageParams>,
  ): CompiledCall<GoogleImageWire, GoogleImageResult> {
    const parameters: GoogleImageWireParameters = {};
    const body: GoogleImageWire = { model: ctx.model, instances: [{ prompt: input.prompt }] };
    ctx.from(["instances", 0, "prompt"], "prompt");
    ctx.from(["parameters", "aspectRatio"], "aspectRatio");
    ctx.from(["parameters", "sampleImageSize"], "resolution");
    ctx.from(["parameters", "sampleCount"], "n");
    ctx.from(["parameters", "outputOptions", "mimeType"], "outputFormat");

    // `dimensions` is a declared gap, so the kernel has already reported it and
    // this can only be the ratio arm or nothing. `resolveSizing` still runs,
    // because the XOR itself is a runtime check for JavaScript callers.
    const sizing = ctx.take(resolveSizing(input, { path: ["aspectRatio"], warn: ctx.warn }));
    if (sizing?.kind === "ratio") {
      const ratio = ctx.take(
        toRatioEnum(
          sizing.aspectRatio,
          IMAGEN_ASPECT_RATIOS,
          { source: IMAGEN_DOCS_URL },
          { path: ["aspectRatio"], warn: ctx.warn },
        ),
      );
      if (ratio !== undefined) parameters.aspectRatio = ratio;
    } else if (sizing?.kind === "dimensions") {
      // Reached only by a `size` string: `dimensions` is a declared gap and the
      // kernel has already refused it. A `size` is the same decision spelled
      // differently, and this route can carry only the shape — so it goes
      // through `pixelsToRatio`, which warns that the pixel count did not
      // survive. Typed callers never land here: `size` is `never` on all three
      // rows.
      const wrote = sizingField(sizing);
      ctx.from(["parameters", "aspectRatio"], wrote);
      const ratio = ctx.take(
        pixelsToRatio(sizing.dimensions.width, sizing.dimensions.height, IMAGEN_ASPECT_RATIOS, {
          path: [wrote],
          warn: ctx.warn,
        }),
      );
      if (ratio !== undefined) parameters.aspectRatio = ratio as (typeof IMAGEN_ASPECT_RATIOS)[number];
    }

    // No default tier: `sampleImageSize` is optional and Imagen documents its
    // own default ("Default is 1K"). Sending 1K for a caller who never
    // mentioned size would put a value on the wire they did not choose, and
    // pin a default that is the provider's to change.
    if (input.resolution !== undefined) {
      if (NO_IMAGE_SIZE_MODELS.has(ctx.model)) {
        ctx.fail({
          code: "unsupported_param",
          path: ["resolution"],
          message:
            "`sampleImageSize` (SDK imageSize) is only supported for the Standard and Ultra " +
            `Imagen models, so "${ctx.model}" has no size field at all and the guide does not ` +
            "document what it produces. Use imagen-4.0-generate-001 or " +
            "imagen-4.0-ultra-generate-001 to choose 1K or 2K.",
          meta: { value: input.resolution, source: IMAGEN_DOCS_URL },
        });
      } else {
        const size = ctx.take(
          toTier(input.resolution, IMAGE_SIZES, { path: ["resolution"], warn: ctx.warn }),
        );
        if (size !== undefined) parameters.sampleImageSize = size;
      }
    }

    if (input.n !== undefined) parameters.sampleCount = input.n;

    if (input.outputFormat !== undefined) {
      const mimeType = MIME_TYPES[input.outputFormat];
      if (mimeType === undefined) {
        ctx.fail({
          code: "invalid_enum_value",
          path: ["outputFormat"],
          message:
            "`outputOptions.mimeType` (SDK outputMimeType) documents only \"image/png\" and " +
            `"image/jpeg" on the Gemini API; ${JSON.stringify(input.outputFormat)} has no ` +
            "equivalent, and a MIME type Imagen does not encode is not made true by sending it.",
          meta: {
            allowed: Object.keys(MIME_TYPES),
            value: input.outputFormat,
            source: IMAGEN_DOCS_URL,
          },
        });
      } else {
        parameters.outputOptions = { mimeType };
      }
    }

    if (input.outputDelivery !== undefined) {
      // No `ctx.from`: nothing is emitted for delivery on either branch, and a
      // provenance rule for a wire key this adapter never writes would steal
      // the path from a caller who reached `parameters.storageUri` through
      // `providerOptions` — whose message should say exactly that.
      //
      // No field, and none needed: the response is
      // `{ predictions: [{ bytesBase64Encoded, mimeType }] }` for every model on
      // this route. Asking for that is exact; asking for a URL is asking for
      // `storageUri`, which is Vertex AI-only and denied here.
      if (input.outputDelivery !== "base64") {
        ctx.fail({
          code: "unsupported_param",
          path: ["outputDelivery"],
          message:
            "models.{model}:predict returns every image inline as `bytesBase64Encoded`; the " +
            "Gemini API has no URL delivery — `storageUri` (SDK outputGcsUri), the Cloud " +
            `Storage output that would produce one, is Vertex AI-only, so "${ctx.model}" ` +
            "cannot return a URL.",
          meta: { value: input.outputDelivery, source: IMAGEN_DOCS_URL },
        });
      }
    }

    // Omitted entirely when empty: `parameters` is optional on the wire, and an
    // empty object is a key the request did not need.
    if (Object.keys(parameters).length > 0) body.parameters = parameters;

    // After the `parameters` object is attached, so an extra lands beside the
    // compiled keys rather than in an object the line above then replaces.
    applyExtras(input, GOOGLE_IMAGE_MODEL_PARAMS, body, ctx, { at: ["parameters"] });

    return { params: body, validate: validator.safe };
  },
} as const satisfies ImageAdapterFor<
  typeof GOOGLE_IMAGE_MODEL_PARAMS,
  GoogleImageWire,
  GoogleImageResult
>;
