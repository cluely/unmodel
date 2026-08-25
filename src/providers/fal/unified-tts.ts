/**
 * `unmodel/tts` → fal, across 23 endpoints.
 *
 * The widest per-model surface in the library, and the reason is that fal is a
 * queue in front of ten different speech vendors. Every canonical word in this
 * category lands somewhere different depending on the ref, so this adapter
 * reads five wire names off the generated row and hard-codes none of them.
 *
 * # The text has two names and the row says which
 *
 * Fourteen endpoints call it `text`; nine — Kokoro, Gemini and MiniMax's 2.8
 * generation — call it `prompt`, which everywhere else in this library means "a
 * description of what to make". Both are plain required strings, so no rule
 * reads the difference off a schema: it is curated per id in
 * `data/fal/curation.json` and arrives here as `textWire`.
 *
 * `fal-ai/qwen-3-tts/text-to-speech/1.7b` declares BOTH and means different
 * things by them — `text` is spoken and `prompt` is a style instruction — so
 * its `prompt` is a per-model extra and its `textWire` is `text`.
 *
 * # `voice` is a list at fourteen endpoints and a free string at six
 *
 * Kokoro publishes nine different arrays, one per language, ranging from twenty
 * voices to one (`fal-ai/kokoro/french` has a `const "ff_siwis"`). Gemini,
 * Inworld, xAI, ByteDance and Qwen publish theirs. ElevenLabs and Chatterbox do
 * not, because their catalogs are per-account and include clones — so those
 * rows carry no `voices` and the canonical `voice` keeps its wide type, exactly
 * as `TtsModelParams` describes.
 *
 * MiniMax has no flat voice field at all: its voice is `voice_setting.voice_id`,
 * one level down, and unmodel does not flatten objects into canonical words. So
 * `voice` there is refused by name and pointed at `providerOptions`.
 *
 * # `language` needs a translation table, not a passthrough
 *
 * ElevenLabs takes any BCP-47 code, so its row says `languageOpen` and the
 * value goes through `toPrimaryLanguage` and out. Everyone else publishes an
 * ENUM — of bare subtags at xAI, of capitalised names at MiniMax
 * (`"Portuguese"`), of names with countries at Gemini (`"Portuguese (Brazil)"`)
 * — and the generator has already mapped each of those back to a primary
 * subtag. So the caller writes `"pt-BR"`, `toPrimaryLanguage` reports the
 * dropped region, and `languageValues["pt"]` supplies whichever of the four
 * spellings this endpoint wants.
 *
 * # `outputFormat` is refused at eighteen endpoints, three different ways
 *
 * `codecs: []` means "no flat codec field" and it happens for three unrelated
 * reasons: Kokoro has no format parameter at all, `xai/tts/v1` spells its
 * format as an OBJECT (`{ codec, sample_rate, bit_rate }`), and MiniMax's
 * `output_format` is `url | hex` — a DELIVERY switch wearing a codec's name.
 * The refusal names which of the three it is, because the fix differs.
 *
 * # There is no adapter-wide `unsupported`
 *
 * Risk R7. `speed` exists at thirteen of the twenty-three and `voice` at
 * twenty-one; a provider-wide "fal speech has no speed" would be false at more
 * than half of fal's own speech endpoints. Every refusal here names the
 * endpoint and counts its siblings.
 */

import {
  applyExtras,
  resolveAudioFormat,
  resolveVoice,
  toPrimaryLanguage,
  toSpeed,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { AudioFormatCodec } from "../../core/unified/vocabulary/audio";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { AnyTtsAdapter, TtsParams } from "../../core/unified/vocabulary/tts";
import { tts as validator } from "./tts";
import { FAL_TTS_DELIVERY, FAL_TTS_MODEL_PARAMS, MODELS } from "./tts-params";
import { FAL_DOC_URLS } from "./gen/endpoints.gen";

/** The generated row shape, as this file reads it. */
interface FalTtsRow {
  readonly keys: readonly string[];
  readonly textWire?: string;
  readonly voiceWire?: string;
  readonly voices?: readonly string[];
  readonly speedWire?: string;
  readonly languageWire?: string;
  readonly languageOpen?: true;
  readonly languages?: readonly string[];
  readonly languageValues?: Readonly<Record<string, string>>;
  readonly formatWire?: string;
  readonly codecs?: readonly string[];
  readonly codecValues?: Readonly<Record<string, string>>;
  readonly bounds?: Readonly<Record<string, { readonly min?: number; readonly max?: number }>>;
}

const ROWS = FAL_TTS_MODEL_PARAMS as Readonly<Record<string, FalTtsRow>>;

/**
 * The wire body this adapter compiles to.
 *
 * No index-signature tail, for `FalImageWire`'s measured reason. Every field
 * below is written under a name the ROW chose, so they all go through
 * {@link write}; per-model extras reach the body through `applyExtras`.
 */
export interface FalTtsWire {
  /** The route selector, stripped into `.request.url` by `fal.tts`. */
  endpoint: string;
  text?: string;
  prompt?: string;
  voice?: string;
  speed?: number;
}

/** What a unified call to `fal/…` returns: `fal.tts`'s own `Validated`. */
export type FalTtsResult = ReturnType<typeof validator>;

/** See `./unified-image.ts`: `CompiledCall.validate` is not generic, and cannot be. */
type FalTtsValidate = CompiledCall<FalTtsWire, FalTtsResult>["validate"];

function docs(model: string): string | undefined {
  return FAL_DOC_URLS[model as keyof typeof FAL_DOC_URLS];
}

/** See `unified-upscale.ts`: the confined cast a row-named wire key costs. */
function write(body: FalTtsWire, wire: string, value: string | number): void {
  (body as unknown as Record<string, unknown>)[wire] = value;
}

/** The endpoints whose row declares `wire`, for a refusal that counts rather than claims. */
function takers(pick: (row: FalTtsRow) => unknown): number {
  return Object.keys(ROWS).filter((id) => {
    const row = ROWS[id];
    return row !== undefined && pick(row) !== undefined;
  }).length;
}

/**
 * This endpoint's own encoding capabilities, as an {@link AudioFormatSpec}.
 *
 * Built per call from the generated row rather than transcribed by hand,
 * because at 23 endpoints a hand table would be 23 transcriptions to keep in
 * step with a weekly refresh. `unavailable` is endpoint-wide: fal's
 * `output_format` carries a bare codec everywhere it carries one at all, and
 * the sample rate — where an endpoint has one — is a SEPARATE wire field
 * (`sample_rate`, `sample_rate_hertz`) reachable as a per-model extra.
 */
function formatSpec(row: Pick<FalTtsRow, "codecValues"> | undefined, model: string): AudioFormatSpec {
  return {
    codecs: (row?.codecValues ?? {}) as Readonly<Partial<Record<AudioFormatCodec, string>>>,
    unavailable: ["sampleRate", "bitrate"],
    ...(docs(model) === undefined ? {} : { source: docs(model) as string }),
  };
}

function applyVoice(
  input: TtsParams,
  body: FalTtsWire,
  row: FalTtsRow | undefined,
  ctx: CompileContext<TtsParams>,
): void {
  if (input.voice === undefined) return;
  const wire = row?.voiceWire ?? "voice";
  ctx.from([wire], "voice");
  if (row !== undefined && row.voiceWire === undefined) {
    ctx.fail({
      code: "unsupported_param",
      path: ["voice"],
      message:
        `"${ctx.model}" has no top-level voice parameter — it selects a speaker inside a nested object ` +
        "(`voice_setting.voice_id` at MiniMax), and unmodel does not flatten a wire object into a " +
        "canonical word. Set it with `providerOptions: { fal: { voice_setting: { voice_id: … } } }`, " +
        `where the value is typed from this endpoint's own interface. ${takers((r) => r.voiceWire)} of ` +
        `the ${Object.keys(ROWS).length} fal speech endpoints do take a flat one.`,
      meta: { source: docs(ctx.model), declared: [...row.keys] },
    });
    return;
  }
  // Both spellings: fal voices are opaque ids at some vendors (`af_heart`) and
  // human names at others (`Kore`), and no endpoint distinguishes the two.
  const voice = ctx.take(
    resolveVoice(
      input.voice,
      { accepts: ["id", "name"], ...(docs(ctx.model) === undefined ? {} : { source: docs(ctx.model) as string }) },
      { path: ["voice"], warn: ctx.warn },
    ),
  );
  if (voice !== undefined) write(body, wire, voice.value);
}

function applySpeed(
  input: TtsParams,
  body: FalTtsWire,
  row: FalTtsRow | undefined,
  ctx: CompileContext<TtsParams>,
): void {
  if (input.speed === undefined) return;
  const wire = row?.speedWire ?? "speed";
  ctx.from([wire], "speed");
  if (row !== undefined && row.speedWire === undefined) {
    ctx.fail({
      code: "unsupported_param",
      path: ["speed"],
      message:
        `"${ctx.model}" declares no speaking-rate parameter, so \`speed\` has nothing to become. ` +
        `${takers((r) => r.speedWire)} of the ${Object.keys(ROWS).length} fal speech endpoints do take ` +
        "one; pace this model through the text instead.",
      meta: { source: docs(ctx.model), declared: [...row.keys] },
    });
    return;
  }
  // A plain multiplier at every fal endpoint that has one — no reciprocal, no
  // percentage delta — so the bounds are the only thing to apply, read from
  // this endpoint's own schema.
  const bound = row?.bounds?.[wire];
  const speed = ctx.take(
    toSpeed(
      input.speed,
      {
        ...(bound?.min === undefined ? {} : { min: bound.min }),
        ...(bound?.max === undefined ? {} : { max: bound.max }),
        ...(docs(ctx.model) === undefined ? {} : { source: docs(ctx.model) as string }),
      },
      { path: ["speed"], warn: ctx.warn },
    ),
  );
  if (speed !== undefined) write(body, wire, speed);
}

function applyLanguage(
  input: TtsParams,
  body: FalTtsWire,
  row: FalTtsRow | undefined,
  ctx: CompileContext<TtsParams>,
): void {
  if (input.language === undefined) return;
  const wire = row?.languageWire ?? "language";
  ctx.from([wire], "language");

  if (row !== undefined && row.languageWire === undefined) {
    ctx.fail({
      code: "unsupported_param",
      path: ["language"],
      message:
        `"${ctx.model}" declares no language parameter — it speaks whatever the text is in, or one ` +
        `language only. ${takers((r) => r.languageWire)} of the ${Object.keys(ROWS).length} fal speech ` +
        "endpoints take one. (The nine Kokoro endpoints are per-language: the ref IS the language.)",
      meta: { source: docs(ctx.model), declared: [...row.keys] },
    });
    return;
  }

  const primary = ctx.take(
    toPrimaryLanguage(
      input.language,
      { path: ["language"], warn: ctx.warn },
      docs(ctx.model) === undefined ? {} : { source: docs(ctx.model) as string },
    ),
  );
  if (primary === undefined) return;

  const values = row?.languageValues;
  if (values === undefined) {
    // `languageOpen` — any BCP-47 code, nothing to map through.
    write(body, wire, primary);
    return;
  }
  const spelling = values[primary];
  if (spelling === undefined) {
    const offered = row?.languages ?? [];
    ctx.fail({
      code: "invalid_enum_value",
      path: ["language"],
      message:
        `"${ctx.model}" does not offer ${primary}. Its \`${wire}\` is a closed enum covering ` +
        `${offered.length} language${offered.length === 1 ? "" : "s"}.`,
      meta: { allowed: [...offered], value: primary, wire, source: docs(ctx.model) },
    });
    return;
  }
  // fal spells the same language four different ways across this roster — `"en"`,
  // `"English"`, `"English (US)"`, `"english"` — and the row is what maps back.
  write(body, wire, spelling);
}

function applyFormat(
  input: TtsParams,
  body: FalTtsWire,
  row: FalTtsRow | undefined,
  ctx: CompileContext<TtsParams>,
): void {
  if (input.outputFormat === undefined) return;
  const wire = row?.formatWire ?? "output_format";
  ctx.from([wire], "outputFormat");

  if (row !== undefined && (row.codecs === undefined || row.codecs.length === 0)) {
    ctx.fail({
      code: "unsupported_param",
      path: ["outputFormat"],
      message:
        `"${ctx.model}" gives no choice of encoding: ` +
        (row.formatWire === undefined
          ? "it declares no output-format parameter at all, and answers whatever it answers."
          : "its `output_format` is not a codec — at MiniMax it is `url | hex`, which decides how the " +
            "audio is DELIVERED, and at xAI it is an object with `codec`, `sample_rate` and `bit_rate` " +
            "inside it. Set it through `providerOptions: { fal: { output_format: … } }`, where the value " +
            "is typed from this endpoint's own interface."),
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
 * The fal speech adapter.
 *
 * `models` is the curated roster, so a ref outside it draws `unknown_model`
 * from the kernel and then compiles with no row — the refusals above stand down
 * and the request goes to `fal.tts`'s own IR.
 */
export const tts = {
  category: "tts",
  provider: "fal",
  models: MODELS,
  modelParams: FAL_TTS_MODEL_PARAMS,
  delivery: FAL_TTS_DELIVERY,
  compile(input: TtsParams, ctx: CompileContext<TtsParams>): CompiledCall<FalTtsWire, FalTtsResult> {
    const body: FalTtsWire = { endpoint: ctx.model };
    const row = ROWS[ctx.model];

    const textWire = row?.textWire ?? "text";
    ctx.from([textWire], "text");
    write(body, textWire, input.text);

    applyVoice(input, body, row, ctx);
    applySpeed(input, body, row, ctx);
    applyLanguage(input, body, row, ctx);
    applyFormat(input, body, row, ctx);

    applyExtras(input, FAL_TTS_MODEL_PARAMS, body, ctx);
    return { params: body, validate: validator.safe as FalTtsValidate };
  },
} as const satisfies AnyTtsAdapter;
