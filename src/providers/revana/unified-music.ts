/**
 * `unmodel/music` → `revana.music`
 * (POST https://api.revana.si/v1/generations).
 *
 * | canonical | wire (`input.…`) | notes |
 * |---|---|---|
 * | `prompt` | `prompt` | "the idea", at most 3000 characters |
 * | `instrumental` | `instrumental` | "true for no vocals. Not with lyrics." |
 * | `durationSeconds`, `seed`, `outputFormat` | — | declared unsupported |
 *
 * # A canonical request alone is not a Revana music request
 *
 * "A music request needs style or lyrics; prompt … is the idea." The canonical
 * vocabulary has `prompt` and neither of the other two, so
 * `music({ model: "revana/suno-v6", prompt })` is refused by `revana.music`
 * with that sentence, and the fix is one of the two per-model extras:
 *
 * ```ts
 * music({ model: "revana/suno-v6", prompt: "A song about first snow", style: "indie folk, warm vocals" });
 * ```
 *
 * `prompt` is NOT written to `style` to make the bare request pass. The two
 * are different fields with different caps (3000 and 1000 characters) and
 * Revana says which is which; guessing that a caller's prompt is a genre would
 * be inventing the request.
 *
 * # Three words with no field
 *
 * The API's own list is closed — "makes music and does not take
 * input.duration. It takes prompt, style, lyrics and instrumental" — so the
 * length, the seed and the encoding are all declared rather than dropped.
 */

import { applyExtras } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { MusicAdapterFor, MusicParams } from "../../core/unified/vocabulary/music";
import { music as validator } from "./music";
import { MODELS, REVANA_MUSIC_MODEL_PARAMS } from "./music-params";

/**
 * `input`, as this adapter writes it and as `providerOptions.revana.input`
 * completes it: `MusicModelInput` in `./generation-wire.ts`.
 */
export interface RevanaMusicWireInput {
  prompt?: string;
  instrumental?: boolean;
  /** Per-model extras: a request needs one of the two. */
  style?: string;
  lyrics?: string;
}

/** The wire body this adapter compiles to: `GenerationRequest`, loosely typed. */
export interface RevanaMusicWire {
  model: string;
  input: RevanaMusicWireInput;
  max_cost_usd?: number;
  max_wait_s?: number;
}

/** What a unified music call to `revana/…` returns — see `RevanaVideoResult` in `./unified-video.ts`. */
export type RevanaMusicResult = ReturnType<typeof validator<string>>;

/** See `RevanaVideoValidate` in `./unified-video.ts`. */
type RevanaMusicValidate = CompiledCall<RevanaMusicWire, RevanaMusicResult>["validate"];

/** "<id> makes music and does not take input.<field>. It takes prompt, style, lyrics and instrumental." */
const TAKES = "A Revana music model takes `prompt`, `style`, `lyrics` and `instrumental`";

export const music = {
  category: "music",
  provider: "revana",
  models: MODELS,
  modelParams: REVANA_MUSIC_MODEL_PARAMS,
  unsupported: {
    durationSeconds: `${TAKES} — there is no length field, and the API refuses \`input.duration\` by name.`,
    seed: `${TAKES} — there is no seed.`,
    outputFormat: `${TAKES} — there is no encoding field; \`output.urls\` lists the finished files.`,
  },
  compile(
    input: MusicParams,
    ctx: CompileContext<MusicParams>,
  ): CompiledCall<RevanaMusicWire, RevanaMusicResult> {
    const wire: RevanaMusicWireInput = { prompt: input.prompt };
    ctx.from(["input", "prompt"], "prompt");
    ctx.from(["input", "instrumental"], "instrumental");
    if (input.instrumental !== undefined) wire.instrumental = input.instrumental;

    const body: RevanaMusicWire = { model: ctx.model, input: wire };
    applyExtras(input, REVANA_MUSIC_MODEL_PARAMS, body, ctx, { at: ["input"] });
    return { params: body, validate: validator.safe as RevanaMusicValidate };
  },
} as const satisfies MusicAdapterFor<
  typeof REVANA_MUSIC_MODEL_PARAMS,
  RevanaMusicWire,
  RevanaMusicResult
>;
