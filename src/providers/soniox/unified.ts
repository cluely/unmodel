/**
 * `unmodel/stt` → `soniox.stt` (POST /v1/transcriptions).
 *
 * The two-kind adapter: `audio_url` **or** `file_id` (from `POST /v1/files`),
 * exactly one of them, which is what `audioInputs: ["url", "fileId"]` says at
 * the call site and what Soniox's own schema enforces on the wire.
 *
 * The interesting cell is `language`, and it is the category's clearest
 * example of an honest approximation. Soniox has **no** field that asserts a
 * language: `language_hints` biases detection and `language_hints_strict`
 * leans on it harder, but detection still runs. So:
 *
 * - `languages` — a candidate set — maps to `language_hints` **exactly**, because
 *   that is precisely what the field means. No warning.
 * - `language` — an assertion — maps to a one-element `language_hints` with
 *   `language_hints_strict: true`, which is the strongest thing this API can be
 *   told, and warns `approximated_param` saying so. A caller who needs the
 *   guarantee learns that this provider cannot give it, once, here, rather than
 *   from a transcript in the wrong language.
 */
import {
  applyExtras,
  EXTRA,
  resolveAudioInput,
  resolveDiarization,
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
  type SonioxTranslation,
  type TranscriptionsBody,
} from "./stt";

/** The two async models — the ref union for `soniox/…`. */
const MODELS = ["stt-async-v5", "stt-async-v4"] as const;

const CREATE_DOCS =
  "https://soniox.com/docs/api-reference/stt/transcriptions/create_transcription";

/** The wire body this adapter compiles to. */
export type SonioxSttWire = TranscriptionsBody;

/** What a unified call to `soniox/…` returns. */
export type SonioxSttResult = ReturnType<typeof validator>;

/**
 * Both async models share one row: one schema, one param surface, no per-model
 * constraint table.
 *
 * `timestamps: ["word"]` and no `"none"` — Soniox returns per-token timing on
 * every response and offers no switch, so `"word"` agrees and costs nothing
 * while the other three are refused by name.
 *
 * The three extras are the rest of Soniox's language machinery, and they are
 * exactly the fields the canonical mapping *approximates* around.
 * `language_hints_strict` is the flag this adapter already sets to `true` when
 * `language` is used — so setting it alongside `languages` is the only way to
 * say "bias hard toward this shortlist" without asserting a single language,
 * which is the request the canonical vocabulary has no word for.
 * `enable_language_identification` returns the detected language per token, and
 * `translation` is the one-way/two-way translation config.
 *
 * Excluded: `audio_url`, `file_id`, `language_hints`,
 * `enable_speaker_diarization` and `context` are canonical words' wire
 * spellings.
 */
const SONIOX_ROW = {
  timestamps: ["word"],
  extras: {
    language_hints_strict: EXTRA as boolean,
    enable_language_identification: EXTRA as boolean,
    translation: EXTRA as SonioxTranslation | null,
  },
} as const;

const SONIOX_STT_MODEL_PARAMS = {
  "stt-async-v5": SONIOX_ROW,
  "stt-async-v4": SONIOX_ROW,
} as const satisfies SttModelParamTable;

export const stt = {
  category: "stt",
  provider: "soniox",
  models: MODELS,
  modelParams: SONIOX_STT_MODEL_PARAMS,
  audioInputs: ["url", "fileId"],
  compile(
    input: SttParamsFor<"url" | "fileId">,
    ctx: CompileContext<SttParamsFor<"url" | "fileId">>,
  ): CompiledCall<SonioxSttWire, SonioxSttResult> {
    const body: SonioxSttWire = { model: ctx.model };
    ctx.from(["audio_url"], "audio");
    ctx.from(["file_id"], "audio");
    ctx.from(["language_hints"], "languages");
    ctx.from(["enable_speaker_diarization"], "diarization");
    ctx.from(["context"], "prompt");

    const audio = ctx.take(
      resolveAudioInput(input.audio, ["url", "fileId"], { path: ["audio"], warn: ctx.warn }, {
        source: CREATE_DOCS,
        hint: "Upload local bytes to POST /v1/files first and pass the id it returns.",
      }),
    );
    if (audio?.kind === "url") body.audio_url = audio.url;
    if (audio?.kind === "fileId") body.file_id = audio.fileId;

    if (input.language !== undefined && input.languages !== undefined) {
      ctx.fail({
        code: "invalid_shape",
        path: ["languages"],
        message:
          "`language` and `languages` both compile to `language_hints` at Soniox — the assertion " +
          "as a one-element strict hint, the candidate set as the list itself — so a request that " +
          "sets both has not said which it means. Send one.",
        meta: { source: CREATE_DOCS },
      });
    } else if (input.language !== undefined) {
      const language = ctx.take(
        toPrimaryLanguage(input.language, { path: ["language"], warn: ctx.warn }, {
          source: CREATE_DOCS,
        }),
      );
      if (language !== undefined) {
        body.language_hints = [language];
        body.language_hints_strict = true;
        ctx.warn({
          code: "approximated_param",
          path: ["language"],
          message:
            `\`language\` ${JSON.stringify(input.language)} was sent as a strict language *hint* ` +
            "— Soniox has no field that pins a language, so detection still runs and may " +
            "disagree. Set `languages` instead if a shortlist is what you meant.",
          meta: {
            requested: input.language,
            achieved: { language_hints: [language], language_hints_strict: true },
            source: CREATE_DOCS,
          },
        });
      }
    } else if (input.languages !== undefined) {
      // The exact meaning of the field, so no warning: a candidate set is what
      // `language_hints` *is*.
      body.language_hints = [...input.languages];
    }

    if (input.diarization !== undefined) {
      const diarization = ctx.take(
        resolveDiarization(
          input.diarization,
          { source: CREATE_DOCS },
          { path: ["diarization"], warn: ctx.warn },
        ),
      );
      if (diarization !== undefined) body.enable_speaker_diarization = diarization.enabled;
    }

    // Soniox returns per-token timing on every response; there is no
    // granularity field, so the agreeing value costs nothing and the others
    // are refused by name.
    if (input.timestamps !== undefined) {
      ctx.take(
        toTimestampGranularity(input.timestamps, ["word"], {
          path: ["timestamps"],
          warn: ctx.warn,
        }, { source: CREATE_DOCS }),
      );
    }

    if (input.prompt !== undefined) body.context = input.prompt;

    applyExtras(input, SONIOX_STT_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies SttAdapterFor<
  "url" | "fileId",
  typeof SONIOX_STT_MODEL_PARAMS,
  SonioxSttWire,
  SonioxSttResult
>;
