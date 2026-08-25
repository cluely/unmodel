/**
 * `unmodel/3d` → Tripo, across both v3 generation routes.
 *
 * # The route follows the input, not the model id
 *
 * This is the shape that makes Tripo the category's second witness rather than
 * a second copy of the first. At fal the same four Tripo models are eight
 * endpoint ids — `tripo3d/h3.1/text-to-3d` and `tripo3d/h3.1/image-to-3d` and so
 * on — and each row names one mood. Here `model: "v3.1-20260211"` is the same
 * string whichever mood you are in, and the URL is chosen by whether the caller
 * wrote `prompt` or `image`:
 *
 * ```ts
 * threeD({ model: "tripo3d/v3.1-20260211", prompt: "a chair" });
 * // → POST /v3/generation/text-to-model   { model, prompt }
 *
 * threeD({ model: "tripo3d/v3.1-20260211", image: { url } });
 * // → POST /v3/generation/image-to-model  { model, input }
 * ```
 *
 * So every row here says `inputs: ["image", "text"]` and the two canonical
 * words are both optional — which puts the requirement on the ADAPTER, not the
 * type. A request with neither is refused naming both fields; a request with
 * BOTH is refused too, because Tripo's image route has no prompt field and
 * quietly dropping the prompt would bill for a generation that ignored half the
 * request.
 *
 * # `image` is a URL, a token or a task id — never bytes
 *
 * `input` is one polymorphic string and none of its three shapes is inline
 * data: a `file_…` token minted by `POST /v3/files` (a multipart upload unmodel
 * does not make), a public http(s) URL, or a `task_…` id from a prior
 * image-generation task. So a `{ data }` ref is refused here naming the upload
 * endpoint, rather than compiled into a `data:` URI Tripo would reject.
 *
 * # `seed` is `model_seed`, out of three
 *
 * Tripo publishes `model_seed`, `image_seed` and `texture_seed` and they pin
 * three different stages. The canonical `seed` maps to `model_seed` — the one
 * that decides whether you got the same OBJECT — and the other two ride as
 * extras, which is also the answer for the same model reached through fal.
 *
 * # No adapter-wide `unsupported`
 *
 * Every one of Tripo's own dials — `texture`, `pbr`, `face_limit`,
 * `texture_quality`, `geometry_quality`, `quad`, `smart_low_poly`,
 * `generate_parts`, `compress` — is a per-model extra, and the version gate
 * means the set genuinely differs per row: `v2.5-20250123` takes none of the
 * last seven. A provider-wide claim about any of them would be false at half
 * this catalog.
 */

import { applyExtras, requireMediaUrl } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { AnyThreeDAdapter, ThreeDParams } from "../../core/unified/vocabulary/3d";
import { DOCS_BASE, FILES_URL } from "./shared";
import { threeD as textValidator, type TextToModelParams } from "./three-d";
import { threeDFromImage as imageValidator, type ImageToModelParams } from "./three-d-from-image";
import { MODELS, TRIPO3D_THREE_D_MODEL_PARAMS } from "./three-d-params";

const SOURCE = `${DOCS_BASE}/generation-text-to-model/standard`;
const IMAGE_SOURCE = `${DOCS_BASE}/generation-image-to-model/standard`;

/** The wire body of whichever of the two routes the inputs select. */
export type Tripo3dThreeDWire = TextToModelParams | ImageToModelParams;

/** What a unified 3D call to `tripo3d/…` returns — one route's `Validated`. */
export type Tripo3dThreeDResult =
  | ReturnType<typeof textValidator>
  | ReturnType<typeof imageValidator>;

/** See the note on vidu's video adapter: `validate` is contravariant. */
type Tripo3dValidate = CompiledCall<Tripo3dThreeDWire, Tripo3dThreeDResult>["validate"];

/**
 * The body under construction, before the route narrows it.
 *
 * Looser than either arm in one place — `prompt` is required on the text route
 * and absent from the image one, `input` the reverse — because which route this
 * is has not been decided when the field is written, and the arm that requires
 * it says so on the way out.
 */
interface Tripo3dDraft {
  model: string;
  prompt?: string;
  input?: string;
  model_seed?: number;
}

export const threeD = {
  category: "3d",
  provider: "tripo3d",
  models: MODELS,
  modelParams: TRIPO3D_THREE_D_MODEL_PARAMS,
  compile(
    input: ThreeDParams,
    ctx: CompileContext<ThreeDParams>,
  ): CompiledCall<Tripo3dThreeDWire, Tripo3dThreeDResult> {
    const body: Tripo3dDraft = { model: ctx.model };
    const hasImage = input.image !== undefined;
    const hasPrompt = input.prompt !== undefined;

    if (!hasImage && !hasPrompt) {
      ctx.fail({
        code: "invalid_shape",
        path: ["prompt"],
        message:
          `"${ctx.model}" is reached by DESCRIBING an object or by SHOWING one, and this request does ` +
          "neither. Pass `prompt` for POST /v3/generation/text-to-model, or `image` for " +
          "POST /v3/generation/image-to-model — the model id is the same either way, the URL is not.",
        meta: { source: SOURCE },
      });
    }

    if (hasImage && hasPrompt) {
      ctx.fail({
        code: "unsupported_param",
        path: ["prompt"],
        message:
          "Tripo's image route (POST /v3/generation/image-to-model) declares no `prompt` field, so a " +
          "request carrying both would silently drop the words. Pick one: `image` reconstructs the " +
          "picture, `prompt` builds from the description. To steer a reconstruction with text, use a " +
          "provider whose route reads both — `fal/fal-ai/hyper3d/rodin/v2.5` does.",
        meta: { source: IMAGE_SOURCE },
      });
    }

    if (input.prompt !== undefined) {
      ctx.from(["prompt"], "prompt");
      body.prompt = input.prompt;
    }

    if (input.image !== undefined) {
      ctx.from(["input"], "image");
      const uri = ctx.take(
        requireMediaUrl(
          input.image,
          `Upload the picture with POST ${FILES_URL} and pass the \`file_…\` token it returns, or ` +
            "give a publicly reachable https URL. Tripo's `input` accepts a token, a URL or a prior " +
            "task id — never inline bytes.",
          { path: ["image"], warn: ctx.warn },
        ),
      );
      if (uri !== undefined) body.input = uri;
    }

    if (input.seed !== undefined) {
      // `model_seed` out of three: it pins the geometry, which is the one that
      // decides whether you got the same object back.
      ctx.from(["model_seed"], "seed");
      body.model_seed = input.seed;
    }

    applyExtras(input, TRIPO3D_THREE_D_MODEL_PARAMS, body, ctx);

    // Chosen here rather than at the type level because the model id does not
    // carry the route — the input does. A request that named neither has
    // already failed above and is never validated; it still compiles so one
    // pass reports everything else wrong with it too.
    const validate = (
      hasImage ? imageValidator.safe : textValidator.safe
    ) as Tripo3dValidate;

    return { params: body as unknown as Tripo3dThreeDWire, validate };
  },
} as const satisfies AnyThreeDAdapter;
