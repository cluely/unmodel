/**
 * `unmodel/lipsync` → fal, across 10 endpoints.
 *
 * The simplest adapter in this provider, and deliberately so: the category is
 * five words and seven of the ten endpoints take four wire parameters or fewer.
 * What the adapter has to get right is small and load-bearing.
 *
 * # The source shape is read off the row, never assumed
 *
 * Every fal lipsync row says `sources: ["video"]` today, and the adapter still
 * asks. The alternative — hard-coding "this category takes clips" — would be a
 * second declaration of the fact that separates this category from
 * `unmodel/avatar`, and the second declaration is the one that goes stale: fal
 * publishes both arms of `sync-lipsync/v3` under one product name, and the day
 * a vendor ships a lipsync route that also accepts a still, the row will say so
 * and this file will already handle it.
 *
 * The compile-time half is `LipsyncModelNarrowing`, which types `source` from
 * the same list. What arrives here at run time is therefore already the right
 * shape at every typed call site; the check below is for the JavaScript
 * callers and the run-time-built refs no type can reach.
 *
 * # `sync_mode` and `loop_mode` are extras, and that is the interesting part
 *
 * sync. spells "what to do when the audio outlasts the clip" as `sync_mode`
 * with five arms (`cut_off | loop | bounce | silence | remap`); LatentSync
 * spells the same idea `loop_mode` with two (`pingpong | loop`); VEED and Kling
 * do not spell it at all. One idea, three vocabularies, no agreement — so it is
 * not canonical, it rides as a per-model extra typed from each endpoint's own
 * wire interface, and it gets promoted the day a second provider agrees with a
 * first. (`unmodel/image`'s `sync_mode` is a BOOLEAN meaning something else
 * entirely, at the same provider. Hence no shared fragment, anywhere.)
 *
 * # There is no adapter-wide `unsupported`
 *
 * Risk R7. `seed` exists on `fal-ai/latentsync` and on none of the other
 * seven, so a provider-wide "fal lipsync has no seed" would be false where it
 * mattered. Every refusal here names the endpoint and is derived from that
 * endpoint's own generated key list.
 */

import { applyExtras, toMediaUri } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  AnyLipsyncAdapter,
  LipsyncParams,
} from "../../core/unified/vocabulary/lipsync";
import { lipsync as validator } from "./lipsync";
import { FAL_LIPSYNC_MODEL_PARAMS, MODELS } from "./lipsync-params";
import { FAL_DOC_URLS } from "./gen/endpoints.gen";

/** The generated row shape, as this file reads it. */
interface FalLipsyncRow {
  readonly keys: readonly string[];
  readonly sources?: readonly string[];
  readonly sourceWire?: string;
  readonly audioWire?: string;
}

const ROWS = FAL_LIPSYNC_MODEL_PARAMS as Readonly<Record<string, FalLipsyncRow>>;

/**
 * The wire body this adapter compiles to.
 *
 * No index-signature tail, for `FalImageWire`'s measured reason: an open one
 * makes `ExactKeys` demand `never` for every key and quietly un-narrows the
 * hand surface. Per-model extras (`sync_mode`, `loop_mode`, `model`,
 * `guidance_scale`, `voice_id`, `text`, `options`) reach the body through
 * `applyExtras`'s own cast.
 */
export interface FalLipsyncWire {
  /** The route selector, stripped into `.request.url` by `fal.lipsync`. */
  endpoint: string;
  video_url?: string;
  audio_url?: string;
  seed?: number;
}

/** What a unified call to `fal/…` returns: `fal.lipsync`'s own `Validated`. */
export type FalLipsyncResult = ReturnType<typeof validator>;

/** See `./unified-image.ts`: `CompiledCall.validate` is not generic, and cannot be. */
type FalLipsyncValidate = CompiledCall<FalLipsyncWire, FalLipsyncResult>["validate"];

function docs(model: string): string | undefined {
  return FAL_DOC_URLS[model as keyof typeof FAL_DOC_URLS];
}

/**
 * The fal lipsync adapter.
 *
 * `models` is the curated roster, so a ref outside it draws `unknown_model`
 * from the kernel and then compiles with no row — the refusals below stand
 * down and the request goes to `fal.lipsync`'s own IR, which is the right
 * place for an endpoint unmodel has not catalogued yet.
 */
export const lipsync = {
  category: "lipsync",
  provider: "fal",
  models: MODELS,
  modelParams: FAL_LIPSYNC_MODEL_PARAMS,
  compile(
    input: LipsyncParams,
    ctx: CompileContext<LipsyncParams>,
  ): CompiledCall<FalLipsyncWire, FalLipsyncResult> {
    const body: FalLipsyncWire = { endpoint: ctx.model };
    const row = ROWS[ctx.model];

    // --- the clip ----------------------------------------------------------
    const sourceWire = row?.sourceWire;
    if (row !== undefined && sourceWire === undefined) {
      ctx.fail({
        code: "unsupported_capability",
        path: ["source"],
        message:
          `"${ctx.model}" declares no source-clip parameter, so it cannot serve a lipsync request. ` +
          "This is a roster bug rather than a caller mistake — please file it.",
        meta: { source: docs(ctx.model) },
      });
    } else {
      const wire = sourceWire ?? "video_url";
      ctx.from([wire], "source");
      const uri = ctx.take(toMediaUri(input.source, { path: ["source"], warn: ctx.warn }));
      if (uri !== undefined) (body as unknown as Record<string, unknown>)[wire] = uri;
    }

    // --- the voice track ---------------------------------------------------
    const audioWire = row?.audioWire ?? "audio_url";
    ctx.from([audioWire], "audio");
    const audio = ctx.take(toMediaUri(input.audio, { path: ["audio"], warn: ctx.warn }));
    if (audio !== undefined) (body as unknown as Record<string, unknown>)[audioWire] = audio;

    // --- seed, on the one endpoint that has one ----------------------------
    if (input.seed !== undefined) {
      ctx.from(["seed"], "seed");
      if (row === undefined || row.keys.includes("seed")) body.seed = input.seed;
      else {
        const takers = Object.keys(ROWS).filter((id) => ROWS[id]?.keys.includes("seed") === true);
        ctx.fail({
          code: "unsupported_param",
          path: ["seed"],
          message:
            `"${ctx.model}" declares no \`seed\` parameter — lipsync is mostly deterministic given a clip ` +
            `and a track, and only ${takers.length} of the ${Object.keys(ROWS).length} fal lipsync ` +
            `endpoints expose one${takers.length > 0 && takers.length <= 3 ? ` (${takers.map((id) => `"${id}"`).join(", ")})` : ""}.`,
          meta: { wire: "seed", source: docs(ctx.model), ...(row === undefined ? {} : { declared: [...row.keys] }) },
        });
      }
    }

    applyExtras(input, FAL_LIPSYNC_MODEL_PARAMS, body, ctx);
    return { params: body, validate: validator.safe as FalLipsyncValidate };
  },
} as const satisfies AnyLipsyncAdapter;
