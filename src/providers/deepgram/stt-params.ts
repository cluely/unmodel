/**
 * The stt adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/deepgram/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { SttModelParamTable } from "../../core/unified/vocabulary/stt";
import { sttModels } from "./models";
import type { DeepgramListenEncoding, DeepgramRedact } from "./stt";

/**
 * Every pre-recorded STT id, read off the hand catalog rather than copied, so
 * the ref union, the `unknown_model` warning and the catalog cannot drift.
 *
 * The Flux ids are excluded in the type as well as at runtime: they are served
 * by the /v2/listen WebSocket alone, and `deepgram.stt`'s own
 * `checkFluxNotPreRecorded` says so — a ref that cannot work should not
 * autocomplete.
 */
export const MODELS = Object.keys(sttModels).filter((id) => !id.startsWith("flux-")) as readonly Exclude<
  keyof typeof sttModels,
  `flux-${string}`
>[];

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
export const LISTEN_EXTRAS = {
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

export const TIMESTAMPS = ["word", "segment"] as const;

export const NOVA_3_ROW = {
  timestamps: TIMESTAMPS,
  extras: { ...LISTEN_EXTRAS, keyterm: EXTRA as string | string[] },
} as const;

export const LISTEN_ROW = { timestamps: TIMESTAMPS, extras: LISTEN_EXTRAS } as const;

export const DEEPGRAM_STT_MODEL_PARAMS = Object.fromEntries(
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
} satisfies SttModelParamTable;
