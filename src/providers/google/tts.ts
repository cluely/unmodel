/**
 * Gemini text-to-speech — the generateContent route, seen through a TTS-shaped
 * window.
 * POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *
 * **This is the same wire route `google.chat` serves, deliberately.** Gemini
 * has no dedicated speech endpoint: TTS is `generateContent` with
 * `responseModalities: ["AUDIO"]` and a `speechConfig`. The TTS ids therefore
 * REMAIN valid on `google.chat` — a validator that refused a request the API
 * fulfils would be the one forbidden failure — and this module is a narrower
 * *view* of the same bytes, not a different endpoint:
 *
 * - `contents` carries text parts only ("TTS models can only receive text
 *   inputs and generate audio outputs");
 * - `generationConfig` is REQUIRED, and its `responseModalities` is pinned to
 *   `["AUDIO"]`, because every other value is an error for these models;
 * - every chat-only knob — tools, structured output, image config, media
 *   resolution, sampling penalties — is `?: never`, including the ones nested
 *   under `generationConfig`, which have to be spelled rather than omitted or
 *   the callable's intersection re-admits them;
 * - `speechConfig` is an XOR of the single- and multi-speaker arms, and
 *   multi-speaker's `speakerVoiceConfigs` is a bounded 1-or-2 tuple.
 *
 * The RULES are not restated here. Every check this module runs comes from
 * `./tts-checks.ts`, which `google.chat` calls too, so the two surfaces cannot
 * drift about what a valid speech request is.
 *
 * Sources (verified 2026-08-21):
 * - https://ai.google.dev/gemini-api/docs/generate-content/speech-generation
 *   (voices, the 78-language table, the 32k session limit, the streaming note,
 *   the multi-speaker "up to 2")
 * - https://ai.google.dev/api/generate-content (SpeechConfig,
 *   AudioResponseFormat, GenerationConfig)
 * - @google/genai@2.17.0's `AudioResponseFormatMimeType` / `SpeechConfig`
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
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeCostUSD } from "../../core/cost";
import { PER_MESSAGE_TOKEN_OVERHEAD } from "../../core/tokens";
import { geminiSdkParams } from "../../core/translate/sdk-shapes";
import type { ValidatorProviderCarrier } from "../../core/validator-result-kind";
// `./model-path`, not `./chat`: the two share one six-line normalization, and
// taking it from the chat validator would pull that module's whole graph — the
// Gemini wire schema, the chat constraint tables, the retarget engine and two
// dialect codecs — into an entry that only synthesizes speech.
import { GOOGLE_MODELS_BASE_URL, googleModelUrl, stripModelsPrefix } from "./model-path";
// The import-free leaf, never `./constraints` (which reads the generated
// catalog): see that module's header.
import {
  GEMINI_TTS_DOCS_URL,
  GEMINI_TTS_STREAMING_MODEL_IDS,
  type GeminiAudioDelivery,
  type GeminiCompressedAudioMimeType,
  type GeminiTtsLanguageCode,
  type GeminiUncompressedAudioMimeType,
} from "./tts-constraints";
import {
  checkAudioModalityRequested,
  checkAudioResponseFormat,
  checkGenerationCapabilities,
  checkSpeechConfig,
  isGeminiTtsModel,
} from "./tts-checks";
import { ttsModels, type GoogleTtsModelId } from "./tts-models";
import type {
  GoogleSafetySetting,
  GoogleServiceTier,
  GoogleSpeakerVoiceConfig,
  GoogleThinkingConfig,
  GoogleVoiceConfig,
} from "./wire";

export const GENERATE_TTS_BASE_URL = GOOGLE_MODELS_BASE_URL;

// ---------------------------------------------------------------------------
// Wire types — Tier A: one arm per documented TTS model id.
//
// Arrays here are MUTABLE (`GoogleTtsTextPart[]`, `["AUDIO"]`), matching the
// wire leaf's convention and not by accident: `@google/genai`'s
// `GenerateContentParameters` declares mutable arrays, so a `readonly` body
// type would make `.toSdk("google")` un-assignable to the SDK's own params —
// the one property every google surface in this repo is type-tested for. The
// bounded speaker tuple below is a tuple for the bound, not for immutability.
// ---------------------------------------------------------------------------

/**
 * A `Part` on this surface: text, and nothing else.
 *
 * The other eight part kinds are spelled `?: never` rather than omitted so the
 * editor says *which* key is refused and why — an omitted key on a nested
 * object inside a generic callable is re-admitted by the intersection the
 * public signature performs (same finding as `chat.ts`'s generationConfig
 * arms).
 */
export interface GoogleTtsTextPart {
  text: string;
  /** "TTS models can only receive text inputs" — send audio to `google.stt`. */
  inlineData?: never;
  /** "TTS models can only receive text inputs" — send audio to `google.stt`. */
  fileData?: never;
  functionCall?: never;
  functionResponse?: never;
  executableCode?: never;
  codeExecutionResult?: never;
  toolCall?: never;
  toolResponse?: never;
  thought?: never;
  videoMetadata?: never;
}

/**
 * A `Content` on this surface. `role` is optional and can only be "user":
 * there is no conversation here, only a transcript to speak (the guide's
 * REST samples omit `role` entirely).
 */
export interface GoogleTtsContent {
  role?: "user";
  parts: GoogleTtsTextPart[];
}

/**
 * `SpeechConfig` for a single voice.
 *
 * `multiSpeakerVoiceConfig?: never` is the XOR half — "It is mutually
 * exclusive with the voiceConfig field" — expressed so a body carrying both
 * fails to compile instead of only failing to validate.
 */
export interface GoogleTtsSingleSpeakerConfig {
  /** One of the 30 presets, via `prebuiltVoiceConfig.voiceName`. */
  voiceConfig?: GoogleVoiceConfig;
  multiSpeakerVoiceConfig?: never;
  /**
   * Primary language subtag, e.g. "en" or "cmn" — the 78 the guide tabulates
   * complete; the tail is open because the REST reference's own example is a
   * full tag ("en-US") its table does not carry. TTS models detect the input
   * language automatically, so this is a hint, not a requirement.
   */
  languageCode?: GeminiTtsLanguageCode | (string & {});
}

/**
 * `MultiSpeakerVoiceConfig.speakerVoiceConfigs` as a BOUNDED tuple.
 *
 * The two first-party sources disagree: the guide says "each speaker (up to
 * 2)" while @google/genai's docstring says "exactly two". The type takes the
 * looser reading (1 **or** 2), because a type must never be stricter than the
 * check — and the check, shared with `google.chat`, refuses only >2, which is
 * what the runtime actually rejects.
 */
export type GoogleTtsSpeakerVoiceConfigs =
  | [GoogleSpeakerVoiceConfig]
  | [GoogleSpeakerVoiceConfig, GoogleSpeakerVoiceConfig];

export interface GoogleTtsMultiSpeakerVoiceConfig {
  speakerVoiceConfigs: GoogleTtsSpeakerVoiceConfigs;
}

/** `SpeechConfig` for a two-speaker dialogue. */
export interface GoogleTtsMultiSpeakerConfig {
  voiceConfig?: never;
  /** Each speaker's name must match the name used in the prompt. */
  multiSpeakerVoiceConfig: GoogleTtsMultiSpeakerVoiceConfig;
  languageCode?: GeminiTtsLanguageCode | (string & {});
}

/** `SpeechConfig` — exactly one of the two voice arms. */
export type GoogleTtsSpeechConfig = GoogleTtsSingleSpeakerConfig | GoogleTtsMultiSpeakerConfig;

interface GoogleTtsAudioFormatBase {
  /** Inline base64 bytes (the default) or a URI to fetch. */
  delivery?: GeminiAudioDelivery;
  /** Output sample rate in Hz. Gemini TTS renders natively at 24000. */
  sampleRate?: number;
}

/** MP3 / Ogg-Opus output: the only formats `bitRate` applies to. */
export interface GoogleTtsCompressedAudioFormat extends GoogleTtsAudioFormatBase {
  mimeType: GeminiCompressedAudioMimeType;
  /** Bit rate in bits per second. Compressed formats only. */
  bitRate?: number;
}

/** L16 / WAV / A-law / µ-law output: `bitRate` has no meaning and is refused. */
export interface GoogleTtsUncompressedAudioFormat extends GoogleTtsAudioFormatBase {
  mimeType: GeminiUncompressedAudioMimeType;
  /** "Only applicable for compressed formats (MP3, Opus)." */
  bitRate?: never;
}

/** No format named — the model picks; nothing can be said about `bitRate`. */
export interface GoogleTtsUnspecifiedAudioFormat extends GoogleTtsAudioFormatBase {
  mimeType?: "MIME_TYPE_UNSPECIFIED";
  bitRate?: number;
}

/**
 * `AudioResponseFormat`, as a discriminated union on `mimeType`.
 *
 * Both first-party spellings of each of the six values are members (the REST
 * reference types the field as a proto enum, @google/genai as a MIME string),
 * so `"AUDIO_MP3"` and `"audio/mp3"` both narrow to the compressed arm.
 */
export type GoogleTtsAudioResponseFormat =
  | GoogleTtsCompressedAudioFormat
  | GoogleTtsUncompressedAudioFormat
  | GoogleTtsUnspecifiedAudioFormat;

/** `ResponseFormatConfig` on this surface: the audio slot only. */
export interface GoogleTtsResponseFormatConfig {
  audio?: GoogleTtsAudioResponseFormat;
  /** These models emit no text; `responseFormat.text` is rejected. */
  text?: never;
  /** These models emit no images; `responseFormat.image` is rejected. */
  image?: never;
}

/**
 * `responseModalities` on a TTS body. Both documented casings, and nothing
 * else: "TTS models can only receive text inputs and generate audio outputs",
 * and an absent or empty list "is equivalent to requesting only text".
 */
export type GoogleTtsResponseModalities = ["AUDIO"] | ["Audio"];

/**
 * The `generationConfig` keys that are the same on every TTS arm.
 *
 * Every `?: never` below is a key `generateContent` accepts on a chat body and
 * these models reject. They are spelled out rather than omitted for the reason
 * in this module's header, and each carries the surface that DOES take it, so
 * the editor's hover is an answer rather than a refusal.
 */
export interface GoogleTtsGenerationConfigBase {
  /** REQUIRED and pinned: these models produce audio and nothing else. */
  responseModalities: GoogleTtsResponseModalities;
  /** Voice selection — single-voice or up to two speakers. */
  speechConfig?: GoogleTtsSpeechConfig;
  /** Container / sample rate / bit rate for the generated audio. */
  responseFormat?: GoogleTtsResponseFormatConfig;
  /** Worst-case output size; also what the cost estimate bills. */
  maxOutputTokens?: number;

  /** Structured output is a text feature — use `google.chat`. */
  responseSchema?: never;
  /** Structured output is a text feature — use `google.chat`. */
  responseJsonSchema?: never;
  /** The output is audio; there is no response MIME type to choose here. */
  responseMimeType?: never;
  /** Image generation config — `google.chat` or `google.image`. */
  imageConfig?: never;
  /** Tunes how *input* media is tokenized; these models take text only. */
  mediaResolution?: never;
  /** Transcription config — that is `google.stt`, the opposite direction. */
  audioTranscriptionConfig?: never;
  /** One audio rendering per request. */
  candidateCount?: never;
  /** Logprobs are a text-sampling readout. */
  logprobs?: never;
  /** Logprobs are a text-sampling readout. */
  responseLogprobs?: never;
  /** Not part of the documented TTS surface. */
  topK?: never;
  /** Not part of the documented TTS surface. */
  topP?: never;
  /** Nothing stops speech mid-word; the transcript is the boundary. */
  stopSequences?: never;
  /** Not part of the documented TTS surface. */
  presencePenalty?: never;
  /** Not part of the documented TTS surface. */
  frequencyPenalty?: never;
  /** Not part of the documented TTS surface. */
  seed?: never;
  /** A chat-only dialogue feature. */
  enableAffectiveDialog?: never;
  /** A chat-only answer-quality feature. */
  enableEnhancedCivicAnswers?: never;
  /** A chat-only translation feature. */
  translationConfig?: never;
}

/** The generated-flag source the two per-model arms below are derived from. */
type TtsCatalog = typeof ttsModels;

/**
 * `generationConfig` narrowed to one model id.
 *
 * Keyed off `ttsModels`' own literals rather than a hand-copied id list, so a
 * flag that changes upstream moves the arm by itself — and `tts.test.ts` pins
 * the resolved unions, so it surfaces as a test diff rather than a silent
 * break in a caller's code. Today that means `thinkingConfig` exists only on
 * `gemini-3.1-flash-tts-preview`, the one reasoning TTS model.
 */
export type NarrowedTtsGenerationConfig<M extends string> = GoogleTtsGenerationConfigBase & {
  temperature?: M extends ModelsWhereFalse<TtsCatalog, "temperature"> ? never : number;
  thinkingConfig?: M extends ModelsWhereFalse<TtsCatalog, "reasoning">
    ? never
    : GoogleThinkingConfig;
};

interface GoogleTtsBodyBase {
  /** The transcript to speak, plus any style direction, as text parts. */
  contents: GoogleTtsContent[];
  safetySettings?: GoogleSafetySetting[];
  serviceTier?: GoogleServiceTier;
  /** Request-level logging opt-in/out. Rides only in the wire body. */
  store?: boolean;

  /** No system turn: the direction goes in the transcript — use `google.chat` for a system instruction. */
  systemInstruction?: never;
  /** TTS models do not call tools — use `google.chat`. */
  tools?: never;
  /** TTS models do not call tools — use `google.chat`. */
  toolConfig?: never;
  /** Context caching is a chat feature — use `google.chat`. */
  cachedContent?: never;
}

export interface GoogleTts25FlashBody extends GoogleTtsBodyBase {
  model: "gemini-2.5-flash-preview-tts";
  generationConfig: NarrowedTtsGenerationConfig<"gemini-2.5-flash-preview-tts">;
}

export interface GoogleTts25ProBody extends GoogleTtsBodyBase {
  model: "gemini-2.5-pro-preview-tts";
  generationConfig: NarrowedTtsGenerationConfig<"gemini-2.5-pro-preview-tts">;
}

export interface GoogleTts31FlashBody extends GoogleTtsBodyBase {
  model: "gemini-3.1-flash-tts-preview";
  generationConfig: NarrowedTtsGenerationConfig<"gemini-3.1-flash-tts-preview">;
}

/** Escape hatch for TTS models unmodel doesn't know yet (unknown_model warning). */
export interface UnknownTtsBody<Model extends string> extends GoogleTtsBodyBase {
  model: FutureModelId<Model, GoogleTtsModelId>;
  generationConfig: GoogleTtsGenerationConfigBase & {
    temperature?: number;
    thinkingConfig?: GoogleThinkingConfig;
  };
}

/**
 * Closed over the three documented Gemini TTS models by default. Supply a
 * future model literal to opt into the loose arm:
 * `GenerateTtsBody<"gemini-4-flash-tts">`.
 */
export type GenerateTtsBody<FutureModel extends string = never> =
  | GoogleTts25FlashBody
  | GoogleTts25ProBody
  | GoogleTts31FlashBody
  | UnknownTtsBody<FutureModel>;

interface GenerateTtsBodyByModel {
  "gemini-2.5-flash-preview-tts": GoogleTts25FlashBody;
  "gemini-2.5-pro-preview-tts": GoogleTts25ProBody;
  "gemini-3.1-flash-tts-preview": GoogleTts31FlashBody;
}

/** Resolves a model id literal to its exact Tier-A arm. */
export type GoogleTtsArm<M extends string> = M extends keyof GenerateTtsBodyByModel
  ? GenerateTtsBodyByModel[M]
  : UnknownTtsBody<M>;

/** Runtime implementation type; the public alias stays closed by default. */
type AnyGenerateTtsBody = GenerateTtsBody<string>;
type GoogleTtsModelInput = GoogleTtsModelId | (string & {});

// ---------------------------------------------------------------------------
// SDK view — @google/genai's ai.models.generateContent({ model, contents,
// config }), the same re-shape `google.chat` performs (one implementation, in
// core/translate/sdk-shapes.ts).
// ---------------------------------------------------------------------------

export type GenerateTtsSdkParams<T extends AnyGenerateTtsBody = GenerateTtsBody> = {
  model: T["model"];
  contents: T["contents"];
  config: T["generationConfig"] &
    (T extends { safetySettings: infer S } ? { safetySettings: S } : {}) &
    (T extends { serviceTier: infer V } ? { serviceTier: V } : {});
};

/**
 * The SDK targets this endpoint declares: `@google/genai`'s
 * `ai.models.generateContent()`. No `.toApi` — no other provider serves these
 * models, so `Avail` stays `never` and `.toApi` does not exist on the result at
 * all (same arrangement as `google.image`).
 */
export type TtsSdkTargets<T extends AnyGenerateTtsBody = GenerateTtsBody> = {
  google: () => GenerateTtsSdkParams<T>;
};

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through; the pipeline warns on unknown
// top-level keys by introspecting the shape).
// ---------------------------------------------------------------------------

const voiceConfigSchema = z.looseObject({
  prebuiltVoiceConfig: z.looseObject({ voiceName: z.string().optional() }).optional(),
});

const schema = z.looseObject({
  model: z.string(),
  contents: z
    .array(
      z.looseObject({
        role: z.string().optional(),
        parts: z.array(z.looseObject({ text: z.string().optional() })),
      }),
    )
    .min(1, "contents must contain at least one Content"),
  // REQUIRED, unlike every other generateContent body: a TTS request without
  // `responseModalities: ["AUDIO"]` asks these models for text, which they
  // cannot produce.
  generationConfig: z.looseObject({
    responseModalities: z.array(z.string()),
    speechConfig: z
      .looseObject({
        voiceConfig: voiceConfigSchema.optional(),
        multiSpeakerVoiceConfig: z
          .looseObject({
            speakerVoiceConfigs: z.array(
              z.looseObject({ speaker: z.string(), voiceConfig: voiceConfigSchema }),
            ),
          })
          .optional(),
        languageCode: z.string().optional(),
      })
      .optional(),
    responseFormat: z
      .looseObject({
        audio: z
          .looseObject({
            mimeType: z.string().optional(),
            delivery: z.string().optional(),
            sampleRate: z.number().optional(),
            bitRate: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    temperature: z.number().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    thinkingConfig: z
      .looseObject({
        includeThoughts: z.boolean().optional(),
        thinkingBudget: z.number().int().optional(),
        thinkingLevel: z.string().optional(),
      })
      .optional(),
  }),
  safetySettings: z
    .array(z.looseObject({ category: z.string(), threshold: z.string() }))
    .optional(),
  serviceTier: z.string().optional(),
  store: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Checks — S1–S13. S1–S5 and S7–S11 come from ./tts-checks, shared verbatim
// with `google.chat`; S6, S12 and S13 are this surface's own, because they are
// facts about the NARROWING rather than about the wire.
// ---------------------------------------------------------------------------

/** Modality enum values are compared case-insensitively (the guides mix cases). */
function normalizedModalities(params: AnyGenerateTtsBody): string[] {
  const requested: unknown = params.generationConfig?.responseModalities;
  if (!Array.isArray(requested)) return [];
  return requested
    .map((value) => (typeof value === "string" ? value.toUpperCase() : undefined))
    .filter((value): value is string => value !== undefined);
}

/**
 * S6 — the model-on-the-list gate.
 *
 * This is the check that makes a narrow surface honest: `google.tts` serves
 * TTS models, and a chat id here is not a validation subtlety, it is the wrong
 * endpoint. The message names the one that does serve it.
 *
 * The gate is by NAME rather than by catalog, so a TTS model unmodel does not
 * know yet still reaches the loose arm (with the pipeline's ordinary
 * `unknown_model` warning) instead of being refused outright.
 */
function checkTtsModel(
  params: AnyGenerateTtsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model;
  const id = stripModelsPrefix(model);
  if (isGeminiTtsModel(id)) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model"],
    model,
    message:
      `"${model}" is not a Gemini TTS model, so it cannot serve google.tts. ` +
      `The documented TTS ids are ${Object.keys(ttsModels).join(", ")}; ` +
      "for any other Gemini model use `chat` from `unmodel/google` (google.chat).",
    meta: { allowed: Object.keys(ttsModels), surface: "google.chat", source: GEMINI_TTS_DOCS_URL },
  });
}

/** The catalog's own opinion: this route returns audio, so the model must emit it. */
function checkAudioModality(
  params: AnyGenerateTtsBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined || info.modalities.output.includes("audio")) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model"],
    model: params.model,
    message: `"${params.model}" does not generate audio (output modalities: ${info.modalities.output.join(", ")}); google.tts synthesizes speech.`,
    meta: { outputModalities: [...info.modalities.output], source: GEMINI_TTS_DOCS_URL },
  });
}

/**
 * S1 + S12 — `responseModalities` must be exactly AUDIO.
 *
 * S1 (AUDIO missing) is the shared message, so a caller who hits it from
 * `google.chat` and a caller who hits it here read the same sentence. S12 —
 * an EXTRA modality alongside AUDIO — is this surface's own, because on a chat
 * body `["TEXT", "AUDIO"]` is a legitimate request for a model that serves it.
 */
function checkResponseModalities(
  params: AnyGenerateTtsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const requested = normalizedModalities(params);
  const path = ["generationConfig", "responseModalities"];
  checkAudioModalityRequested(requested, path, params.model, ctx);

  requested.forEach((value, i) => {
    if (value === "AUDIO") return;
    ctx.report({
      code: "invalid_enum_value",
      path: [...path, i],
      model: params.model,
      message: `\`generationConfig.responseModalities\` on google.tts is ["AUDIO"] and nothing else; got ${JSON.stringify(value)}.`,
      meta: { value, allowed: ["AUDIO"], source: GEMINI_TTS_DOCS_URL },
    });
  });
}

/** The part kinds a `generateContent` body may carry, minus the one this route takes. */
const REFUSED_PART_KINDS = [
  "inlineData",
  "fileData",
  "functionCall",
  "functionResponse",
  "executableCode",
  "codeExecutionResult",
  "toolCall",
  "toolResponse",
] as const;

/**
 * S13 — "TTS models can only receive text inputs and generate audio outputs."
 *
 * A part with no `text` at all is also refused: an empty part is not a
 * transcript, and the loose schema would otherwise pass `parts: [{}]` straight
 * to a 400.
 */
function checkTextOnlyParts(
  params: AnyGenerateTtsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  params.contents?.forEach((content, i) => {
    content?.parts?.forEach((part, j) => {
      const record = part as unknown as Record<string, unknown>;
      const refused = REFUSED_PART_KINDS.filter((kind) => record[kind] !== undefined);
      const path = ["contents", i, "parts", j];
      if (refused.length > 0) {
        ctx.report({
          code: "unsupported_capability",
          path,
          model: params.model,
          message:
            `TTS models can only receive text inputs; this part sets ${refused.join(" + ")}. ` +
            "To send audio TO a Gemini model use `stt` from `unmodel/google` (google.stt).",
          meta: { kinds: refused, surface: "google.stt", source: GEMINI_TTS_DOCS_URL },
        });
        return;
      }
      if (typeof record["text"] !== "string") {
        ctx.report({
          code: "invalid_shape",
          path,
          model: params.model,
          message: "each part on google.tts must set `text`; this one sets nothing.",
          meta: { source: GEMINI_TTS_DOCS_URL },
        });
      }
    });
  });
}

/** S2–S5 + S7–S11: the shared battery, at this surface's coordinates. */
function checkSpeech(
  params: AnyGenerateTtsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const config = params.generationConfig;
  // `enforceVoices` is unconditionally true here: every model this surface
  // accepts is a TTS model, which is exactly the condition `google.chat`
  // computes per request.
  checkSpeechConfig(
    config?.speechConfig,
    ["generationConfig", "speechConfig"],
    params.model,
    true,
    ctx,
  );
  checkAudioResponseFormat(
    config?.responseFormat?.audio,
    ["generationConfig", "responseFormat", "audio"],
    params.model,
    ctx,
  );
}

/** temperature / thinkingConfig / maxOutputTokens against the catalog row. */
function checkCapabilities(
  params: AnyGenerateTtsBody,
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
}

// ---------------------------------------------------------------------------
// Estimation — token-based, like chat: the transcript is billed as input text
// and the rendered audio as output tokens.
// ---------------------------------------------------------------------------

function estimate(params: AnyGenerateTtsBody, info: ModelInfo | undefined, ctx: PipelineContext) {
  let inputTokens = 0;
  for (const content of params.contents ?? []) {
    inputTokens += PER_MESSAGE_TOKEN_OVERHEAD;
    for (const part of content?.parts ?? []) {
      if (typeof part?.text === "string") inputTokens += ctx.tokenizer.count(part.text);
    }
  }

  // Worst case: the model renders the full requested/possible output. The
  // context bound the pipeline then applies is the doc-corrected 32k from
  // ./tts-models, not models.dev's 8192.
  const outputTokens = params.generationConfig?.maxOutputTokens ?? info?.limit.output ?? 0;
  const costUSD = computeCostUSD(info?.cost, { inputTokens, outputTokens });
  return costUSD === undefined ? { inputTokens } : { inputTokens, costUSD };
}

// ---------------------------------------------------------------------------
// Finalize: wire body (model stripped — it lives in the URL) + .toSdk(target)
// + .request
// ---------------------------------------------------------------------------

/**
 * Endpoint URL for a TTS model id. Accepts both the bare id
 * ("gemini-2.5-flash-preview-tts") and the REST-documented "models/…" form —
 * both yield the same URL.
 */
export function generateTtsUrl(model: string): string {
  return googleModelUrl(model, "generateContent");
}

/**
 * The **streaming** URL for the same request:
 * `models/{model}:streamGenerateContent?alt=sse`.
 *
 * Offered as a URL builder rather than a validated surface on purpose. "TTS
 * does not support streaming for models older than version 3.1 (streaming is
 * supported for gemini-3.1-flash-tts-preview and newer)" — so the same body
 * that validates here streams only on the ids in
 * {@link GEMINI_TTS_STREAMING_MODEL_IDS}. unmodel validates the unary route,
 * which is what `.request.url` points at; if you stream, check the model
 * against that set yourself:
 *
 * ```ts
 * const params = tts({ model: "gemini-3.1-flash-tts-preview", … });
 * await fetch(ttsStreamUrl("gemini-3.1-flash-tts-preview"), {
 *   method: "POST",
 *   headers: { ...params.request.headers, "x-goog-api-key": key },
 *   body: JSON.stringify(params),
 * });
 * ```
 */
export function ttsStreamUrl(model: string): string {
  return `${googleModelUrl(model, "streamGenerateContent")}?alt=sse`;
}

/**
 * Whether a TTS model id can be driven through {@link ttsStreamUrl}.
 *
 * The documented rule, as a predicate, so the check a streaming caller has to
 * make is a function call rather than a sentence they have to remember: "TTS
 * does not support streaming for models older than version 3.1". It is NOT
 * wired into the validator — `tts()` validates the unary route, and a body
 * that is valid there is valid on both — so calling this is the caller's
 * decision at the point where they choose the URL.
 */
export function ttsSupportsStreaming(model: string): boolean {
  return GEMINI_TTS_STREAMING_MODEL_IDS.includes(
    stripModelsPrefix(model) as (typeof GEMINI_TTS_STREAMING_MODEL_IDS)[number],
  );
}

function finalize(params: AnyGenerateTtsBody): unknown {
  const { model, ...body } = params;
  const request: RequestMeta = {
    url: generateTtsUrl(model),
    method: "POST",
    headers: JSON_HEADERS,
  };
  // The same re-shape `google.chat` performs, from the same function — a body
  // that is valid on both surfaces must produce the same SDK params on both.
  return toValidated(body, request, { sdk: { google: () => geminiSdkParams(model, body) } });
}

const validator = createValidator<AnyGenerateTtsBody, unknown>({
  endpoint: "google.tts",
  schema,
  modelId: (params) => stripModelsPrefix(params.model),
  catalog: ttsModels,
  checks: [
    checkTtsModel,
    checkAudioModality,
    checkResponseModalities,
    checkTextOnlyParts,
    checkSpeech,
    checkCapabilities,
  ],
  estimate,
  promptPath: ["contents"],
  finalize,
});

/**
 * Validates raw wire params for Gemini text-to-speech —
 * `models.{model}:generateContent` with `responseModalities: ["AUDIO"]`.
 *
 * The returned object's enumerable props are the exact fetch JSON body —
 * `model` is stripped, because on the wire it lives only in the URL
 * (`.request.url` already has it interpolated). `.toSdk("google")` re-shapes
 * the body for `@google/genai`'s `ai.models.generateContent()`. Auth is your
 * job: add an `x-goog-api-key` header (or `?key=`) when fetching.
 *
 * ```ts
 * const params = google.tts({
 *   model: "gemini-2.5-flash-preview-tts",
 *   contents: [{ parts: [{ text: "Say cheerfully: Have a wonderful day!" }] }],
 *   generationConfig: {
 *     responseModalities: ["AUDIO"],
 *     speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
 *   },
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, "x-goog-api-key": process.env.GEMINI_API_KEY! },
 *   body: JSON.stringify(params),
 * }).then((r) => r.json());
 * // res.candidates[0].content.parts[0].inlineData.data is base64 PCM (24 kHz, mono, 16-bit)
 * ```
 */
export const tts = validator as unknown as {
  <M extends GoogleTtsModelInput, T extends GoogleTtsArm<M>>(
    params: T & GoogleTtsArm<M> & { model: M } & ExactKeys<T, GoogleTtsArm<M>>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "model">, TtsSdkTargets<T>>;
  safe<M extends GoogleTtsModelInput, T extends GoogleTtsArm<M>>(
    params: T & GoogleTtsArm<M> & { model: M } & ExactKeys<T, GoogleTtsArm<M>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "model">, TtsSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
} & ValidatorProviderCarrier<"google">;

export type { GoogleTtsModelId };
