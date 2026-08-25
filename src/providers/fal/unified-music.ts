/**
 * `unmodel/music` → fal, across 10 endpoints.
 *
 * # The length has four spellings and one of them is milliseconds
 *
 * `duration` at MiniMax Music 3, ACE-Step and Stable Audio 3; `seconds_total`
 * at Stable Audio 2.5; `music_duration` at DiffRhythm, where it is a two-member
 * string enum (`"95s" | "285s"`); and `music_length_ms` at ElevenLabs Music.
 * The row states the wire name AND the unit, so the adapter multiplies by a
 * thousand exactly where it should and nowhere else. This is the reason the
 * canonical word is `durationSeconds` rather than `duration`, argued from the
 * one provider that makes both mistakes available.
 *
 * # `prompt` is not always the prompt
 *
 * ACE-Step calls it `tags` — a comma-separated style list — and DiffRhythm
 * calls it `lyrics`, because DiffRhythm turns lyrics into a song and its
 * `style_prompt` is the decoration. The curated `textParam` records which, and
 * this adapter writes the canonical `prompt` to whichever name the row names.
 *
 * Two endpoints (`minimax/music-3`, `fal-ai/minimax-music/v2`) REQUIRE a second
 * text field beside the prompt, and unmodel does not invent one: a prompt-only
 * request is refused by `fal.music`'s own required check, naming the field. The
 * alternative is shipping an empty string and letting the model sing nothing.
 *
 * # `outputFormat` is refused at eight of the ten
 *
 * Most of these endpoints answer a fixed encoding and have no field to change
 * it. The two that do are opposites: Stable Audio 3 Medium takes a bare codec
 * enum, and ElevenLabs Music takes a COMPOSITE (`mp3_44100_128`) that states a
 * codec, a sample rate and sometimes a bitrate at once. The row narrows only
 * the codec half — the legal triples are not a cross product — so a caller who
 * asks for a specific sample rate is refused rather than given the composite's
 * one.
 *
 * # There is no adapter-wide `unsupported`
 *
 * Risk R7. `seed` exists at six of the ten, a length field at six, an
 * instrumental switch at two. A provider-wide claim would be false at the
 * majority of fal's own music endpoints.
 */

import {
  applyExtras,
  resolveAudioFormat,
  toMilliseconds,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { AudioFormatCodec } from "../../core/unified/vocabulary/audio";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { AnyMusicAdapter, MusicParams } from "../../core/unified/vocabulary/music";
import { music as validator } from "./music";
import { FAL_MUSIC_MODEL_PARAMS, MODELS } from "./music-params";
import { FAL_DOC_URLS } from "./gen/endpoints.gen";

/** The generated row shape, as this file reads it. */
interface FalMusicRow {
  readonly keys: readonly string[];
  readonly textWire?: string;
  readonly lengthWire?: string;
  readonly lengthUnit?: "ms";
  readonly lengths?: readonly number[];
  readonly lengthValues?: Readonly<Record<string, string | number>>;
  readonly instrumentalWire?: string;
  readonly formatWire?: string;
  readonly codecs?: readonly string[];
  readonly codecValues?: Readonly<Record<string, string>>;
  readonly bounds?: Readonly<Record<string, { readonly min?: number; readonly max?: number }>>;
}

const ROWS = FAL_MUSIC_MODEL_PARAMS as Readonly<Record<string, FalMusicRow>>;

/**
 * The wire body this adapter compiles to. No index-signature tail — see
 * `FalImageWire`. Per-model extras (`lyrics`, `negative_prompt`,
 * `guidance_scale`, `audio_setting`, `composition_plan`, …) reach the body
 * through `applyExtras`.
 */
export interface FalMusicWire {
  /** The route selector, stripped into `.request.url` by `fal.music`. */
  endpoint: string;
  prompt?: string;
  tags?: string;
  lyrics?: string;
  seed?: number;
}

/** What a unified call to `fal/…` returns: `fal.music`'s own `Validated`. */
export type FalMusicResult = ReturnType<typeof validator>;

/** See `./unified-image.ts`: `CompiledCall.validate` is not generic, and cannot be. */
type FalMusicValidate = CompiledCall<FalMusicWire, FalMusicResult>["validate"];

function docs(model: string): string | undefined {
  return FAL_DOC_URLS[model as keyof typeof FAL_DOC_URLS];
}

/** See `unified-upscale.ts`: the confined cast a row-named wire key costs. */
function write(body: FalMusicWire, wire: string, value: string | number | boolean): void {
  (body as unknown as Record<string, unknown>)[wire] = value;
}

/** The endpoints whose row declares a given field, for a refusal that counts. */
function takers(pick: (row: FalMusicRow) => unknown): number {
  return Object.keys(ROWS).filter((id) => {
    const row = ROWS[id];
    return row !== undefined && pick(row) !== undefined;
  }).length;
}

/** See `unified-tts.ts`: this endpoint's own encoding capabilities, from its row. */
function formatSpec(row: Pick<FalMusicRow, "codecValues"> | undefined, model: string): AudioFormatSpec {
  return {
    codecs: (row?.codecValues ?? {}) as Readonly<Partial<Record<AudioFormatCodec, string>>>,
    // The two endpoints with a format field carry either a bare codec (Stable
    // Audio 3) or a composite whose legal (codec, rate, bitrate) triples are not
    // a cross product (ElevenLabs Music). Neither lets a caller pick the numeric
    // halves independently, so both are refused rather than approximated.
    unavailable: ["sampleRate", "bitrate"],
    ...(docs(model) === undefined ? {} : { source: docs(model) as string }),
  };
}

function applyLength(
  input: MusicParams,
  body: FalMusicWire,
  row: FalMusicRow | undefined,
  ctx: CompileContext<MusicParams>,
): void {
  if (input.durationSeconds === undefined) return;
  const wire = row?.lengthWire;
  ctx.from([wire ?? "duration"], "durationSeconds");

  if (row === undefined) {
    write(body, "duration", input.durationSeconds);
    return;
  }
  if (wire === undefined) {
    ctx.fail({
      code: "unsupported_param",
      path: ["durationSeconds"],
      message:
        `"${ctx.model}" decides how long the track is and declares no length parameter, so ` +
        `\`durationSeconds\` has nothing to become. ${takers((r) => r.lengthWire)} of the ` +
        `${Object.keys(ROWS).length} fal music endpoints do take one.`,
      meta: { source: docs(ctx.model), declared: [...row.keys] },
    });
    return;
  }

  // A closed set of lengths — DiffRhythm's `"95s" | "285s"`.
  const offered = row.lengths;
  if (offered !== undefined && offered.length > 0) {
    const spelling = row.lengthValues?.[String(input.durationSeconds)];
    if (spelling === undefined) {
      ctx.fail({
        code: "invalid_enum_value",
        path: ["durationSeconds"],
        message:
          `"${ctx.model}" generates ${offered.join(" or ")} seconds and nothing between; got ` +
          `${input.durationSeconds}. The list is this endpoint's own closed enum, so the nearest ` +
          "length is a different request rather than a rounding.",
        meta: { allowed: [...offered], value: input.durationSeconds, wire, source: docs(ctx.model) },
      });
      return;
    }
    write(body, wire, spelling);
    return;
  }

  if (row.lengthUnit === "ms") {
    // Silent, and lossless: `toMilliseconds` refuses a value that would need a
    // fractional millisecond rather than rounding one.
    const ms = ctx.take(
      toMilliseconds(input.durationSeconds, { path: ["durationSeconds"], warn: ctx.warn }),
    );
    if (ms !== undefined) write(body, wire, ms);
    return;
  }
  write(body, wire, input.durationSeconds);
}

function applyInstrumental(
  input: MusicParams,
  body: FalMusicWire,
  row: FalMusicRow | undefined,
  ctx: CompileContext<MusicParams>,
): void {
  if (input.instrumental === undefined) return;
  const wire = row?.instrumentalWire ?? "is_instrumental";
  ctx.from([wire], "instrumental");
  if (row !== undefined && row.instrumentalWire === undefined) {
    ctx.fail({
      code: "unsupported_param",
      path: ["instrumental"],
      message:
        `"${ctx.model}" declares no instrumental switch, so \`instrumental\` has nothing to become. ` +
        `${takers((r) => r.instrumentalWire)} of the ${Object.keys(ROWS).length} fal music endpoints ` +
        "do take one; at the rest, whether there are vocals is something the prompt says.",
      meta: { source: docs(ctx.model), declared: [...row.keys] },
    });
    return;
  }
  write(body, wire, input.instrumental);
}

function applyFormat(
  input: MusicParams,
  body: FalMusicWire,
  row: FalMusicRow | undefined,
  ctx: CompileContext<MusicParams>,
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
        `\`outputFormat\` has nothing to become. ${takers((r) => r.formatWire)} of the ` +
        `${Object.keys(ROWS).length} fal music endpoints let you choose.`,
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
  if (format !== undefined) write(body, wire, format.wire);
}

/**
 * The fal music adapter.
 *
 * `models` is the curated roster, so a ref outside it draws `unknown_model`
 * from the kernel and then compiles with no row — the refusals above stand down
 * and the request goes to `fal.music`'s own IR.
 */
export const music = {
  category: "music",
  provider: "fal",
  models: MODELS,
  modelParams: FAL_MUSIC_MODEL_PARAMS,
  compile(
    input: MusicParams,
    ctx: CompileContext<MusicParams>,
  ): CompiledCall<FalMusicWire, FalMusicResult> {
    const body: FalMusicWire = { endpoint: ctx.model };
    const row = ROWS[ctx.model];

    const textWire = row?.textWire ?? "prompt";
    ctx.from([textWire], "prompt");
    write(body, textWire, input.prompt);

    applyLength(input, body, row, ctx);
    applyInstrumental(input, body, row, ctx);
    applyFormat(input, body, row, ctx);

    if (input.seed !== undefined) {
      ctx.from(["seed"], "seed");
      if (row === undefined || row.keys.includes("seed")) body.seed = input.seed;
      else {
        ctx.fail({
          code: "unsupported_param",
          path: ["seed"],
          message:
            `"${ctx.model}" declares no \`seed\` parameter, so \`seed\` has nothing to become. ` +
            `${Object.keys(ROWS).filter((id) => ROWS[id]?.keys.includes("seed") === true).length} of ` +
            `the ${Object.keys(ROWS).length} fal music endpoints do take one.`,
          meta: { wire: "seed", source: docs(ctx.model), declared: [...row.keys] },
        });
      }
    }

    applyExtras(input, FAL_MUSIC_MODEL_PARAMS, body, ctx);
    return { params: body, validate: validator.safe as FalMusicValidate };
  },
} as const satisfies AnyMusicAdapter;
