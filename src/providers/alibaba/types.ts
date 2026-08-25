/**
 * `unmodel/alibaba/types` — every `alibaba` type, and nothing else.
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
 * import type { ChatBody } from "unmodel/alibaba/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies ChatBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`ChatMessage`, `ChatSystemMessage`,
 *   `ChatDeveloperMessage`, `VideoSynthesisParams`, `TtsGenerationParams`, …)
 *   — re-exported verbatim, because they are how you find the endpoint in the
 *   provider's own documentation;
 * - the **uniform category aliases** (`ChatBody`, `VideoBody`, `TtsBody`) —
 *   one per endpoint address this provider serves, named after the word you
 *   already type at `unmodel/alibaba` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/alibaba`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `alibaba.chat` → `ChatBody`
 * - `alibaba.video` → `VideoBody` (DashScope video-synthesis, async)
 * - `alibaba.tts` → `TtsBody` (DashScope multimodal-generation)
 */

import type { ChatCompletionsBodyBase } from "../openai-compatible/wire";
import type { AlibabaTextModelId } from "../../catalog/alibaba.gen";
import type { VideoSynthesisParams } from "./video";
import type { TtsGenerationParams } from "./tts";

export type {
  AlibabaModelId,
  AlibabaTextModelId,
  AlibabaImageModelId,
  AlibabaAudioModelId,
  AlibabaVideoModelId,
} from "../../catalog/alibaba.gen";

// The OpenAI-compatible chat dialect this overlay speaks. The wire leaf is the
// same one `alibaba.chat` validates against, so what type-checks here is
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

// The DashScope media wires — the same leaves `alibaba.video` / `alibaba.tts`
// validate against.
export type {
  VideoSynthesisParams,
  AlibabaVideoInput,
  AlibabaVideoParameters,
  AlibabaVideoMedia,
  AlibabaVideoMediaType,
  AlibabaVideoResolution,
  AlibabaVideoModelRule,
} from "./video";

export type { TtsGenerationParams, AlibabaTtsInput, AlibabaLanguageType } from "./tts";

// Hand-maintained media catalog ids (models.dev tracks none of these).
export type {
  AlibabaMediaModelId,
  AlibabaVideoGenerationModelId,
  AlibabaTtsGenerationModelId,
  AlibabaRealtimeTtsModelId,
} from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type ChatBody<ModelId extends string = AlibabaTextModelId> = ChatCompletionsBodyBase<ModelId>;
export type VideoBody = VideoSynthesisParams;
export type TtsBody = TtsGenerationParams;
