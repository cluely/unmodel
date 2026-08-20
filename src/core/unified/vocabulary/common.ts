/**
 * The words more than one media category needs.
 *
 * Types only — every file under `vocabulary/` compiles to zero bytes, which is
 * what lets `unmodel/image` and its five siblings ship a kernel and nothing
 * else. A constant here would be a constant in six bundles.
 *
 * The vocabulary is *canonical*, not a lowest common denominator: it says what
 * a caller means, and each adapter is responsible for saying whether its
 * provider can express that. A param nobody can express does not belong here;
 * a param one provider expresses differently does, because the adapter can
 * translate it and warn about what the translation cost.
 */

// ---------------------------------------------------------------------------
// Aspect ratio
// ---------------------------------------------------------------------------

/**
 * The ratios worth autocompleting. Every image and video provider serves some
 * subset of these nine, so they are the ones spelled out.
 */
export type AspectRatioPreset =
  | "1:1"
  | "16:9"
  | "9:16"
  | "4:3"
  | "3:4"
  | "3:2"
  | "2:3"
  | "21:9"
  | "9:21";

/**
 * `"16:9"`, or any other `W:H` a provider might accept.
 *
 * The `` (`${number}:${number}` & {}) `` tail is the standard trick for "these
 * are the suggestions, not the limits": the intersection with `{}` stops the
 * template literal from swallowing the preset union, so an editor still offers
 * the nine while `"5:4"` stays legal. Which ratios a given model *actually*
 * accepts is the adapter's business, reported as `invalid_enum_value` naming
 * that model's list.
 */
export type AspectRatio = AspectRatioPreset | (`${number}:${number}` & {});

/**
 * Explicit pixel dimensions, the other way to say the same thing.
 *
 * Mutually exclusive with `aspectRatio` wherever both appear: they are two
 * spellings of one decision, and a request that supplies both has not decided.
 * The type enforces it (see `ImageParams`), and `resolveSizing` in `derive.ts`
 * reports `invalid_shape` for the JavaScript callers the type cannot reach.
 */
export interface Dimensions {
  width: number;
  height: number;
}

/**
 * How big, in the only three sizes every provider agrees on.
 *
 * Deliberately a tier rather than a pixel count: providers express size as an
 * enum (`"1024x1024"`), a free-form string, a grid-constrained pair, or not at
 * all, and a tier is the one thing all four can be derived *from*. The target
 * areas are in `derive.ts`, and every derivation that cannot land on the tier
 * exactly warns rather than pretending.
 */
export type ResolutionTier = "1k" | "2k" | "4k";

/**
 * How big a *clip* is: the three resolutions worth naming, plus the two
 * everyone markets.
 *
 * A separate word from {@link ResolutionTier} because video sizes are named
 * after their **short edge** rather than their pixel count — 1280×720 and
 * 720×1280 are both "720p", and every video API in this build spells its own
 * tiers this way — so `"1k"` would be a translation where `"720p"` is the
 * provider's own word.
 *
 * It lives here rather than in `video.ts` so that `model-params.ts` can read it
 * without the two files importing each other.
 */
export type VideoResolution = "480p" | "720p" | "1080p" | "1440p" | "4k";

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** Still-image encodings. */
export type ImageOutputFormat = "png" | "jpeg" | "webp";

/**
 * Whether the provider should hand back a URL or the bytes inline. Providers
 * that offer only one of the two report the other as `unsupported_param`.
 */
export type OutputDelivery = "url" | "base64";

// ---------------------------------------------------------------------------
// The escape hatch
// ---------------------------------------------------------------------------

/**
 * Per-provider wire params, deep-merged over the compiled body **before**
 * validation — so they are checked by the provider's own four layers exactly
 * like anything the adapter emitted, rather than smuggled past them.
 *
 * Keyed by provider id (`{ openai: { style: "vivid" } }`) so one request
 * literal can carry overrides for every provider it might be pointed at, and
 * only the one the ref names is applied.
 *
 * This is where anything genuinely one-off goes. The unified vocabulary stays
 * small because this exists; inventing a canonical word for a param one
 * provider has would make every other adapter answer for it.
 */
export type ProviderOptions = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

// ---------------------------------------------------------------------------
// Media references
// ---------------------------------------------------------------------------

/** A remote asset the provider fetches itself. */
export interface UrlRef {
  url: string;
}

/** Bytes inline: base64, or a `data:` URL. */
export interface DataRef {
  data: string;
  /** e.g. `"image/png"`. Required where the provider cannot sniff it. */
  mimeType?: string;
}

/** A handle minted by the provider's own file API. */
export interface FileIdRef {
  fileId: string;
}

/** A `Blob`/`File` for the multipart endpoints. */
export interface BlobRef {
  file: Blob;
}
