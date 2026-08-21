/**
 * Gemini speech-to-text — the generateContent route, seen through a
 * transcription-shaped window.
 * POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *
 * **This is the same wire route `google.chat` serves, deliberately.** Gemini
 * has no dedicated transcription endpoint: you send audio parts and ask for
 * text. The audio-capable ids therefore REMAIN valid on `google.chat` — a
 * validator that refused a request the API fulfils would be the one forbidden
 * failure — and this module is a narrower *view* of the same bytes:
 *
 * - `contents` carries text and AUDIO parts and nothing else: no image, no
 *   video, no PDF, no function calls, no thoughts;
 * - `inlineData.mimeType` is the closed seven-value audio set (the audio guide
 *   publishes the whole list, and an off-list value is already an error);
 * - `generationConfig` is the transcription subset, with a fully typed
 *   `audioTranscriptionConfig` — six live fields plus three the SDK marks
 *   deprecated;
 * - `speechConfig` / `imageConfig` / `responseFormat` are `?: never`, because
 *   this direction produces text.
 *
 * `audioTranscriptionConfig` is typed rather than left as a passthrough bag
 * because its acceptance on the **unary** route was verified against the live
 * API: `generateContent` returned 200 for a body carrying
 * `{ wordTimestamp, diarization }`, and Google 400s unknown fields, so
 * acceptance is proof. The REST reference documents the message under the Live
 * API's setup; the field is real here too.
 *
 * Sources (verified 2026-08-21):
 * - https://ai.google.dev/gemini-api/docs/audio (formats, 32 tokens/second,
 *   the 9.5-hour cap)
 * - https://ai.google.dev/api/generate-content (GenerationConfig)
 * - @google/genai@2.17.0's `AudioTranscriptionConfig`
 *
 * Auth is your job: add an `x-goog-api-key` header (or `?key=`) when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import {
  JSON_HEADERS,
  toValidated,
  type ExactKeys,
  type RequestMeta,
  type Validated,
} from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { FutureModelId, ModelInfo, ModelsWhereFalse } from "../../core/catalog-types";
import type { EndpointConstraints, MediaRule } from "../../core/constraint-types";
import { computeCostUSD } from "../../core/cost";
import { PER_MESSAGE_TOKEN_OVERHEAD } from "../../core/tokens";
import { findMediaDeclaration, reportMediaIssues } from "../../core/media/check";
import { geminiSdkParams } from "../../core/translate/sdk-shapes";
import type { ValidatorProviderCarrier } from "../../core/validator-result-kind";
import { GOOGLE_MODELS_BASE_URL, googleModelUrl, stripModelsPrefix } from "./model-path";
// The import-free leaf, never `./constraints` — which reads the generated
// catalog AND the Veo rows, neither of which a transcription request needs.
// The audio MediaRule below is assembled locally from these four constants for
// exactly that reason: `chatFamilyRules` would drag both in.
import {
  GEMINI_AUDIO_FORMATS,
  GEMINI_AUDIO_MAX_DURATION_SECONDS,
  GEMINI_AUDIO_MIME_TYPES,
  GEMINI_AUDIO_TOKENS_PER_SECOND,
  GEMINI_STT_EXCLUDED_IDS,
  GEMINI_STT_MODEL_IDS,
  GOOGLE_AUDIO_DOCS_URL,
  INLINE_MEDIA_MAX_BYTES,
  type GeminiAudioMimeType,
  type GeminiSttModelId,
} from "./audio-constraints";
import { checkGenerationCapabilities } from "./tts-checks";
// The GENERATED catalog. Unlike `google.tts`, this surface makes NO doc
// correction to any row — thirteen mainline models with nothing to restate —
// and hand rows would be a second opinion on generated data. The curation that
// *is* a judgement call lives in ./audio-constraints as two id lists, with a
// drift test that forces a codegen refresh to classify rather than absorb.
import { models as googleCatalogModels } from "../../catalog/google.gen";
import type { GoogleContent, GoogleSafetySetting, GoogleServiceTier, GoogleThinkingConfig } from "./wire";

export const GENERATE_STT_BASE_URL = GOOGLE_MODELS_BASE_URL;

// ---------------------------------------------------------------------------
// Wire types — Tier A over the thirteen curated ids.
// ---------------------------------------------------------------------------

/** Part kinds this surface refuses, spelled so the editor says which and why. */
interface GoogleSttPartRefusals {
  /** Transcription is one turn in, one transcript out — tool turns are `google.chat`. */
  functionCall?: never;
  /** Transcription is one turn in, one transcript out — tool turns are `google.chat`. */
  functionResponse?: never;
  /** Code execution is a `google.chat` tool. */
  executableCode?: never;
  /** Code execution is a `google.chat` tool. */
  codeExecutionResult?: never;
  /** Server-side tool turns are `google.chat`. */
  toolCall?: never;
  /** Server-side tool turns are `google.chat`. */
  toolResponse?: never;
  /** Thought parts come back from a model; they are not an input here. */
  thought?: never;
  /** Video framing has no meaning on an audio part. */
  videoMetadata?: never;
}

/** The prompt: what to do with the audio ("Transcribe this", "Summarize…"). */
export interface GoogleSttTextPart extends GoogleSttPartRefusals {
  text: string;
  inlineData?: never;
  fileData?: never;
}

/** Base64 audio in the request body. Under ~20 MB total; use the Files API above that. */
export interface GoogleSttInlineAudioPart extends GoogleSttPartRefusals {
  text?: never;
  inlineData: {
    /**
     * CLOSED to the seven documented audio types, with no `(string & {})`
     * tail: the audio guide publishes the whole set, and an off-list value is
     * already a `media_unsupported_format` ERROR — so a tail would advertise
     * an allowed-value space Google has not published and switch the editor's
     * completion list off.
     */
    mimeType: GeminiAudioMimeType;
    /** Base64-encoded bytes. */
    data: string;
    /** Vertex AI-only; generativelanguage 400s on unknown fields. */
    displayName?: never;
  };
  fileData?: never;
}

/** A Files API pointer: `files.upload` then `file.uri`. Up to 2 GB, 48 h retention. */
export interface GoogleSttFileAudioPart extends GoogleSttPartRefusals {
  text?: never;
  inlineData?: never;
  fileData: {
    /**
     * A Files API URI (`https://generativelanguage.googleapis.com/v1beta/files/…`),
     * NOT an arbitrary URL — Gemini does not fetch third-party hosts.
     */
    fileUri: string;
    mimeType?: GeminiAudioMimeType;
    /** Vertex AI-only; generativelanguage 400s on unknown fields. */
    displayName?: never;
  };
}

/** Exactly one of text / inlineData / fileData. */
export type GoogleSttPart = GoogleSttTextPart | GoogleSttInlineAudioPart | GoogleSttFileAudioPart;

export interface GoogleSttContent {
  role?: "user";
  parts: GoogleSttPart[];
}

/**
 * `AudioTranscriptionConfig` — the ASR knobs, fully typed.
 *
 * PROBE-VERIFIED on the unary route (see this module's header). The three
 * deprecated members are carried because @google/genai still declares them and
 * bodies in the wild still send them; the `@deprecated` tag is what moves a
 * caller off them without refusing a request the API accepts.
 */
export interface GoogleAudioTranscriptionConfig {
  /**
   * BCP-47 language codes hinting at the languages present in the audio.
   * Omitted or empty → automatic language detection.
   */
  languageCodes?: readonly string[];
  /** Phrases that bias the ASR model toward specific terms (names, jargon). */
  customVocabulary?: readonly string[];
  /** Emit word-level timestamps. */
  wordTimestamp?: boolean;
  /** Label which speaker said what. There is no speaker-count field. */
  diarization?: boolean;

  /** @deprecated Use `languageCodes`. @google/genai: "will be removed in a future version". */
  languageHints?: { languageCodes?: readonly string[] };
  /** @deprecated Use `customVocabulary`. */
  adaptationPhrases?: readonly string[];
  /** @deprecated Auto-detection is the default when `languageCodes` is omitted. */
  languageAuto?: Record<string, never>;
}

/** `responseModalities` on a transcription body: text, in either casing. */
export type GoogleSttResponseModalities = ["TEXT"] | ["Text"];

/** The `generationConfig` keys that are the same on every STT arm. */
export interface GoogleSttGenerationConfigBase {
  /** Optional and pinned: this direction produces text. */
  responseModalities?: GoogleSttResponseModalities;
  /** ASR configuration — language hints, custom vocabulary, timestamps, diarization. */
  audioTranscriptionConfig?: GoogleAudioTranscriptionConfig;
  /** "text/plain" for a transcript, "application/json" with a schema for structure. */
  responseMimeType?: "text/plain" | "application/json" | (string & {});
  maxOutputTokens?: number;
  /** Trades audio-token count against fidelity. */
  mediaResolution?:
    | "MEDIA_RESOLUTION_UNSPECIFIED"
    | "MEDIA_RESOLUTION_LOW"
    | "MEDIA_RESOLUTION_MEDIUM"
    | "MEDIA_RESOLUTION_HIGH";

  /** Speech OUTPUT config — that is `google.tts`, the opposite direction. */
  speechConfig?: never;
  /** These models return text; image config is a `google.chat` / `google.image` knob. */
  imageConfig?: never;
  /** Per-modality output format — the text slot adds nothing here, the audio slot is `google.tts`. */
  responseFormat?: never;
  /** One transcript per request. */
  candidateCount?: never;
  /** Logprobs over a transcript are a chat-surface readout — use `google.chat`. */
  logprobs?: never;
  /** Logprobs over a transcript are a chat-surface readout — use `google.chat`. */
  responseLogprobs?: never;
}

/** The generated-flag source the per-model arms are derived from. */
type GoogleCatalog = typeof googleCatalogModels;

/**
 * `generationConfig` narrowed to one model id.
 *
 * Keyed off the generated catalog's own literals rather than a hand-copied id
 * list, exactly as `google.chat`'s arms are — a flag that flips in the next
 * `bun run codegen` moves the arm by itself, and `stt.test.ts` pins the
 * resolved unions so it surfaces as a test diff.
 */
export type NarrowedSttGenerationConfig<M extends string> = GoogleSttGenerationConfigBase & {
  temperature?: M extends ModelsWhereFalse<GoogleCatalog, "temperature"> ? never : number;
  thinkingConfig?: M extends ModelsWhereFalse<GoogleCatalog, "reasoning">
    ? never
    : GoogleThinkingConfig;
  /** OpenAPI-subset schema, for a structured transcript. */
  responseSchema?: M extends ModelsWhereFalse<GoogleCatalog, "structuredOutput">
    ? never
    : Record<string, unknown>;
  /** Standard JSON Schema alternative to `responseSchema`. */
  responseJsonSchema?: M extends ModelsWhereFalse<GoogleCatalog, "structuredOutput">
    ? never
    : unknown;
};

interface GoogleSttBodyBase {
  /** The audio, plus whatever instruction should be applied to it. */
  contents: GoogleSttContent[];
  /** Text-only direction for the transcription task. */
  systemInstruction?: GoogleContent;
  safetySettings?: GoogleSafetySetting[];
  serviceTier?: GoogleServiceTier;
  /** Name of a cached content, e.g. "cachedContents/abc123". */
  cachedContent?: string;
  /** Request-level logging opt-in/out. Rides only in the wire body. */
  store?: boolean;

  /** Transcription does not call tools — use `google.chat`. */
  tools?: never;
  /** Transcription does not call tools — use `google.chat`. */
  toolConfig?: never;
}

/** A transcription body narrowed to one curated model id. */
export interface GoogleSttModelBody<M extends GeminiSttModelId> extends GoogleSttBodyBase {
  model: M;
  generationConfig?: NarrowedSttGenerationConfig<M>;
}

/** Escape hatch for models unmodel doesn't know yet (unknown_model warning). */
export interface UnknownSttBody<Model extends string> extends GoogleSttBodyBase {
  model: FutureModelId<Model, GeminiSttModelId>;
  generationConfig?: GoogleSttGenerationConfigBase & {
    temperature?: number;
    thinkingConfig?: GoogleThinkingConfig;
    responseSchema?: Record<string, unknown>;
    responseJsonSchema?: unknown;
  };
}

/**
 * Closed over the thirteen curated Gemini transcription models by default.
 * Supply a future model literal to opt into the loose arm:
 * `GenerateSttBody<"gemini-4-flash">`.
 */
export type GenerateSttBody<FutureModel extends string = never> =
  | GoogleSttModelBody<GeminiSttModelId>
  | UnknownSttBody<FutureModel>;

/** Resolves a model id literal to its exact Tier-A arm. */
export type GoogleSttArm<M extends string> = M extends GeminiSttModelId
  ? GoogleSttModelBody<M>
  : UnknownSttBody<M>;

/** Runtime implementation type; the public alias stays closed by default. */
type AnyGenerateSttBody = GenerateSttBody<string>;
type GoogleSttModelInput = GeminiSttModelId | (string & {});

// ---------------------------------------------------------------------------
// SDK view — @google/genai's ai.models.generateContent({ model, contents,
// config }), the same re-shape `google.chat` and `google.tts` perform.
// ---------------------------------------------------------------------------

export type GenerateSttSdkParams<T extends AnyGenerateSttBody = GenerateSttBody> = {
  model: T["model"];
  contents: T["contents"];
  config?: (T extends { generationConfig: infer G } ? G : {}) &
    (T extends { systemInstruction: infer S } ? { systemInstruction: S } : {}) &
    (T extends { safetySettings: infer S } ? { safetySettings: S } : {}) &
    (T extends { cachedContent: infer C } ? { cachedContent: C } : {}) &
    (T extends { serviceTier: infer V } ? { serviceTier: V } : {});
};

/**
 * The SDK targets this endpoint declares: `@google/genai`'s
 * `ai.models.generateContent()`. No `.toApi` — media retargeting is not
 * derivable from the catalog, so `Avail` stays `never`.
 */
export type SttSdkTargets<T extends AnyGenerateSttBody = GenerateSttBody> = {
  google: () => GenerateSttSdkParams<T>;
};

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through; the pipeline warns on unknown
// top-level keys by introspecting the shape).
// ---------------------------------------------------------------------------

const schema = z.looseObject({
  model: z.string(),
  contents: z
    .array(
      z.looseObject({
        role: z.string().optional(),
        parts: z.array(
          z.looseObject({
            text: z.string().optional(),
            // `mimeType` is REQUIRED on inline audio, unlike the chat schema:
            // the bytes carry no format on this route and Gemini cannot sniff
            // them, so an omitted type is a 400 rather than a default.
            inlineData: z.looseObject({ mimeType: z.string(), data: z.string() }).optional(),
            fileData: z
              .looseObject({ fileUri: z.string(), mimeType: z.string().optional() })
              .optional(),
          }),
        ),
      }),
    )
    .min(1, "contents must contain at least one Content"),
  systemInstruction: z
    .looseObject({
      role: z.string().optional(),
      parts: z.array(z.looseObject({ text: z.string().optional() })),
    })
    .optional(),
  generationConfig: z
    .looseObject({
      responseModalities: z.array(z.string()).optional(),
      audioTranscriptionConfig: z
        .looseObject({
          languageCodes: z.array(z.string()).optional(),
          customVocabulary: z.array(z.string()).optional(),
          wordTimestamp: z.boolean().optional(),
          diarization: z.boolean().optional(),
          adaptationPhrases: z.array(z.string()).optional(),
        })
        .optional(),
      responseMimeType: z.string().optional(),
      responseSchema: z.record(z.string(), z.unknown()).optional(),
      responseJsonSchema: z.unknown().optional(),
      temperature: z.number().optional(),
      maxOutputTokens: z.number().int().positive().optional(),
      mediaResolution: z.string().optional(),
      thinkingConfig: z
        .looseObject({
          includeThoughts: z.boolean().optional(),
          thinkingBudget: z.number().int().optional(),
          thinkingLevel: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  safetySettings: z
    .array(z.looseObject({ category: z.string(), threshold: z.string() }))
    .optional(),
  cachedContent: z.string().optional(),
  serviceTier: z.string().optional(),
  store: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// The local audio MediaRule.
//
// Assembled here from ./audio-constraints rather than read out of
// `chatFamilyRules`, because that table lives in ./constraints, which imports
// the generated catalog AND ./veo-models. A transcription surface has no
// business paying for the Veo rows to learn that WAV is a supported format.
// ---------------------------------------------------------------------------

const AUDIO_RULE: MediaRule = {
  maxBytes: INLINE_MEDIA_MAX_BYTES,
  maxDurationSeconds: GEMINI_AUDIO_MAX_DURATION_SECONDS,
  formats: GEMINI_AUDIO_FORMATS,
};

/** "audio/mp3;codec=x" → "mp3"; "audio/jpg" → "jpeg" (the chat normalization). */
function formatOfMime(mimeType: string): string | undefined {
  const subtype = mimeType.trim().toLowerCase().split(";")[0]?.split("/")[1];
  return subtype === undefined || subtype === "" ? undefined : subtype;
}

interface AudioPartRef {
  path: Array<string | number>;
  mimeType: string | undefined;
  /** Base64 length, for the inline byte cap. Undefined for a Files API pointer. */
  encodedBytes: number | undefined;
}

/** Every audio-bearing part, with its coordinates. */
function audioPartsOf(params: AnyGenerateSttBody): AudioPartRef[] {
  const out: AudioPartRef[] = [];
  params.contents?.forEach((content, i) => {
    content?.parts?.forEach((part, j) => {
      const record = part as unknown as Record<string, Record<string, unknown> | undefined>;
      const inline = record["inlineData"];
      const file = record["fileData"];
      if (inline !== undefined) {
        const mimeType = typeof inline["mimeType"] === "string" ? inline["mimeType"] : undefined;
        // A non-audio inline part is not this surface's business, but it IS
        // reported (T5 below reads the same list), so it stays in.
        out.push({
          path: ["contents", i, "parts", j],
          mimeType,
          encodedBytes: typeof inline["data"] === "string" ? inline["data"].length : undefined,
        });
        return;
      }
      if (file !== undefined) {
        out.push({
          path: ["contents", i, "parts", j],
          mimeType: typeof file["mimeType"] === "string" ? file["mimeType"] : undefined,
          encodedBytes: undefined,
        });
      }
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Checks — T1–T9.
// ---------------------------------------------------------------------------

/** T1 — the catalog's own opinion: this route needs a model that hears. */
function checkAudioInput(
  params: AnyGenerateSttBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined || info.modalities.input.includes("audio")) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model"],
    model: params.model,
    message: `"${params.model}" does not accept audio input (input modalities: ${info.modalities.input.join(", ")}); google.stt transcribes audio.`,
    meta: { inputModalities: [...info.modalities.input], source: GOOGLE_AUDIO_DOCS_URL },
  });
}

/**
 * T2 — the curation gate.
 *
 * Nineteen models in the generated catalog take audio input; thirteen of them
 * are mainline generateContent models this surface serves. The other six are
 * refused BY NAME with the reason, because "not supported" tells a caller
 * nothing about whether they picked the wrong model or hit a gap in unmodel.
 *
 * An id in neither list and not in the catalog is left alone: the pipeline's
 * `unknown_model` warning already says model-dependent checks were skipped,
 * and refusing a model Google shipped last week would be exactly the failure
 * this library forbids.
 */
function checkCuratedModel(
  params: AnyGenerateSttBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model;
  const id = stripModelsPrefix(model);
  if (GEMINI_STT_MODEL_IDS.includes(id as GeminiSttModelId)) return;

  const excluded = Object.hasOwn(GEMINI_STT_EXCLUDED_IDS, id)
    ? GEMINI_STT_EXCLUDED_IDS[id]
    : undefined;
  if (excluded !== undefined) {
    ctx.report({
      code: "unsupported_capability",
      path: ["model"],
      model,
      message:
        `"${model}" is not served by google.stt: ${excluded}. ` +
        `The curated transcription models are ${GEMINI_STT_MODEL_IDS.join(", ")}.`,
      meta: { reason: excluded, allowed: [...GEMINI_STT_MODEL_IDS], source: GOOGLE_AUDIO_DOCS_URL },
    });
    return;
  }

  // In the catalog, audio-capable, and yet on neither list: the drift test in
  // stt.test.ts exists to make this unreachable, so reaching it means a
  // codegen refresh added a model nobody classified.
  if (info !== undefined) {
    ctx.report({
      code: "unsupported_capability",
      path: ["model"],
      model,
      message:
        `"${model}" is not one of the models google.stt curates for transcription. ` +
        `Use \`chat\` from \`unmodel/google\` (google.chat) to send it audio, or one of ${GEMINI_STT_MODEL_IDS.join(", ")}.`,
      meta: { allowed: [...GEMINI_STT_MODEL_IDS], surface: "google.chat" },
    });
  }
}

/** T3 + T4 — there must be audio, and one piece of it is the documented shape. */
function checkAudioParts(
  params: AnyGenerateSttBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const parts = audioPartsOf(params);
  if (parts.length === 0) {
    ctx.report({
      code: "invalid_shape",
      path: ["contents"],
      model: params.model,
      message:
        "google.stt needs at least one audio part (inlineData or fileData); a body with no audio is a chat call — use `chat` from `unmodel/google` (google.chat).",
      meta: { surface: "google.chat", source: GOOGLE_AUDIO_DOCS_URL },
    });
    return;
  }
  if (parts.length > 1) {
    ctx.report({
      code: "invalid_shape",
      severity: "warning",
      path: parts[1]?.path ?? ["contents"],
      model: params.model,
      message:
        `this request carries ${parts.length} audio parts. Gemini will process all of them, but the transcript comes back as ONE text response with no per-part boundaries — ` +
        "send one recording per request if you need them kept apart.",
      meta: { count: parts.length, source: GOOGLE_AUDIO_DOCS_URL },
    });
  }
}

/**
 * T5–T7 — format, size and duration, against the local audio rule.
 *
 * The `maxDurationSeconds` half is applied only when the caller DECLARED a
 * duration, which is the one place this surface deliberately differs from
 * `google.chat`: there, an audio part is the exception and
 * `media_duration_undeclared` is worth saying; here every request is audio, so
 * the same warning would fire on 100% of calls and mean nothing. The estimate
 * below re-raises it — with the cost reasoning attached — precisely when it
 * matters: when a budget is being checked against an undercount.
 */
function checkAudioMedia(
  params: AnyGenerateSttBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  for (const part of audioPartsOf(params)) {
    const declaration = findMediaDeclaration(ctx.options.media, part.path);

    // T5 — the declared MIME type, against the seven documented subtypes.
    const format = part.mimeType === undefined ? undefined : formatOfMime(part.mimeType);
    if (
      format !== undefined &&
      !GEMINI_AUDIO_FORMATS.includes(format as (typeof GEMINI_AUDIO_FORMATS)[number])
    ) {
      ctx.report({
        code: "media_unsupported_format",
        path: part.path,
        model: params.model,
        message: `audio format "${format}" is not supported; Gemini documents ${GEMINI_AUDIO_MIME_TYPES.join(", ")}.`,
        meta: {
          format,
          allowed: [...GEMINI_AUDIO_FORMATS],
          mimeTypes: [...GEMINI_AUDIO_MIME_TYPES],
          source: GOOGLE_AUDIO_DOCS_URL,
        },
      });
    }

    reportMediaIssues(ctx, {
      kind: "audio",
      rule: {
        ...AUDIO_RULE,
        // The inline byte cap applies to inlineData only; Files-API media may
        // be up to 2 GB, so a declared size must not trip it.
        ...(part.encodedBytes === undefined && { maxBytes: undefined }),
        // See this function's docstring.
        ...(declaration?.durationSeconds === undefined && { maxDurationSeconds: undefined }),
      },
      path: part.path,
      model: params.model,
      source: GOOGLE_AUDIO_DOCS_URL,
      ...(declaration !== undefined && { declaration }),
      ...(part.encodedBytes !== undefined && { encodedBytes: part.encodedBytes }),
    });
  }
}

/**
 * T8 — `displayName` on inlineData/fileData is a Vertex AI-only field, and
 * generativelanguage 400s on unknown fields. Top-level unknown-key detection
 * does not reach nested parts, so it is warned about here.
 */
function checkVertexOnlyFields(
  params: AnyGenerateSttBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  params.contents?.forEach((content, i) => {
    content?.parts?.forEach((part, j) => {
      const record = part as unknown as Record<string, Record<string, unknown> | undefined>;
      for (const key of ["inlineData", "fileData"] as const) {
        if (record[key]?.["displayName"] !== undefined) {
          ctx.report({
            code: "unknown_param",
            path: ["contents", i, "parts", j, key, "displayName"],
            model: params.model,
            message: `\`${key}.displayName\` is a Vertex AI-only field; the Gemini API (generativelanguage) rejects unknown fields with a 400 — remove it.`,
          });
        }
      }
    });
  });
}

/** T9 — temperature / thinkingConfig / maxOutputTokens against the catalog row. */
function checkCapabilities(
  params: AnyGenerateSttBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  checkGenerationCapabilities(
    params.generationConfig,
    ["generationConfig"],
    params.model,
    info,
    ctx,
  );
  const config = params.generationConfig;
  if (config === undefined || info === undefined) return;
  for (const key of ["responseSchema", "responseJsonSchema"] as const) {
    // Tri-state, like every structured-output check in the library: absent
    // means "the catalog has no answer" and must not fail a request.
    if (config[key] !== undefined && info.structuredOutput === false) {
      ctx.report({
        code: "unsupported_capability",
        path: ["generationConfig", key],
        model: params.model,
        message: `"${params.model}" does not support structured output; remove \`generationConfig.${key}\`.`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Estimation — text tokens plus audio tokens.
//
// "32 tokens per second of audio (1 minute = 1,920 tokens)", from the audio
// guide. Duration is not inspectable from base64 (a container header would
// give a format, never a length), so it comes from `options.media`.
// ---------------------------------------------------------------------------

function estimate(params: AnyGenerateSttBody, info: ModelInfo | undefined, ctx: PipelineContext) {
  let textTokens = 0;
  for (const content of params.contents ?? []) {
    textTokens += PER_MESSAGE_TOKEN_OVERHEAD;
    for (const part of content?.parts ?? []) {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") textTokens += ctx.tokenizer.count(text);
    }
  }
  for (const part of params.systemInstruction?.parts ?? []) {
    if (typeof part?.text === "string") textTokens += ctx.tokenizer.count(part.text);
  }

  let audioTokens = 0;
  let undeclared = 0;
  for (const part of audioPartsOf(params)) {
    const declared = findMediaDeclaration(ctx.options.media, part.path)?.durationSeconds;
    if (declared === undefined) {
      undeclared += 1;
      continue;
    }
    audioTokens += Math.ceil(declared * GEMINI_AUDIO_TOKENS_PER_SECOND);
  }

  // The undeclared-duration warning, raised ONLY when a budget is riding on
  // the number. Normally the undercount is invisible and harmless; with
  // `maxCostUSD` set it is the difference between a check that passed and a
  // check that was never really made.
  if (undeclared > 0 && ctx.options.maxCostUSD !== undefined) {
    ctx.report({
      code: "media_duration_undeclared",
      path: ["contents"],
      model: params.model,
      message:
        `maxCostUSD is set, but ${undeclared} audio part(s) carry no declared duration, so the estimate below counts ${GEMINI_AUDIO_TOKENS_PER_SECOND} tokens/second for none of them — ` +
        "the budget check is passing on an undercount. Declare them via options.media = [{ path, durationSeconds }].",
      meta: {
        undeclared,
        tokensPerSecond: GEMINI_AUDIO_TOKENS_PER_SECOND,
        source: GOOGLE_AUDIO_DOCS_URL,
      },
    });
  }

  const inputTokens = textTokens + audioTokens;
  const outputTokens = params.generationConfig?.maxOutputTokens ?? info?.limit.output ?? 0;
  const costUSD = computeCostUSD(info?.cost, {
    inputTokens,
    outputTokens,
    ...(audioTokens > 0 && { audioInputTokens: audioTokens }),
  });
  return costUSD === undefined ? { inputTokens } : { inputTokens, costUSD };
}

// ---------------------------------------------------------------------------
// Finalize
// ---------------------------------------------------------------------------

/**
 * Endpoint URL for a transcription model id. Accepts both the bare id
 * ("gemini-2.5-flash") and the REST-documented "models/…" form.
 */
export function generateSttUrl(model: string): string {
  return googleModelUrl(model, "generateContent");
}

function finalize(params: AnyGenerateSttBody): unknown {
  const { model, ...body } = params;
  const request: RequestMeta = {
    url: generateSttUrl(model),
    method: "POST",
    headers: JSON_HEADERS,
  };
  return toValidated(body, request, { sdk: { google: () => geminiSdkParams(model, body) } });
}

const catalog: Record<string, ModelInfo> = googleCatalogModels;

const validator = createValidator<AnyGenerateSttBody, unknown>({
  endpoint: "google.stt",
  schema,
  modelId: (params) => stripModelsPrefix(params.model),
  catalog,
  checks: [
    checkAudioInput,
    checkCuratedModel,
    checkAudioParts,
    checkAudioMedia,
    checkVertexOnlyFields,
    checkCapabilities,
  ],
  estimate,
  promptPath: ["contents"],
  finalize,
});

/**
 * Validates raw wire params for Gemini speech-to-text —
 * `models.{model}:generateContent` with audio parts in `contents`.
 *
 * The returned object's enumerable props are the exact fetch JSON body —
 * `model` is stripped, because on the wire it lives only in the URL.
 * `.toSdk("google")` re-shapes the body for `@google/genai`'s
 * `ai.models.generateContent()`. Auth is your job: add an `x-goog-api-key`
 * header (or `?key=`) when fetching.
 *
 * ```ts
 * const params = google.stt({
 *   model: "gemini-2.5-flash",
 *   contents: [{
 *     parts: [
 *       { text: "Transcribe this recording." },
 *       { inlineData: { mimeType: "audio/wav", data: base64 } },
 *     ],
 *   }],
 *   generationConfig: {
 *     audioTranscriptionConfig: { wordTimestamp: true, diarization: true },
 *   },
 * }, {
 *   // Declared duration → real audio-token and cost estimates (32 tok/s).
 *   media: [{ path: ["contents", 0, "parts", 1], durationSeconds: 600 }],
 * });
 * ```
 */
export const stt = validator as unknown as {
  <M extends GoogleSttModelInput, T extends GoogleSttArm<M>>(
    params: T & GoogleSttArm<M> & { model: M } & ExactKeys<T, GoogleSttArm<M>>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "model">, SttSdkTargets<T>>;
  safe<M extends GoogleSttModelInput, T extends GoogleSttArm<M>>(
    params: T & GoogleSttArm<M> & { model: M } & ExactKeys<T, GoogleSttArm<M>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "model">, SttSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
} & ValidatorProviderCarrier<"google">;

export type { GeminiAudioMimeType, GeminiSttModelId };
