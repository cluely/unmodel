/**
 * OpenAI's per-model image surface, for `unmodel/image` and
 * `unmodel/image-edit`.
 *
 * A separate module from the two adapters because both routes serve most of
 * the same ids with *different* surfaces — `dall-e-2`'s edit `size` enum has
 * no `"auto"`, `chatgpt-image-latest` exists only on edits, `dall-e-3` only on
 * generations, and `input_fidelity` is an edits-only param that
 * `gpt-image-1-mini` and `gpt-image-2` both refuse — so the two tables want to
 * sit next to each other where the differences are readable.
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
 * gpt-image-1 / -1-mini / -1.5 on **generations**.
 *
 * `background` keeps `"transparent"` here and loses it two rows down, which is
 * the whole reason this table is per-model: the SDK's own type offers
 * `transparent` on every GPT image model, and gpt-image-2 answers a recorded
 * 400 (`test/fixtures/provider-errors/openai/images-gpt-image-2-background.json`).
 */
const GPT_IMAGE_1_EXTRAS = {
  background: EXTRA as "transparent" | "opaque" | "auto" | null,
  quality: GPT_IMAGE_QUALITY,
  moderation: MODERATION,
  output_compression: OUTPUT_COMPRESSION,
  user: USER,
} as const;

/** gpt-image-2 / -2-2026-04-21 on generations: the same list minus `transparent`. */
const GPT_IMAGE_2_EXTRAS = {
  background: EXTRA as "opaque" | "auto" | null,
  quality: GPT_IMAGE_QUALITY,
  moderation: MODERATION,
  output_compression: OUTPUT_COMPRESSION,
  user: USER,
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
 * gpt-image-1-mini has no such parameter, and gpt-image-2 "processes every
 * image input at high fidelity automatically" and rejects it.
 */
const GPT_IMAGE_EDIT_EXTRAS = {
  ...GPT_IMAGE_1_EXTRAS,
  input_fidelity: EXTRA as "high" | "low" | null,
} as const;

const GPT_IMAGE_MINI_EDIT_EXTRAS = GPT_IMAGE_1_EXTRAS;

const GPT_IMAGE_2_EDIT_EXTRAS = GPT_IMAGE_2_EXTRAS;

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

export const OPENAI_IMAGE_MODEL_PARAMS = {
  "gpt-image-2": {
    sizes: GPT_IMAGE_2_SIZES,
    sizeFreeform: true,
    tiers: GPT_IMAGE_2_TIERS,
    extras: GPT_IMAGE_2_EXTRAS,
  },
  "gpt-image-2-2026-04-21": {
    sizes: GPT_IMAGE_2_SIZES,
    sizeFreeform: true,
    tiers: GPT_IMAGE_2_TIERS,
    extras: GPT_IMAGE_2_EXTRAS,
  },
  "gpt-image-1.5": {
    sizes: GPT_IMAGE_1_SIZE_VALUES,
    tiers: GPT_IMAGE_1_TIERS,
    extras: GPT_IMAGE_1_EXTRAS,
  },
  "gpt-image-1": {
    sizes: GPT_IMAGE_1_SIZE_VALUES,
    tiers: GPT_IMAGE_1_TIERS,
    extras: GPT_IMAGE_1_EXTRAS,
  },
  "gpt-image-1-mini": {
    sizes: GPT_IMAGE_1_SIZE_VALUES,
    tiers: GPT_IMAGE_1_TIERS,
    extras: GPT_IMAGE_1_EXTRAS,
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
  "gpt-image-2": {
    sizes: GPT_IMAGE_2_SIZES,
    sizeFreeform: true,
    tiers: GPT_IMAGE_2_TIERS,
    extras: GPT_IMAGE_2_EDIT_EXTRAS,
  },
  "gpt-image-2-2026-04-21": {
    sizes: GPT_IMAGE_2_SIZES,
    sizeFreeform: true,
    tiers: GPT_IMAGE_2_TIERS,
    extras: GPT_IMAGE_2_EDIT_EXTRAS,
  },
  "gpt-image-1.5": {
    sizes: GPT_IMAGE_1_SIZE_VALUES,
    tiers: GPT_IMAGE_1_TIERS,
    extras: GPT_IMAGE_EDIT_EXTRAS,
  },
  "gpt-image-1": {
    sizes: GPT_IMAGE_1_SIZE_VALUES,
    tiers: GPT_IMAGE_1_TIERS,
    extras: GPT_IMAGE_EDIT_EXTRAS,
  },
  "gpt-image-1-mini": {
    sizes: GPT_IMAGE_1_SIZE_VALUES,
    tiers: GPT_IMAGE_1_TIERS,
    extras: GPT_IMAGE_MINI_EDIT_EXTRAS,
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
// route serves dall-e-3 and the edits route serves chatgpt-image-latest, and
// neither serves the other's, which is the whole reason there are two lists.
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
 * | `gpt-image-1`, `-1-mini`, `-1.5` | `1024x1024` / `1536x1024` / `1024x1536` | S3 — square and 3:2 |
 * | `gpt-image-2`, `-2-2026-04-21` | free-form `WxH` | S4 — 16-px grid, ≤3:1, ≤3840 px/edge |
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
  "gpt-image-2",
  "gpt-image-2-2026-04-21",
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini",
  "dall-e-3",
  "dall-e-2",
] as const;

/**
 * Every model `/v1/images/edits` documents — "One of `dall-e-2` or a GPT image
 * model". `dall-e-3` is deliberately absent; `chatgpt-image-latest` is
 * deliberately present, and is edit-only.
 */
export const IMAGE_EDIT_MODELS = [
  "gpt-image-2",
  "gpt-image-2-2026-04-21",
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini",
  "chatgpt-image-latest",
  "dall-e-2",
] as const;
