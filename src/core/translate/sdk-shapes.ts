/**
 * Per-dialect SDK param shaping, for dialects whose official SDK does **not**
 * take the wire body verbatim.
 *
 * `openai-chat` and `anthropic-messages` need nothing here — their SDKs' param
 * objects *are* the wire body, so the retarget engine hands back an identity
 * formatter. Gemini is the odd one out: `@google/genai`'s
 * `ai.models.generateContent()` takes `{ model, contents, config }`, folding
 * `generationConfig`'s fields up into the top level of `config` alongside
 * `systemInstruction` / `tools` / `toolConfig` / `safetySettings` /
 * `cachedContent` / `serviceTier`.
 *
 * This lives in `core/translate` rather than in `providers/google` for two
 * reasons: it is a fact about the *dialect*, not about the provider (Vertex
 * speaks it too), and `core/translate/retarget.ts` needs it while being
 * forbidden from importing `src/providers/**` (import-graph rule 1).
 * `providers/google/chat.ts` imports it back, so there is exactly
 * one implementation and a retargeted `.toSdk("google")` cannot drift from the
 * one `google.chat` hands out.
 */

/** The gemini wire body, minus the model id (which travels in the URL path). */
interface GeminiBodyLike {
  contents?: unknown;
  generationConfig?: Record<string, unknown>;
  systemInstruction?: unknown;
  tools?: unknown;
  toolConfig?: unknown;
  safetySettings?: unknown;
  cachedContent?: unknown;
  serviceTier?: unknown;
}

/** Wire-body keys that move into `config` unchanged. `store` has no SDK equivalent. */
export const CONFIG_KEYS = [
  "systemInstruction",
  "tools",
  "toolConfig",
  "safetySettings",
  "cachedContent",
  "serviceTier",
] as const;

/**
 * The wire-body keys `geminiSdkParams` lifts into `config`, as a type.
 *
 * `src/retarget/dialects.ts` builds its `GeminiSdkParams` result type off this,
 * so the declared shape of `.toSdk("google")` is read from the same constant
 * the runtime iterates — adding a key here changes both at once.
 */
export type GeminiSdkConfigKey = (typeof CONFIG_KEYS)[number];

/**
 * `{ contents, generationConfig, … }` + a model id →
 * `@google/genai`'s `{ model, contents, config }`.
 */
export function geminiSdkParams(model: string, body: object): Record<string, unknown> {
  const source = body as GeminiBodyLike;
  const config: Record<string, unknown> = { ...(source.generationConfig ?? {}) };
  for (const key of CONFIG_KEYS) {
    const value = source[key];
    if (value !== undefined) config[key] = value;
  }
  const sdk: Record<string, unknown> = { model, contents: source.contents };
  if (Object.keys(config).length > 0) sdk.config = config;
  return sdk;
}
