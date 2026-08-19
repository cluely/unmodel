/**
 * Wire param name → unified param name, per dialect.
 *
 * Layers 1, 2 and 4 of the chat pipeline inspect the caller's `ChatParams`, so
 * their issue paths are already in the vocabulary the caller typed. **Layer 3
 * is the exception**: the provider deny/enum tables are written against the
 * wire body (that is the whole point of them — they encode "this API returns a
 * 400 for `logprobs`"), so they can only run against the *compiled* body, and
 * the paths they produce name params nobody wrote.
 *
 * Telling someone their request is invalid at `["max_completion_tokens"]` when
 * they wrote `maxOutputTokens` is worse than saying nothing: it sends them
 * looking for a param that does not exist in the API they are using. So layer 3
 * issues get their paths translated back through these tables before they are
 * reported.
 *
 * ## The two cases, and why unmapped is not a failure
 *
 * A wire param reached the body one of two ways:
 *
 * 1. **The compiler put it there** — `maxOutputTokens` became
 *    `max_completion_tokens`, `reasoning` became `reasoning_effort`. These are
 *    in the tables below and the path is rewritten to the name the caller
 *    wrote.
 * 2. **`providerOptions` put it there verbatim** — `logprobs`, `logit_bias`,
 *    `store`, openrouter's `provider` block. There is no unified name to map
 *    to *because the caller deliberately used the escape hatch*, so the wire
 *    name is exactly right and the message gains
 *    `(supplied via providerOptions)` to say where to go and fix it.
 *
 * That second case is the common one for deny rules — groq denies `logprobs`
 * and `logit_bias`, which the unified vocabulary has no word for at all — so
 * "unmapped" is the *expected* outcome for most layer-3 findings, not a hole
 * in the table.
 *
 * ## Nested keys
 *
 * Gemini's settings live under `generationConfig`, so its entries are dotted
 * (`"generationConfig.maxOutputTokens"`). Lookup tries the whole joined path
 * first and then the head segment, so a table keyed either way resolves.
 */
import type { DialectId } from "../core/translate/endpoints";

/**
 * OpenAI chat-completions. The largest map because it is the dialect the
 * unified vocabulary borrowed the *fewest* spellings from — camelCase against
 * snake_case throughout.
 */
const OPENAI_CHAT: Readonly<Record<string, string>> = Object.freeze({
  model: "model",
  messages: "messages",
  max_completion_tokens: "maxOutputTokens",
  max_tokens: "maxOutputTokens",
  temperature: "temperature",
  top_p: "topP",
  stop: "stopSequences",
  seed: "seed",
  presence_penalty: "presencePenalty",
  frequency_penalty: "frequencyPenalty",
  n: "candidates",
  reasoning_effort: "reasoning",
  response_format: "responseFormat",
  tools: "tools",
  tool_choice: "toolChoice",
  parallel_tool_calls: "parallelToolCalls",
  stream: "stream",
  user: "user",
  service_tier: "serviceTier",
  // Deprecated chat-completions spellings the dialect still accepts. Mapped so
  // a deny rule written against the old name still points somewhere real.
  functions: "tools",
  function_call: "toolChoice",
});

/** Anthropic `/v1/messages`. */
const ANTHROPIC_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  model: "model",
  messages: "messages",
  system: "system",
  max_tokens: "maxOutputTokens",
  temperature: "temperature",
  top_p: "topP",
  top_k: "topK",
  stop_sequences: "stopSequences",
  thinking: "reasoning",
  "thinking.budget_tokens": "reasoning",
  output_config: "reasoning",
  "output_config.effort": "reasoning",
  tools: "tools",
  tool_choice: "toolChoice",
  // `disable_parallel_tool_use` is the inverted spelling of the unified flag;
  // pointing at `parallelToolCalls` is right even though the polarity flips.
  "tool_choice.disable_parallel_tool_use": "parallelToolCalls",
  stream: "stream",
  metadata: "user",
  "metadata.user_id": "user",
  service_tier: "serviceTier",
});

/** Gemini `:generateContent`. Settings nest under `generationConfig`. */
const GEMINI: Readonly<Record<string, string>> = Object.freeze({
  contents: "messages",
  systemInstruction: "system",
  tools: "tools",
  toolConfig: "toolChoice",
  serviceTier: "serviceTier",
  generationConfig: "generationConfig",
  "generationConfig.maxOutputTokens": "maxOutputTokens",
  "generationConfig.temperature": "temperature",
  "generationConfig.topP": "topP",
  "generationConfig.topK": "topK",
  "generationConfig.stopSequences": "stopSequences",
  "generationConfig.seed": "seed",
  "generationConfig.presencePenalty": "presencePenalty",
  "generationConfig.frequencyPenalty": "frequencyPenalty",
  "generationConfig.candidateCount": "candidates",
  "generationConfig.thinkingConfig": "reasoning",
  "generationConfig.thinkingConfig.thinkingBudget": "reasoning",
  "generationConfig.thinkingConfig.thinkingLevel": "reasoning",
  "generationConfig.responseMimeType": "responseFormat",
  "generationConfig.responseSchema": "responseFormat",
  "generationConfig.responseJsonSchema": "responseFormat",
});

const MAPS: Readonly<Record<DialectId, Readonly<Record<string, string>>>> = Object.freeze({
  "openai-chat": OPENAI_CHAT,
  "anthropic-messages": ANTHROPIC_MESSAGES,
  gemini: GEMINI,
  // No codec ships for bedrock-converse in v1, so nothing can produce a
  // layer-3 issue in that dialect. An empty map means every path is treated as
  // a `providerOptions` passthrough, which is the safe reading.
  "bedrock-converse": Object.freeze({}),
});

/** The suffix an unmapped wire param's message gains. */
export const PROVIDER_OPTIONS_SUFFIX = " (supplied via `providerOptions`)";

export interface RemappedPath {
  /** The path to report — unified spelling when one exists, else the wire one. */
  path: Array<string | number>;
  /** True when no unified param corresponds; the caller used `providerOptions`. */
  unmapped: boolean;
}

/** Looks up `path` in `dialect`'s table, longest prefix first. */
export function unifiedPath(dialect: DialectId, path: Array<string | number>): RemappedPath {
  if (path.length === 0) return { path, unmapped: false };
  const map = MAPS[dialect];
  const joined = path.join(".");
  if (Object.hasOwn(map, joined)) return { path: [map[joined] as string], unmapped: false };
  const head = path[0];
  if (typeof head === "string" && Object.hasOwn(map, head)) {
    // Keep whatever the rule pointed *inside* the param, so a nested finding
    // does not lose its position: ["messages", 3, "name"] stays addressed.
    return { path: [map[head] as string, ...path.slice(1)], unmapped: false };
  }
  return { path: [...path], unmapped: true };
}
