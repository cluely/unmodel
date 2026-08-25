/**
 * `unmodel/upscale` → Topaz Labs, the category's second provider.
 *
 * # The ROUTE follows the model, not the input
 *
 * Topaz publishes two image-upscale paths with disjoint model enums —
 * `/enhance/async` for the six classic (GAN) upscalers and
 * `/enhance-gen/async` for the nine generative and creative ones — so the ref
 * decides the URL and there is nothing for the caller to say:
 *
 * ```ts
 * upscale({ model: "topaz/Standard V2", source: { url } });
 * // → POST https://api.topazlabs.com/image/v1/enhance/async
 *
 * upscale({ model: "topaz/Redefine", source: { url }, prompt: "a wooden sailing boat" });
 * // → POST https://api.topazlabs.com/image/v1/enhance-gen/async
 * ```
 *
 * That is the mirror image of `unmodel/tripo3d`, where the model id is the same
 * on both routes and the INPUT picks the URL. Two native providers, two ways a
 * route can fork, one adapter shape.
 *
 * # `factor` is `never` here, and the message says why
 *
 * Topaz has no multiplier. Its envelope states an absolute output size
 * (`output_width`, `output_height`), so the category's one cross-vendor word
 * types as `never` at every Topaz ref and the refusal points at the two fields
 * that do exist. It is a different `never` from
 * `fal-ai/recraft/upscale/crisp`'s, which has no multiplier because it picks
 * its own size — and a caller can act differently on each, which is why they
 * get different messages.
 *
 * Deriving one is not on the table: `factor: 2` needs the input's dimensions to
 * become an output size, and the input is a URL.
 *
 * # `prompt` is the word Topaz brought to the category
 *
 * Nine of the fifteen models take one, on the generative route. The other six
 * refuse it by name, counting the ones that do — the same shape the fal adapter
 * uses, and here it splits the roster almost in half rather than naming an
 * exception.
 *
 * # Inline bytes are refused, not encoded
 *
 * Topaz DOES read raw bytes — as the multipart `image` file part — and
 * `UpscaleSource` cannot express a `Blob`, only a URL or base64. A `data:` URI
 * in `source_url` is a URL Topaz would try to fetch and fail on, so the refusal
 * names `topaz.upscale`'s own `image` field and the raw surface it lives on
 * rather than compiling something that 4xxs.
 *
 * # There is no adapter-wide `unsupported`
 *
 * Risk R7. `seed` exists at two of the fifteen models, `creativity` at nine,
 * `strength` at six, `enhancementStrength` at two — a provider-wide claim about
 * any of them would be false at most of this roster. Every refusal comes off
 * the row, and the row is Topaz's own per-model documentation, which the
 * OpenAPI document does not contain at all.
 */

import { applyExtras, requireMediaUrl } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { AnyUpscaleAdapter, UpscaleParams } from "../../core/unified/vocabulary/upscale";
import { upscale as enhanceValidator, type TopazUpscaleParams } from "./upscale";
import {
  upscaleGenerative as enhanceGenValidator,
  type TopazUpscaleGenerativeParams,
} from "./upscale-generative";
import { MODELS, TOPAZ_UPSCALE_MODEL_PARAMS } from "./upscale-params";
import { DOCS_BASE, TOPAZ_ENHANCE_GEN_MODELS } from "./shared";

const SOURCE = `${DOCS_BASE}/reference/api-endpoints/image`;

/** The wire body of whichever of the two routes the ref selects. */
export type TopazUpscaleWire = TopazUpscaleParams | TopazUpscaleGenerativeParams;

/** What a unified upscale call to `topaz/…` returns — one route's `Validated`. */
export type TopazUpscaleResult =
  | ReturnType<typeof enhanceValidator>
  | ReturnType<typeof enhanceGenValidator>;

/** See vidu's video adapter: `CompiledCall.validate` is contravariant. */
type TopazUpscaleValidate = CompiledCall<TopazUpscaleWire, TopazUpscaleResult>["validate"];

/** The nine ids on `/enhance-gen/async`, as a lookup. */
const GENERATIVE = new Set<string>(TOPAZ_ENHANCE_GEN_MODELS);

/**
 * The body under construction, before the route narrows it.
 *
 * Looser than either arm in one place — `prompt` exists only on the generative
 * one — because which route this is has been decided from the ref but the two
 * param types still differ, and the arm that refuses `prompt` says so on the
 * way out.
 */
interface TopazDraft {
  model: string;
  source_url?: string;
  prompt?: string;
}

export const upscale = {
  category: "upscale",
  provider: "topaz",
  models: MODELS,
  modelParams: TOPAZ_UPSCALE_MODEL_PARAMS,
  compile(
    input: UpscaleParams,
    ctx: CompileContext<UpscaleParams>,
  ): CompiledCall<TopazUpscaleWire, TopazUpscaleResult> {
    const body: TopazDraft = { model: ctx.model };
    const generative = GENERATIVE.has(ctx.model);
    const known = Object.hasOwn(TOPAZ_UPSCALE_MODEL_PARAMS, ctx.model);

    // --- the picture -------------------------------------------------------
    ctx.from(["source_url"], "source");
    const uri = ctx.take(
      requireMediaUrl(
        input.source,
        "Topaz reads raw bytes as the multipart `image` file part rather than out of a URL field, " +
          "and `source` has no way to carry a Blob. Pass a publicly reachable https URL, or call " +
          "`topaz.upscale({ image: blob, … })` directly and post `topaz.toFormData(params)`.",
        { path: ["source"], warn: ctx.warn },
      ),
    );
    if (uri !== undefined) body.source_url = uri;

    // --- the multiplier, which Topaz does not have -------------------------
    if (input.factor !== undefined) {
      ctx.from(["output_width"], "factor");
      ctx.fail({
        code: "unsupported_param",
        path: ["factor"],
        message:
          `Topaz states an ABSOLUTE output size rather than a multiplier: "${ctx.model}" takes ` +
          "`output_width` and `output_height` (1–32000) and there is no `factor` on either of its " +
          "image routes. A multiplier is not derivable here either — it would need the input's " +
          "dimensions, and the input is a URL. Pass the size you want through `providerOptions` or " +
          "as the `output_width` / `output_height` extras.",
        meta: { source: SOURCE, value: input.factor },
      });
    }

    // --- the prompt, on the generative route only --------------------------
    if (input.prompt !== undefined) {
      ctx.from(["prompt"], "prompt");
      if (generative || !known) {
        body.prompt = input.prompt;
      } else {
        ctx.fail({
          code: "unsupported_param",
          path: ["prompt"],
          message:
            `"${ctx.model}" is one of Topaz's classic upscalers: it enlarges what is already in the ` +
            "picture and declares no `prompt` field, so `prompt` has nothing to become. " +
            `${GENERATIVE.size} of the ${MODELS.length} Topaz models — the Wonder and Bloom families on ` +
            "`/enhance-gen/async` — do steer on one; `topaz/Redefine` is the one to reach for first.",
          meta: { source: SOURCE, generative: [...GENERATIVE] },
        });
      }
    }

    applyExtras(input, TOPAZ_UPSCALE_MODEL_PARAMS, body, ctx);

    // Chosen from the ref rather than from a parameter, because Topaz's two
    // model enums are disjoint: an id names exactly one of the two paths. An
    // id this build has not catalogued goes to the classic route, which is the
    // default half of the API and the one whose `model` field defaults.
    const validate = (
      generative ? enhanceGenValidator.safe : enhanceValidator.safe
    ) as TopazUpscaleValidate;

    return { params: body as unknown as TopazUpscaleWire, validate };
  },
} as const satisfies AnyUpscaleAdapter;
