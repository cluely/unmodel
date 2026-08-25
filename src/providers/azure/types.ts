/**
 * `unmodel/azure/types` — every `azure` type, and nothing else.
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
 * import type { ChatBody } from "unmodel/azure/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies ChatBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`AzureConfig`, `ChatMessage`, `ChatSystemMessage`, …)
 *   — re-exported verbatim, because they are how you find the endpoint in the
 *   provider's own documentation;
 * - the **uniform category aliases** (`ChatBody`) — one per endpoint address
 *   this provider serves, named after the word you already type at
 *   `unmodel/azure`.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/azure`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `azure` is factory-configured (its URL needs configuration a bare
 *   model ref cannot carry), so it has no `unmodel validate` endpoint id.
 *   `ChatBody`, `ImageBody` and `ImageEditBody` name the bodies its `chat`,
 *   `image` and `imageEdit` validators take all the same.
 */

import type { ChatCompletionsBodyBase } from "../openai-compatible/wire";
import type { AzureTextModelId } from "../../catalog/azure.gen";
import type { MaiImagesGenerationsBody } from "./image";
import type { MaiImagesEditsBody } from "./image-edit";

export type {
  AzureModelId,
  AzureTextModelId,
  AzureImageModelId,
  AzureAudioModelId,
  AzureVideoModelId,
} from "../../catalog/azure.gen";

// Declared in this provider's own `index.ts`; re-exported here type-only so the
// types entry is complete on its own.
export type { AzureConfig, AzureProvider } from "./index";

// The MAI image surface (POST {endpoint}/mai/v1/images/generations and
// /mai/v1/images/edits) — wire names first, per docs/decisions.md §2.
export type { MaiImagesGenerationsBody, AzureMaiImage } from "./image";
export type { MaiImagesEditsBody, AzureMaiImageEdit } from "./image-edit";
export type { AzureMaiImageModelId, AzureMaiImageEditModelId } from "./mai-image-models";

// The OpenAI-compatible chat dialect this overlay speaks. The wire leaf is the
// same one `azure.chat` validates against, so what type-checks here is
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

export type ChatBody<ModelId extends string = AzureTextModelId> = ChatCompletionsBodyBase<ModelId>;

/** `azure.image`'s body — POST {endpoint}/mai/v1/images/generations. */
export type ImageBody = MaiImagesGenerationsBody;

/** `azure.imageEdit`'s multipart params — POST {endpoint}/mai/v1/images/edits. */
export type ImageEditBody = MaiImagesEditsBody;
