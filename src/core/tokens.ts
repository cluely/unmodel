/**
 * Pluggable token counter. unmodel ships only a heuristic (~4 chars per
 * token) so no tokenizer weights ever land in your bundle. For precise
 * counts, pass your own, e.g. a 3-line adapter over `js-tiktoken`:
 *
 * ```ts
 * import { encodingForModel } from "js-tiktoken";
 * const enc = encodingForModel("gpt-4o");
 * const tokenizer = { count: (text: string) => enc.encode(text).length };
 * ```
 */
export interface Tokenizer {
  count(text: string): number;
}

export const heuristicTokenizer: Tokenizer = {
  count: (text) => Math.ceil(text.length / 4),
};

/**
 * Fixed structural overhead added per message on top of its text tokens
 * (role markers, separators). A coarse constant is fine at heuristic
 * precision.
 */
export const PER_MESSAGE_TOKEN_OVERHEAD = 4;

/** Estimated tokens for a tool/function definition sent with the request. */
export function estimateToolDefinitionTokens(tokenizer: Tokenizer, definition: unknown): number {
  try {
    return tokenizer.count(JSON.stringify(definition) ?? "") + PER_MESSAGE_TOKEN_OVERHEAD;
  } catch {
    return PER_MESSAGE_TOKEN_OVERHEAD;
  }
}
