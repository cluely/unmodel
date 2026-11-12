/**
 * `unmodel/video` → `revana.video`
 * (POST https://api.revana.si/v1/generations).
 *
 * # One url, one id, and the INPUTS are the route
 *
 * Revana serves every video model from one POST path, and a model is one id
 * whatever it is asked to do: `veo-3.1` with a first frame IS image-to-video.
 * So this adapter derives nothing and picks nothing — it writes each canonical
 * input to the field of the same meaning and `revana.video` decides whether
 * the combination is one the model offers, in the API's own sentence:
 *
 * ```ts
 * video({ model: "revana/veo-3.1", prompt, image: [{ url, role: "reference" }] });
 * // → `"veo-3.1" cannot take this combination of inputs. It takes: a prompt
 * //    alone; `input.image_url`; `input.image_url` with `input.end_image_url`.`
 * ```
 *
 * That is `docs/decisions.md` §1 applied literally. A second copy of the
 * combination rule here would be wrong within a release, and it would be wrong
 * in the expensive direction: the API lets a lower-ranking media field ride
 * along with a higher one (a character picture beside a motion-control clip),
 * which a per-field refusal in this file would forbid.
 *
 * # The mapping table
 *
 * | canonical | wire (`input.…`) | notes |
 * |---|---|---|
 * | `prompt` | `prompt` | |
 * | `image` (first / last) | `image_url` / `end_image_url` | |
 * | `image` (reference) | `image_urls` | |
 * | `video` | `video_url` | |
 * | `duration` | `duration` | whole seconds; a model's list is an enum, its range is checked on the way out |
 * | `resolution` | `resolution` | the catalog's spelling of the tier (`"4k"` → `"4K"`) |
 * | `aspectRatio` | `aspect_ratio` | the catalog's spelling where the model lists shapes, verbatim where it lists none |
 * | `seed` | `seed` | |
 * | `negativePrompt` | `negative_prompt` | sent; `revana.video` WARNS where no route took it |
 * | `n` | — | declared unsupported |
 *
 * Every media reference is a public URL: see `toRevanaMediaUrl`.
 *
 * # The three input schemas need no branch
 *
 * `seedance-2.5` takes `SeedanceInput` and `nemesis` / `nemesis-lite` take
 * `NemesisInput` (`./generation-wire.ts`). Every field in the table above has
 * the SAME name in whichever of the three schemas has it, so one compile
 * serves all of them, and a field a schema lacks is refused by that schema's
 * own unknown-key rule — `seed` on Seedance 2.5 answers "takes `SeedanceInput`,
 * which has no `seed`", at the canonical path. Two things do differ and both
 * are data: those schemas match exactly rather than ignoring case, which the
 * generated rows already satisfy (they carry the catalog's spelling); and
 * Nemesis has no `duration` and no `aspect_ratio`, so its rows list none.
 *
 * A Nemesis request is canonical as it stands — the clip is `video`, the
 * people and products are `image` tagged `role: "reference"` — and its own
 * dials (`roles`, `guide`, `sound`) are per-model extras.
 *
 * # What rides outside the vocabulary
 *
 * `audio` (the model's sound toggle, where its row has one) is a per-model
 * extra. Everything else — `quality`, `task`, a size the canonical tiers do
 * not name, `max_cost_usd` — is `providerOptions.revana`, merged over the
 * `{ model, input }` body before `revana.video` validates it.
 */

import {
  applyExtras,
  resolveImageSlots,
  toDurationNumber,
  toRatioEnum,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { VideoAdapterFor, VideoImageInput, VideoParams } from "../../core/unified/vocabulary/video";
import { REVANA_MODELS_SOURCE } from "./checks";
import { toRevanaMediaUrl, toRevanaTier } from "./compile-input";
import type { GenerationTask, NemesisRole } from "./generation-wire";
import type { RevanaVideoParamRow } from "./param-types";
import { video as validator } from "./video";
import { MODELS, REVANA_VIDEO_MODEL_PARAMS } from "./video-params";

const ROWS: Readonly<Partial<Record<string, RevanaVideoParamRow>>> = REVANA_VIDEO_MODEL_PARAMS;

/**
 * `input`, as this adapter writes it and as `providerOptions.revana.input`
 * completes it: the fields of the three video schemas in `./generation-wire.ts`,
 * with a media reference typed as the plain string the caller supplied.
 */
export interface RevanaVideoWireInput {
  prompt?: string;
  negative_prompt?: string;
  image_url?: string;
  end_image_url?: string;
  image_urls?: string[];
  video_url?: string;
  resolution?: string;
  aspect_ratio?: string;
  duration?: number;
  seed?: number;
  /** The model's sound toggle — a per-model extra where its row offers one. */
  audio?: boolean;
  quality?: string;
  /** "A sound to drive the video" — the lip-sync and avatar models' field. */
  audio_url?: string;
  /** `SeedanceInput`: reference clips and sounds. */
  video_urls?: string[];
  audio_urls?: string[];
  /** `NemesisInput`. */
  roles?: NemesisRole[];
  target_frame?: boolean;
  guide?: string;
  sound?: string;
  face_mesh?: boolean;
}

/** The wire body this adapter compiles to: `GenerationRequest`, loosely typed. */
export interface RevanaVideoWire {
  model: string;
  input: RevanaVideoWireInput;
  task?: GenerationTask;
  max_cost_usd?: number;
  max_wait_s?: number;
}

/**
 * What a unified video call to `revana/…` returns: `revana.video`'s
 * `Validated`, at the arm of an id the type does not narrow by — a ref is a
 * string to the kernel, so the body is the unnarrowed `GenerationRequest`.
 */
export type RevanaVideoResult = ReturnType<typeof validator<string>>;

/**
 * `revana.video.safe`, seen as the one-argument function `CompiledCall` wants.
 * The validator is generic in the model id so that a literal narrows `input`;
 * the kernel has no literal to give it. Nothing is skipped at run time.
 */
type RevanaVideoValidate = CompiledCall<RevanaVideoWire, RevanaVideoResult>["validate"];

export const video = {
  category: "video",
  provider: "revana",
  models: MODELS,
  modelParams: REVANA_VIDEO_MODEL_PARAMS,
  unsupported: {
    n:
      "one generation is one clip — the API answers `input.num_images` on a video model with " +
      '"is for picture models … Send one request per output". Submit the request once per clip.',
  },
  compile(
    input: VideoParams,
    ctx: CompileContext<VideoParams>,
  ): CompiledCall<RevanaVideoWire, RevanaVideoResult> {
    const row = ROWS[ctx.model];
    const wire: RevanaVideoWireInput = {};
    declareProvenance(ctx);

    if (input.prompt !== undefined) wire.prompt = input.prompt;
    applyMedia(input, wire, ctx);
    applyDuration(input, wire, row, ctx);
    applyResolution(input, wire, row, ctx);
    applyAspectRatio(input, wire, row, ctx);
    if (input.negativePrompt !== undefined) wire.negative_prompt = input.negativePrompt;
    if (input.seed !== undefined) wire.seed = input.seed;

    const body: RevanaVideoWire = { model: ctx.model, input: wire };
    applyExtras(input, REVANA_VIDEO_MODEL_PARAMS, body, ctx, { at: ["input"] });
    return { params: body, validate: validator.safe as RevanaVideoValidate };
  },
} as const satisfies VideoAdapterFor<
  typeof REVANA_VIDEO_MODEL_PARAMS,
  RevanaVideoWire,
  RevanaVideoResult
>;

/**
 * Wire path → the canonical word it was compiled from, for every field this
 * adapter can write. Declared whether or not the request carries the field:
 * `revana.video` also reports what is MISSING ("`input.prompt` is required"),
 * and that finding belongs at `prompt` too.
 */
function declareProvenance(ctx: CompileContext<VideoParams>): void {
  ctx.from(["input", "prompt"], "prompt");
  ctx.from(["input", "image_url"], "image");
  ctx.from(["input", "end_image_url"], "image");
  ctx.from(["input", "image_urls"], "image");
  ctx.from(["input", "video_url"], "video");
  ctx.from(["input", "duration"], "duration");
  ctx.from(["input", "resolution"], "resolution");
  ctx.from(["input", "aspect_ratio"], "aspectRatio");
  ctx.from(["input", "negative_prompt"], "negativePrompt");
  ctx.from(["input", "seed"], "seed");
}

/** Each input to the field of the same meaning. Which combination a model offers is the validator's. */
function applyMedia(
  input: VideoParams,
  wire: RevanaVideoWireInput,
  ctx: CompileContext<VideoParams>,
): void {
  const slots = ctx.take(resolveImageSlots(input.image, { path: ["image"], warn: ctx.warn }));
  if (slots !== undefined) {
    const first = mediaUrl(slots.first, ctx);
    if (first !== undefined) wire.image_url = first;
    const last = mediaUrl(slots.last, ctx);
    if (last !== undefined) wire.end_image_url = last;
    const references = slots.references.flatMap((reference) => mediaUrl(reference, ctx) ?? []);
    if (references.length > 0) wire.image_urls = references;
  }
  if (input.video !== undefined) {
    const clip = ctx.take(toRevanaMediaUrl(input.video, { path: ["video"], warn: ctx.warn }));
    if (clip !== undefined) wire.video_url = clip;
  }
}

function mediaUrl(
  image: VideoImageInput | undefined,
  ctx: CompileContext<VideoParams>,
): string | undefined {
  if (image === undefined) return undefined;
  return ctx.take(toRevanaMediaUrl(image, { path: ["image"], warn: ctx.warn }));
}

/**
 * `duration`, as the plain seconds the wire takes.
 *
 * A model that lists its lengths is checked here against that list, so the
 * finding names `duration` and the values on offer. One with a range, or with
 * no `duration` at all ("sets its own length"), is sent on: `revana.video`
 * holds the range and the refusal, in the API's words.
 */
function applyDuration(
  input: VideoParams,
  wire: RevanaVideoWireInput,
  row: RevanaVideoParamRow | undefined,
  ctx: CompileContext<VideoParams>,
): void {
  if (input.duration === undefined) return;
  const listed = row?.durations;
  if (listed === undefined || listed.length === 0) {
    wire.duration = input.duration;
    return;
  }
  const duration = ctx.take(
    toDurationNumber(input.duration, listed, { path: ["duration"], warn: ctx.warn }),
  );
  if (duration !== undefined) wire.duration = duration;
}

/**
 * `resolution`, in the catalog's spelling of the tier.
 *
 * Sent as written for a model this build has no row for, and for one whose
 * catalog row lists no resolutions — `revana.video` answers that one "takes no
 * `input.resolution`".
 */
function applyResolution(
  input: VideoParams,
  wire: RevanaVideoWireInput,
  row: RevanaVideoParamRow | undefined,
  ctx: CompileContext<VideoParams>,
): void {
  if (input.resolution === undefined) return;
  if (row?.resolutionWire === undefined) {
    wire.resolution = input.resolution;
    return;
  }
  const resolution = toRevanaTier(input.resolution, row.resolutionWire, ctx);
  if (resolution !== undefined) wire.resolution = resolution;
}

/**
 * `aspect_ratio` — the catalog's own spelling where the model lists shapes
 * (the API matches the list as strings), and the caller's where it lists none
 * and the field is free-form.
 */
function applyAspectRatio(
  input: VideoParams,
  wire: RevanaVideoWireInput,
  row: RevanaVideoParamRow | undefined,
  ctx: CompileContext<VideoParams>,
): void {
  if (input.aspectRatio === undefined) return;
  const listed = row?.ratios;
  if (listed === undefined || listed.length === 0) {
    wire.aspect_ratio = input.aspectRatio;
    return;
  }
  const ratio = ctx.take(
    toRatioEnum(
      input.aspectRatio,
      listed,
      { source: REVANA_MODELS_SOURCE },
      { path: ["aspectRatio"], warn: ctx.warn },
    ),
  );
  if (ratio !== undefined) wire.aspect_ratio = ratio;
}

// A deliberate NON-import, asserted in test/bundle-budget.test.ts: this module
// never imports `./models.ts` or `./index.ts`. The catalog belongs to the
// validator — the pack reaches it through `./video` — and `unmodel/revana/values`
// re-exports this file's tables from the import-free `./video-params` leaf.
