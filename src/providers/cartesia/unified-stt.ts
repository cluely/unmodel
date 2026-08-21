/**
 * `unmodel/stt` → `cartesia.stt` (POST /stt).
 *
 * The smallest surface in the category — six wire fields — and the second
 * blob-only route, so `audioInputs` is `["file"]`. There is no URL field and
 * no upload endpoint: `file` is required and a string in it is appended to the
 * form verbatim rather than fetched, which is why a canonical `{ url }` has
 * nothing to compile to here.
 *
 * `timestamp_granularities` is an array whose only member is `"word"`, so the
 * canonical `"segment"` and `"character"` are `invalid_enum_value` naming what
 * this route reports — the narrowest timestamp cell in the category, and the
 * one that shows why the granularity is refused rather than approximated: a
 * segment is not a coarse word.
 */
import {
  applyExtras,
  EXTRA,
  resolveAudioInput,
  toPrimaryLanguage,
  toTimestampGranularity,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  SttAdapterFor,
  SttModelParamTable,
  SttParamsFor,
} from "../../core/unified/vocabulary/stt";
import {
  stt as validator,
  CARTESIA_STT_LANGUAGES,
  type CartesiaSttEncoding,
  type CartesiaSttLanguage,
  type SttTranscribeParams,
} from "./stt";

/** The one batch STT model — the ref union for `cartesia/…`. */
const MODELS = ["ink-whisper"] as const;

const STT_DOCS = "https://docs.cartesia.ai/api-reference/stt/transcribe";

/** The wire params this adapter compiles to (form fields + query params). */
export type CartesiaSttWire = SttTranscribeParams;

/** What a unified call to `cartesia/…` returns. */
export type CartesiaSttResult = ReturnType<typeof validator>;

/**
 * One model, one row — and the row is where the 100-code language list finally
 * becomes visible to a caller.
 *
 * The module note above says the enum "lives in `cartesia.stt`'s own
 * `checkLanguage`; duplicating it here would be a second copy to drift". That
 * is still true, which is why `languages` is {@link CARTESIA_STT_LANGUAGES}
 * *by reference*: one array, checked at run time by the provider and completed
 * at compile time by the editor, with no second declaration to keep in step.
 *
 * `timestamps: ["none", "word"]`: the wire array's only member is `"word"`, and
 * `"none"` is expressible because omitting the field is exactly what it means
 * here. `"segment"` and `"character"` are the narrowest refusal in the category
 * — a segment is not a coarse word, so it is an error rather than an
 * approximation.
 *
 * The two extras describe the *bytes*, which this route needs because it takes
 * raw audio as well as containers: `encoding` and `sample_rate` are what a
 * containerless upload has instead of a header. They are not the canonical
 * `outputFormat` — that word belongs to the speech category, and there is no
 * output audio here to have a format.
 */
const CARTESIA_STT_MODEL_PARAMS = {
  "ink-whisper": {
    timestamps: ["none", "word"],
    languages: CARTESIA_STT_LANGUAGES,
    extras: {
      encoding: EXTRA as CartesiaSttEncoding,
      sample_rate: EXTRA as number,
    },
  },
} as const satisfies SttModelParamTable;

const STT_LANGUAGE_SET = new Set<string>(CARTESIA_STT_LANGUAGES);

/**
 * Membership in the wire's closed 100-code `language` enum, tested against the
 * same array the row above publishes for completions — still one list.
 *
 * `toPrimaryLanguage` returns a bare `string` (it normalizes BCP-47 to a primary
 * subtag but knows no provider's list), so this is where a compiled body earns
 * the closed wire type.
 */
function isSttLanguage(language: string): language is CartesiaSttLanguage {
  return STT_LANGUAGE_SET.has(language);
}

export const stt = {
  category: "stt",
  provider: "cartesia",
  models: MODELS,
  modelParams: CARTESIA_STT_MODEL_PARAMS,
  audioInputs: ["file"],
  unsupported: {
    languages:
      "POST /stt takes one `language` from a closed list and has no candidate-set field; omit " +
      "`language` to let Whisper detect.",
    diarization:
      "POST /stt has no diarization of any kind — Cartesia's speaker features live on the " +
      "realtime `/stt/websocket` surface, which is a different endpoint.",
    prompt: "POST /stt takes no prompt, keyterms or vocabulary field of any kind.",
  },
  compile(
    input: SttParamsFor<"file">,
    ctx: CompileContext<SttParamsFor<"file">>,
  ): CompiledCall<CartesiaSttWire, CartesiaSttResult> {
    const body: CartesiaSttWire = { file: new Blob([]), model: ctx.model };
    ctx.from(["file"], "audio");
    ctx.from(["timestamp_granularities"], "timestamps");

    const audio = ctx.take(
      resolveAudioInput(input.audio, ["file"], { path: ["audio"], warn: ctx.warn }, {
        source: STT_DOCS,
        hint: "POST /stt reads the bytes from a multipart `file` part; it fetches no URLs.",
      }),
    );
    if (audio?.kind === "file") body.file = audio.file;

    if (input.language !== undefined) {
      const language = ctx.take(
        toPrimaryLanguage(input.language, { path: ["language"], warn: ctx.warn }, {
          source: STT_DOCS,
        }),
      );
      // The closed 100-code list lives in `cartesia.stt`'s own
      // `checkLanguage`; duplicating it here would be a second copy to drift.
      // So: narrowed against that same array for every code the wire accepts,
      // and an off-enum primary subtag is forwarded through one explicit cast —
      // reinstating the wire type's old looseness exactly one layer inward — so
      // `checkLanguage` still refuses it at *error* severity. Dropping it would
      // silently transcribe in Whisper's detected language instead.
      if (language !== undefined) {
        body.language = isSttLanguage(language) ? language : (language as CartesiaSttLanguage);
      }
    }

    if (input.timestamps !== undefined) {
      const granularity = ctx.take(
        toTimestampGranularity(input.timestamps, ["word"], {
          path: ["timestamps"],
          warn: ctx.warn,
        }, { source: STT_DOCS }),
      );
      if (granularity !== undefined) body.timestamp_granularities = [granularity];
    }

    applyExtras(input, CARTESIA_STT_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies SttAdapterFor<
  "file",
  typeof CARTESIA_STT_MODEL_PARAMS,
  CartesiaSttWire,
  CartesiaSttResult
>;
