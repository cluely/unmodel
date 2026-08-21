/**
 * `unmodel/stt` → `google.stt` (POST models/{model}:generateContent with audio
 * parts in `contents`).
 *
 * # The endpoint that is not a transcription endpoint
 *
 * Gemini has no `/audio/transcriptions` route: you send audio parts and ask for
 * text. So `audio` does not compile to a *field*, it compiles to a **part** —
 * `contents[0].parts[…]` — and `prompt` compiles to a text part beside it,
 * which is why the two are assembled together below rather than in two
 * independent branches.
 *
 * # `audio`: two of the four shapes, and why the other two are not sulking
 *
 * `audioInputs` is `["data", "fileId"]`, and both are the wire:
 *
 * - **`{ data }`** → `inlineData: { mimeType, data }`. Under ~20 MB per the
 *   audio guide; the request-size cap is what `google.stt` checks.
 * - **`{ fileId }`** → `fileData: { fileUri }`. A bare id is expanded to the
 *   full `…/v1beta/files/<id>` URI, because that is what `files.upload` returns
 *   and what a caller who kept only the id would otherwise have to rebuild.
 * - **`{ url }`** is refused with a pointer, and this is the one worth reading
 *   twice: `fileData.fileUri` *looks* like a URL field and is not one. Gemini
 *   does not fetch third-party hosts; the value has to be a Files API name.
 *   Compiling an arbitrary URL into it would produce a 400 nobody can connect
 *   to what they wrote.
 * - **`{ file }`** has no arm for the reason it has none at Inworld: a `Blob`
 *   is read asynchronously and `compile` is synchronous, by design.
 *
 * **`mimeType` is REQUIRED on `{ data }`**, unlike everywhere else the shape
 * appears. The bytes carry no format on this route and Gemini cannot sniff
 * them, so an omitted type is a 400 rather than a default — the refusal names
 * the seven spellings the audio guide publishes.
 *
 * # The ASR config is probe-backed, not inferred
 *
 * `generationConfig.audioTranscriptionConfig` is documented under the Live
 * API's setup message, and its acceptance on the **unary** route was verified
 * against the live API: `generateContent` returned 200 for a body carrying
 * `{ wordTimestamp, diarization }`, and Google 400s unknown fields, so
 * acceptance is proof. That is what makes these four cells `derived` rather
 * than `unsupported`:
 *
 * | canonical | wire | note |
 * |---|---|---|
 * | `language` | `audioTranscriptionConfig.languageCodes: [tag]` | the **full** BCP-47 tag, unlike `google.tts` |
 * | `languages` | `audioTranscriptionConfig.languageCodes` | the same array, as a candidate set |
 * | `timestamps: "word"` | `audioTranscriptionConfig.wordTimestamp: true` | `"none"` omits the field |
 * | `diarization.enabled` | `audioTranscriptionConfig.diarization` | there is no speaker-count field at all |
 *
 * **One array, two canonical words**, exactly as at Gladia: `languageCodes` is
 * both the pin (one entry) and the candidate set (several), so a request
 * carrying `language` *and* `languages` has not decided which it means and is
 * an `invalid_shape` naming the collision rather than a last-writer-wins.
 *
 * **The speaker counts have no wire field.** `diarization` is a bare boolean —
 * @google/genai's own `AudioTranscriptionConfig` declares nothing else — so
 * `diarization.speakers` / `minSpeakers` / `maxSpeakers` are each an
 * `unsupported_param` at their own canonical path, never a bound that went
 * nowhere while the caller was billed for the run.
 *
 * Everything else Gemini has that the vocabulary has no word for — custom
 * vocabulary, the sampling and thinking knobs, a structured-transcript schema,
 * a system turn — is typed on {@link GOOGLE_STT_MODEL_PARAMS} and copied
 * verbatim. `providerOptions.google` still reaches the rest (`safetySettings`,
 * `cachedContent`, `serviceTier`, `store`), which is transport and policy
 * rather than transcription.
 */
import {
  applyExtras,
  base64Payload,
  EXTRA,
  resolveAudioInput,
  resolveDiarization,
  toTimestampGranularity,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  SttAdapterFor,
  SttModelParamTable,
  SttParamsFor,
} from "../../core/unified/vocabulary/stt";
// The import-free leaf, never `./constraints` — which reads the Veo rows a
// transcription request has no business paying for.
import {
  GEMINI_AUDIO_MIME_TYPES,
  GEMINI_STT_MODEL_IDS,
  GOOGLE_AUDIO_DOCS_URL,
  GOOGLE_FILES_BASE_URL,
  type GeminiAudioMimeType,
} from "./audio-constraints";
import {
  stt as validator,
  type GoogleAudioTranscriptionConfig,
  type GoogleSttContent,
  type GoogleSttGenerationConfigBase,
  type GoogleSttPart,
} from "./stt";
import type { GoogleContent, GoogleThinkingConfig } from "./wire";

/** The thirteen curated transcription ids — the `google/…` ref union. */
const MODELS = GEMINI_STT_MODEL_IDS;

/**
 * `"word"` and `"none"`, and nothing else.
 *
 * `wordTimestamp` is a bare boolean: there is no segment grouping and no
 * character alignment anywhere in `AudioTranscriptionConfig`, so `"segment"`
 * and `"character"` are an `invalid_enum_value` naming the two this route
 * reports. `"none"` is genuinely expressible — omitting the field returns a
 * plain transcript — which is why it is on the list rather than refused.
 */
const TIMESTAMPS = ["word", "none"] as const;

/**
 * What a transcription request can carry that the vocabulary has no word for.
 *
 * One object rather than thirteen literals, and the table below is built from
 * it, because the thirteen curated ids have **identical** capability flags in
 * the generated catalog — `temperature`, `reasoning` and `structuredOutput` are
 * all true on every one, and their output limits agree. Thirteen copies would
 * imply a distinction the catalog does not make; the drift test in
 * `stt.test.ts` is what keeps the curated list itself honest.
 *
 * `customVocabulary` nests one level deeper than the rest — it is an ASR knob,
 * not a generation one — and `systemInstruction` one level shallower, at the
 * body root. {@link EXTRA_NESTING} carries both exceptions.
 */
const STT_EXTRAS = {
  /** "Phrases that bias the ASR model toward specific terms (names, jargon)." */
  customVocabulary: EXTRA as readonly string[],
  temperature: EXTRA as number,
  maxOutputTokens: EXTRA as number,
  /** Trades audio-token count against fidelity. */
  mediaResolution: EXTRA as NonNullable<GoogleSttGenerationConfigBase["mediaResolution"]>,
  /** `"text/plain"` for a transcript, `"application/json"` with a schema for structure. */
  responseMimeType: EXTRA as NonNullable<GoogleSttGenerationConfigBase["responseMimeType"]>,
  /** An OpenAPI-subset schema, for a structured transcript. */
  responseSchema: EXTRA as Record<string, unknown>,
  thinkingConfig: EXTRA as GoogleThinkingConfig,
  /**
   * A system turn, which is a different slot from the canonical `prompt`: the
   * prompt is a user part beside the audio, this is the standing instruction
   * above it. Both exist on the wire, so both are reachable.
   */
  systemInstruction: EXTRA as GoogleContent,
} as const;

const STT_ROW = { timestamps: TIMESTAMPS, extras: STT_EXTRAS } as const;

/**
 * The thirteen rows, built from one.
 *
 * The cast is a mapped type rather than `Record<GeminiSttModelId, typeof
 * STT_ROW>` for Deepgram's reason: only a mapped type over the id tuple keeps
 * each key a literal, and a lost literal is a silently dead narrowing with a
 * green build.
 */
const GOOGLE_STT_MODEL_PARAMS = Object.fromEntries(
  MODELS.map((model) => [model, STT_ROW]),
) as {
  readonly [M in (typeof MODELS)[number]]: typeof STT_ROW;
} satisfies SttModelParamTable;

/** The two extras that do not live directly under `generationConfig`. */
const EXTRA_NESTING: Readonly<Record<string, readonly string[]>> = {
  customVocabulary: ["generationConfig", "audioTranscriptionConfig"],
  systemInstruction: [],
};

/** `generationConfig` as this adapter builds it — the members it can write. */
export interface GoogleSttWireGenerationConfig {
  audioTranscriptionConfig?: GoogleAudioTranscriptionConfig;
  temperature?: number;
  maxOutputTokens?: number;
  mediaResolution?: GoogleSttGenerationConfigBase["mediaResolution"];
  responseMimeType?: GoogleSttGenerationConfigBase["responseMimeType"];
  responseSchema?: Record<string, unknown>;
  thinkingConfig?: GoogleThinkingConfig;
}

/** The wire body this adapter compiles to — the loose arm of `GenerateSttBody`. */
export interface GoogleSttWire {
  model: string;
  contents: GoogleSttContent[];
  systemInstruction?: GoogleContent;
  generationConfig?: GoogleSttWireGenerationConfig;
}

/** What a unified transcribe call to `google/…` returns: `google.stt`'s `Validated`. */
export type GoogleSttResult = ReturnType<
  typeof validator<GoogleSttWire["model"], GoogleSttWire>
>;

/**
 * A bare Files API id → the full URI `fileData.fileUri` documents.
 *
 * `files.upload` answers with `files/abc123` and its `uri` is the absolute
 * form; a caller who kept only the short name would otherwise have to rebuild
 * the prefix by hand, and a caller who kept the whole URI must not have it
 * prefixed twice. Anything already absolute passes through untouched.
 */
function toFileUri(fileId: string): string {
  if (fileId.startsWith("http://") || fileId.startsWith("https://")) return fileId;
  const name = fileId.startsWith("files/") ? fileId : `files/${fileId}`;
  return `${GOOGLE_FILES_BASE_URL}/${name.slice("files/".length)}`;
}

export const stt = {
  category: "stt",
  provider: "google",
  models: MODELS,
  modelParams: GOOGLE_STT_MODEL_PARAMS,
  audioInputs: ["data", "fileId"] as const,
  // No `unsupported` block: every canonical word in this category has a wire
  // slot here. The one thing that *is* refused — `{ url }` — is an audio KIND
  // rather than a canonical field, so it is `audioInputs`' job and
  // `resolveAudioInput` reports it with the Files API pointer below.
  compile(
    input: SttParamsFor<"data" | "fileId">,
    ctx: CompileContext<SttParamsFor<"data" | "fileId">>,
  ): CompiledCall<GoogleSttWire, GoogleSttResult> {
    const parts: GoogleSttPart[] = [];
    const transcription: GoogleAudioTranscriptionConfig = {};

    // The prompt is part 0 and the audio part 1 whenever both are present:
    // the guide's own samples put the instruction first, and a fixed order is
    // what makes the `ctx.from` paths below stable.
    ctx.from(["contents", 0, "parts", 0, "text"], "prompt");
    ctx.from(["generationConfig", "audioTranscriptionConfig", "languageCodes"], "languages");
    ctx.from(["generationConfig", "audioTranscriptionConfig", "wordTimestamp"], "timestamps");
    ctx.from(["generationConfig", "audioTranscriptionConfig", "diarization"], "diarization");

    if (input.prompt !== undefined) parts.push({ text: input.prompt });

    const audioIndex = parts.length;
    for (const leaf of [[], ["mimeType"], ["data"]]) {
      ctx.from(["contents", 0, "parts", audioIndex, "inlineData", ...leaf], "audio");
    }
    for (const leaf of [[], ["fileUri"]]) {
      ctx.from(["contents", 0, "parts", audioIndex, "fileData", ...leaf], "audio");
    }

    const audio = ctx.take(
      resolveAudioInput(input.audio, ["data", "fileId"], { path: ["audio"], warn: ctx.warn }, {
        source: GOOGLE_AUDIO_DOCS_URL,
        hint:
          "`fileData.fileUri` is a Files API name, not an arbitrary URL — Gemini does not fetch " +
          "third-party hosts. Upload the audio with `files.upload` first and pass the id it " +
          "returns as `{ fileId }`, or send the bytes as `{ data, mimeType }`.",
      }),
    );

    if (audio?.kind === "data") {
      if (audio.mimeType === undefined) {
        ctx.fail({
          code: "invalid_shape",
          path: ["audio", "mimeType"],
          message:
            "`inlineData.mimeType` is required on this route: the bytes carry no format and " +
            `Gemini does not sniff them, so an omitted type is a 400. One of ${GEMINI_AUDIO_MIME_TYPES.join(", ")}.`,
          meta: { allowed: [...GEMINI_AUDIO_MIME_TYPES], source: GOOGLE_AUDIO_DOCS_URL },
        });
      } else {
        parts.push({
          inlineData: {
            // Closed to the seven documented types at the wire, and re-checked
            // there: a compiled value is a `string`, which is exactly the case
            // `checkAudioMedia` exists for.
            mimeType: audio.mimeType as GeminiAudioMimeType,
            // The field is documented "base64", so a `data:` envelope the
            // caller happened to have is unwrapped rather than sent whole.
            data: base64Payload(audio.data),
          },
        });
      }
    } else if (audio?.kind === "fileId") {
      parts.push({ fileData: { fileUri: toFileUri(audio.fileId) } });
    }

    if (input.language !== undefined && input.languages !== undefined) {
      ctx.fail({
        code: "invalid_shape",
        path: ["languages"],
        message:
          "`language` and `languages` both compile to " +
          "`audioTranscriptionConfig.languageCodes` — one entry pins the language, several are " +
          "the candidate set — so a request that sets both has not said which it means. Send one.",
        meta: { source: GOOGLE_AUDIO_DOCS_URL },
      });
    } else if (input.language !== undefined) {
      ctx.from(["generationConfig", "audioTranscriptionConfig", "languageCodes"], "language");
      // The FULL tag, unlike `google.tts`'s primary-subtag `languageCode`:
      // `languageCodes` is documented "BCP-47 language codes", and "pt-BR" is a
      // hint this field can carry exactly.
      transcription.languageCodes = [input.language];
    } else if (input.languages !== undefined) {
      transcription.languageCodes = [...input.languages];
    }

    if (input.timestamps !== undefined) {
      const granularity = ctx.take(
        toTimestampGranularity(input.timestamps, ["word"], { path: ["timestamps"], warn: ctx.warn }, {
          source: GOOGLE_AUDIO_DOCS_URL,
        }),
      );
      // `"none"` is the omission: the field is a bare boolean, and `false` is
      // its documented default, so writing it would put a value on the wire the
      // caller's request does not need.
      if (granularity === "word") transcription.wordTimestamp = true;
    }

    if (input.diarization !== undefined) {
      const diarization = ctx.take(
        resolveDiarization(
          input.diarization,
          // No `speakers`, no `minSpeakers`, no `maxSpeakers`: the wire field is
          // a bare boolean, so each count is refused at its own path.
          { source: GOOGLE_AUDIO_DOCS_URL },
          { path: ["diarization"], warn: ctx.warn },
        ),
      );
      if (diarization !== undefined) transcription.diarization = diarization.enabled;
    }

    const body: GoogleSttWire = { model: ctx.model, contents: [{ parts }] };
    if (Object.keys(transcription).length > 0) {
      body.generationConfig = { audioTranscriptionConfig: transcription };
    }

    // After `generationConfig` is attached, so a nested extra lands beside the
    // compiled ASR keys rather than in an object the line above then replaces.
    applyExtras(input, GOOGLE_STT_MODEL_PARAMS, body, ctx, {
      at: ["generationConfig"],
      nest: EXTRA_NESTING,
    });

    return { params: body, validate: validator.safe };
  },
} as const satisfies SttAdapterFor<
  "data" | "fileId",
  typeof GOOGLE_STT_MODEL_PARAMS,
  GoogleSttWire,
  GoogleSttResult
>;
