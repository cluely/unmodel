/**
 * `blackForestLabs.image` (FLUX.2) and `blackForestLabs.imageFlux1` (FLUX.1)
 * → fal: the overlap tables and the mappings.
 *
 * **Reached only from `./index.ts`** — see `core/translate/media-retarget.ts`
 * for why the seam is placed there and not in the endpoint modules.
 *
 * ## What fal serves
 *
 * Five of BFL's eleven text-to-image routes, verified against fal's curated
 * roster on 2026-08-25 (`data/fal/curation.json`; the drift guard in
 * `fal-target.test.ts` re-asserts every id here against `FAL_IMAGE_ENDPOINTS`).
 * Source pages under https://fal.ai/models/fal-ai/…/api
 *
 * | native `model` | endpoint | fal endpoint |
 * |---|---|---|
 * | `flux-2-pro` | `image` | `fal-ai/flux-2-pro` |
 * | `flux-2-max` | `image` | `fal-ai/flux-2-max` |
 * | `flux-pro-1.1` | `imageFlux1` | `fal-ai/flux-pro/v1.1` |
 * | `flux-pro-1.1-ultra` | `imageFlux1` | `fal-ai/flux-pro/v1.1-ultra` |
 * | `flux-dev` | `imageFlux1` | `fal-ai/flux/dev` |
 *
 * ## The three fal FLUX rows that look mappable and are not
 *
 * `fal-ai/flux-2` is FLUX.2 **[dev]**, the open-weights checkpoint; BFL's own
 * API serves `flux-2-flex` and the `klein` line, and neither is [dev].
 * `fal-ai/flux-2/flash` is a turbo distillation. `fal-ai/flux/schnell` is
 * FLUX.1 [schnell], which BFL's API does not route at all. Routing a flex or
 * klein request to any of them would swap the checkpoint and the price, so
 * each of those native ids is refused by name.
 *
 * ## Two shape facts that recur on every arm
 *
 * - **`image_size` is an object, never a preset.** fal's image rows accept
 *   either a six-value preset string or `{ width, height }`. BFL sizes by
 *   pixels, and this repo carries no preset→pixel table, so the pair is
 *   emitted verbatim and no preset is ever snapped onto. That makes the size
 *   mapping exact rather than approximate. `flux-pro/v1.1-ultra` is the one
 *   row with no `image_size` at all — it sizes by `aspect_ratio`, which is
 *   also how BFL's ultra route sizes, so that pair is exact too.
 * - **`safety_tolerance` is a *string* enum at fal** (`"1".."5"` on the FLUX.2
 *   rows, `"1".."6"` on the FLUX.1 pro rows) and an *integer* natively, where
 *   `0` is the strictest setting. `0` is unreachable on fal, and promoting it
 *   to `"1"` would LOOSEN moderation, so it is refused.
 */
import type { ApiRetargeter } from "../../core/request";
import {
  createMediaToApi,
  refuseParam,
  type MediaMapContext,
} from "../../core/translate/media-retarget";
import { FAL_MEDIA_TARGET } from "../../core/translate/media-endpoints";
import type { FalImageBodyById } from "../fal/interop";
import type { Flux2Body } from "./image";
import type { Flux1Body } from "./image-flux1";

// The per-endpoint aliases below are `export`ed rather than private, and it is
// not decoration: they are the exact symbols `<Provider>…FalOverlap`'s
// `ReturnType` resolves to, so a consumer that emits declarations around a
// result carrying `.toApi("fal")` cannot name it without them (TS4023, "has or
// is using name 'FalAiFlux2ProInput' … but cannot be named"). Type-only, and
// re-exported one line from ./index.ts. See src/core/carriers.ts.
export type ById = FalImageBodyById;
export type FalFlux2Pro = ById["fal-ai/flux-2-pro"];
export type FalFlux2Max = ById["fal-ai/flux-2-max"];
export type FalFluxProV11 = ById["fal-ai/flux-pro/v1.1"];
export type FalFluxProV11Ultra = ById["fal-ai/flux-pro/v1.1-ultra"];
export type FalFluxDev = ById["fal-ai/flux/dev"];

/**
 * The widest FLUX.2 / FLUX.1 shapes, for reading a param off any arm.
 *
 * The `Record<string, unknown>` tail is what lets one mapping read a field
 * that only some arms declare (`steps` is `never` on `flux-pro-1.1`), which is
 * the shape a *route-selected* body has: `blackForestLabs.image` narrows the
 * body per `model` literal, and the retarget runs after that narrowing has
 * already been enforced.
 */
export type AnyFlux2 = Flux2Body<string> & Record<string, unknown>;
export type AnyFlux1 = Flux1Body<string> & Record<string, unknown>;

/** fal's `{ width, height }` object arm — the only size shape unmodel emits. */
const MAX_DIMENSION = 14142;

function readNumber(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  return typeof value === "number" ? value : undefined;
}

function readString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

function readBoolean(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  return typeof value === "boolean" ? value : undefined;
}

/** `width`/`height` → fal's `image_size` object, or nothing when unsized. */
function imageSize(
  body: Record<string, unknown>,
  ctx: MediaMapContext,
  endpoint: string,
): { width: number; height: number } | undefined {
  const width = readNumber(body, "width");
  const height = readNumber(body, "height");
  if (width === undefined && height === undefined) return undefined;
  if (width === undefined || height === undefined) {
    ctx.unsupported({
      path: [width === undefined ? "width" : "height"],
      message:
        `${endpoint} sizes by an \`image_size: { width, height }\` pair and has no way to express one dimension ` +
        "alone. BFL fills the missing side from its own default; unmodel will not guess which pixels you meant.",
    });
    return undefined;
  }
  for (const [key, value] of [
    ["width", width],
    ["height", height],
  ] as const) {
    if (value > MAX_DIMENSION) {
      ctx.unsupported({
        path: [key],
        message: `\`${key}: ${value}\` is over the ${MAX_DIMENSION}px cap ${endpoint} publishes for \`image_size\`.`,
      });
    }
  }
  return { width, height };
}

/** Native integer 0–6 → fal's string enum, refusing the strictest setting. */
function safetyTolerance(
  body: Record<string, unknown>,
  max: 5 | 6,
  ctx: MediaMapContext,
  endpoint: string,
): string | undefined {
  const value = readNumber(body, "safety_tolerance");
  if (value === undefined) return undefined;
  if (value === 0) {
    refuseParam(
      ctx,
      ["safety_tolerance"],
      endpoint,
      `starts its \`safety_tolerance\` enum at "1" — BFL's 0 is the STRICTEST setting, and promoting it to "1" would loosen moderation rather than preserve it`,
    );
    return undefined;
  }
  if (value < 1 || value > max || !Number.isInteger(value)) {
    ctx.unsupported({
      path: ["safety_tolerance"],
      message: `\`safety_tolerance: ${value}\` has no equivalent at ${endpoint}, which serves "1" through "${max}".`,
    });
    return undefined;
  }
  return String(value);
}

/** `output_format` — fal's FLUX rows take jpeg/png; BFL also takes webp. */
function outputFormat(
  body: Record<string, unknown>,
  ctx: MediaMapContext,
  endpoint: string,
): "jpeg" | "png" | undefined {
  const value = readString(body, "output_format");
  if (value === undefined) return undefined;
  if (value === "jpeg" || value === "png") return value;
  ctx.unsupported({
    path: ["output_format"],
    message: `\`output_format: "${value}"\` has no equivalent at ${endpoint}, which returns jpeg or png.`,
  });
  return undefined;
}

/** The webhook pair, refused everywhere: fal's queue has no in-body callback. */
function refuseWebhook(
  body: Record<string, unknown>,
  ctx: MediaMapContext,
  endpoint: string,
): void {
  if (body["webhook_url"] == null && body["webhook_secret"] == null) return;
  refuseParam(
    ctx,
    [body["webhook_url"] != null ? "webhook_url" : "webhook_secret"],
    endpoint,
    "carries no in-body webhook: fal's queue answers a submit with a `request_id` and a `status_url` you poll",
  );
}

/** The image-reference inputs, refused: these are fal's TEXT-to-image rows. */
function refuseImageInputs(
  body: Record<string, unknown>,
  keys: readonly string[],
  ctx: MediaMapContext,
  endpoint: string,
): void {
  const present = keys.find((key) => body[key] != null);
  if (present === undefined) return;
  refuseParam(
    ctx,
    [present],
    endpoint,
    "is a text-to-image row with no image input — fal routes FLUX editing to its own `/edit` endpoints, which are a different category with a different body",
  );
}

const FLUX2_IMAGE_INPUTS = [
  "input_image",
  "input_image_2",
  "input_image_3",
  "input_image_4",
  "input_image_5",
  "input_image_6",
  "input_image_7",
  "input_image_8",
] as const;

// ---------------------------------------------------------------------------
// FLUX.2 — `blackForestLabs.image`
// ---------------------------------------------------------------------------

/**
 * `flux-2-pro` / `flux-2-max` → `fal-ai/flux-2-pro` / `fal-ai/flux-2-max`.
 *
 * `disable_pup` is refused rather than dropped, and the reason is worth
 * stating: BFL's pro/max routes apply prompt upsampling **by default**, and
 * `disable_pup: true` is how you ask for your prompt verbatim. fal's
 * `flux-2-pro` / `flux-2-max` rows publish no prompt-expansion field at all —
 * `enable_prompt_expansion` exists only on `fal-ai/flux-2` and
 * `fal-ai/flux-2/flash`, which are different checkpoints — so there is nothing
 * to carry the intent onto.
 */
function mapFlux2(params: AnyFlux2, ctx: MediaMapContext, endpoint: string): FalFlux2Pro {
  refuseWebhook(params, ctx, endpoint);
  refuseImageInputs(params, FLUX2_IMAGE_INPUTS, ctx, endpoint);
  if (readBoolean(params, "disable_pup") !== undefined) {
    refuseParam(
      ctx,
      ["disable_pup"],
      endpoint,
      "publishes no prompt-expansion field (fal exposes `enable_prompt_expansion` on `fal-ai/flux-2` and `fal-ai/flux-2/flash`, which are different checkpoints), so a request for a verbatim prompt has nowhere to go",
    );
  }
  const size = imageSize(params, ctx, endpoint);
  const tolerance = safetyTolerance(params, 5, ctx, endpoint);
  const format = outputFormat(params, ctx, endpoint);
  const seed = readNumber(params, "seed");
  return {
    prompt: params.prompt,
    ...(size !== undefined && { image_size: size }),
    ...(seed !== undefined && { seed }),
    ...(tolerance !== undefined && { safety_tolerance: tolerance as FalFlux2Pro["safety_tolerance"] }),
    ...(format !== undefined && { output_format: format }),
  };
}

function mapFlux2Pro(params: AnyFlux2, ctx: MediaMapContext): FalFlux2Pro {
  return mapFlux2(params, ctx, "fal-ai/flux-2-pro");
}

function mapFlux2Max(params: AnyFlux2, ctx: MediaMapContext): FalFlux2Max {
  return mapFlux2(params, ctx, "fal-ai/flux-2-max") as FalFlux2Max;
}

/** FLUX.2 model id → the fal endpoint that serves it. */
export const BFL_IMAGE_FAL_OVERLAP = {
  "flux-2-pro": { endpoints: ["fal-ai/flux-2-pro"], map: mapFlux2Pro },
  "flux-2-max": { endpoints: ["fal-ai/flux-2-max"], map: mapFlux2Max },
} as const;

/** The four FLUX.2 ids fal serves no matching checkpoint for. */
export const BFL_IMAGE_FAL_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  "flux-2-pro-preview": "fal serves no FLUX.2 pro preview row.",
  "flux-2-flex":
    "fal's `fal-ai/flux-2` is FLUX.2 [dev], the open-weights checkpoint, and `fal-ai/flux-2/flash` is a turbo distillation. Neither is flex, and routing there would swap the checkpoint, the knobs (`guidance`/`steps`) and the price.",
  "flux-2-klein-9b":
    "fal publishes no FLUX.2 klein row; `fal-ai/flux-2` is FLUX.2 [dev], a different checkpoint.",
  "flux-2-klein-9b-preview": "fal publishes no FLUX.2 klein row.",
  "flux-2-klein-4b": "fal publishes no FLUX.2 klein row.",
});

/** The type half of {@link BFL_IMAGE_FAL_OVERLAP}, derived from it. */
export type BflImageFalOverlap = {
  [K in keyof typeof BFL_IMAGE_FAL_OVERLAP]: ReturnType<(typeof BFL_IMAGE_FAL_OVERLAP)[K]["map"]>;
};

// ---------------------------------------------------------------------------
// FLUX.1 — `blackForestLabs.imageFlux1`
// ---------------------------------------------------------------------------

/** fal's FLUX.1 rows require `prompt`; BFL's default it to `""`. */
function requirePrompt(params: AnyFlux1, ctx: MediaMapContext, endpoint: string): string {
  const prompt = readString(params, "prompt");
  if (prompt !== undefined && prompt !== "") return prompt;
  ctx.unsupported({
    path: ["prompt"],
    message:
      `\`prompt\` is required at ${endpoint}. BFL's FLUX.1 routes default it to the empty string; fal marks it ` +
      "required, and unmodel will not invent one.",
  });
  return prompt ?? "";
}

/** `image_prompt` is BFL's base64 Redux input — refused, see the message. */
function refuseImagePrompt(params: AnyFlux1, ctx: MediaMapContext, endpoint: string): void {
  if (params["image_prompt"] == null) return;
  refuseParam(
    ctx,
    ["image_prompt"],
    endpoint,
    "cannot take a bare base64 payload: fal accepts an https URL or a `data:` URI, and a `data:` URI needs a MIME type the bytes do not carry",
  );
}

function mapFluxProV11(params: AnyFlux1, ctx: MediaMapContext): FalFluxProV11 {
  const endpoint = "fal-ai/flux-pro/v1.1";
  refuseWebhook(params, ctx, endpoint);
  refuseImagePrompt(params, ctx, endpoint);
  const size = imageSize(params, ctx, endpoint);
  const tolerance = safetyTolerance(params, 6, ctx, endpoint);
  const format = outputFormat(params, ctx, endpoint);
  const seed = readNumber(params, "seed");
  const upsampling = readBoolean(params, "prompt_upsampling");
  return {
    prompt: requirePrompt(params, ctx, endpoint),
    ...(size !== undefined && { image_size: size }),
    ...(seed !== undefined && { seed }),
    ...(tolerance !== undefined && {
      safety_tolerance: tolerance as FalFluxProV11["safety_tolerance"],
    }),
    ...(format !== undefined && { output_format: format }),
    // A pure rename: both are booleans defaulting to false.
    ...(upsampling !== undefined && { enhance_prompt: upsampling }),
  };
}

/**
 * `flux-pro-1.1-ultra` → `fal-ai/flux-pro/v1.1-ultra`.
 *
 * The cleanest image mapping in the set: fal's ultra row is the family's one
 * `aspectRatioEnum` shape, its `aspect_ratio` is an **open** string, and BFL's
 * ultra route sizes the same way. So every ratio BFL accepts — including the
 * four it publishes that fal does not enumerate, and any free-form value
 * inside 21:9…9:21 — passes through verbatim.
 */
function mapFluxProV11Ultra(params: AnyFlux1, ctx: MediaMapContext): FalFluxProV11Ultra {
  const endpoint = "fal-ai/flux-pro/v1.1-ultra";
  refuseWebhook(params, ctx, endpoint);
  refuseImagePrompt(params, ctx, endpoint);
  const tolerance = safetyTolerance(params, 6, ctx, endpoint);
  const format = outputFormat(params, ctx, endpoint);
  const seed = readNumber(params, "seed");
  const upsampling = readBoolean(params, "prompt_upsampling");
  const raw = readBoolean(params, "raw");
  const strength = readNumber(params, "image_prompt_strength");
  return {
    prompt: requirePrompt(params, ctx, endpoint),
    ...(readString(params, "aspect_ratio") !== undefined && {
      aspect_ratio: readString(params, "aspect_ratio") as FalFluxProV11Ultra["aspect_ratio"],
    }),
    ...(seed !== undefined && { seed }),
    ...(tolerance !== undefined && {
      safety_tolerance: tolerance as FalFluxProV11Ultra["safety_tolerance"],
    }),
    ...(format !== undefined && { output_format: format }),
    ...(upsampling !== undefined && { enhance_prompt: upsampling }),
    ...(raw !== undefined && { raw }),
    ...(strength !== undefined && { image_prompt_strength: strength }),
  };
}

/**
 * `flux-dev` → `fal-ai/flux/dev`.
 *
 * `steps` → `num_inference_steps` and `guidance` → `guidance_scale` are pure
 * renames with compatible ranges. Two things do NOT carry, and neither is
 * symmetric with `flux-pro/v1.1`, which is exactly why they are checked here
 * rather than assumed:
 *
 * - **`prompt_upsampling`** — `fal-ai/flux/dev` has no `enhance_prompt` and no
 *   `enable_prompt_expansion`.
 * - **`safety_tolerance`** — `fal-ai/flux/dev` publishes only the boolean
 *   `enable_safety_checker`, and an integer 0–6 cannot be folded into a
 *   boolean without choosing a threshold on the caller's behalf.
 */
function mapFluxDev(params: AnyFlux1, ctx: MediaMapContext): FalFluxDev {
  const endpoint = "fal-ai/flux/dev";
  refuseWebhook(params, ctx, endpoint);
  refuseImagePrompt(params, ctx, endpoint);
  if (readBoolean(params, "prompt_upsampling") !== undefined) {
    refuseParam(
      ctx,
      ["prompt_upsampling"],
      endpoint,
      "publishes no prompt-expansion field — unlike `fal-ai/flux-pro/v1.1`, which does; the two rows are not symmetric",
    );
  }
  if (readNumber(params, "safety_tolerance") !== undefined) {
    refuseParam(
      ctx,
      ["safety_tolerance"],
      endpoint,
      "publishes only the boolean `enable_safety_checker`, and a 0–6 strictness cannot be folded into a boolean without choosing a threshold on your behalf",
    );
  }
  const size = imageSize(params, ctx, endpoint);
  const format = outputFormat(params, ctx, endpoint);
  const seed = readNumber(params, "seed");
  const steps = readNumber(params, "steps");
  const guidance = readNumber(params, "guidance");
  return {
    prompt: requirePrompt(params, ctx, endpoint),
    ...(size !== undefined && { image_size: size }),
    ...(seed !== undefined && { seed }),
    ...(steps !== undefined && { num_inference_steps: steps }),
    ...(guidance !== undefined && { guidance_scale: guidance }),
    ...(format !== undefined && { output_format: format }),
  };
}

/** FLUX.1 model id → the fal endpoint that serves it. */
export const BFL_IMAGE_FLUX1_FAL_OVERLAP = {
  "flux-pro-1.1": { endpoints: ["fal-ai/flux-pro/v1.1"], map: mapFluxProV11 },
  "flux-pro-1.1-ultra": { endpoints: ["fal-ai/flux-pro/v1.1-ultra"], map: mapFluxProV11Ultra },
  "flux-dev": { endpoints: ["fal-ai/flux/dev"], map: mapFluxDev },
} as const;

/** The FLUX.1 id fal serves no matching route for. */
export const BFL_IMAGE_FLUX1_FAL_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  "flux-pro-1.1-ultra-finetuned":
    "fal's ultra row publishes no `finetune_id` or `finetune_strength`, and a LoRA id addresses your own BFL account — routing there would drop the fine-tune silently.",
});

/** The type half of {@link BFL_IMAGE_FLUX1_FAL_OVERLAP}, derived from it. */
export type BflImageFlux1FalOverlap = {
  [K in keyof typeof BFL_IMAGE_FLUX1_FAL_OVERLAP]: ReturnType<
    (typeof BFL_IMAGE_FLUX1_FAL_OVERLAP)[K]["map"]
  >;
};

/** `.toApi("fal")` for `blackForestLabs.image`. */
export const bflImageToFal: (params: AnyFlux2) => ApiRetargeter = createMediaToApi({
  endpoint: "black-forest-labs.image",
  target: FAL_MEDIA_TARGET,
  modelId: (params: AnyFlux2) => params.model,
  overlap: BFL_IMAGE_FAL_OVERLAP,
  refusals: BFL_IMAGE_FAL_REFUSALS,
});

/** `.toApi("fal")` for `blackForestLabs.imageFlux1`. */
export const bflImageFlux1ToFal: (params: AnyFlux1) => ApiRetargeter = createMediaToApi({
  endpoint: "black-forest-labs.imageFlux1",
  target: FAL_MEDIA_TARGET,
  modelId: (params: AnyFlux1) => params.model,
  overlap: BFL_IMAGE_FLUX1_FAL_OVERLAP,
  refusals: BFL_IMAGE_FLUX1_FAL_REFUSALS,
});
