/**
 * `unmodel/minimax/types` — every `minimax` type, and nothing else.
 *
 * **Zero runtime.** Every export in this module is a `type`, so the emitted
 * JavaScript is an empty module: importing it adds nothing to a bundle. That
 * is pinned, against a real build, by `test/types-entries.test.ts`.
 *
 * Reach for this entry when you want unmodel's doc-corrected request shapes at
 * compile time and are sending the request yourself — with `fetch`, with the
 * vendor SDK, or through your own client:
 *
 * ```ts
 * import type { ChatBody } from "unmodel/minimax/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies ChatBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`T2aParams`, `VideoGenerationParams`,
 *   `VideoGenerationV2Params`, …) — re-exported verbatim, because they are
 *   how you find the endpoint in the provider's own documentation;
 * - the **uniform category aliases** (`ChatBody`, `TtsBody`, `VideoBody`, …)
 *   — one per endpoint address this provider serves, named after the word you
 *   already type at `unmodel/minimax` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/minimax`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `minimax.chat` → `ChatBody`
 * - `minimax.tts` → `TtsBody`
 * - `minimax.video` → `VideoBody`
 * - `minimax.videoV2` → `VideoV2Body`
 */

import type { T2aParams } from "./tts";
import type { VideoGenerationParams } from "./video";
import type { VideoGenerationV2Params } from "./video-v2";
import type { ChatCompletionsBodyBase } from "../openai-compatible/wire";
import type { MinimaxTextModelId } from "../../catalog/minimax.gen";

export type {
  MinimaxModelId,
  MinimaxTextModelId,
  MinimaxImageModelId,
  MinimaxAudioModelId,
  MinimaxVideoModelId,
} from "../../catalog/minimax.gen";

export type {
  T2aParams,
  MinimaxVoiceSetting,
  MinimaxAudioSetting,
  MinimaxTimbreWeight,
  MinimaxVoiceModify,
  MinimaxEmotion,
  MinimaxAudioFormat,
  MinimaxLanguageBoost,
} from "./tts";

export type {
  VideoGenerationParams,
  MinimaxSubjectReference,
  MinimaxVideoResolution,
} from "./video";

export type {
  VideoGenerationV2Params,
  MinimaxV2ContentItem,
  MinimaxV2ContentType,
  MinimaxV2Role,
  MinimaxMediaUrl,
  MinimaxVideoV2Resolution,
  MinimaxVideoV2Duration,
  MinimaxVideoV2Ratio,
} from "./video-v2";

export type {
  MinimaxMediaModelId,
  MinimaxSpeechModelId,
  MinimaxVideoGenerationModelId,
  MinimaxVideoV2ModelId,
} from "./models";

// The OpenAI-compatible chat dialect this overlay speaks. The wire leaf is the
// same one `minimax.chat` validates against, so what type-checks here is
// what that validator accepts.
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

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type ChatBody<ModelId extends string = MinimaxTextModelId> = ChatCompletionsBodyBase<ModelId>;
export type TtsBody = T2aParams;
export type VideoBody = VideoGenerationParams;
export type VideoV2Body = VideoGenerationV2Params;
