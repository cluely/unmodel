/**
 * `unmodel/sfx` → fal, across 6 endpoints from five vendors.
 *
 * # The length is the category, and its ABSENCE is what the row is for
 *
 * Two wire spellings — `duration_seconds` at ElevenLabs, `duration` everywhere
 * else — both already in seconds, so unlike music there is nothing to convert.
 * What the row actually carries is the other half: whether the field is a whole
 * number (Sonilo and CassetteAI), what the endpoint does when the caller says
 * nothing (8 seconds at Sonilo, 10 at Mirelo, 30 at Stable Audio, a prompt-read
 * guess at ElevenLabs), and whether saying nothing is legal at all (it is not
 * at CassetteAI). The first two are checked by `fal.sfx`'s own IR; the third
 * warns here, naming the number; the fourth is `checkRequired`'s refusal,
 * remapped onto `durationSeconds` by the `ctx.from` below.
 *
 * # `prompt` is spelled three ways and means one thing
 *
 * `prompt` at Sonilo, CassetteAI and both Stable Audio routes, `text` at
 * ElevenLabs, `text_prompt` at Mirelo. Unlike music's `lyrics`, none of these
 * is a different CONCEPT — there is no sung-text trap in this category — so the
 * curated `textParam` is a pure rename and the write is lossless.
 *
 * # `outputFormat` is refused at one of the six, and composite at another
 *
 * `cassetteai/sound-effects-generator` has no encoding field at all and types
 * `outputFormat` as `never`. The ElevenLabs route takes a COMPOSITE
 * (`mp3_44100_128`) that states a codec, a sample rate and sometimes a bitrate
 * at once; the row narrows only the codec half, because the legal triples are
 * not a cross product. The remaining four take a bare codec enum — and the two
 * Stable Audio routes add a SEPARATE `bitrate` field, a kbps-suffixed string
 * (`"192k"`), which is where `outputFormat.bitrate` lands there and nowhere
 * else.
 *
 * # There is no adapter-wide `unsupported`
 *
 * Risk R7, and this category is the clearest case for it yet: an encoding field
 * exists at five of the six, a bitrate field at two, a required length at one.
 * A provider-wide claim would be false at the majority of fal's own sound-effect
 * endpoints.
 */

import {
  applyExtras,
  bitsToKbps,
  resolveAudioFormat,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { AudioFormatCodec } from "../../core/unified/vocabulary/audio";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { AnySfxAdapter, SfxParams } from "../../core/unified/vocabulary/sfx";
import { sfx as validator } from "./sfx";
import { FAL_SFX_MODEL_PARAMS, MODELS } from "./sfx-params";
import { FAL_DOC_URLS } from "./gen/endpoints.gen";

/** The generated row shape, as this file reads it. */
interface FalSfxRow {
  readonly keys: readonly string[];
  readonly textWire?: string;
  readonly lengthWire?: string;
  readonly durationDefault?: number;
  readonly durationRequired?: true;
  readonly formatWire?: string;
  readonly bitrateWire?: string;
  readonly codecs?: readonly string[];
  readonly codecValues?: Readonly<Record<string, string>>;
}

const ROWS = FAL_SFX_MODEL_PARAMS as Readonly<Record<string, FalSfxRow>>;

/**
 * The wire body this adapter compiles to. No index-signature tail — see
 * `FalImageWire`. Per-model extras (`loop`, `prompt_influence`, `seed`,
 * `negative_prompt`, `ambience`, `num_samples`, …) reach the body through
 * `applyExtras`.
 */
export interface FalSfxWire {
  /** The route selector, stripped into `.request.url` by `fal.sfx`. */
  endpoint: string;
  prompt?: string;
  text?: string;
  text_prompt?: string;
}

/** What a unified call to `fal/…` returns: `fal.sfx`'s own `Validated`. */
export type FalSfxResult = ReturnType<typeof validator>;

/** See `./unified-image.ts`: `CompiledCall.validate` is not generic, and cannot be. */
type FalSfxValidate = CompiledCall<FalSfxWire, FalSfxResult>["validate"];

function docs(model: string): string | undefined {
  return FAL_DOC_URLS[model as keyof typeof FAL_DOC_URLS];
}

/** See `unified-upscale.ts`: the confined cast a row-named wire key costs. */
function write(body: FalSfxWire, wire: string, value: string | number | boolean): void {
  (body as unknown as Record<string, unknown>)[wire] = value;
}

/**
 * The endpoints whose row declares a given field — a refusal that counts, and
 * where the list is short enough to read, one that names.
 */
function takers(pick: (row: FalSfxRow) => unknown): readonly string[] {
  return Object.keys(ROWS).filter((id) => {
    const row = ROWS[id];
    return row !== undefined && pick(row) !== undefined;
  });
}

/**
 * This endpoint's own encoding capabilities, from its row.
 *
 * `sampleRate` is unavailable everywhere: five of the six publish a bare codec
 * enum with no rate field, and the sixth folds the rate into a composite whose
 * legal (codec, rate, bitrate) triples are not a cross product. `bitrate` is
 * unavailable only where the route has no `bitrate` field — refusing it at
 * Stable Audio, which does, would be a false negative on a request fal
 * fulfils.
 */
function formatSpec(row: FalSfxRow | undefined, model: string): AudioFormatSpec {
  return {
    codecs: (row?.codecValues ?? {}) as Readonly<Partial<Record<AudioFormatCodec, string>>>,
    unavailable: row?.bitrateWire === undefined ? ["sampleRate", "bitrate"] : ["sampleRate"],
    ...(docs(model) === undefined ? {} : { source: docs(model) as string }),
  };
}

function applyLength(
  input: SfxParams,
  body: FalSfxWire,
  row: FalSfxRow | undefined,
  ctx: CompileContext<SfxParams>,
): void {
  const wire = row?.lengthWire;
  // Declared unconditionally, so a `checkRequired` refusal at CassetteAI —
  // which fires precisely when nothing was written — is reported on
  // `durationSeconds` rather than on a wire name the caller never typed.
  ctx.from([wire ?? "duration"], "durationSeconds");

  if (input.durationSeconds === undefined) {
    // The default is INVENTED on the caller's behalf, so it goes on the record
    // naming the number. Not sent explicitly: writing 8 into `duration` would
    // pin a value fal's own page is free to change, and the request would stop
    // meaning "whatever this endpoint thinks best" the day it does. Silence is
    // right at the two ElevenLabs routes, whose row publishes no default
    // because the model reads a length off the prompt, and at CassetteAI,
    // where `checkRequired` is about to refuse the body outright.
    const seconds = row?.durationDefault;
    if (seconds === undefined) return;
    ctx.warn({
      code: "approximated_param",
      path: ["durationSeconds"],
      message:
        `\`durationSeconds\` was not set, so "${ctx.model}" will generate ${seconds} seconds — its ` +
        "own documented default rather than a length this request asked for. Set it to pin the length.",
      meta: { achieved: seconds, wire, source: docs(ctx.model) },
    });
    return;
  }

  if (row === undefined) {
    write(body, "duration", input.durationSeconds);
    return;
  }
  if (wire === undefined) {
    ctx.fail({
      code: "unsupported_param",
      path: ["durationSeconds"],
      message:
        `"${ctx.model}" decides how long the effect is and declares no length parameter, so ` +
        `\`durationSeconds\` has nothing to become. ${takers((r) => r.lengthWire).length} of the ` +
        `${Object.keys(ROWS).length} fal sound-effect endpoints do take one.`,
      meta: { source: docs(ctx.model), declared: [...row.keys] },
    });
    return;
  }
  // Bounds and whole-number-ness live in `fal.sfx`'s own IR — a second copy
  // here is a second thing to drift — so an out-of-range or fractional length
  // surfaces that check's message remapped onto `durationSeconds`.
  write(body, wire, input.durationSeconds);
}

function applyFormat(
  input: SfxParams,
  body: FalSfxWire,
  row: FalSfxRow | undefined,
  ctx: CompileContext<SfxParams>,
): void {
  if (input.outputFormat === undefined) return;
  const wire = row?.formatWire ?? "output_format";
  ctx.from([wire], "outputFormat");

  if (row !== undefined && (row.codecs === undefined || row.codecs.length === 0)) {
    ctx.fail({
      code: "unsupported_param",
      path: ["outputFormat"],
      message:
        `"${ctx.model}" answers a fixed encoding and declares no output-format parameter, so ` +
        `\`outputFormat\` has nothing to become. ${takers((r) => r.formatWire).length} of the ` +
        `${Object.keys(ROWS).length} fal sound-effect endpoints let you choose.`,
      meta: { source: docs(ctx.model), declared: [...row.keys] },
    });
    return;
  }

  const format = ctx.take(
    resolveAudioFormat(input.outputFormat, formatSpec(row, ctx.model), {
      path: ["outputFormat"],
      warn: ctx.warn,
    }),
  );
  if (format === undefined) return;
  write(body, wire, format.wire);

  const bitrateWire = row?.bitrateWire;
  if (bitrateWire === undefined || format.bitrate === undefined) return;
  ctx.from([bitrateWire], "outputFormat");
  const kbps = ctx.take(bitsToKbps(format.bitrate, { path: ["outputFormat"], warn: ctx.warn }));
  // The suffixed kbps string Stable Audio's own default (`"192k"`) is written
  // in — the only bitrate spelling in this roster, so it is inlined here rather
  // than carried as a row field nothing else would ever set.
  if (kbps !== undefined) write(body, bitrateWire, `${kbps}k`);
}

/**
 * The fal sound-effects adapter.
 *
 * `models` is the curated roster, so a ref outside it draws `unknown_model`
 * from the kernel and then compiles with no row — the refusals above stand down
 * and the request goes to `fal.sfx`'s own IR.
 */
export const sfx = {
  category: "sfx",
  provider: "fal",
  models: MODELS,
  modelParams: FAL_SFX_MODEL_PARAMS,
  compile(input: SfxParams, ctx: CompileContext<SfxParams>): CompiledCall<FalSfxWire, FalSfxResult> {
    const body: FalSfxWire = { endpoint: ctx.model };
    const row = ROWS[ctx.model];

    const textWire = row?.textWire ?? "prompt";
    ctx.from([textWire], "prompt");
    write(body, textWire, input.prompt);

    applyLength(input, body, row, ctx);
    applyFormat(input, body, row, ctx);

    applyExtras(input, FAL_SFX_MODEL_PARAMS, body, ctx);
    return { params: body, validate: validator.safe as FalSfxValidate };
  },
} as const satisfies AnySfxAdapter;
