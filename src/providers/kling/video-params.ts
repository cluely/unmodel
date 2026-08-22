/**
 * The video adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/kling/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VideoModelParamTable } from "../../core/unified/vocabulary/video";
import { KLING_ASPECT_RATIOS, type KlingWatermarkInfo } from "./shared";
import {
  V1_MODEL_RULES,
  V1_MODE_TIERS,
  type KlingCameraControl,
  type KlingShot,
  type KlingShotType,
  type V1RuleModelId,
  type V1RulesOf,
} from "./v1-routes";
import { TEXT2VIDEO_MODELS } from "./shared";

/** Every video model across the three route families — the `kling/…` ref union. */
export const MODELS = [
  // The corroborated `/v1/videos/*` family (`model_name` in the body).
  "kling-v3",
  "kling-v2-6",
  "kling-v2-5-turbo",
  "kling-v2-1-master",
  "kling-v2-1",
  "kling-v2-master",
  "kling-v1-6",
  "kling-v1-5",
  "kling-v1",
  // EXPERIMENTAL path-addressed routes.
  "kling-3.0",
  "kling-3.0-turbo",
  "kling-2.6",
  "kling-2.5-turbo",
  "kling-3.0-omni",
  "kling-o1",
] as const;

/**
 * Kling's per-model surface, across all three route families.
 *
 * ## The two families, in the two lists
 *
 * `mode` on `/v1/videos/*` is a resolution with another name ("std = 720P, pro
 * = 1080P, 4k = 4K"), so a `kling-v*` row's `resolutions` is that model's mode
 * set translated back into tiers — `kling-v2-master` is pro-only, hence
 * `["1080p"]`. Those nine rows are no longer written out: {@link rowOf} DERIVES
 * them from `V1_MODEL_RULES`, the same table `kling.video` /
 * `kling.videoFromImage` narrow their bodies from, so the two surfaces cannot
 * disagree about a model again (see the block above `rowOf`). The
 * path-addressed family spells its tiers directly and its six rows are still
 * written out — its rule tables come from the doc site's JS bundle rather than
 * a served page, so those wire validators stay deliberately wide and there is
 * nothing there to derive *from* that a reader could check. `480p` and `1440p`
 * are on nothing. `./video.test.ts` ties all fifteen rows to their rule tables
 * either way.
 *
 * `ratios: []` marks `kling-v2-1` and `kling-v1-5`: both are **image-to-video
 * only** ids (they are absent from `TEXT2VIDEO_MODELS` — which is now what the
 * derivation reads, rather than a fact restated here), and
 * `/v1/videos/image2video` has no `aspect_ratio` field because the frame sets
 * the shape. Every other model keeps the three-value enum, which the image
 * route still refuses at run time — the shape is a text-route param on both
 * families, and only omni takes it alongside a frame.
 *
 * ## Extras, and why they nest differently per family
 *
 * The same key lands in a different place depending on which family the ref
 * selected: `watermark_info` is a body-root field on `/v1/videos/*` and lives
 * under `options` on the path-addressed routes, and `multi_shot` is body-root
 * on `kling-v3` and under `settings` on `kling-3.0`. That is what
 * {@link V3_NESTING} is for — one table, so the "not a parameter this model
 * accepts" check still sees every key, with a per-key prefix at the write.
 *
 * Excluded on purpose:
 *
 * - **`static_mask`, `dynamic_masks`, `element_list`, `voice_list`** exist on
 *   `image2video` and not on `text2video`, and this surface picks the route
 *   from the inputs. `videoSchema` is a `looseObject`, so one of them on a
 *   text request would ride onto a body that has no such field and be ignored
 *   rather than refused — the one outcome the loss contract does not allow.
 * - **`shot_type` and `multi_prompt`** are accepted by the schema on every v1
 *   id, but they only do anything alongside `multi_shot`, which is `kling-v3`'s
 *   alone. They are declared on `kling-v3` for that reason: a `shot_type` on
 *   `kling-v1` is accepted-and-ignored, which is worse than refused.
 * - **`cfg_scale`** is `kling-v1` / `-v1-5` / `-v1-6` only (`V1_MODEL_RULES`),
 *   and **`camera_control`** is `kling-v1` alone — not `kling-v1-6`, which the
 *   research had wrong and `V1_MODEL_RULES` settles.
 *
 * `callback_url` and `external_task_id` are transport and stay on
 * `providerOptions.kling`.
 */
export const WATERMARK = { watermark_info: EXTRA as KlingWatermarkInfo } as const;

export const V1_CFG_ROW_EXTRAS = { ...WATERMARK, cfg_scale: EXTRA as number } as const;

export const THREE_ZERO_DURATIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

// ---------------------------------------------------------------------------
// The `/v1/videos/*` rows are DERIVED from `V1_MODEL_RULES`, not restated.
//
// Those nine rows used to be nine hand-written literals beside a rule table
// describing the same nine models, and the two disagreed in the direction that
// matters most: the rows said `kling-v2-5-turbo` runs 5 or 10 seconds — which
// `V1_MODEL_RULES` also says — while `kling.video`, the wire validator this
// adapter compiles *down to*, accepted `duration: "8"` there at compile time.
// A wire-exact validator looser than the unified surface above it inverts
// docs/decisions.md #1, so the rule table is now the one source: `./video.ts`
// narrows its body arm from it, and `rowOf` below builds these rows from it.
//
// The three transformations are the ones the route's own documentation states:
//
// - **`durations` are the same numbers, spelled differently.** `/v1/videos/*`
//   takes seconds as a STRING ("5") and the canonical vocabulary takes a
//   number (5), so the row is the rule list parsed — not a second list.
// - **`resolutions` are `modes`.** "std = 720P, pro = 1080P, 4k = 4K" is the
//   parameter's own description (see {@link V1_MODE_TIERS}), so a model's mode
//   set IS its tier set: `kling-v2-master` is pro-only, hence `["1080p"]`.
// - **`ratios: []` is route membership, not a ratio rule.** `kling-v2-1` and
//   `kling-v1-5` are image-to-video-only ids (absent from
//   `TEXT2VIDEO_MODELS`), and `/v1/videos/image2video` has no `aspect_ratio`
//   field because the frame sets the shape. Every id the text route serves
//   keeps the full three-value enum — no source narrows `aspect_ratio` per
//   model, which is why the wire arm leaves it wide too.
//
// `extras` stays hand-written, exactly as google's rows do: it carries TYPES
// (`cfg_scale` is a number, `sound` is `"on" | "off"`) that a boolean
// capability flag cannot spell. `./video.test.ts` asserts each extra key is
// present iff the rule table sets its switch, in both directions.
// ---------------------------------------------------------------------------

/** `"5"` → `5`, over a whole rule list, at the type level. */
export type SecondsOf<S> = S extends `${infer N extends number}` ? N : never;

export type DurationNumbers<T extends readonly string[]> = { readonly [K in keyof T]: SecondsOf<T[K]> };

/** `"pro"` → `"1080p"`, over a whole `modes` list. */
export type TiersOf<T extends readonly string[]> = {
  readonly [K in keyof T]: T[K] extends keyof typeof V1_MODE_TIERS
    ? (typeof V1_MODE_TIERS)[T[K]]
    : never;
};

/** One `/v1/videos/*` row, stated as a function of the model's rule row. */
export type V1Row<M extends V1RuleModelId, E extends object> = {
  readonly durations: DurationNumbers<V1RulesOf<M>["durations"]>;
  readonly resolutions: TiersOf<V1RulesOf<M>["modes"]>;
  readonly ratios: M extends (typeof TEXT2VIDEO_MODELS)[number]
    ? typeof KLING_ASPECT_RATIOS
    : readonly [];
  readonly extras: E;
};

export function rowOf<M extends V1RuleModelId, E extends object>(model: M, extras: E): V1Row<M, E> {
  const rules = V1_MODEL_RULES[model]!;
  const onTextRoute = (TEXT2VIDEO_MODELS as readonly string[]).includes(model);
  // One cast, at the one place the two spellings meet: the runtime performs
  // exactly the two mappings `V1Row` states, and `./video.test.ts` re-checks
  // the result against the rule table value by value.
  return {
    durations: rules.durations.map(Number),
    resolutions: rules.modes.map((mode) => V1_MODE_TIERS[mode as keyof typeof V1_MODE_TIERS]),
    ratios: onTextRoute ? KLING_ASPECT_RATIOS : [],
    extras,
  } as unknown as V1Row<M, E>;
}

export const KLING_VIDEO_MODEL_PARAMS = {
  // --- POST /v1/videos/{text2video,image2video} — derived from V1_MODEL_RULES
  "kling-v3": rowOf("kling-v3", {
    ...WATERMARK,
    sound: EXTRA as "on" | "off",
    multi_shot: EXTRA as boolean,
    shot_type: EXTRA as KlingShotType,
    multi_prompt: EXTRA as KlingShot[],
  }),
  "kling-v2-6": rowOf("kling-v2-6", { ...WATERMARK, sound: EXTRA as "on" | "off" }),
  "kling-v2-5-turbo": rowOf("kling-v2-5-turbo", WATERMARK),
  "kling-v2-1-master": rowOf("kling-v2-1-master", WATERMARK),
  "kling-v2-1": rowOf("kling-v2-1", WATERMARK),
  "kling-v2-master": rowOf("kling-v2-master", WATERMARK),
  "kling-v1-6": rowOf("kling-v1-6", V1_CFG_ROW_EXTRAS),
  "kling-v1-5": rowOf("kling-v1-5", V1_CFG_ROW_EXTRAS),
  "kling-v1": rowOf("kling-v1", {
    ...V1_CFG_ROW_EXTRAS,
    camera_control: EXTRA as KlingCameraControl,
  }),
  // --- The path-addressed families ----------------------------------------
  "kling-3.0": {
    durations: THREE_ZERO_DURATIONS,
    resolutions: ["720p", "1080p", "4k"],
    ratios: KLING_ASPECT_RATIOS,
    extras: { ...WATERMARK, audio: EXTRA as "native" | "off", multi_shot: EXTRA as boolean },
  },
  "kling-3.0-turbo": {
    durations: THREE_ZERO_DURATIONS,
    resolutions: ["720p", "1080p"],
    ratios: KLING_ASPECT_RATIOS,
    extras: WATERMARK,
  },
  "kling-2.6": {
    durations: [5, 10],
    resolutions: ["720p", "1080p"],
    ratios: KLING_ASPECT_RATIOS,
    extras: { ...WATERMARK, audio: EXTRA as "native" | "off" },
  },
  "kling-2.5-turbo": {
    durations: [5, 10],
    resolutions: ["720p", "1080p"],
    ratios: KLING_ASPECT_RATIOS,
    extras: WATERMARK,
  },
  "kling-3.0-omni": {
    durations: THREE_ZERO_DURATIONS,
    resolutions: ["720p", "1080p", "4k"],
    ratios: KLING_ASPECT_RATIOS,
    extras: {
      ...WATERMARK,
      audio: EXTRA as "native" | "original" | "off",
      multi_shot: EXTRA as boolean,
    },
  },
  "kling-o1": {
    durations: [3, 4, 5, 6, 7, 8, 9, 10],
    resolutions: ["720p", "1080p"],
    ratios: KLING_ASPECT_RATIOS,
    extras: { ...WATERMARK, audio: EXTRA as "original" | "off" },
  },
} as const satisfies VideoModelParamTable;
