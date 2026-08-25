/**
 * `unmodel/stt` → fal, across 6 endpoints.
 *
 * # `audioInputs` is `["url", "data"]`, and that is the wire
 *
 * fal has no multipart transcription route. Every endpoint here declares one
 * string parameter for the recording, and what may go in it is an https URL fal
 * fetches or a `data:` URI carrying the bytes inline. There is no `Blob` arm to
 * offer and no upload endpoint to point at, so a `File` handed to this adapter
 * is refused at the keystroke by `AudioNarrowing` rather than compiled into
 * something that would 422.
 *
 * # `timestamps` is `never` at five of the six, and that is honest
 *
 * ElevenLabs Scribe returns word timings on every response and offers no switch
 * to turn them off; fal's own ASR returns what it returns. Only
 * `fal-ai/wizper` publishes a `chunk_level` a caller can set, and its enum has
 * one member (`"segment"`, a `const` in the schema). So five rows carry
 * `timestamps: []`, which types the field as `never` — "this route does not
 * take the question" — and the one that does takes exactly one answer.
 *
 * That is the AssemblyAI treatment, one provider over: refusing `"word"` at a
 * route that always returns word timings would be a lie about what it does, and
 * accepting it silently would be a lie about what the request said.
 *
 * # `diarization` exists at two endpoints and is a bare boolean there
 *
 * `diarize` at the two ElevenLabs Scribe generations, and nowhere else. The
 * canonical word carries a speaker COUNT as well as a switch, and no route in
 * this category has a field for one — so `{ speakers: 3 }` is an
 * `unsupported_param` at `diarization.speakers` rather than a value that goes
 * nowhere. `resolveDiarization` is what turns that into one message for the
 * whole library.
 *
 * # Two adapter-wide `unsupported` entries, and only two
 *
 * Risk R7 says a per-model fact belongs on a row, and `language` (four of six)
 * and `diarize` (two of six) are exactly that — both are refused per endpoint,
 * counting the siblings that do take them.
 *
 * `prompt` and `languages` are the exception, and they earn it: NO fal
 * transcription endpoint takes a vocabulary hint or a candidate shortlist, so a
 * provider-wide claim is true rather than convenient. The closest thing in the
 * roster is Scribe v2's `keyterms`, which is a LIST of terms rather than prose
 * and keeps its own meaning through `providerOptions`.
 */

import {
  applyExtras,
  resolveAudioInput,
  resolveDiarization,
  toPrimaryLanguage,
  toTimestampGranularity,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { SttParamsFor, TimestampGranularity } from "../../core/unified/vocabulary/stt";
import type { SttAdapterFor } from "../../core/unified/vocabulary/stt";
import { stt as validator } from "./stt";
import { FAL_STT_MODEL_PARAMS, MODELS } from "./stt-params";
import { FAL_DOC_URLS } from "./gen/endpoints.gen";

/** The generated row shape, as this file reads it. */
interface FalSttRow {
  readonly keys: readonly string[];
  readonly audioWire?: string;
  readonly languageWire?: string;
  readonly languageOpen?: true;
  readonly languages?: readonly string[];
  readonly languageValues?: Readonly<Record<string, string>>;
  readonly timestamps?: readonly string[];
  readonly timestampValues?: Readonly<Record<string, string>>;
  readonly diarizeWire?: string;
}

const ROWS = FAL_STT_MODEL_PARAMS as Readonly<Record<string, FalSttRow>>;

/** The two shapes a recording may arrive in at this provider. */
const AUDIO_INPUTS = ["url", "data"] as const;

/** What this adapter's `compile` is written against. */
type FalSttParams = SttParamsFor<(typeof AUDIO_INPUTS)[number]>;

/**
 * The wire body this adapter compiles to. No index-signature tail — see
 * `FalImageWire`. Per-model extras (`task`, `use_pnc`, `keyterms`,
 * `max_new_tokens`, `chunk_level`, `merge_chunks`, …) reach the body through
 * `applyExtras`.
 */
export interface FalSttWire {
  /** The route selector, stripped into `.request.url` by `fal.stt`. */
  endpoint: string;
  audio_url?: string;
  language?: string;
  language_code?: string;
  diarize?: boolean;
}

/** What a unified call to `fal/…` returns: `fal.stt`'s own `Validated`. */
export type FalSttResult = ReturnType<typeof validator>;

/** See `./unified-image.ts`: `CompiledCall.validate` is not generic, and cannot be. */
type FalSttValidate = CompiledCall<FalSttWire, FalSttResult>["validate"];

function docs(model: string): string | undefined {
  return FAL_DOC_URLS[model as keyof typeof FAL_DOC_URLS];
}

/** See `unified-upscale.ts`: the confined cast a row-named wire key costs. */
function write(body: FalSttWire, wire: string, value: string | boolean): void {
  (body as unknown as Record<string, unknown>)[wire] = value;
}

/** The endpoints whose row declares a given field, for a refusal that counts. */
function takers(pick: (row: FalSttRow) => unknown): number {
  return Object.keys(ROWS).filter((id) => {
    const row = ROWS[id];
    return row !== undefined && pick(row) !== undefined;
  }).length;
}

function applyLanguage(
  input: FalSttParams,
  body: FalSttWire,
  row: FalSttRow | undefined,
  ctx: CompileContext<FalSttParams>,
): void {
  if (input.language === undefined) return;
  const wire = row?.languageWire ?? "language";
  ctx.from([wire], "language");

  if (row !== undefined && row.languageWire === undefined) {
    ctx.fail({
      code: "unsupported_param",
      path: ["language"],
      message:
        `"${ctx.model}" detects the language and declares no field to assert one, so \`language\` has ` +
        `nothing to become. ${takers((r) => r.languageWire)} of the ${Object.keys(ROWS).length} fal ` +
        "transcription endpoints do take one.",
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
    // `languageOpen` — ElevenLabs takes any BCP-47 code.
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
        `"${ctx.model}" does not transcribe ${primary}. Its \`${wire}\` is a closed enum covering ` +
        `${offered.length} language${offered.length === 1 ? "" : "s"}.`,
      meta: { allowed: [...offered], value: primary, wire, source: docs(ctx.model) },
    });
    return;
  }
  write(body, wire, spelling);
}

function applyTimestamps(
  input: FalSttParams,
  body: FalSttWire,
  row: FalSttRow | undefined,
  ctx: CompileContext<FalSttParams>,
): void {
  if (input.timestamps === undefined) return;
  const offered = (row?.timestamps ?? []) as readonly TimestampGranularity[];
  const wire = Object.keys(row?.timestampValues ?? {}).length > 0 ? "chunk_level" : undefined;
  if (wire !== undefined) ctx.from([wire], "timestamps");

  // `"none"` resolves to `undefined` and compiles to nothing — which is the
  // right answer everywhere here, because no fal route can be told to stop
  // returning timings it produces anyway.
  const granularity = ctx.take(
    toTimestampGranularity(
      input.timestamps,
      offered,
      { path: ["timestamps"], warn: ctx.warn },
      docs(ctx.model) === undefined ? {} : { source: docs(ctx.model) as string },
    ),
  );
  if (granularity === undefined || wire === undefined) return;
  const spelling = row?.timestampValues?.[granularity];
  if (spelling !== undefined) write(body, wire, spelling);
}

function applyDiarization(
  input: FalSttParams,
  body: FalSttWire,
  row: FalSttRow | undefined,
  ctx: CompileContext<FalSttParams>,
): void {
  if (input.diarization === undefined) return;
  const wire = row?.diarizeWire ?? "diarize";
  ctx.from([wire], "diarization");

  if (row !== undefined && row.diarizeWire === undefined) {
    ctx.fail({
      code: "unsupported_param",
      path: ["diarization"],
      message:
        `"${ctx.model}" declares no speaker-diarization switch, so \`diarization\` has nothing to ` +
        `become. ${takers((r) => r.diarizeWire)} of the ${Object.keys(ROWS).length} fal transcription ` +
        "endpoints do take one (both ElevenLabs Scribe generations).",
      meta: { source: docs(ctx.model), declared: [...row.keys] },
    });
    return;
  }

  // `diarize` is a bare boolean at both Scribe generations and there is no
  // companion count field anywhere in this category — so every count is an
  // `unsupported_param` at its own canonical path rather than a value that goes
  // nowhere. `resolveDiarization` is what turns "this provider has no
  // `speakers` field" into that message, once, for the whole library.
  const resolved = ctx.take(
    resolveDiarization(
      input.diarization,
      docs(ctx.model) === undefined ? {} : { source: docs(ctx.model) as string },
      { path: ["diarization"], warn: ctx.warn },
    ),
  );
  if (resolved !== undefined) write(body, wire, resolved.enabled);
}

/**
 * The fal transcription adapter.
 *
 * `models` is the curated roster, so a ref outside it draws `unknown_model`
 * from the kernel and then compiles with no row — the refusals above stand down
 * and the request goes to `fal.stt`'s own IR.
 */
export const stt = {
  category: "stt",
  provider: "fal",
  models: MODELS,
  modelParams: FAL_STT_MODEL_PARAMS,
  audioInputs: AUDIO_INPUTS,
  unsupported: {
    prompt:
      "no fal transcription endpoint takes a vocabulary hint or a prior transcript. The closest thing " +
      "in the roster is Scribe v2's `keyterms`, which is a LIST of terms rather than prose — send it " +
      "through `providerOptions.fal` so it keeps its own meaning.",
    languages:
      "fal's transcription routes assert a single language or detect one; none takes a candidate " +
      "shortlist to choose from. Use `language` to assert one.",
  },
  compile(
    input: FalSttParams,
    ctx: CompileContext<FalSttParams>,
  ): CompiledCall<FalSttWire, FalSttResult> {
    const body: FalSttWire = { endpoint: ctx.model };
    const row = ROWS[ctx.model];

    const audioWire = row?.audioWire ?? "audio_url";
    ctx.from([audioWire], "audio");
    const audio = ctx.take(
      resolveAudioInput(input.audio, AUDIO_INPUTS, { path: ["audio"], warn: ctx.warn }, {
        ...(docs(ctx.model) === undefined ? {} : { source: docs(ctx.model) as string }),
        hint: "fal fetches files by reference: pass `{ url }`, or `{ data, mimeType }` for a `data:` URI.",
      }),
    );
    if (audio?.kind === "url") write(body, audioWire, audio.url);
    else if (audio?.kind === "data") {
      write(
        body,
        audioWire,
        audio.data.startsWith("data:")
          ? audio.data
          : `data:${audio.mimeType ?? "audio/mpeg"};base64,${audio.data}`,
      );
    }

    applyLanguage(input, body, row, ctx);
    applyTimestamps(input, body, row, ctx);
    applyDiarization(input, body, row, ctx);

    applyExtras(input, FAL_STT_MODEL_PARAMS, body, ctx);
    return { params: body, validate: validator.safe as FalSttValidate };
  },
} as const satisfies SttAdapterFor<
  (typeof AUDIO_INPUTS)[number],
  typeof FAL_STT_MODEL_PARAMS,
  FalSttWire,
  FalSttResult
>;
