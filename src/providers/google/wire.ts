import { z } from "zod";
import type { GoogleTextModelId } from "../../catalog/google.gen";

// ---------------------------------------------------------------------------
// Wire leaf for POST .../models/{model}:generateContent: the wire types and
// the zod schema, and nothing else. This module imports only zod and
// type-only catalog ids — no pipeline, no validator, no checks — so
// retarget/translate machinery can depend on the Gemini dialect without
// creating a cycle back through ./generate-content.ts. Enforced by
// test/import-graph.test.ts.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Wire types — mirror the raw REST body of
// POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
// exactly (camelCase JSON). Reference: https://ai.google.dev/api/generate-content
// NOTE: this wire shape differs from @google/genai's SDK shape — the SDK nests
// generationConfig fields (plus systemInstruction/tools/toolConfig/
// safetySettings/cachedContent) inside a single `config` object. `.toSdk("google")`
// performs that re-shaping.
// ---------------------------------------------------------------------------

export type GoogleRole = "user" | "model";

/**
 * The wire Blob is exactly {mimeType, data}. NOTE: `displayName` is a
 * Vertex AI-only field — generativelanguage 400s on unknown fields, so it is
 * deliberately absent here (a part-level warning fires if it is passed).
 */
export interface GoogleInlineData {
  /** IANA MIME type, e.g. "image/png", "audio/mp3", "video/mp4". */
  mimeType: string;
  /** Base64-encoded bytes. */
  data: string;
}

/** The wire FileData is exactly {fileUri, mimeType} — `displayName` is Vertex AI-only (see GoogleInlineData). */
export interface GoogleFileData {
  /** Files API URI, e.g. "https://generativelanguage.googleapis.com/v1beta/files/…". */
  fileUri: string;
  mimeType?: string;
}

export interface GoogleFunctionCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

export interface GoogleFunctionResponse {
  id?: string;
  name: string;
  response: Record<string, unknown>;
}

export interface GoogleExecutableCode {
  id?: string;
  language?: string;
  code?: string;
}

export interface GoogleCodeExecutionResult {
  /** Matches the `id` of the corresponding executableCode part. */
  id?: string;
  outcome?: string;
  output?: string;
}

export interface GoogleVideoMetadata {
  /** e.g. "60s". */
  startOffset?: string;
  endOffset?: string;
  fps?: number;
}

/**
 * A server-side tool call predicted by the model (e.g. Google Search / URL
 * context); the client echoes it back verbatim in a subsequent turn together
 * with the matching `toolResponse`.
 */
export interface GoogleToolCall {
  id?: string;
  toolName?: string;
  /** e.g. "GOOGLE_SEARCH_WEB", "URL_CONTEXT", "GOOGLE_MAPS", "FILE_SEARCH". */
  toolType?: string;
  args?: Record<string, unknown>;
}

/** The output of a server-side `toolCall` execution, passed back by the client. */
export interface GoogleToolResponse {
  /** Matches the `id` of the corresponding `toolCall`. */
  id?: string;
  toolType?: string;
  response?: Record<string, unknown>;
}

/** Exactly one of the part-kind keys (text/inlineData/fileData/functionCall/functionResponse/executableCode/codeExecutionResult/toolCall/toolResponse) must be set. */
export interface GooglePart {
  text?: string;
  inlineData?: GoogleInlineData;
  fileData?: GoogleFileData;
  functionCall?: GoogleFunctionCall;
  functionResponse?: GoogleFunctionResponse;
  executableCode?: GoogleExecutableCode;
  codeExecutionResult?: GoogleCodeExecutionResult;
  toolCall?: GoogleToolCall;
  toolResponse?: GoogleToolResponse;
  thought?: boolean;
  thoughtSignature?: string;
  videoMetadata?: GoogleVideoMetadata;
  /** Per-part media tokenization resolution, e.g. { level: "MEDIA_RESOLUTION_LOW" }. */
  mediaResolution?: { level?: string };
  /** How video parts are processed for understanding ("STATIC" | "AGENTIC"); ignored for non-video parts. */
  mediaProcessing?: string;
  /** Custom client-side metadata associated with the part. */
  partMetadata?: Record<string, unknown>;
}

/**
 * Wire roles are only "user" and "model" — functionResponse parts ride in a
 * user-role Content. `role` may be omitted (the service defaults to "user").
 */
export interface GoogleContent {
  role?: GoogleRole;
  parts: GooglePart[];
}

export interface GoogleFunctionDeclaration {
  name: string;
  description?: string;
  behavior?: string;
  /** OpenAPI-subset schema (REST `Schema` object). */
  parameters?: Record<string, unknown>;
  parametersJsonSchema?: unknown;
  response?: Record<string, unknown>;
  responseJsonSchema?: unknown;
}

export interface GoogleTool {
  functionDeclarations?: GoogleFunctionDeclaration[];
  /** Enable Google Search grounding: `{ googleSearch: {} }`. */
  googleSearch?: Record<string, unknown>;
  googleSearchRetrieval?: Record<string, unknown>;
  /** Enable code execution: `{ codeExecution: {} }`. */
  codeExecution?: Record<string, unknown>;
  urlContext?: Record<string, unknown>;
  fileSearch?: Record<string, unknown>;
  computerUse?: Record<string, unknown>;
  /** Ground responses with geospatial context. */
  googleMaps?: Record<string, unknown>;
  /** MCP servers to connect to. */
  mcpServers?: Array<Record<string, unknown>>;
}

export interface GoogleFunctionCallingConfig {
  mode?: "AUTO" | "ANY" | "NONE" | "VALIDATED";
  allowedFunctionNames?: string[];
}

export interface GoogleToolConfig {
  functionCallingConfig?: GoogleFunctionCallingConfig;
}

export type GoogleHarmCategory =
  | "HARM_CATEGORY_HARASSMENT"
  | "HARM_CATEGORY_HATE_SPEECH"
  | "HARM_CATEGORY_SEXUALLY_EXPLICIT"
  | "HARM_CATEGORY_DANGEROUS_CONTENT"
  | "HARM_CATEGORY_CIVIC_INTEGRITY"
  | "HARM_CATEGORY_JAILBREAK";

export type GoogleHarmBlockThreshold =
  | "HARM_BLOCK_THRESHOLD_UNSPECIFIED"
  | "BLOCK_LOW_AND_ABOVE"
  | "BLOCK_MEDIUM_AND_ABOVE"
  | "BLOCK_ONLY_HIGH"
  | "BLOCK_NONE"
  | "OFF";

export interface GoogleSafetySetting {
  category: GoogleHarmCategory;
  threshold: GoogleHarmBlockThreshold;
}

/**
 * `enum (ThinkingLevel)` — "Recommended for Gemini 3 or later models. Use with
 * earlier models results in an error."
 */
export type GoogleThinkingLevel =
  | "THINKING_LEVEL_UNSPECIFIED"
  | "MINIMAL"
  | "LOW"
  | "MEDIUM"
  | "HIGH";

export interface GoogleThinkingConfig {
  includeThoughts?: boolean;
  /** Tokens; 0 disables thinking, -1 means automatic. */
  thinkingBudget?: number;
  thinkingLevel?: GoogleThinkingLevel | (string & {});
}

/**
 * `enum (Modality)`. The REST reference spells the values in SCREAMING_CASE,
 * but the image-generation guide's own REST samples send Title case
 * ("Image"); both spellings are therefore accepted, and the runtime check
 * compares case-insensitively.
 */
export type GoogleModality =
  | "TEXT"
  | "IMAGE"
  | "AUDIO"
  | "Text"
  | "Image"
  | "Audio"
  | "MODALITY_UNSPECIFIED";

/** `PrebuiltVoiceConfig` — "The name of the preset voice to use." */
export interface GooglePrebuiltVoiceConfig {
  voiceName?: string;
}

/** `VoiceConfig` — a oneof whose only documented member is prebuiltVoiceConfig. */
export interface GoogleVoiceConfig {
  prebuiltVoiceConfig?: GooglePrebuiltVoiceConfig;
}

/** `SpeakerVoiceConfig` — both fields are documented Required. */
export interface GoogleSpeakerVoiceConfig {
  /** "The name of the speaker to use. Should be the same as in the prompt." */
  speaker: string;
  voiceConfig: GoogleVoiceConfig;
}

/** `MultiSpeakerVoiceConfig` — up to 2 speakers per the speech-generation guide. */
export interface GoogleMultiSpeakerVoiceConfig {
  speakerVoiceConfigs: GoogleSpeakerVoiceConfig[];
}

/** `SpeechConfig` — voiceConfig and multiSpeakerVoiceConfig are mutually exclusive. */
export interface GoogleSpeechConfig {
  voiceConfig?: GoogleVoiceConfig;
  multiSpeakerVoiceConfig?: GoogleMultiSpeakerVoiceConfig;
  /** IETF BCP-47 language code, e.g. "en-US". */
  languageCode?: string;
}

/**
 * Aspect ratios `ImageConfig.aspectRatio` documents. NOTE: @google/genai's
 * own `ImageConfig` docstring lists only eight of these — 1:4, 4:1, 1:8, 8:1,
 * 4:5 and 5:4 are documented by the REST reference but missing from the SDK.
 */
export type GoogleImageAspectRatio =
  | "1:1"
  | "1:4"
  | "4:1"
  | "1:8"
  | "8:1"
  | "2:3"
  | "3:2"
  | "3:4"
  | "4:3"
  | "4:5"
  | "5:4"
  | "9:16"
  | "16:9"
  | "21:9";

/** `ImageConfig.imageSize` — "Supported values are 512, 1K, 2K, 4K". The SDK omits "512". */
export type GoogleImageSize = "512" | "1K" | "2K" | "4K";

/**
 * The proto-JSON enum-name spelling of a `GoogleImageAspectRatio`. The REST
 * reference types `aspectRatio` as `enum (AspectRatio)` while the
 * image-generation guide's REST samples pass the plain "16:9" form; the pages
 * conflict, so BOTH spellings validate (the runtime check expands each allowed
 * ratio to its enum name via `allowedSpellings`).
 *
 * Hand-written, one name per GoogleImageAspectRatio arm: keep in sync with
 * GEMINI_IMAGE_ASPECT_RATIO_ENUM_NAMES in ./constraints — this module is a
 * wire LEAF (test/import-graph.test.ts: "a wire leaf may import only zod,
 * sibling wire leaves, type-only catalog ids and type-only core types"), so it
 * cannot reach into constraints.ts to derive the union, not even type-only.
 */
export type GoogleImageAspectRatioEnumName =
  | "ASPECT_RATIO_ONE_BY_ONE"
  | "ASPECT_RATIO_ONE_BY_FOUR"
  | "ASPECT_RATIO_FOUR_BY_ONE"
  | "ASPECT_RATIO_ONE_BY_EIGHT"
  | "ASPECT_RATIO_EIGHT_BY_ONE"
  | "ASPECT_RATIO_TWO_BY_THREE"
  | "ASPECT_RATIO_THREE_BY_TWO"
  | "ASPECT_RATIO_THREE_BY_FOUR"
  | "ASPECT_RATIO_FOUR_BY_THREE"
  | "ASPECT_RATIO_FOUR_BY_FIVE"
  | "ASPECT_RATIO_FIVE_BY_FOUR"
  | "ASPECT_RATIO_NINE_BY_SIXTEEN"
  | "ASPECT_RATIO_SIXTEEN_BY_NINE"
  | "ASPECT_RATIO_TWENTY_ONE_BY_NINE";

/**
 * The proto-JSON enum-name spelling of a `GoogleImageSize`. Keep in sync with
 * GEMINI_IMAGE_SIZE_ENUM_NAMES in ./constraints (see the note above on why
 * this union is hand-written rather than derived).
 */
export type GoogleImageSizeEnumName =
  | "IMAGE_SIZE_FIVE_TWELVE"
  | "IMAGE_SIZE_ONE_K"
  | "IMAGE_SIZE_TWO_K"
  | "IMAGE_SIZE_FOUR_K";

/**
 * `ImageConfig` — config for native (Nano Banana) image generation.
 * Per-model aspect-ratio / size support differs; see
 * GEMINI_IMAGE_MODEL_RULES in ./constraints.
 */
export interface GoogleImageConfig {
  /** Either documented spelling: "16:9" or ASPECT_RATIO_SIXTEEN_BY_NINE. */
  aspectRatio?: GoogleImageAspectRatio | GoogleImageAspectRatioEnumName;
  /** Either documented spelling: "2K" or IMAGE_SIZE_TWO_K. */
  imageSize?: GoogleImageSize | GoogleImageSizeEnumName;
  /**
   * Present on @google/genai's ImageConfig ("ALLOW_ALL, ALLOW_ADULT,
   * ALLOW_NONE") but absent from the REST reference's ImageConfig message —
   * accepted and left unvalidated (docs are silent, so we stay permissive).
   */
  personGeneration?: string;
  /** @google/genai: "This field is not supported in Gemini API." */
  outputMimeType?: never;
  /** @google/genai: "This field is not supported in Gemini API." */
  outputCompressionQuality?: never;
  /** @google/genai: "This field is not supported in Gemini API." */
  imageOutputOptions?: never;
  /** @google/genai: "This field is not supported in Gemini API." */
  prominentPeople?: never;
}

/** `TextResponseFormat`. */
export interface GoogleTextResponseFormat {
  mimeType?: "MIME_TYPE_UNSPECIFIED" | "APPLICATION_JSON" | "TEXT_PLAIN" | (string & {});
  /** JSON schema; "Only applicable when mimeType is APPLICATION_JSON". */
  schema?: unknown;
}

/** `AudioResponseFormat`. */
export interface GoogleAudioResponseFormat {
  mimeType?:
    | "MIME_TYPE_UNSPECIFIED"
    | "AUDIO_MP3"
    | "AUDIO_OGG_OPUS"
    | "AUDIO_L16"
    | "AUDIO_WAV"
    | "AUDIO_ALAW"
    | "AUDIO_MULAW"
    | (string & {});
  delivery?: "DELIVERY_UNSPECIFIED" | "INLINE" | "URI" | (string & {});
  /**
   * Output sample rate in Hz. Deliberately a bare `number`: the reference
   * enumerates no values and gives no range for it, and inventing a preset
   * list ("24000", "16000") would advertise an allowed-value space Google has
   * not published.
   */
  sampleRate?: number;
  /** "Only applicable for compressed formats (MP3, Opus)." No documented values. */
  bitRate?: number;
}

/**
 * `ImageResponseFormat`. The reference types `aspectRatio`/`imageSize` as
 * proto enums (ASPECT_RATIO_SIXTEEN_BY_NINE / IMAGE_SIZE_TWO_K) while the
 * image-generation guide's REST samples pass the plain "16:9" / "2K"
 * spellings — both are accepted, and the runtime check allows either.
 */
export interface GoogleImageResponseFormat {
  mimeType?: "MIME_TYPE_UNSPECIFIED" | "IMAGE_JPEG" | (string & {});
  delivery?: "DELIVERY_UNSPECIFIED" | "INLINE" | "URI" | (string & {});
  /** Either documented spelling: "16:9" or ASPECT_RATIO_SIXTEEN_BY_NINE. */
  aspectRatio?: GoogleImageAspectRatio | GoogleImageAspectRatioEnumName;
  /** Either documented spelling: "2K" or IMAGE_SIZE_TWO_K. */
  imageSize?: GoogleImageSize | GoogleImageSizeEnumName;
}

/**
 * `ResponseFormatConfig` — per-modality output configuration. For image
 * generation this is the spelling the current guide's REST samples use
 * (`responseFormat.image.aspectRatio`); `imageConfig` is the equivalent
 * flat field and both are validated identically.
 */
export interface GoogleResponseFormatConfig {
  text?: GoogleTextResponseFormat;
  audio?: GoogleAudioResponseFormat;
  image?: GoogleImageResponseFormat;
}

export interface GoogleGenerationConfig {
  /** "The set of character sequences (up to 5) that will stop output generation." */
  stopSequences?: string[];
  responseMimeType?: string;
  /** OpenAPI-subset schema (REST `Schema` object); requires a compatible responseMimeType. */
  responseSchema?: Record<string, unknown>;
  /** Standard JSON Schema alternative to responseSchema. */
  responseJsonSchema?: unknown;
  responseModalities?: Array<GoogleModality>;
  candidateCount?: number;
  maxOutputTokens?: number;
  /** "Values can range from [0.0, 2.0]." */
  temperature?: number;
  /** No documented range — "the default value varies by Model". */
  topP?: number;
  /** No documented range; models running with nucleus sampling reject it entirely. */
  topK?: number;
  seed?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  responseLogprobs?: boolean;
  /** "Only valid if responseLogprobs=True … must be in the range of [0, 20]." */
  logprobs?: number;
  enableEnhancedCivicAnswers?: boolean;
  thinkingConfig?: GoogleThinkingConfig;
  mediaResolution?:
    | "MEDIA_RESOLUTION_UNSPECIFIED"
    | "MEDIA_RESOLUTION_LOW"
    | "MEDIA_RESOLUTION_MEDIUM"
    | "MEDIA_RESOLUTION_HIGH";
  /** Speech generation config — Gemini TTS rides generateContent, not a separate endpoint. */
  speechConfig?: GoogleSpeechConfig;
  /** Native image generation config (Nano Banana). */
  imageConfig?: GoogleImageConfig;
  /** Per-modality output format configuration (REST `ResponseFormatConfig`). */
  responseFormat?: GoogleResponseFormatConfig;
  /** Config for translation (REST `TranslationConfig`). */
  translationConfig?: Record<string, unknown>;
  /** Detect emotions and adapt responses accordingly. */
  enableAffectiveDialog?: boolean;
  /** Config for audio transcription / speech recognition (REST `AudioTranscriptionConfig`). */
  audioTranscriptionConfig?: Record<string, unknown>;
}

/** Pricing/performance service tier (wire enum values are lowercase). */
export type GoogleServiceTier = "unspecified" | "standard" | "flex" | "priority";

/**
 * Raw wire body for generateContent plus `model`. On the wire the model id
 * lives ONLY in the URL path — the validated output strips `model` from the
 * enumerable body and interpolates it into `.request.url` instead.
 */
export interface GenerateContentBody {
  model: GoogleTextModelId | (string & {});
  contents: GoogleContent[];
  /** Content whose role is ignored; text parts only in practice. */
  systemInstruction?: GoogleContent;
  tools?: GoogleTool[];
  toolConfig?: GoogleToolConfig;
  safetySettings?: GoogleSafetySetting[];
  generationConfig?: GoogleGenerationConfig;
  /** Name of a cached content, e.g. "cachedContents/abc123". */
  cachedContent?: string;
  /** The service tier of the request. */
  serviceTier?: GoogleServiceTier;
  /**
   * Request-level logging opt-in/out; takes precedence over the
   * project-level logging config. NOT carried into `.toSdk("google")` — @google/genai
   * has no equivalent config field (raw fetch keeps it).
   */
  store?: boolean;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through; the pipeline warns on unknown
// top-level keys by introspecting the shape).
// ---------------------------------------------------------------------------

const PART_KINDS = [
  "text",
  "inlineData",
  "fileData",
  "functionCall",
  "functionResponse",
  "executableCode",
  "codeExecutionResult",
  "toolCall",
  "toolResponse",
] as const;

const partSchema = z.looseObject({
  text: z.string().optional(),
  inlineData: z.looseObject({ mimeType: z.string(), data: z.string() }).optional(),
  fileData: z.looseObject({ fileUri: z.string(), mimeType: z.string().optional() }).optional(),
  functionCall: z
    .looseObject({ name: z.string(), args: z.record(z.string(), z.unknown()).optional() })
    .optional(),
  functionResponse: z
    .looseObject({ name: z.string(), response: z.record(z.string(), z.unknown()) })
    .optional(),
  executableCode: z.looseObject({ language: z.string().optional(), code: z.string().optional() }).optional(),
  codeExecutionResult: z
    .looseObject({ outcome: z.string().optional(), output: z.string().optional() })
    .optional(),
  toolCall: z
    .looseObject({
      id: z.string().optional(),
      toolName: z.string().optional(),
      toolType: z.string().optional(),
      args: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  toolResponse: z
    .looseObject({
      id: z.string().optional(),
      toolType: z.string().optional(),
      response: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  thought: z.boolean().optional(),
  thoughtSignature: z.string().optional(),
});

const contentSchema = z.looseObject({
  role: z.enum(["user", "model"]).optional(),
  parts: z.array(partSchema),
});

const voiceConfigSchema = z.looseObject({
  prebuiltVoiceConfig: z.looseObject({ voiceName: z.string().optional() }).optional(),
});

/**
 * Shared by `generationConfig.imageConfig` and
 * `generationConfig.responseFormat.image` — the two first-party spellings of
 * the same image-generation knobs.
 */
const imageConfigSchema = z.looseObject({
  aspectRatio: z.string().optional(),
  imageSize: z.string().optional(),
});

const generationConfigSchema = z.looseObject({
  stopSequences: z.array(z.string()).optional(),
  responseMimeType: z.string().optional(),
  responseSchema: z.record(z.string(), z.unknown()).optional(),
  responseJsonSchema: z.unknown().optional(),
  responseModalities: z.array(z.string()).optional(),
  candidateCount: z.number().int().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  topK: z.number().optional(),
  seed: z.number().int().optional(),
  presencePenalty: z.number().optional(),
  frequencyPenalty: z.number().optional(),
  responseLogprobs: z.boolean().optional(),
  logprobs: z.number().int().optional(),
  thinkingConfig: z
    .looseObject({
      includeThoughts: z.boolean().optional(),
      thinkingBudget: z.number().int().optional(),
      thinkingLevel: z.string().optional(),
    })
    .optional(),
  mediaResolution: z.string().optional(),
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
  imageConfig: imageConfigSchema.optional(),
  responseFormat: z
    .looseObject({
      text: z.looseObject({}).optional(),
      audio: z.looseObject({}).optional(),
      image: imageConfigSchema.optional(),
    })
    .optional(),
});

/** Loose top-level schema for the generateContent wire body. */
export const generateContentSchema = z
  .looseObject({
    model: z.string(),
    contents: z.array(contentSchema).min(1, "contents must contain at least one Content"),
    systemInstruction: contentSchema.optional(),
    tools: z.array(z.looseObject({})).optional(),
    toolConfig: z.looseObject({}).optional(),
    safetySettings: z.array(z.looseObject({ category: z.string(), threshold: z.string() })).optional(),
    generationConfig: generationConfigSchema.optional(),
    cachedContent: z.string().optional(),
    serviceTier: z.string().optional(),
    store: z.boolean().optional(),
  })
  .superRefine((value, refCtx) => {
    value.contents.forEach((content, i) => {
      content.parts.forEach((part, j) => {
        const kinds = PART_KINDS.filter((kind) => (part as Record<string, unknown>)[kind] !== undefined);
        if (kinds.length !== 1) {
          refCtx.addIssue({
            code: "custom",
            path: ["contents", i, "parts", j],
            message: `each part must set exactly one of ${PART_KINDS.join(", ")}; found ${
              kinds.length === 0 ? "none" : kinds.join(" + ")
            }.`,
          });
        }
      });
    });
  });
