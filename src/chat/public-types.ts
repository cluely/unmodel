/** Provider-free public result types shared by the ready and factory entries. */
import type { AiSdkChatResult } from "../core/translate/ai-sdk";
import type { TranslationWarning } from "../core/translate/warnings";
import type { DialectBody } from "../retarget/dialects";
import type { ChatProviderId } from "../catalog/chat-refs.gen";

/** The three dialects `unmodel/chat` can compile to. */
export type ChatDialect = "openai-chat" | "anthropic-messages" | "gemini";

/** Every chat provider except the two with their own wire format. */
type OpenAiChatProviderId = Exclude<ChatProviderId, "anthropic" | "google">;

/** `"openrouter/anthropic/claude-opus-5"` -> `"openrouter"`. */
export type ChatProviderOf<R extends string> = R extends `${infer P}/${string}` ? P : string;

/** `"openrouter/anthropic/claude-opus-5"` -> `"anthropic/claude-opus-5"`. */
export type ChatModelOf<R extends string> = R extends `${infer _P}/${infer M}` ? M : string;

/** The wire dialect selected by a model ref's first-slash provider half. */
export type ChatDialectOf<R extends string> = R extends `${infer P}/${string}`
  ? P extends "anthropic"
    ? "anthropic-messages"
    : P extends "google"
      ? "gemini"
      : P extends OpenAiChatProviderId
        ? "openai-chat"
        : ChatDialect
  : ChatDialect;

/** The compiled wire body for a ref. */
export type ChatBody<R extends string> = DialectBody<ChatDialectOf<R>, ChatModelOf<R>>;

/** `@google/genai`'s `{ model, contents, config }` SDK shape. */
export interface ChatGeminiSdkParams<M extends string = string> {
  model: M | (string & {});
  contents: unknown;
  config?: Record<string, unknown>;
}

/** Native SDK targets offered by each compiled dialect. */
export type ChatSdkTargets<D, M extends string> = D extends "anthropic-messages"
  ? {
      anthropic: () => DialectBody<"anthropic-messages", M>;
      "ai-sdk": () => AiSdkChatResult;
    }
  : D extends "gemini"
    ? { google: () => ChatGeminiSdkParams<M>; "ai-sdk": () => AiSdkChatResult }
    : { openai: () => DialectBody<"openai-chat", M>; "ai-sdk": () => AiSdkChatResult };

/** Non-enumerable facts added by the unified compiler to a provider result. */
export interface ChatResultMeta<R extends string> {
  /** Provider selected by `model`'s first-slash prefix. */
  readonly target: ChatProviderOf<R>;
  /** Bare model id; Gemini carries this in its URL rather than its body. */
  readonly modelId: ChatModelOf<R>;
  /** Every loss or approximation incurred while compiling the request. */
  readonly warnings: readonly TranslationWarning[];
}
