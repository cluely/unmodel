/**
 * `unmodel/stt` → `gladia.stt` (POST /v2/pre-recorded).
 *
 * URL-only, like AssemblyAI: `audio_url` is the one required field and bytes
 * go through `POST /v2/upload` first (`toUploadFormData` builds that body).
 *
 * The two things this adapter has to get right:
 *
 * - **One array, two canonical words.** `language_config.languages` is *both*
 *   the pin (one entry) and the candidate set (several), so `language` and
 *   `languages` compile to the same field. A request carrying both has not
 *   decided which meaning it wants, and the wire cannot hold both — so it is an
 *   `invalid_shape` naming the collision rather than a last-writer-wins.
 * - **Every config object needs its toggle.** Gladia drops a `*_config` whose
 *   boolean is not `true` (its own `checkToggles` warns about exactly that), so
 *   `diarization_config` is only ever emitted with `diarization: true`
 *   alongside it.
 *
 * `timestamps` maps to `sentences`: the response always carries word timings,
 * and `sentences` is the one switch that changes the grouping — so `"segment"`
 * turns it on and `"word"` turns it off, which keeps the granularity *stated*
 * rather than inherited from a default the caller cannot see.
 */
import {
  applyExtras,
  resolveAudioInput,
  resolveDiarization,
  toPrimaryLanguage,
  toTimestampGranularity,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { SttAdapterFor, SttParamsFor } from "../../core/unified/vocabulary/stt";
import { stt as validator, type PreRecordedBody } from "./stt";
import { GLADIA_STT_MODEL_PARAMS, MODELS } from "./stt-params";

const INIT_DOCS = "https://docs.gladia.io/api-reference/v2/pre-recorded/init";

/** The wire body this adapter compiles to. */
export type GladiaSttWire = PreRecordedBody;

/** What a unified call to `gladia/…` returns. */
export type GladiaSttResult = ReturnType<typeof validator>;

/** The one extra that belongs to `language_config`. */
const LANGUAGE_CONFIG_NESTING: Readonly<Record<string, readonly string[]>> = {
  code_switching: ["language_config"],
};

export const stt = {
  category: "stt",
  provider: "gladia",
  models: MODELS,
  modelParams: GLADIA_STT_MODEL_PARAMS,
  audioInputs: ["url"],
  unsupported: {
    prompt:
      "/v2/pre-recorded takes no acoustic prompt — `custom_vocabulary_config` is a weighted term " +
      "list and `audio_to_llm_config.prompts` runs an LLM *after* transcription, so neither is " +
      "this word; send them through `providerOptions.gladia`.",
  },
  compile(
    input: SttParamsFor<"url">,
    ctx: CompileContext<SttParamsFor<"url">>,
  ): CompiledCall<GladiaSttWire, GladiaSttResult> {
    const body: GladiaSttWire = { audio_url: "", model: ctx.model };
    ctx.from(["audio_url"], "audio");
    ctx.from(["diarization"], "diarization");
    ctx.from(["diarization_config", "number_of_speakers"], "diarization.speakers");
    ctx.from(["diarization_config", "min_speakers"], "diarization.minSpeakers");
    ctx.from(["diarization_config", "max_speakers"], "diarization.maxSpeakers");
    ctx.from(["sentences"], "timestamps");

    const audio = ctx.take(
      resolveAudioInput(input.audio, ["url"], { path: ["audio"], warn: ctx.warn }, {
        source: INIT_DOCS,
        hint: "Upload local bytes to POST /v2/upload first; its `audio_url` is what goes here.",
      }),
    );
    if (audio?.kind === "url") body.audio_url = audio.url;

    if (input.language !== undefined && input.languages !== undefined) {
      ctx.fail({
        code: "invalid_shape",
        path: ["languages"],
        message:
          "`language` and `languages` both compile to `language_config.languages` at Gladia — one " +
          "entry pins the language, several are the candidate set — so a request that sets both " +
          "has not said which it means. Send one.",
        meta: { source: INIT_DOCS },
      });
    } else if (input.language !== undefined) {
      // Declared inside the branch, and for the *element* as well as the array:
      // `checkModelLanguages` reports solaria-3's five-language limit at
      // `language_config.languages.0`, and a rule declared only for the array
      // would leave that path unmapped — sending a caller who wrote `language`
      // to look for a wire field they have never seen.
      ctx.from(["language_config", "languages"], "language");
      ctx.from(["language_config", "languages", 0], "language");
      const language = ctx.take(
        toPrimaryLanguage(input.language, { path: ["language"], warn: ctx.warn }, {
          source: INIT_DOCS,
        }),
      );
      if (language !== undefined) body.language_config = { languages: [language] };
    } else if (input.languages !== undefined) {
      // The plural word owns the same field when it is the one that was sent.
      ctx.from(["language_config", "languages"], "languages");
      body.language_config = { languages: [...input.languages] };
    }

    if (input.diarization !== undefined) {
      const diarization = ctx.take(
        resolveDiarization(
          input.diarization,
          { speakers: true, minSpeakers: true, maxSpeakers: true, source: INIT_DOCS },
          { path: ["diarization"], warn: ctx.warn },
        ),
      );
      if (diarization !== undefined) {
        body.diarization = diarization.enabled;
        const config = {
          ...(diarization.speakers !== undefined && { number_of_speakers: diarization.speakers }),
          ...(diarization.minSpeakers !== undefined && { min_speakers: diarization.minSpeakers }),
          ...(diarization.maxSpeakers !== undefined && { max_speakers: diarization.maxSpeakers }),
        };
        if (Object.keys(config).length > 0) body.diarization_config = config;
      }
    }

    if (input.timestamps !== undefined) {
      const granularity = ctx.take(
        toTimestampGranularity(input.timestamps, ["word", "segment"], {
          path: ["timestamps"],
          warn: ctx.warn,
        }, { source: INIT_DOCS }),
      );
      if (granularity !== undefined) body.sentences = granularity === "segment";
    }

    applyExtras(input, GLADIA_STT_MODEL_PARAMS, body, ctx, {
      nest: LANGUAGE_CONFIG_NESTING,
    });

    return { params: body, validate: validator.safe };
  },
} as const satisfies SttAdapterFor<
  "url",
  typeof GLADIA_STT_MODEL_PARAMS,
  GladiaSttWire,
  GladiaSttResult
>;
