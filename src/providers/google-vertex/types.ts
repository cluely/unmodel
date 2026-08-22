/**
 * `unmodel/google-vertex/types` — every `google-vertex` type, and nothing else.
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
 * import type { ChatBody } from "unmodel/google-vertex/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies ChatBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`VertexGenerateContentBody`,
 *   `VertexGenerateContentSdkParams`, `GoogleVertexConfig`, …) — re-exported
 *   verbatim, because they are how you find the endpoint in the provider's
 *   own documentation;
 * - the **uniform category aliases** (`ChatBody`) — one per endpoint address
 *   this provider serves, named after the word you already type at
 *   `unmodel/google-vertex`.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/google-vertex`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `google-vertex` is factory-configured (its URL needs configuration a bare
 *   model ref cannot carry), so it has no `unmodel validate` endpoint id.
 *   `ChatBody` names the body its `chat` validator takes all the same.
 */

import type { VertexGenerateContentBody } from "./chat";

export type {
  GoogleVertexConfig,
  GoogleVertexChat,
  VertexGenerateContentBody,
  VertexGenerateContentSdkParams,
  VertexChatSdkTargets,
} from "./chat";

export type {
  ChatResponseLike,
  GoogleCodeExecutionResult,
  GoogleContent,
  GoogleExecutableCode,
  GoogleFileData,
  GoogleFinishReason,
  GoogleFunctionCall,
  GoogleFunctionCallingConfig,
  GoogleFunctionDeclaration,
  GoogleFunctionResponse,
  GoogleGenerationConfig,
  GoogleHarmBlockThreshold,
  GoogleHarmCategory,
  GoogleInlineData,
  GooglePart,
  GoogleRole,
  GoogleSafetySetting,
  GoogleThinkingConfig,
  GoogleTool,
  GoogleToolCall,
  GoogleToolConfig,
  GoogleToolResponse,
  GoogleVideoMetadata,
} from "../google";

export type {
  GoogleVertexModelId,
  GoogleVertexTextModelId,
  GoogleVertexImageModelId,
  GoogleVertexAudioModelId,
  GoogleVertexVideoModelId,
} from "../../catalog/google-vertex.gen";

// Declared in this provider's own `index.ts`; re-exported here type-only so the
// types entry is complete on its own.
export type { GoogleVertexProvider } from "./index";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type ChatBody = VertexGenerateContentBody;
