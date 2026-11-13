/**
 * OpenAI's per-model image surface, for `unmodel/image` and
 * `unmodel/image-edit`.
 *
 * A separate module from the two adapters because both routes serve most of
 * the same ids with *different* surfaces — `dall-e-2`'s edit `size` enum has
 * no `"auto"`, `dall-e-3` exists only on generations, and `input_fidelity` is
 * an edits-only param that `gpt-image-1-mini` takes at `low` only and
 * `gpt-image-2` refuses — so the two tables want to sit next to each other
 * where the differences are readable.
 *
 * Every `size` list here is the value the wire modules already check against
 * (`GPT_IMAGE_2_SIZES` and friends in `./images-shared`), not a copy: the presets an
 * editor suggests and the presets `openai.image` accepts are one list, and
 * `test/unified/image-presets.test.ts` compiles every one of them through the
 * adapter to prove it.
 */
import { EXTRA } from "../../core/unified/derive";
import type { ModelParamTable } from "../../core/unified/vocabulary/image";
// `./images-shared`, not `./image`: both routes' tables live in this module,
// and importing the generations endpoint here would put its validator, schema
// and catalog into the `unmodel/image-edit` pack, which never calls it.
import {
  DALL_E_2_SIZE_VALUES,
  DALL_E_3_SIZE_VALUES,
  GPT_IMAGE_1_SIZE_VALUES,
  GPT_IMAGE_2_SIZES,
} from "./images-shared";

// ---------------------------------------------------------------------------
// Extras
// ---------------------------------------------------------------------------

/**
 * The GPT image family's quality ladder, shared by both routes.
 *
 * `null` is kept, here and everywhere else in these tables, because an
 * explicit `null` is how this API spells "use the server default" — dropping
 * the arm would make `quality: null` a compile error for a value the endpoint
 * documents.
 */
const GPT_IMAGE_QUALITY = EXTRA as "auto" | "low" | "medium" | "high" | null;
const MODERATION = EXTRA as "low" | "auto" | null;
/** Integer percentage, 0–100, checked by `openai.image`'s own schema. */
const OUTPUT_COMPRESSION = EXTRA as number | null;
const USER = EXTRA as string;

/**
 * Every GPT image model on **generations**. `background` carries all three
 * values on every row — gpt-image-2's `transparent` support is in preview
 * (images/create reference, checked 2026-08-31) — so the per-model split
 * below is about sizes and tiers, not extras.
 */
const GPT_IMAGE_EXTRAS = {
  background: EXTRA as "transparent" | "opaque" | "auto" | null,
  quality: GPT_IMAGE_QUALITY,
  moderation: MODERATION,
  output_compression: OUTPUT_COMPRESSION,
  user: USER,
  /**
   * `user`'s successor ("Deprecated: use `safety_identifier` instead."), which
   * both image references document for every model, `maxLength: 128`
   * (2026-11-13). Every GPT row on either route spreads this table.
   */
  safety_identifier: EXTRA as string | null,
} as const;

/**
 * GPT-Image-2.5 and 2.6: the ladder gains `xhigh` and `max` — "`gpt-image-2.5-sunburst`
 * and `gpt-image-2.5-flare`, including their `2026-09-08` snapshots, also
 * support `xhigh` and `max`." (images/create reference) and, for 2.6, "the
 * quality options are `low`, `medium`, `high`, `xhigh`, and `max`."
 * (image-generation guide), both read 2026-11-12.
 */
const GPT_IMAGE_25_EXTRAS = {
  ...GPT_IMAGE_EXTRAS,
  quality: EXTRA as "auto" | "low" | "medium" | "high" | "xhigh" | "max" | null,
} as const;

/**
 * GPT-Image-2.6 adds `complexity` — "The supported complexity levels for
 * Sunburst and Flare are `low`, `medium`, and `high`." (image-generation
 * guide, 2026-11-12). The GIF/SVG controls (`frame_count`, `frame_duration_ms`,
 * `svg`) are not extras: they pair with an `output_format` the canonical
 * `outputFormat` vocabulary has no word for, so they stay `providerOptions`.
 */
const GPT_IMAGE_26_EXTRAS = {
  ...GPT_IMAGE_25_EXTRAS,
  complexity: EXTRA as "low" | "medium" | "high" | null,
} as const;

/** dall-e-3: the only model on either route with `style`. */
const DALL_E_3_EXTRAS = {
  quality: EXTRA as "auto" | "standard" | "hd" | null,
  style: EXTRA as "vivid" | "natural" | null,
  user: USER,
} as const;

const DALL_E_2_EXTRAS = {
  quality: EXTRA as "auto" | "standard" | null,
  user: USER,
} as const;

/**
 * The edits route adds `input_fidelity`, and it is not universal:
 * gpt-image-1-mini "supports only `low`", and gpt-image-2 "processes every
 * image input at high fidelity automatically" and rejects it.
 */
const GPT_IMAGE_EDIT_EXTRAS = {
  ...GPT_IMAGE_EXTRAS,
  input_fidelity: EXTRA as "high" | "low" | null,
} as const;

/**
 * "Supports `high` and `low` on `gpt-image-1.5`; `gpt-image-1-mini` supports
 * only `low`." — createEdit reference, 2026-11-12.
 */
const GPT_IMAGE_1_MINI_EDIT_EXTRAS = {
  ...GPT_IMAGE_EXTRAS,
  input_fidelity: EXTRA as "low" | null,
} as const;

/** The 2.5 / 2.6 edit rows keep `input_fidelity`: the createEdit reference narrows it only for the GPT Image 1 family. */
const GPT_IMAGE_25_EDIT_EXTRAS = {
  ...GPT_IMAGE_25_EXTRAS,
  input_fidelity: EXTRA as "high" | "low" | null,
} as const;

const GPT_IMAGE_26_EDIT_EXTRAS = {
  ...GPT_IMAGE_26_EXTRAS,
  input_fidelity: EXTRA as "high" | "low" | null,
} as const;

// ---------------------------------------------------------------------------
// The tables
// ---------------------------------------------------------------------------

/**
 * Only `1k` is offered on the enum models: every value in their `size` lists
 * is between 0.06 and 1.9 megapixels, and inventing a `2k` row for an API
 * that documents none would be a promise this table cannot keep. gpt-image-2's
 * free-form rules reach 8.29 MP, so it carries all three.
 */
const GPT_IMAGE_1_TIERS = ["1k"] as const;
const GPT_IMAGE_2_TIERS = ["1k", "2k", "4k"] as const;

/**
 * The 2.5 and 2.6 rows take gpt-image-2's shape: the same free-form presets
 * and tiers. For 2.6 the presets are autocomplete only — no page states its
 * size rules, so `openai.image` runs no size check on it (see
 * GPT_IMAGE_2_MODELS in `./images-shared`).
 */
const GPT_IMAGE_25_ROW = {
  sizes: GPT_IMAGE_2_SIZES,
  sizeFreeform: true,
  tiers: GPT_IMAGE_2_TIERS,
  extras: GPT_IMAGE_25_EXTRAS,
} as const;

const GPT_IMAGE_26_ROW = {
  sizes: GPT_IMAGE_2_SIZES,
  sizeFreeform: true,
  tiers: GPT_IMAGE_2_TIERS,
  extras: GPT_IMAGE_26_EXTRAS,
} as const;

const GPT_IMAGE_25_EDIT_ROW = {
  sizes: GPT_IMAGE_2_SIZES,
  sizeFreeform: true,
  tiers: GPT_IMAGE_2_TIERS,
  extras: GPT_IMAGE_25_EDIT_EXTRAS,
} as const;

const GPT_IMAGE_26_EDIT_ROW = {
  sizes: GPT_IMAGE_2_SIZES,
  sizeFreeform: true,
  tiers: GPT_IMAGE_2_TIERS,
  extras: GPT_IMAGE_26_EDIT_EXTRAS,
} as const;

export const OPENAI_IMAGE_MODEL_PARAMS = {
  "gpt-image-2.6-sunburst": GPT_IMAGE_26_ROW,
  "gpt-image-2.6-flare": GPT_IMAGE_26_ROW,
  "gpt-image-2.5-sunburst": GPT_IMAGE_25_ROW,
  "gpt-image-2.5-sunburst-2026-09-08": GPT_IMAGE_25_ROW,
  "gpt-image-2.5-flare": GPT_IMAGE_25_ROW,
  "gpt-image-2.5-flare-2026-09-08": GPT_IMAGE_25_ROW,
  "gpt-image-2": {
    sizes: GPT_IMAGE_2_SIZES,
    sizeFreeform: true,
    tiers: GPT_IMAGE_2_TIERS,
    extras: GPT_IMAGE_EXTRAS,
  },
  "gpt-image-2-2026-04-21": {
    sizes: GPT_IMAGE_2_SIZES,
    sizeFreeform: true,
    tiers: GPT_IMAGE_2_TIERS,
    extras: GPT_IMAGE_EXTRAS,
  },
  "gpt-image-1.5": {
    sizes: GPT_IMAGE_1_SIZE_VALUES,
    tiers: GPT_IMAGE_1_TIERS,
    extras: GPT_IMAGE_EXTRAS,
  },
  "gpt-image-1-mini": {
    sizes: GPT_IMAGE_1_SIZE_VALUES,
    tiers: GPT_IMAGE_1_TIERS,
    extras: GPT_IMAGE_EXTRAS,
  },
  "chatgpt-image-latest": {
    sizes: GPT_IMAGE_1_SIZE_VALUES,
    tiers: GPT_IMAGE_1_TIERS,
    extras: GPT_IMAGE_EXTRAS,
  },
  "dall-e-3": {
    sizes: DALL_E_3_SIZE_VALUES,
    tiers: GPT_IMAGE_1_TIERS,
    extras: DALL_E_3_EXTRAS,
  },
  "dall-e-2": {
    sizes: DALL_E_2_SIZE_VALUES,
    tiers: GPT_IMAGE_1_TIERS,
    extras: DALL_E_2_EXTRAS,
  },
} as const satisfies ModelParamTable;

export const OPENAI_IMAGE_EDIT_MODEL_PARAMS = {
  "gpt-image-2.6-sunburst": GPT_IMAGE_26_EDIT_ROW,
  "gpt-image-2.6-flare": GPT_IMAGE_26_EDIT_ROW,
  "gpt-image-2.5-sunburst": GPT_IMAGE_25_EDIT_ROW,
  "gpt-image-2.5-sunburst-2026-09-08": GPT_IMAGE_25_EDIT_ROW,
  "gpt-image-2.5-flare": GPT_IMAGE_25_EDIT_ROW,
  "gpt-image-2.5-flare-2026-09-08": GPT_IMAGE_25_EDIT_ROW,
  "gpt-image-2": {
    sizes: GPT_IMAGE_2_SIZES,
    sizeFreeform: true,
    tiers: GPT_IMAGE_2_TIERS,
    extras: GPT_IMAGE_EXTRAS,
  },
  "gpt-image-2-2026-04-21": {
    sizes: GPT_IMAGE_2_SIZES,
    sizeFreeform: true,
    tiers: GPT_IMAGE_2_TIERS,
    extras: GPT_IMAGE_EXTRAS,
  },
  "gpt-image-1.5": {
    sizes: GPT_IMAGE_1_SIZE_VALUES,
    tiers: GPT_IMAGE_1_TIERS,
    extras: GPT_IMAGE_EDIT_EXTRAS,
  },
  "gpt-image-1-mini": {
    sizes: GPT_IMAGE_1_SIZE_VALUES,
    tiers: GPT_IMAGE_1_TIERS,
    extras: GPT_IMAGE_1_MINI_EDIT_EXTRAS,
  },
  "chatgpt-image-latest": {
    sizes: GPT_IMAGE_1_SIZE_VALUES,
    tiers: GPT_IMAGE_1_TIERS,
    extras: GPT_IMAGE_EDIT_EXTRAS,
  },
  "dall-e-2": {
    // No `"auto"` on this route — the edits reference's dall-e-2 enum is the
    // three square sizes and nothing else.
    sizes: DALL_E_2_SIZE_VALUES,
    tiers: GPT_IMAGE_1_TIERS,
    extras: DALL_E_2_EXTRAS,
  },
} as const satisfies ModelParamTable;

// ---------------------------------------------------------------------------
// Model lists
//
// The two routes' ref unions, beside the tables they narrow: the generations
// route serves dall-e-3 and the edits route does not, which is the whole
// reason there are two lists.
// ---------------------------------------------------------------------------

/**
 * # `image`
 *
 * Three size vocabularies live behind one `size` field here, and which one a
 * request lands in is decided entirely by the model id:
 *
 * | family | `size` | canonical shape |
 * |---|---|---|
 * | `dall-e-2` | `256x256` / `512x512` / `1024x1024` | S3 — square only |
 * | `dall-e-3` | `1024x1024` / `1792x1024` / `1024x1792` | S3 — and `1792x1024` is **1.750:1**, not 16:9 |
 * | `gpt-image-1-mini`, `-1.5` | `1024x1024` / `1536x1024` / `1024x1536` | S3 — square and 3:2 |
 * | `gpt-image-2`, `-2-2026-04-21`, `-2.5-sunburst`, `-2.5-flare` (+ snapshots) | free-form `WxH` | S4 — 16-px grid, ≤3:1, ≤3840 px/edge |
 * | `gpt-image-2.6-sunburst`, `-2.6-flare` | free-form `WxH` | S4 presets for autocomplete; no documented bounds, so none enforced |
 *
 * The DALL·E 3 row is the reason {@link toSizeEnum} measures its own output:
 * everyone calls `1792x1024` "16:9" and it is not, so asking for `16:9` here
 * gets that size **and** an `approximated_param` naming 1.750 against 1.778.
 * Nothing else in this adapter is lossy — which is the point.
 *
 * The two deliveries and the two formats are orthogonal on paper and not on
 * this API: the GPT image models always return base64 and have no
 * `response_format`, and the DALL·E models return a URL or base64 and have no
 * `output_format`. So `outputDelivery: "base64"` is free on a GPT image model
 * (it is what it does) and `outputDelivery: "url"` is an error there, while
 * `outputFormat` is an error on DALL·E. Both errors quote the create
 * reference's own wording rather than a message this file invented.
 *
 * `seed` and `negativePrompt` have no field on this endpoint at all, so they
 * are declared gaps and the kernel reports them uniformly.
 */
export const IMAGE_MODELS = [
  "gpt-image-2.6-sunburst",
  "gpt-image-2.6-flare",
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-sunburst-2026-09-08",
  "gpt-image-2.5-flare",
  "gpt-image-2.5-flare-2026-09-08",
  "gpt-image-2",
  "gpt-image-2-2026-04-21",
  "gpt-image-1.5",
  "gpt-image-1-mini",
  "chatgpt-image-latest",
  "dall-e-3",
  "dall-e-2",
] as const;

/**
 * Every model `/v1/images/edits` documents — "One of `dall-e-2` or a GPT image
 * model". `dall-e-3` is deliberately absent.
 */
export const IMAGE_EDIT_MODELS = [
  "gpt-image-2.6-sunburst",
  "gpt-image-2.6-flare",
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-sunburst-2026-09-08",
  "gpt-image-2.5-flare",
  "gpt-image-2.5-flare-2026-09-08",
  "gpt-image-2",
  "gpt-image-2-2026-04-21",
  "gpt-image-1.5",
  "gpt-image-1-mini",
  "chatgpt-image-latest",
  "dall-e-2",
] as const;
