/**
 * The image adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/leonardo/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { ModelParamTable } from "../../core/unified/vocabulary/image";
import type { LeonardoLucidParameters, LeonardoPhoenixParameters } from "./image";
import type { LeonardoContrast, LeonardoPromptEnhance } from "./model-rules";

/**
 * Leonardo's own image models on `POST /v2/generations` — the whole of
 * `./models.ts`.
 *
 * The same endpoint routes ~60 third-party models (FLUX, Imagen, Seedream,
 * Kling, Veo, …), each with a different `parameters` schema. They belong to
 * their own providers' catalogs, so they are deliberately absent: a ref like
 * `leonardo/flux-dev` draws an `unknown_model` warning and compiles against the
 * shape below, which is honest about being a guess.
 */
export const MODELS = ["lucid-origin", "lucid-realism", "phoenix-v1.0", "phoenix-v0.9"] as const;

// ---------------------------------------------------------------------------
// The per-model table
// ---------------------------------------------------------------------------

/**
 * The four Leonardo rows, split by `parameters` schema: Lucid and Phoenix.
 *
 * **Sizes.** `parameters.width` / `height` are a free pixel pair on an 8-px
 * grid, so `sizeFreeform` is set and the presets are curated exact-ratio pairs
 * at each model's own reachable tiers (Lucid Origin goes to 4k, the other
 * three to 2k). `ratios` is absent everywhere: there is no ratio field on this
 * API — a canonical ratio is *derived* into pixels by `toPixels` — so the wide
 * vocabulary is the honest one.
 *
 * **Extras.** The split is the schemas': Phoenix adds `contrast`, `tiling` and
 * a `QUALITY` mode Lucid does not have, and its `guidances` object takes two
 * more kinds. `style_ids` is `string[]` on both rather than the per-model UUID
 * allowlist — those are checked by `checkStyleIds` against the model's own
 * table, whose message names the ids, and hard-coding four twenty-UUID unions
 * here would be a second copy of a list that already exists and can already
 * answer better.
 */
export const LUCID_ORIGIN_SIZES = [
  "1024x1024", "2048x2048", "2880x2880", "3616x3616", "1536x1024", "2400x1600",
  "3456x2304", "1024x1536", "1600x2400", "2400x3600", "1024x768", "2048x1536",
  "3200x2400", "768x1024", "1536x2048", "2400x3200", "1280x720", "2560x1440",
  "3840x2160", "720x1280", "1440x2560", "2016x3584", "2048x1024", "3840x1920",
  "1024x2048", "1808x3616", "2520x1080", "3360x1440", "1080x2520", "1440x3360",
] as const;

export const LUCID_REALISM_SIZES = [
  "1024x1024", "2048x2048", "2496x2496", "1536x1024", "2400x1600", "1024x1536",
  "1600x2400", "1024x768", "2048x1536", "2432x1824", "768x1024", "1536x2048",
  "1824x2432", "1280x720", "2432x1368", "720x1280", "1368x2432", "2048x1024",
  "2432x1216", "1024x2048", "1216x2432", "1680x720", "2352x1008", "720x1680",
  "1008x2352",
] as const;

export const PHOENIX_SIZES = [
  "1024x1024", "1536x1536", "2048x2048", "1536x1024", "1920x1280", "1024x1536",
  "1280x1920", "1024x768", "1600x1200", "2048x1536", "768x1024", "1200x1600",
  "1536x2048", "1280x720", "2048x1152", "720x1280", "1152x2048", "1024x512",
  "2048x1024", "512x1024", "1024x2048", "1680x720", "2016x864", "720x1680",
  "864x2016",
] as const;

export const LEONARDO_SHARED_EXTRAS = {
  prompt_enhance: EXTRA as LeonardoPromptEnhance,
  style_ids: EXTRA as string[],
  public: EXTRA as boolean | null,
} as const;

export const LUCID_ROW_EXTRAS = {
  mode: EXTRA as "FAST" | "ULTRA",
  guidances: EXTRA as LeonardoLucidParameters["guidances"],
  ...LEONARDO_SHARED_EXTRAS,
} as const;

export const PHOENIX_ROW_EXTRAS = {
  mode: EXTRA as "FAST" | "QUALITY" | "ULTRA",
  contrast: EXTRA as LeonardoContrast,
  tiling: EXTRA as boolean,
  guidances: EXTRA as LeonardoPhoenixParameters["guidances"],
  ...LEONARDO_SHARED_EXTRAS,
} as const;

export const PHOENIX_ROW = {
  sizes: PHOENIX_SIZES,
  sizeFreeform: true,
  tiers: ["1k", "2k"],
  extras: PHOENIX_ROW_EXTRAS,
} as const;

export const LEONARDO_IMAGE_MODEL_PARAMS = {
  "lucid-origin": {
    sizes: LUCID_ORIGIN_SIZES,
    sizeFreeform: true,
    tiers: ["1k", "2k", "4k"],
    extras: LUCID_ROW_EXTRAS,
  },
  "lucid-realism": {
    sizes: LUCID_REALISM_SIZES,
    sizeFreeform: true,
    tiers: ["1k", "2k"],
    extras: LUCID_ROW_EXTRAS,
  },
  "phoenix-v1.0": PHOENIX_ROW,
  "phoenix-v0.9": PHOENIX_ROW,
} as const satisfies ModelParamTable;
