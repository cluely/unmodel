/**
 * `unmodel/amazon-bedrock/types` — every `amazon-bedrock` type, and nothing else.
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
 * import type { ChatBody } from "unmodel/amazon-bedrock/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies ChatBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`ConverseParams`, `AmazonBedrockConfig`,
 *   `BedrockMessage`, …) — re-exported verbatim, because they are how you
 *   find the endpoint in the provider's own documentation;
 * - the **uniform category aliases** (`ChatBody`) — one per endpoint address
 *   this provider serves, named after the word you already type at
 *   `unmodel/amazon-bedrock`.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/amazon-bedrock`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `amazon-bedrock` is factory-configured (its URL needs configuration a bare
 *   model ref cannot carry), so it has no `unmodel validate` endpoint id.
 *   `ChatBody` names the body its `chat` validator takes all the same.
 */

import type { ConverseParams } from "./chat";

export type {
  AmazonBedrockConfig,
  AmazonBedrockChat,
  AmazonBedrockProvider,
  ConverseParams,
  BedrockMessage,
  BedrockContentBlock,
  BedrockSystemContentBlock,
  BedrockImageBlock,
  BedrockImageFormat,
  BedrockVideoBlock,
  BedrockVideoFormat,
  BedrockDocumentBlock,
  BedrockDocumentFormat,
  BedrockDocumentSource,
  BedrockBytesSource,
  BedrockS3Location,
  BedrockCachePoint,
  BedrockToolUseBlock,
  BedrockToolResultBlock,
  BedrockToolResultContent,
  BedrockTool,
  BedrockToolSpecification,
  BedrockToolChoice,
  BedrockToolConfig,
  BedrockInferenceConfig,
  BedrockGuardrailConfig,
  BedrockOutputConfig,
} from "./chat";

export type { ConverseResponseLike, ConverseStopReason, ConverseUsageLike } from "./check";

export type {
  AmazonBedrockModelId,
  AmazonBedrockTextModelId,
  AmazonBedrockImageModelId,
  AmazonBedrockAudioModelId,
  AmazonBedrockVideoModelId,
} from "../../catalog/amazon-bedrock.gen";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type ChatBody = ConverseParams;
