/**
 * `unmodel/anthropic/types` — every `anthropic` type, and nothing else.
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
 * import type { ChatBody } from "unmodel/anthropic/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies ChatBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`MessagesBody`, `ThinkingConfig`) — re-exported
 *   verbatim, because they are how you find the endpoint in the provider's
 *   own documentation;
 * - the **uniform category aliases** (`ChatBody`) — one per endpoint address
 *   this provider serves, named after the word you already type at
 *   `unmodel/anthropic` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/anthropic`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `anthropic.chat` → `ChatBody`
 */

import type { MessagesBody } from "./chat";

export type {
  MessagesBody,
  MessageParam,
  ContentBlock,
  TextBlock,
  ImageBlock,
  ImageSource,
  Base64ImageSource,
  UrlImageSource,
  FileImageSource,
  ImageMediaType,
  DocumentBlock,
  DocumentSource,
  ToolUseBlock,
  ToolResultBlock,
  ThinkingBlock,
  RedactedThinkingBlock,
  CacheControlEphemeral,
  Tool,
  CustomTool,
  ServerTool,
  ToolChoice,
  ThinkingConfig,
} from "./chat";

export type { AnthropicStopReason, MessageLike, MessageUsage } from "./check";

export type {
  AnthropicModelId,
  AnthropicTextModelId,
  AnthropicImageModelId,
  AnthropicAudioModelId,
  AnthropicVideoModelId,
} from "../../catalog/anthropic.gen";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type ChatBody = MessagesBody;
