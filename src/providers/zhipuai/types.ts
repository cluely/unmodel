/**
 * `unmodel/zhipuai/types` — every `zhipuai` type, and nothing else.
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
 * import type { ChatBody } from "unmodel/zhipuai/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies ChatBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`ChatMessage`, `ChatSystemMessage`,
 *   `ChatDeveloperMessage`, …) — re-exported verbatim, because they are how
 *   you find the endpoint in the provider's own documentation;
 * - the **uniform category aliases** (`ChatBody`) — one per endpoint address
 *   this provider serves, named after the word you already type at
 *   `unmodel/zhipuai` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/zhipuai`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `zhipuai.chat` → `ChatBody`
 */

import type { ChatCompletionsBodyBase } from "../openai-compatible/wire";
import type { ZhipuaiTextModelId } from "../../catalog/zhipuai.gen";

export type {
  ZhipuaiModelId,
  ZhipuaiTextModelId,
  ZhipuaiImageModelId,
  ZhipuaiAudioModelId,
  ZhipuaiVideoModelId,
} from "../../catalog/zhipuai.gen";

// The OpenAI-compatible chat dialect this overlay speaks. The wire leaf is the
// same one `zhipuai.chat` validates against, so what type-checks here is
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

export type ChatBody<ModelId extends string = ZhipuaiTextModelId> = ChatCompletionsBodyBase<ModelId>;
