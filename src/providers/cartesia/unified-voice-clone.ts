/**
 * `unmodel/voice-clone` → `cartesia.voiceClone` (POST /voices/clone).
 *
 * The strictest clone wire in the pack: exactly one `clip`, a REQUIRED
 * `language` from a closed 44-code list, and no transcript, noise-reduction
 * or caller-id field (the pre-2026-08-14 `transcript`/`enhance`/`mode` are
 * gone — see ./voice-clone). What that means here:
 *
 * - **A missing `language` is an error at the canonical path** — the wire's
 *   own "language is required" check, remapped. A BCP-47 tag is reduced to
 *   its primary subtag first (`"pt-BR"` → `"pt"`, warned), and membership in
 *   the 44 is the validator's `checkLanguage`'s call, not a second list here.
 * - **`visibility` maps to `access`, minus one member**: `"unlisted"` has no
 *   wire value at Cartesia and is refused by name.
 */
import {
  applyExtras,
  resolveOperation,
  resolveVoiceSamples,
  toPrimaryLanguage,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  VoiceCloneAdapterFor,
  VoiceCloneParamsFor,
} from "../../core/unified/vocabulary/voice-clone";
import {
  voiceClone as validator,
  type CartesiaCloneLanguage,
  type VoicesCloneParams,
} from "./voice-clone";
import {
  CARTESIA_VOICE_CLONE_MODEL_PARAMS,
  MODELS,
  VOICE_CLONE_DOCS,
  VOICE_CLONE_LANGUAGES,
} from "./voice-clone-params";

/** The wire params this adapter compiles to (the multipart form fields). */
export type CartesiaVoiceCloneWire = VoicesCloneParams;

/** What a unified call to `cartesia/voice-clone` returns. */
export type CartesiaVoiceCloneResult = ReturnType<typeof validator<CartesiaVoiceCloneWire>>;

/** "clip" is singular: exactly one recording. */
const SAMPLE_LIMITS = { min: 1, max: 1 } as const;

const LANGUAGE_SET = new Set<string>(VOICE_CLONE_LANGUAGES);

/** Membership in the wire's closed 44-code enum — the ./unified-stt pattern. */
function isCloneLanguage(language: string): language is CartesiaCloneLanguage {
  return LANGUAGE_SET.has(language);
}

/** The one operation this category serves today; see resolveOperation. */
const CLONE_ONLY = ["clone"] as const;

export const voiceClone = {
  category: "voiceClone",
  provider: "cartesia",
  models: MODELS,
  modelParams: CARTESIA_VOICE_CLONE_MODEL_PARAMS,
  sampleInputs: ["file"],
  sampleLimits: SAMPLE_LIMITS,
  unsupported: {
    noiseReduction:
      "POST /voices/clone (Cartesia-Version 2026-08-14) has no enhancement or " +
      "noise-reduction field — the pre-2026 `enhance` was removed; clean the clip " +
      "before uploading.",
    voiceId:
      "Cartesia mints the voice's `id` in the response; POST /voices/clone has no " +
      "caller-chosen id field.",
  },
  compile(
    input: VoiceCloneParamsFor<"file">,
    ctx: CompileContext<VoiceCloneParamsFor<"file">>,
  ): CompiledCall<CartesiaVoiceCloneWire, CartesiaVoiceCloneResult> {
    // `name` and `language` are required on the wire; `""` lets the
    // validator's own checks answer, remapped onto the canonical fields.
    const body: CartesiaVoiceCloneWire = {
      clip: new Blob([]),
      name: input.name ?? "",
      language: "",
    };
    ctx.from(["clip"], "samples");
    ctx.from(["name"], "name");
    ctx.from(["language"], "language");
    ctx.from(["description"], "description");
    ctx.from(["access"], "visibility");

    ctx.take(
      resolveOperation(input.operation, CLONE_ONLY, { path: ["operation"], warn: ctx.warn }),
    );

    const samples = ctx.take(
      resolveVoiceSamples(
        input.samples,
        {
          accepts: ["file"],
          limits: SAMPLE_LIMITS,
          transcripts: "unsupported",
          source: VOICE_CLONE_DOCS,
          hint: "the 2026-08-14 wire dropped the `transcript` field",
        },
        { path: ["samples"], warn: ctx.warn },
      ),
    );
    const sample = samples?.[0];
    if (sample !== undefined && sample.kind === "file") body.clip = sample.file;

    if (input.language !== undefined) {
      const language = ctx.take(
        toPrimaryLanguage(input.language, { path: ["language"], warn: ctx.warn }, {
          source: VOICE_CLONE_DOCS,
        }),
      );
      // The closed 44-code list lives in `cartesia.voiceClone`'s own
      // `checkLanguage`; an off-enum primary subtag is forwarded through one
      // explicit cast so that check still refuses it at error severity —
      // the ./unified-stt sentence, verbatim.
      if (language !== undefined) {
        body.language = isCloneLanguage(language) ? language : (language as CartesiaCloneLanguage);
      }
    }

    if (input.description !== undefined) body.description = input.description;

    if (input.visibility !== undefined) {
      if (input.visibility === "unlisted") {
        ctx.fail({
          code: "invalid_enum_value",
          path: ["visibility"],
          message:
            '`visibility: "unlisted"` has no wire value at Cartesia — `access` is "private" ' +
            '(the default) or "public".',
          meta: { allowed: ["private", "public"], value: "unlisted", source: VOICE_CLONE_DOCS },
        });
      } else {
        body.access = input.visibility;
      }
    }

    applyExtras(input, CARTESIA_VOICE_CLONE_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies VoiceCloneAdapterFor<
  "file",
  typeof CARTESIA_VOICE_CLONE_MODEL_PARAMS,
  CartesiaVoiceCloneWire,
  CartesiaVoiceCloneResult
>;
