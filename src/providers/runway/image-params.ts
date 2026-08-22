/**
 * The image adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/runway/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { ModelParamTable } from "../../core/unified/vocabulary/image";

/** Every model the text_to_image route has an arm for — the `imageModels` catalog. */
export const MODELS = [
  "gen4_image",
  "gen4_image_turbo",
  "gpt_image_2",
  "gemini_image3_pro",
  "gemini_image3.1_flash",
  "seedream5_pro",
  "seedream5_lite",
  "grok_imagine_image_2",
  "gemini_2.5_flash",
] as const;

// ---------------------------------------------------------------------------
// The per-model table
// ---------------------------------------------------------------------------

/**
 * Nine models, nine `ratio` enums.
 *
 * Runway spells its sizes as **pixel pairs punctuated with a colon**
 * (`"1920:1080"`), which is why every row's `sizes` is that enum respelled with
 * an `x`: the canonical `size` is a `WxH`, `resolveSizing` parses it into a
 * pair, and the `dimensions` arm below re-punctuates it into Runway's own
 * spelling. The two lists are the same values, and the preset sweep compiles
 * every one of them through this adapter to prove it.
 *
 * No `sizeFreeform` anywhere: each arm's `ratio` is a closed enum, so a
 * template tail would suggest a size the endpoint refuses. No `ratios` either
 * — Runway has no ratio field, only that pixel-pair enum, so a canonical
 * `aspectRatio` is *matched* against the enum rather than sent, and the wide
 * vocabulary is the honest one.
 *
 * The extras split by arm, exactly as `imageConstraints` does:
 * `contentModeration` on the two gen4 arms, OpenAI's `quality` / `background`
 * on the `gpt_image_2` arm (with `"transparent"` absent, same as at OpenAI
 * itself), `grounding` on the seedream5 pair, and `quality` / `edit` on Grok.
 */
export const GEN4_SIZES = [
  "1024x1024", "1080x1080", "1168x880", "1360x768", "1440x1080", "1080x1440",
  "1808x768", "1920x1080", "1080x1920", "2112x912", "1280x720", "720x1280",
  "720x720", "960x720", "720x960", "1680x720",
] as const;

export const RUNWAY_GPT_IMAGE_2_SIZES = [
  "2048x880", "1920x1088", "1920x1280", "1920x1440", "1920x1536", "1920x1920",
  "1536x1920", "1440x1920", "1280x1920", "1088x1920", "2912x1248", "2560x1440",
  "2560x1712", "2560x1920", "2560x2048", "2560x2560", "2048x2560", "1920x2560",
  "1712x2560", "1440x2560", "3840x1648", "3840x2160", "3504x2336", "3264x2448",
  "3200x2560", "2880x2880", "2560x3200", "2448x3264", "2336x3504", "2160x3840",
] as const;

export const GEMINI_IMAGE3_PRO_SIZES = [
  "1344x768", "768x1344", "1024x1024", "1184x864", "864x1184", "1536x672",
  "832x1248", "1248x832", "896x1152", "1152x896", "2048x2048", "1696x2528",
  "2528x1696", "1792x2400", "2400x1792", "1856x2304", "2304x1856", "1536x2752",
  "2752x1536", "3168x1344", "4096x4096", "3392x5056", "5056x3392", "3584x4800",
  "4800x3584", "3712x4608", "4608x3712", "3072x5504", "5504x3072", "6336x2688",
] as const;

export const GEMINI_IMAGE3_1_FLASH_SIZES = [
  "512x512", "416x624", "624x416", "432x592", "592x432", "448x576",
  "576x448", "384x672", "672x384", "768x336", "256x1024", "1024x256",
  "176x1408", "1408x176", "1024x1024", "832x1248", "1248x832", "864x1184",
  "1184x864", "896x1152", "1152x896", "768x1344", "1344x768", "1536x672",
  "512x2048", "2048x512", "352x2816", "2816x352", "2048x2048", "1696x2528",
  "2528x1696", "1792x2400", "2400x1792", "1856x2304", "2304x1856", "1536x2752",
  "2752x1536", "3168x1344", "1024x4096", "4096x1024", "704x5632", "5632x704",
  "4096x4096", "3392x5056", "5056x3392", "3584x4800", "4800x3584", "3712x4608",
  "4608x3712", "3072x5504", "5504x3072", "6336x2688", "2048x8192", "8192x2048",
  "1408x11264", "11264x1408",
] as const;

export const SEEDREAM5_PRO_SIZES = [
  "1024x1024", "1184x896", "896x1184", "1376x768", "768x1376", "1296x864",
  "864x1296", "2048x2048", "2304x1728", "1728x2304", "2720x1530", "1530x2720",
  "2496x1664", "1664x2496",
] as const;

export const SEEDREAM5_LITE_SIZES = [
  "2048x2048", "2304x1728", "1728x2304", "2848x1600", "1600x2848", "2496x1664",
  "1664x2496", "3136x1344", "3072x3072", "3456x2592", "2592x3456", "4096x2304",
  "2304x4096", "3744x2496", "2496x3744", "4704x2016",
] as const;

export const GROK_IMAGINE_IMAGE_2_SIZES = [
  "1024x1024", "1280x720", "720x1280", "1152x864", "864x1152", "1248x832",
  "832x1248", "1248x576", "576x1248", "1280x576", "576x1280", "1408x704",
  "704x1408", "2048x2048", "2816x1584", "1584x2816", "2368x1776", "1776x2368",
  "2496x1664", "1664x2496", "2912x1344", "1344x2912", "3200x1440", "1440x3200",
  "2912x1456", "1456x2912",
] as const;

export const GEMINI_2_5_FLASH_SIZES = [
  "1344x768", "768x1344", "1024x1024", "1184x864", "864x1184", "1536x672",
  "832x1248", "1248x832", "896x1152", "1152x896",
] as const;

export const CONTENT_MODERATION = {
  contentModeration: EXTRA as { publicFigureThreshold?: "auto" | "low" },
} as const;

export const RUNWAY_IMAGE_MODEL_PARAMS = {
  gen4_image: { sizes: GEN4_SIZES, tiers: ["1k"], extras: CONTENT_MODERATION },
  gen4_image_turbo: { sizes: GEN4_SIZES, tiers: ["1k"], extras: CONTENT_MODERATION },
  gpt_image_2: {
    sizes: RUNWAY_GPT_IMAGE_2_SIZES,
    tiers: ["1k", "2k", "4k"],
    extras: {
      quality: EXTRA as "low" | "medium" | "high" | "auto",
      background: EXTRA as "opaque" | "auto",
    },
  },
  gemini_image3_pro: {
    sizes: GEMINI_IMAGE3_PRO_SIZES,
    tiers: ["1k", "2k", "4k"],
  },
  "gemini_image3.1_flash": {
    sizes: GEMINI_IMAGE3_1_FLASH_SIZES,
    tiers: ["1k", "2k", "4k"],
  },
  seedream5_pro: {
    sizes: SEEDREAM5_PRO_SIZES,
    tiers: ["1k", "2k"],
    extras: { grounding: EXTRA as boolean },
  },
  seedream5_lite: {
    sizes: SEEDREAM5_LITE_SIZES,
    tiers: ["2k", "4k"],
    extras: { grounding: EXTRA as boolean },
  },
  grok_imagine_image_2: {
    sizes: GROK_IMAGINE_IMAGE_2_SIZES,
    tiers: ["1k", "2k"],
    extras: { quality: EXTRA as "low" | "medium", edit: EXTRA as boolean },
  },
  "gemini_2.5_flash": { sizes: GEMINI_2_5_FLASH_SIZES, tiers: ["1k"] },
} as const satisfies ModelParamTable;
