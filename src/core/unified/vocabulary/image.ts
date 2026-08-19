/**
 * `unmodel/image` — the canonical vocabulary for text-to-image.
 *
 * Types only; the compilation lives in each provider's adapter and the shared
 * derivations in `../derive.ts`.
 */
import type {
  AspectRatio,
  Dimensions,
  ImageOutputFormat,
  OutputDelivery,
  ProviderOptions,
  ResolutionTier,
} from "./common";

export type {
  AspectRatio,
  AspectRatioPreset,
  Dimensions,
  ImageOutputFormat,
  OutputDelivery,
  ProviderOptions,
  ResolutionTier,
} from "./common";

/** Everything that is not part of the size decision. */
interface ImageParamsBase {
  /** What to draw. */
  prompt: string;
  /** `"provider/model"`, split on the **first** slash. */
  model: string;
  /**
   * How big, as a tier. Combined with the shape (`aspectRatio` or
   * `dimensions`) this is enough to produce every provider's spelling of size:
   * an enum, a grid-snapped pixel pair, or a free-form `WxH` string.
   */
  resolution?: ResolutionTier;
  /** How many images. Providers that generate exactly one reject anything else. */
  n?: number;
  seed?: number;
  /** What to avoid. Providers with no negative-prompt field report it unsupported. */
  negativePrompt?: string;
  outputFormat?: ImageOutputFormat;
  /** URL or inline bytes. Most providers offer one and reject the other. */
  outputDelivery?: OutputDelivery;
  providerOptions?: ProviderOptions;
}

/**
 * A text-to-image request.
 *
 * ## Why the shape is a union
 *
 * `aspectRatio` and `dimensions` are two spellings of one decision, and the
 * XOR is expressed in the type rather than checked at runtime because the
 * runtime check comes too late to help: by then the caller has already written
 * a request that cannot mean anything. `dimensions?: never` on the ratio arm
 * is what makes `{ aspectRatio: "16:9", dimensions: { … } }` a compile error
 * instead of a coin flip about which one the adapter reads.
 *
 * JavaScript callers, and anyone who casts, still get an `invalid_shape` from
 * `resolveSizing` — the type is the first line of defence, not the only one.
 *
 * Written as a union of two **complete** object types rather than the shorter
 * `Base & (ArmA | ArmB)`. The two are equivalent to assign to, but only the
 * first is a union at the top level — and a distributive `Omit` (which is what
 * `UnifiedInput` applies to substitute `model` with the ref union) flattens
 * the shorter form back into a single object with both fields optional,
 * silently deleting the one invariant this type exists to state.
 */
export type ImageParams =
  | (ImageParamsBase & { aspectRatio?: AspectRatio; dimensions?: never })
  | (ImageParamsBase & { aspectRatio?: never; dimensions?: Dimensions });
