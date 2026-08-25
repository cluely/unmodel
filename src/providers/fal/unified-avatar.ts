/**
 * `unmodel/avatar` → fal, across 8 endpoints.
 *
 * The lipsync adapter's twin, with one decision it does not have to make: two
 * of these eight endpoints take no still at all.
 *
 * # `image` is required, forbidden, or unknown — three answers, three messages
 *
 * Six rows say `sources: ["image"]` and their `image` is REQUIRED, at compile
 * time through `AvatarModelNarrowing` and at run time here. Two —
 * `veed/avatars/audio-to-video` and `argil/avatars/audio-to-video` — say
 * `sources: []`, because their performer is a catalogued id out of a closed
 * enum of trained presenters and there is nowhere on the wire for a face.
 * Sending a still to one of those is a refusal that names the enum field it
 * actually wants, not a silent drop.
 *
 * A ref this build does not know gets neither: the row is absent, every
 * refusal below stands down, and the body goes to `fal.avatar`'s own IR — the
 * right place for an endpoint unmodel has not catalogued yet.
 *
 * # Why the preset performer is not a canonical word
 *
 * It is tempting to add `performer` to `AvatarParams` and be done. Two
 * witnesses, one provider, and two incompatible spellings (`avatar_id` at VEED
 * with 28 values, `avatar` at Argil with 28 different ones) is not a
 * vocabulary — it is a coincidence with a shape. Both fields are per-model
 * extras, typed from their own endpoint's wire interface, so an editor offers
 * exactly VEED's 28 names on a VEED ref and exactly Argil's on an Argil one;
 * `unmodel/avatar` grows a canonical word for it when a second provider
 * publishes one.
 *
 * # `prompt` is an extra here, and that is a finding
 *
 * Three of the eight rows have no `prompt` at all, `fal-ai/echomimic-v3`
 * REQUIRES one, and the two Kling rows default theirs to `"."` — fal's way of
 * spelling "the wire wants a string and the caller has nothing to say". A
 * canonical word whose meaning ranges from mandatory to meaningless across one
 * provider's own roster is not canonical yet, so it rides as an extra and
 * arrives typed.
 */

import { applyExtras, toMediaUri } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { AnyAvatarAdapter, AvatarParams } from "../../core/unified/vocabulary/avatar";
import { avatar as validator } from "./avatar";
import { FAL_AVATAR_MODEL_PARAMS, MODELS } from "./avatar-params";
import { FAL_DOC_URLS } from "./gen/endpoints.gen";

/** The generated row shape, as this file reads it. */
interface FalAvatarRow {
  readonly keys: readonly string[];
  readonly sources?: readonly string[];
  readonly sourceWire?: string;
  readonly audioWire?: string;
}

const ROWS = FAL_AVATAR_MODEL_PARAMS as Readonly<Record<string, FalAvatarRow>>;

/**
 * The wire body this adapter compiles to. No index-signature tail — see
 * `FalImageWire`. The preset-performer fields (`avatar_id`, `avatar`), the
 * prompts and the per-model knobs all reach the body through `applyExtras`.
 */
export interface FalAvatarWire {
  /** The route selector, stripped into `.request.url` by `fal.avatar`. */
  endpoint: string;
  image_url?: string;
  audio_url?: string;
  seed?: number;
}

/** What a unified call to `fal/…` returns: `fal.avatar`'s own `Validated`. */
export type FalAvatarResult = ReturnType<typeof validator>;

/** See `./unified-image.ts`: `CompiledCall.validate` is not generic, and cannot be. */
type FalAvatarValidate = CompiledCall<FalAvatarWire, FalAvatarResult>["validate"];

function docs(model: string): string | undefined {
  return FAL_DOC_URLS[model as keyof typeof FAL_DOC_URLS];
}

/** The enum field a preset-performer endpoint wants instead of a picture. */
function performerField(row: FalAvatarRow | undefined): string | undefined {
  return row?.keys.find((key) => key === "avatar_id" || key === "avatar");
}

/** The fal avatar adapter. */
export const avatar = {
  category: "avatar",
  provider: "fal",
  models: MODELS,
  modelParams: FAL_AVATAR_MODEL_PARAMS,
  compile(
    input: AvatarParams,
    ctx: CompileContext<AvatarParams>,
  ): CompiledCall<FalAvatarWire, FalAvatarResult> {
    const body: FalAvatarWire = { endpoint: ctx.model };
    const row = ROWS[ctx.model];
    const sourceWire = row?.sourceWire;

    // --- the still ---------------------------------------------------------
    if (input.image !== undefined) {
      if (row !== undefined && sourceWire === undefined) {
        const performer = performerField(row);
        ctx.fail({
          code: "unsupported_param",
          path: ["image"],
          message:
            `"${ctx.model}" animates a catalogued performer rather than a picture you supply, so it ` +
            `declares no image parameter and \`image\` has nothing to become. ` +
            (performer === undefined
              ? "Check this endpoint's documentation for how it selects its subject."
              : `Name one of its presenters with \`providerOptions: { fal: { ${performer}: … } }\` — ` +
                "the value is typed from this endpoint's own enum."),
          meta: {
            source: docs(ctx.model),
            ...(performer === undefined ? {} : { wire: performer }),
            declared: [...row.keys],
          },
        });
      } else {
        const wire = sourceWire ?? "image_url";
        ctx.from([wire], "image");
        const uri = ctx.take(toMediaUri(input.image, { path: ["image"], warn: ctx.warn }));
        if (uri !== undefined) (body as unknown as Record<string, unknown>)[wire] = uri;
      }
    } else if (sourceWire !== undefined) {
      // The row says this endpoint requires a still and the request has none.
      // `AvatarModelNarrowing` already refuses this at the keystroke; this is
      // the same refusal for JavaScript callers and run-time-built refs, and
      // it names the field rather than letting fal answer with a 422.
      ctx.fail({
        code: "invalid_shape",
        path: ["image"],
        message:
          `"${ctx.model}" animates a still you supply, and this request has none — \`image\` is ` +
          `required here. (Two fal avatar endpoints take a catalogued performer instead and refuse ` +
          "an `image`; which kind a model is, is on its row.)",
        meta: { wire: sourceWire, source: docs(ctx.model) },
      });
    }

    // --- the voice track ---------------------------------------------------
    const audioWire = row?.audioWire ?? "audio_url";
    ctx.from([audioWire], "audio");
    const audio = ctx.take(toMediaUri(input.audio, { path: ["audio"], warn: ctx.warn }));
    if (audio !== undefined) (body as unknown as Record<string, unknown>)[audioWire] = audio;

    // --- seed, where the endpoint has one ----------------------------------
    if (input.seed !== undefined) {
      ctx.from(["seed"], "seed");
      if (row === undefined || row.keys.includes("seed")) body.seed = input.seed;
      else {
        const takers = Object.keys(ROWS).filter((id) => ROWS[id]?.keys.includes("seed") === true);
        ctx.fail({
          code: "unsupported_param",
          path: ["seed"],
          message:
            `"${ctx.model}" declares no \`seed\` parameter, so \`seed\` has nothing to become. ` +
            `${takers.length} of the ${Object.keys(ROWS).length} fal avatar endpoints do take one.`,
          meta: { wire: "seed", source: docs(ctx.model), ...(row === undefined ? {} : { declared: [...row.keys] }) },
        });
      }
    }

    applyExtras(input, FAL_AVATAR_MODEL_PARAMS, body, ctx);
    return { params: body, validate: validator.safe as FalAvatarValidate };
  },
} as const satisfies AnyAvatarAdapter;
