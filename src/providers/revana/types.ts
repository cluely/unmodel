/**
 * `unmodel/revana/types` — every `revana` type, and nothing else.
 *
 * **Zero runtime.** Every export in this module is a `type`, so the emitted
 * JavaScript is an empty module: importing it adds nothing to a bundle. That
 * is pinned, against a real build, by `test/types-entries.test.ts`.
 *
 * Reach for this entry when you want unmodel's doc-corrected request shapes at
 * compile time and are sending the request yourself:
 *
 * ```ts
 * import type { VideoBody } from "unmodel/revana/types";
 *
 * const body = {
 *   model: "veo-3.1",
 *   input: { prompt: "A fox walks through snow", resolution: "1080p", duration: 8 },
 * } satisfies VideoBody<"veo-3.1">;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** — `GenerationRequest`, `ModelInput`, `SeedanceInput`,
 *   `NemesisInput`, `Generation`, `Quote`: the schema names of Revana's own
 *   OpenAPI document;
 * - the **uniform category aliases** (`VideoBody`, `ImageBody`, `TtsBody`, …) —
 *   one per endpoint address, named after the word you already type at
 *   `unmodel/revana` and on the CLI. Eight of them are the same wire type over
 *   a different id union, because eight addresses share one route.
 *
 * Runtime values — the validators, the URL helpers, the catalog, the price
 * tables — stay on `unmodel/revana`.
 *
 * Endpoints:
 *
 * - `revana.video` → `VideoBody`
 * - `revana.lipsync` → `LipsyncBody`
 * - `revana.avatar` → `AvatarBody`
 * - `revana.image` → `ImageBody`
 * - `revana.imageEdit` → `ImageEditBody`
 * - `revana.upscale` → `UpscaleBody`
 * - `revana.tts` → `TtsBody`
 * - `revana.music` → `MusicBody`
 * - `revana.chat` → `ChatBody`
 */

import type { ChatCompletionsBodyBase } from "../openai-compatible/wire";
import type {
  RevanaAvatarModelId,
  RevanaChatModelId,
  RevanaImageEditModelId,
  RevanaImageModelId,
  RevanaLipsyncModelId,
  RevanaMusicModelId,
  RevanaTtsModelId,
  RevanaUpscaleModelId,
  RevanaVideoModelId,
} from "./gen/ids.gen";
import type { GenerationRequest, RevanaMediaModelId } from "./generation-wire";

export type {
  Generation,
  GenerationError,
  GenerationErrorCode,
  GenerationOutput,
  GenerationProgress,
  GenerationRequest,
  GenerationTask,
  ImageModelInput,
  InputFor,
  ModelInput,
  MusicModelInput,
  NemesisInput,
  NemesisRole,
  Quote,
  RevanaErrorBody,
  RevanaMediaModelId,
  RevanaMediaUrl,
  SeedanceInput,
  SpeechDialogueLine,
  SpeechModelInput,
  UnknownModelRequest,
  VideoModelInput,
} from "./generation-wire";

export type { GenerationValidator, RequestFor } from "./generation";

export type {
  RevanaAvatarModelId,
  RevanaChatModelId,
  RevanaImageEditModelId,
  RevanaImageModelId,
  RevanaLipsyncModelId,
  RevanaMusicModelId,
  RevanaTtsModelId,
  RevanaUpscaleModelId,
  RevanaVideoModelId,
} from "./gen/ids.gen";

export type {
  RevanaDurationRange,
  RevanaListedPrice,
  RevanaMediaField,
  RevanaModelShape,
  RevanaRate,
  RevanaSpeechField,
  RevanaTask,
} from "./shape-types";

/**
 * Every Revana model id. Spelled from the id unions rather than re-exported
 * from `./models`: that module is the merged catalog — every row of every
 * kind — and a types entry must not be the thing that reaches it.
 */
export type RevanaModelId = RevanaMediaModelId | RevanaChatModelId;

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost. Each takes the model id,
// because the `input` a Revana request carries is chosen by it.
// ---------------------------------------------------------------------------

export type VideoBody<M extends RevanaVideoModelId = RevanaVideoModelId> = GenerationRequest<M>;
export type LipsyncBody<M extends RevanaLipsyncModelId = RevanaLipsyncModelId> = GenerationRequest<M>;
export type AvatarBody<M extends RevanaAvatarModelId = RevanaAvatarModelId> = GenerationRequest<M>;
export type ImageBody<M extends RevanaImageModelId = RevanaImageModelId> = GenerationRequest<M>;
export type ImageEditBody<M extends RevanaImageEditModelId = RevanaImageEditModelId> =
  GenerationRequest<M>;
export type UpscaleBody<M extends RevanaUpscaleModelId = RevanaUpscaleModelId> = GenerationRequest<M>;
export type TtsBody<M extends RevanaTtsModelId = RevanaTtsModelId> = GenerationRequest<M>;
export type MusicBody<M extends RevanaMusicModelId = RevanaMusicModelId> = GenerationRequest<M>;
export type ChatBody = ChatCompletionsBodyBase<RevanaChatModelId>;

// The OpenAI-compatible chat dialect `revana.chat` speaks. The wire leaf is the
// same one that validator checks against, so what type-checks here is what it
// accepts.
export type {
  ChatCompletionsBodyBase,
  ChatMessage,
  ChatSystemMessage,
  ChatDeveloperMessage,
  ChatUserMessage,
  ChatAssistantMessage,
  ChatToolMessage,
  ChatFunctionMessage,
  ChatUserContentPart,
  ChatTextPart,
  ChatImagePart,
  ChatAudioPart,
  ChatFilePart,
  ChatRefusalPart,
  ChatPromptCacheBreakpoint,
  ChatTool,
  ChatFunctionTool,
  ChatCustomTool,
  ChatToolCall,
  ChatFunctionToolCall,
  ChatCustomToolCall,
  ChatToolChoice,
  ChatResponseFormat,
} from "../openai-compatible/wire";

export type {
  ChatChoiceLike,
  ChatCompletionLike,
  ChatFinishReason,
} from "../openai-compatible/check";
