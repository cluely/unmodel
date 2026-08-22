/**
 * `unmodel/openai-compatible/types` — every `openai-compatible` type, and nothing else.
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
 * import type { ChatBody } from "unmodel/openai-compatible/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies ChatBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`ChatAssistantMessage`, `ChatDeveloperMessage`,
 *   `ChatFunctionMessage`, …) — re-exported verbatim, because they are how
 *   you find the endpoint in the provider's own documentation;
 * - the **uniform category aliases** (`ChatBody`) — one per endpoint address
 *   this provider serves, named after the word you already type at
 *   `unmodel/openai-compatible`.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/openai-compatible`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `openai-compatible` is factory-configured (its URL needs configuration a bare
 *   model ref cannot carry), so it has no `unmodel validate` endpoint id.
 *   `ChatBody` names the body its `chat` validator takes all the same.
 */

import type { ChatCompletionsBodyBase } from "./chat-completions";

export type {
  ChatAssistantMessage,
  ChatAudioPart,
  ChatCompletionsBodyBase,
  ChatConstraintSpec,
  ChatFinalizeSpec,
  ChatSdkTargets,
  ChatCustomTool,
  ChatCustomToolCall,
  ChatDeveloperMessage,
  ChatFilePart,
  ChatFunctionMessage,
  ChatFunctionTool,
  ChatFunctionToolCall,
  ChatImagePart,
  ChatMessage,
  ChatPromptCacheBreakpoint,
  ChatRefusalPart,
  ChatResponseFormat,
  ChatSystemMessage,
  ChatTextPart,
  ChatTool,
  ChatToolCall,
  ChatToolChoice,
  ChatToolMessage,
  ChatUserContentPart,
  ChatUserMessage,
} from "./chat-completions";

export type { ChatChoiceLike, ChatCompletionLike, ChatFinishReason } from "./check";

// Declared in this provider's own `index.ts`; re-exported here type-only so the
// types entry is complete on its own.
export type {
  OpenAICompatibleCatalogCarrier,
  OpenAICompatibleCatalogOf,
  OpenAICompatibleConfigBase,
  OpenAICompatibleConfig,
  OpenAICompatibleChatResultKind,
  OpenAICompatibleChat,
  OpenAICompatibleProvider,
} from "./index";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type ChatBody<ModelId extends string = string> = ChatCompletionsBodyBase<ModelId>;
