/**
 * `unmodel/values` ↔ `unmodel/types`. Not executed by `bun test`;
 * type-checked by `bun run check`.
 *
 * Ten arrays and ten unions say the same thing twice, and the repo's own rule
 * about second declarations is that they cannot be kept in step by intention.
 * `src/core/unified/values.ts` carries `satisfies readonly <Union>[]` on every
 * array, which catches **one** of the two failures — a member the union does
 * not have. The other one is the dangerous one and `satisfies` cannot see it:
 * add `"5:4"` to `AspectRatioPreset` and forget the array, and every picker
 * built from `ASPECT_RATIO_PRESETS` silently offers eight ratios out of nine.
 * No runtime test can catch it either, because there is nothing to compare the
 * array against at run time. So both directions are compared here, for all
 * ten, exactly the way `canonical-keys.test-d.ts` compares the kernel's key
 * lists with the `*Params` types.
 *
 * Two `Record` key-sets get the same treatment, and for a sharper reason: they
 * are *unasserted* second declarations. `DEFAULT_CONTAINER` and `TIER_PIXELS`
 * in `derive.ts` are annotated `Readonly<Record<AudioFormatCodec, …>>` and
 * `Readonly<Record<ResolutionTier, …>>`, so TypeScript already refuses a
 * missing key — but a *stale* key would be caught only because the annotation
 * is there, and the annotation is exactly the thing a refactor drops. Pinning
 * the key-sets makes both directions explicit rather than incidental.
 *
 * And `CHAT_MODEL_REFS`, which is generated: 1,339 strings that must be the
 * 1,339 arms of `ChatModelRef`. A models.dev refresh regenerates both files
 * from one scope, so the only way they can disagree is a codegen change — which
 * is precisely when a compile error is worth having.
 */
import {
  ASPECT_RATIO_PRESETS,
  AUDIO_CONTAINERS,
  AUDIO_FORMAT_CODECS,
  AUDIO_INPUT_KINDS,
  IMAGE_OUTPUT_FORMATS,
  OUTPUT_DELIVERIES,
  RESOLUTION_TIERS,
  TIMESTAMP_GRANULARITIES,
  TTS_DELIVERY_KINDS,
  VIDEO_RESOLUTIONS,
} from "../../src/core/unified/values";
import { DEFAULT_CONTAINER, TIER_PIXELS } from "../../src/core/unified/derive";
import { CHAT_MODEL_REFS } from "../../src/catalog/chat-refs-values.gen";
import type { AudioContainer, AudioFormatCodec } from "../../src/core/unified/vocabulary/audio";
import type {
  AspectRatioPreset,
  ImageOutputFormat,
  OutputDelivery,
  ResolutionTier,
  TtsDeliveryKind,
  VideoResolution,
} from "../../src/core/unified/vocabulary/common";
import type {
  AudioInputKind,
  TimestampGranularity,
} from "../../src/core/unified/vocabulary/stt";
import type { ChatModelRef } from "../../src/catalog/chat-refs.gen";
import { expectTrue, type IsNever } from "./helpers";

/** A member of the array the union does not have: a value nothing accepts. */
type Extra<A extends readonly unknown[], U> = Exclude<A[number], U>;

/** A member of the union the array does not have: a value no picker offers. */
type Missing<A extends readonly unknown[], U> = Exclude<U, A[number]>;

// ---------------------------------------------------------------------------
// The ten canonical arrays
// ---------------------------------------------------------------------------

expectTrue<IsNever<Extra<typeof ASPECT_RATIO_PRESETS, AspectRatioPreset>>>();
expectTrue<IsNever<Missing<typeof ASPECT_RATIO_PRESETS, AspectRatioPreset>>>();

expectTrue<IsNever<Extra<typeof RESOLUTION_TIERS, ResolutionTier>>>();
expectTrue<IsNever<Missing<typeof RESOLUTION_TIERS, ResolutionTier>>>();

expectTrue<IsNever<Extra<typeof VIDEO_RESOLUTIONS, VideoResolution>>>();
expectTrue<IsNever<Missing<typeof VIDEO_RESOLUTIONS, VideoResolution>>>();

expectTrue<IsNever<Extra<typeof IMAGE_OUTPUT_FORMATS, ImageOutputFormat>>>();
expectTrue<IsNever<Missing<typeof IMAGE_OUTPUT_FORMATS, ImageOutputFormat>>>();

expectTrue<IsNever<Extra<typeof OUTPUT_DELIVERIES, OutputDelivery>>>();
expectTrue<IsNever<Missing<typeof OUTPUT_DELIVERIES, OutputDelivery>>>();

expectTrue<IsNever<Extra<typeof AUDIO_FORMAT_CODECS, AudioFormatCodec>>>();
expectTrue<IsNever<Missing<typeof AUDIO_FORMAT_CODECS, AudioFormatCodec>>>();

expectTrue<IsNever<Extra<typeof AUDIO_CONTAINERS, AudioContainer>>>();
expectTrue<IsNever<Missing<typeof AUDIO_CONTAINERS, AudioContainer>>>();

expectTrue<IsNever<Extra<typeof TIMESTAMP_GRANULARITIES, TimestampGranularity>>>();
expectTrue<IsNever<Missing<typeof TIMESTAMP_GRANULARITIES, TimestampGranularity>>>();

expectTrue<IsNever<Extra<typeof AUDIO_INPUT_KINDS, AudioInputKind>>>();
expectTrue<IsNever<Missing<typeof AUDIO_INPUT_KINDS, AudioInputKind>>>();

// `TtsDeliveryKind` is derived from `TtsDelivery["kind"]`, so the union follows
// the arms automatically and this array is the one thing that does not — a
// sixth arm with no member here is a picker that cannot name it.
expectTrue<IsNever<Extra<typeof TTS_DELIVERY_KINDS, TtsDeliveryKind>>>();
expectTrue<IsNever<Missing<typeof TTS_DELIVERY_KINDS, TtsDeliveryKind>>>();

// ---------------------------------------------------------------------------
// The two key-set declarations in derive.ts
// ---------------------------------------------------------------------------

expectTrue<IsNever<Exclude<keyof typeof DEFAULT_CONTAINER, AudioFormatCodec>>>();
expectTrue<IsNever<Exclude<AudioFormatCodec, keyof typeof DEFAULT_CONTAINER>>>();

expectTrue<IsNever<Exclude<keyof typeof TIER_PIXELS, ResolutionTier>>>();
expectTrue<IsNever<Exclude<ResolutionTier, keyof typeof TIER_PIXELS>>>();

// …and the containers `DEFAULT_CONTAINER` names really are containers, which
// the annotation states but nothing re-checks once someone widens it.
expectTrue<IsNever<Exclude<(typeof DEFAULT_CONTAINER)[AudioFormatCodec], AudioContainer>>>();

// ---------------------------------------------------------------------------
// The generated chat refs
// ---------------------------------------------------------------------------

expectTrue<IsNever<Extra<typeof CHAT_MODEL_REFS, ChatModelRef>>>();
expectTrue<IsNever<Missing<typeof CHAT_MODEL_REFS, ChatModelRef>>>();
