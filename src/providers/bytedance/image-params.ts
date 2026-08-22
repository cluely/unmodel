/**
 * The image adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/bytedance/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { ModelParamTable } from "../../core/unified/vocabulary/image";

/**
 * Every Seedream id on `POST /api/v3/images/generations` — the `imageModels`
 * catalog, in the order the Model list prints it.
 *
 * `seededit-3-0-i2i-250628` is in the catalog and is deliberately **not**
 * here: BytePlus withdrew its API reference, so unmodel carries no constraint
 * table, no shape rule and no typed arm for it. A ref naming it still works —
 * it earns the kernel's `unknown_model` warning and compiles down the
 * ungated path — but declaring it as a model this adapter *serves* would
 * promise a mapping nobody can check.
 */
export const MODELS = [
  "dola-seedream-5-0-pro-260628",
  "seedream-5-0-260128",
  "seedream-5-0-lite-260128",
  "seedream-4-5-251128",
  "seedream-4-0-250828",
] as const;

// ---------------------------------------------------------------------------
// The per-model table
// ---------------------------------------------------------------------------

/**
 * One `size` field, two grammars, and both are offered.
 *
 * The keyword arm (`"1K"`, `"2K"`, `"4K"` and the between-tier `"1.5K"` /
 * `"3K"`) is a **literal** rather than a pixel pair, so it reaches the wire
 * through `resolveSizing`'s literal arm — which is also what makes `"1.5K"` and
 * `"3K"` reachable at all: the canonical `resolution` has three tiers and
 * ModelArk has five keywords, and rather than invent two canonical words that
 * only this provider would ever use, `size` carries the provider's own
 * spelling. The `WxH` arm is free-form (`sizeFreeform`), bounded only by each
 * model's total-pixel range, so the presets below are curated exact-ratio
 * pairs at that model's own tiers, not an enum.
 *
 * `"auto"` is deliberately absent from every row: it exists only in
 * layer-decomposition mode (`layer_decomposition: true`), so offering it
 * unconditionally would autocomplete a value most requests cannot use.
 * `providerOptions.bytedance.size` still reaches it.
 *
 * `ratios` is absent everywhere: there is no `aspect_ratio` field on this API
 * at all — a canonical ratio is *derived* into a `WxH` by `toSizeFreeform` —
 * so the wide ratio vocabulary is the honest one.
 *
 * The extras are ModelArk's own knobs, and the `PRO_ONLY` / `SEQUENTIAL_ONLY`
 * split in `./constraints.ts` is what the per-model rows below restate:
 * `background` and `layer_decomposition` are Seedream 5.0 pro's alone, the
 * sequential-batch family is everyone else's, and
 * `optimize_prompt_options.mode` narrows to `"standard"` on the three models
 * whose docs say fast mode is not supported.
 */
export const DOLA_SEEDREAM_5_0_PRO_SIZES = [
  "1K", "1.5K", "2K",
  "1024x1024", "1184x888", "888x1184", "1248x832", "832x1248", "1280x720",
  "720x1280", "1554x666", "666x1554", "1448x724", "724x1448", "1536x1536",
  "1776x1332", "1332x1776", "1872x1248", "1248x1872", "2048x1152", "1152x2048",
  "2352x1008", "1008x2352", "2176x1088", "1088x2176", "2048x2048", "2368x1776",
  "1776x2368", "2496x1664", "1664x2496", "2720x1530", "1530x2720", "3276x1404",
  "1404x3276", "2896x1448", "1448x2896",
] as const;

export const SEEDREAM_5_0_SIZES = [
  "2K", "3K", "4K",
  "2048x2048", "2368x1776", "1776x2368", "2496x1664", "1664x2496", "2560x1440",
  "1440x2560", "3276x1404", "1404x3276", "2896x1448", "1448x2896", "3072x3072",
  "3552x2664", "2664x3552", "3744x2496", "2496x3744", "4096x2304", "2304x4096",
  "4704x2016", "2016x4704", "4344x2172", "2172x4344", "4096x4096", "4720x3540",
  "3540x4720", "4992x3328", "3328x4992", "5440x3060", "3060x5440", "6216x2664",
  "2664x6216", "5792x2896", "2896x5792",
] as const;

export const SEEDREAM_4_5_SIZES = [
  "2K", "4K",
  "2048x2048", "2368x1776", "1776x2368", "2496x1664", "1664x2496", "2560x1440",
  "1440x2560", "3276x1404", "1404x3276", "2896x1448", "1448x2896", "4096x4096",
  "4720x3540", "3540x4720", "4992x3328", "3328x4992", "5440x3060", "3060x5440",
  "6216x2664", "2664x6216", "5792x2896", "2896x5792",
] as const;

export const SEEDREAM_4_0_SIZES = [
  "1K", "2K", "4K",
  "1024x1024", "1184x888", "888x1184", "1248x832", "832x1248", "1280x720",
  "720x1280", "1554x666", "666x1554", "1448x724", "724x1448", "2048x2048",
  "2368x1776", "1776x2368", "2496x1664", "1664x2496", "2560x1440", "1440x2560",
  "3276x1404", "1404x3276", "2896x1448", "1448x2896", "4096x4096", "4720x3540",
  "3540x4720", "4992x3328", "3328x4992", "5440x3060", "3060x5440", "6216x2664",
  "2664x6216", "5792x2896", "2896x5792",
] as const;

export const WATERMARK = EXTRA as boolean;

export const SEQUENTIAL = EXTRA as "auto" | "disabled";

export const SEQUENTIAL_OPTIONS = EXTRA as { max_images?: number };

export const STANDARD_ONLY = EXTRA as { mode?: "standard" };

export const SEQUENTIAL_EXTRAS = {
  watermark: WATERMARK,
  sequential_image_generation: SEQUENTIAL,
  sequential_image_generation_options: SEQUENTIAL_OPTIONS,
} as const;

export const BYTEDANCE_IMAGE_MODEL_PARAMS = {
  "dola-seedream-5-0-pro-260628": {
    sizes: DOLA_SEEDREAM_5_0_PRO_SIZES,
    sizeFreeform: true,
    tiers: ["1k", "2k"],
    extras: {
      watermark: WATERMARK,
      background: EXTRA as "transparent" | "opaque",
      layer_decomposition: EXTRA as boolean,
      optimize_prompt_options: EXTRA as { mode?: "standard" | "fast" },
    },
  },
  "seedream-5-0-260128": {
    sizes: SEEDREAM_5_0_SIZES,
    sizeFreeform: true,
    tiers: ["2k", "4k"],
    extras: { ...SEQUENTIAL_EXTRAS, optimize_prompt_options: STANDARD_ONLY },
  },
  "seedream-5-0-lite-260128": {
    sizes: SEEDREAM_5_0_SIZES,
    sizeFreeform: true,
    tiers: ["2k", "4k"],
    extras: { ...SEQUENTIAL_EXTRAS, optimize_prompt_options: STANDARD_ONLY },
  },
  "seedream-4-5-251128": {
    sizes: SEEDREAM_4_5_SIZES,
    sizeFreeform: true,
    tiers: ["2k", "4k"],
    extras: { ...SEQUENTIAL_EXTRAS, optimize_prompt_options: STANDARD_ONLY },
  },
  "seedream-4-0-250828": {
    sizes: SEEDREAM_4_0_SIZES,
    sizeFreeform: true,
    tiers: ["1k", "2k", "4k"],
    extras: {
      ...SEQUENTIAL_EXTRAS,
      optimize_prompt_options: EXTRA as { mode?: "standard" | "fast" },
    },
  },
} as const satisfies ModelParamTable;
