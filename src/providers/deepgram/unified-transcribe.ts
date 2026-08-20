/**
 * `unmodel/transcribe` → `deepgram.transcribe` (POST /v1/listen).
 *
 * The query-string end of the category: only `url` is a body field, and every
 * option rides in `.request.url`. The provider validator does that split, so
 * this adapter writes ordinary params and declares provenance.
 *
 * `audioInputs` is `["url"]`, which is the wire and not a simplification: the
 * local-file form of this endpoint is *raw audio bytes as the HTTP body* with
 * an audio content-type — not a multipart part and not a JSON field — so there
 * is nothing for a `Blob` to compile *to*. `deepgram.transcribe` documents that
 * path (post your bytes to `.request.url` yourself), and the canonical
 * `{ file }` deliberately does not pretend to be it.
 *
 * The timestamp mapping is the one line worth defending. /v1/listen returns
 * word timings unconditionally and offers exactly one timing switch,
 * `utterances`, which groups those words into segments. So `"segment"` is
 * `utterances: true` and `"word"` is `utterances: false` — the request states
 * the granularity it wants rather than leaning on a default the caller cannot
 * see, and the two are distinguishable on the wire, which is what keeps the
 * no-silent-drop guarantee true for this cell.
 */
import {
  applyExtras,
  EXTRA,
  resolveAudioInput,
  resolveDiarization,
  toTimestampGranularity,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  TranscribeAdapterFor,
  TranscribeModelParamTable,
  TranscribeParamsFor,
} from "../../core/unified/vocabulary/transcribe";
import {
  transcribe as validator,
  type DeepgramListenEncoding,
  type DeepgramRedact,
  type ListenParams,
} from "./transcribe";
import { sttModels } from "./models";

/**
 * Every pre-recorded STT id, read off the hand catalog rather than copied, so
 * the ref union, the `unknown_model` warning and the catalog cannot drift.
 *
 * The Flux ids are excluded in the type as well as at runtime: they are served
 * by the /v2/listen WebSocket alone, and `deepgram.transcribe`'s own
 * `checkFluxNotPreRecorded` says so — a ref that cannot work should not
 * autocomplete.
 */
const MODELS = Object.keys(sttModels).filter((id) => !id.startsWith("flux-")) as readonly Exclude<
  keyof typeof sttModels,
  `flux-${string}`
>[];

const LISTEN_DOCS = "https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded";

/** The wire params this adapter compiles to (body `{url}` + query params). */
export type DeepgramTranscribeWire = ListenParams;

/** What a unified call to `deepgram/…` returns. */
export type DeepgramTranscribeResult = ReturnType<typeof validator>;

/**
 * Deepgram's per-model surface: 38 rows, one shared body of extras, and one key
 * that only three of them take.
 *
 * ## `timestamps`
 *
 * `["word", "segment"]` on every row, and **no `"none"`** — deliberately.
 * /v1/listen returns word timings on every response and has no switch to turn
 * them off, so `timestamps: "none"` could only ever be a request that says one
 * thing and gets another. Refusing it at the type level is the same call the
 * adapter's `toTimestampGranularity(…, ["word", "segment"])` already makes at
 * run time; `"segment"` is `utterances: true` and `"word"` is
 * `utterances: false`, so both are *stated* on the wire rather than inherited.
 *
 * ## `keyterm`, and the 35 models that ignore it
 *
 * "Keyterm Prompting is available … using the Nova-3 Models" — and on any other
 * model Deepgram **accepts the parameter and ignores it**, which is the failure
 * mode that looks like a quality regression rather than a bad request. So it is
 * declared on the three `nova-3*` ids and refused by name elsewhere, naming
 * them; `keywords` is on every row, because that is the pre-Nova-3 answer the
 * provider's own message points at.
 *
 * ## Why the table is built rather than written out
 *
 * 38 identical literals would imply a distinction the endpoint does not make —
 * one query surface serves every id — so the rows are generated from the same
 * `MODELS` array the ref union comes from, with the Nova-3 row swapped in by
 * family. The cast preserves the literal keys, which is what makes the lookup
 * hit; `satisfies` still checks the rows field by field.
 *
 * Excluded: `utterances`, `diarize`, `detect_language`, `language`, `model` and
 * `url` are canonical words' wire spellings; `callback` / `callback_method` /
 * `extra` are transport and stay on `providerOptions.deepgram`.
 */
const LISTEN_EXTRAS = {
  // Formatting
  version: EXTRA as string,
  smart_format: EXTRA as boolean,
  punctuate: EXTRA as boolean,
  paragraphs: EXTRA as boolean,
  numerals: EXTRA as boolean,
  measurements: EXTRA as boolean,
  dictation: EXTRA as boolean,
  filler_words: EXTRA as boolean,
  // Safety and substitution
  profanity_filter: EXTRA as boolean,
  redact: EXTRA as
    | DeepgramRedact
    | (string & {})
    | boolean
    | Array<DeepgramRedact | (string & {})>,
  replace: EXTRA as string | string[],
  // Vocabulary and search
  keywords: EXTRA as string | string[],
  search: EXTRA as string | string[],
  // Audio handling
  multichannel: EXTRA as boolean,
  diarize_model: EXTRA as "latest" | "v1" | "v2",
  encoding: EXTRA as DeepgramListenEncoding,
  utt_split: EXTRA as number,
  // Understanding
  detect_entities: EXTRA as boolean,
  sentiment: EXTRA as boolean,
  topics: EXTRA as boolean,
  custom_topic: EXTRA as string | string[],
  custom_topic_mode: EXTRA as "extended" | "strict",
  intents: EXTRA as boolean,
  custom_intent: EXTRA as string | string[],
  custom_intent_mode: EXTRA as "extended" | "strict",
  summarize: EXTRA as boolean | string,
  // Account
  mip_opt_out: EXTRA as boolean,
  tag: EXTRA as string | string[],
} as const;

const TIMESTAMPS = ["word", "segment"] as const;

const NOVA_3_ROW = {
  timestamps: TIMESTAMPS,
  extras: { ...LISTEN_EXTRAS, keyterm: EXTRA as string | string[] },
} as const;

const LISTEN_ROW = { timestamps: TIMESTAMPS, extras: LISTEN_EXTRAS } as const;

const DEEPGRAM_TRANSCRIBE_MODEL_PARAMS = Object.fromEntries(
  MODELS.map((model) => [model, model.startsWith("nova-3") ? NOVA_3_ROW : LISTEN_ROW]),
) as {
  // The conditional mirrors the `startsWith` above, and it has to: a cast to
  // `Record<Model, NovaRow | ListenRow>` would give *every* id the union of
  // both rows, and `keyterm` would then resolve to `never` on all 38 — a green
  // build with the one per-model fact in this table silently erased. Measured;
  // the same class of failure `AnyModelParamTable` documents.
  readonly [M in (typeof MODELS)[number]]: M extends `nova-3${string}`
    ? typeof NOVA_3_ROW
    : typeof LISTEN_ROW;
} satisfies TranscribeModelParamTable;

export const transcribe = {
  category: "transcribe",
  provider: "deepgram",
  models: MODELS,
  modelParams: DEEPGRAM_TRANSCRIBE_MODEL_PARAMS,
  audioInputs: ["url"],
  unsupported: {
    prompt:
      "/v1/listen takes no prose prompt — its nearest feature is `keyterm` (Nova-3) or " +
      "`keywords`, both of which are lists of terms rather than a sentence, so send them " +
      "through `providerOptions.deepgram` where they keep their own meaning.",
  },
  compile(
    input: TranscribeParamsFor<"url">,
    ctx: CompileContext<TranscribeParamsFor<"url">>,
  ): CompiledCall<DeepgramTranscribeWire, DeepgramTranscribeResult> {
    const body: DeepgramTranscribeWire = { model: ctx.model };
    ctx.from(["url"], "audio");
    ctx.from(["detect_language"], "languages");
    ctx.from(["diarize"], "diarization");
    ctx.from(["utterances"], "timestamps");

    const audio = ctx.take(
      resolveAudioInput(input.audio, ["url"], { path: ["audio"], warn: ctx.warn }, {
        source: LISTEN_DOCS,
        hint:
          "For local audio, POST the raw bytes to `.request.url` yourself with the file's " +
          "media type — /v1/listen has no multipart or file-id form.",
      }),
    );
    if (audio?.kind === "url") body.url = audio.url;

    // BCP-47 verbatim: Deepgram documents "language=pt-BR" and the `multi`
    // sentinel, so there is no subtag to drop and nothing to warn about.
    if (input.language !== undefined) body.language = input.language;

    if (input.languages !== undefined) body.detect_language = [...input.languages];

    if (input.diarization !== undefined) {
      const diarization = ctx.take(
        resolveDiarization(
          input.diarization,
          { source: LISTEN_DOCS },
          { path: ["diarization"], warn: ctx.warn },
        ),
      );
      if (diarization !== undefined) body.diarize = diarization.enabled;
    }

    if (input.timestamps !== undefined) {
      const granularity = ctx.take(
        toTimestampGranularity(input.timestamps, ["word", "segment"], {
          path: ["timestamps"],
          warn: ctx.warn,
        }, { source: LISTEN_DOCS }),
      );
      if (granularity !== undefined) body.utterances = granularity === "segment";
    }

    applyExtras(input, DEEPGRAM_TRANSCRIBE_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies TranscribeAdapterFor<
  "url",
  typeof DEEPGRAM_TRANSCRIBE_MODEL_PARAMS,
  DeepgramTranscribeWire,
  DeepgramTranscribeResult
>;
