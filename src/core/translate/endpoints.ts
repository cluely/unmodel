/**
 * The hand-written target endpoint table: which wire dialect each retarget
 * destination speaks, where its URL is, and what static non-auth headers it
 * needs.
 *
 * **This module imports nothing, deliberately** — it is literal strings and
 * pure URL builders only, so any module may reach it without dragging a graph
 * behind it (import-graph rule 4, asserted in `test/import-graph.test.ts`).
 * That is also why the `content-type` header is spelled out here instead of
 * reusing `JSON_HEADERS` from `../request`, and why `DialectId` is *defined*
 * here rather than imported from the translation IR: the IR may depend on this
 * table, never the reverse.
 *
 * **Hand-written, not generated**, because the catalog cannot supply it:
 * models.dev records `api: null` for azure and google-vertex, and
 * amazon-bedrock / google-vertex / azure / cloudflare-workers-ai have no
 * provider-wide static URL at all (they are per-instance configured). The
 * agreement between this table and each provider module's own exported URL
 * constant is asserted by `endpoints.test.ts`, which is what keeps a hand
 * table honest.
 */

/**
 * The four chat wire formats unmodel translates between. ~30 providers, but
 * only four shapes — keying translation off the dialect instead of the
 * provider is what keeps the codec count at 4 encoders + 4 decoders.
 */
export type DialectId = "openai-chat" | "anthropic-messages" | "gemini" | "bedrock-converse";

/** Config keys a factory-configured target needs before a URL can exist. */
export type EndpointConfigKey = "region" | "project" | "location" | "endpoint" | "accountId";

export interface TargetEndpoint {
  /** `"<provider>.<endpoint>"`, e.g. `"anthropic.chat"`. */
  readonly id: string;
  /** models.dev provider id, e.g. `"anthropic"`. */
  readonly provider: string;
  readonly dialect: DialectId;
  /** Static non-auth headers. Auth is always the caller's job. */
  readonly headers: Readonly<Record<string, string>>;
  /**
   * The POST URL. A function when the surface puts the model id in the path
   * (Gemini's `models/{model}:generateContent`). **Absent on factory targets**
   * — see `config`.
   */
  readonly url?: string | ((modelId: string) => string);
  /**
   * Non-empty when the endpoint is factory-configured: its URL embeds a
   * region / project / resource endpoint / account id that a one-arg
   * `.toApi(provider)` call never supplied. These targets are excluded from
   * the v1 `.toApi` union (design-types §5); the two-arg overload that
   * accepts them is a reserved, non-breaking extension.
   */
  readonly config?: readonly EndpointConfigKey[];
}

const JSON_ONLY: Readonly<Record<string, string>> = Object.freeze({
  "content-type": "application/json",
});

/** Required `anthropic-version` header value for `POST /v1/messages`. */
const ANTHROPIC_VERSION = "2023-06-01";

const ANTHROPIC_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "content-type": "application/json",
  "anthropic-version": ANTHROPIC_VERSION,
});

/** `"models/gemini-3-pro"` → `"gemini-3-pro"`; the path segment is added here. */
function stripModelsPrefix(modelId: string): string {
  return modelId.startsWith("models/") ? modelId.slice("models/".length) : modelId;
}

/** Every OpenAI-compatible chat target: id → the full chat/completions URL. */
const OPENAI_CHAT_URLS: Readonly<Record<string, string>> = Object.freeze({
  alibaba: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
  baseten: "https://inference.baseten.co/v1/chat/completions",
  cerebras: "https://api.cerebras.ai/v1/chat/completions",
  deepinfra: "https://api.deepinfra.com/v1/openai/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
  "fireworks-ai": "https://api.fireworks.ai/inference/v1/chat/completions",
  friendli: "https://api.friendli.ai/serverless/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  huggingface: "https://router.huggingface.co/v1/chat/completions",
  inception: "https://api.inceptionlabs.ai/v1/chat/completions",
  longcat: "https://api.longcat.chat/openai/v1/chat/completions",
  meta: "https://api.meta.ai/v1/chat/completions",
  minimax: "https://api.minimax.io/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
  moonshotai: "https://api.moonshot.ai/v1/chat/completions",
  nebius: "https://api.tokenfactory.nebius.com/v1/chat/completions",
  "novita-ai": "https://api.novita.ai/openai/v1/chat/completions",
  nvidia: "https://integrate.api.nvidia.com/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  perplexity: "https://api.perplexity.ai/chat/completions",
  sarvam: "https://api.sarvam.ai/v1/chat/completions",
  scaleway: "https://api.scaleway.ai/v1/chat/completions",
  siliconflow: "https://api.siliconflow.com/v1/chat/completions",
  stepfun: "https://api.stepfun.com/v1/chat/completions",
  togetherai: "https://api.together.ai/v1/chat/completions",
  upstage: "https://api.upstage.ai/v1/chat/completions",
  vercel: "https://ai-gateway.vercel.sh/v1/chat/completions",
  xai: "https://api.x.ai/v1/chat/completions",
  zhipuai: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
});

function openaiChatEndpoint(provider: string, url: string): TargetEndpoint {
  return { id: `${provider}.chat`, provider, dialect: "openai-chat", headers: JSON_ONLY, url };
}

const OPENAI_CHAT_ENTRIES: ReadonlyArray<readonly [string, TargetEndpoint]> = Object.entries(
  OPENAI_CHAT_URLS,
).map(([provider, url]) => [`${provider}.chat`, openaiChatEndpoint(provider, url)] as const);

/**
 * Every endpoint a retarget may land on, keyed by `"<provider>.<endpoint>"`.
 * The generated availability data names an entry here whenever a model is not
 * on its target provider's default surface (today: the `*-maas` rows on
 * `google-vertex.chatMaas`).
 */
export const ENDPOINTS: Readonly<Record<string, TargetEndpoint>> = Object.freeze(
  Object.fromEntries([
    ...OPENAI_CHAT_ENTRIES,

    [
      "anthropic.chat",
      {
        id: "anthropic.chat",
        provider: "anthropic",
        dialect: "anthropic-messages",
        headers: ANTHROPIC_HEADERS,
        url: "https://api.anthropic.com/v1/messages",
      } satisfies TargetEndpoint,
    ],

    [
      "google.chat",
      {
        id: "google.chat",
        provider: "google",
        dialect: "gemini",
        headers: JSON_ONLY,
        url: (modelId: string) =>
          `https://generativelanguage.googleapis.com/v1beta/models/${stripModelsPrefix(modelId)}:generateContent`,
      } satisfies TargetEndpoint,
    ],

    // ---------------------------------------------------------------------
    // Factory-configured targets. Listed so `.toApi` can say *why* they are
    // unavailable instead of "unknown provider", and so the reserved two-arg
    // overload has a table to resolve against. They carry no `url`.
    // ---------------------------------------------------------------------

    [
      "amazon-bedrock.chat",
      {
        id: "amazon-bedrock.chat",
        provider: "amazon-bedrock",
        dialect: "bedrock-converse",
        headers: JSON_ONLY,
        config: ["region"],
      } satisfies TargetEndpoint,
    ],

    [
      "google-vertex.chat",
      {
        id: "google-vertex.chat",
        provider: "google-vertex",
        dialect: "gemini",
        headers: JSON_ONLY,
        config: ["project", "location"],
      } satisfies TargetEndpoint,
    ],

    // Vertex's OpenAI-compatible MaaS surface — the `*-maas` rows in the
    // generated availability data point here explicitly.
    [
      "google-vertex.chatMaas",
      {
        id: "google-vertex.chatMaas",
        provider: "google-vertex",
        dialect: "openai-chat",
        headers: JSON_ONLY,
        config: ["project", "location"],
      } satisfies TargetEndpoint,
    ],

    [
      "azure.chat",
      {
        id: "azure.chat",
        provider: "azure",
        dialect: "openai-chat",
        headers: JSON_ONLY,
        config: ["endpoint"],
      } satisfies TargetEndpoint,
    ],

    [
      "cloudflare-workers-ai.chat",
      {
        id: "cloudflare-workers-ai.chat",
        provider: "cloudflare-workers-ai",
        dialect: "openai-chat",
        headers: JSON_ONLY,
        config: ["accountId"],
      } satisfies TargetEndpoint,
    ],
  ]),
);

/**
 * Provider id → the endpoint id a retarget lands on when the availability
 * entry does not name one. Every provider in `ENDPOINTS` has exactly one
 * default; `google-vertex.chatMaas` is the one non-default surface today.
 */
export const DEFAULT_ENDPOINT_ID: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(Object.keys(OPENAI_CHAT_URLS).map((p) => [p, `${p}.chat`])),
  anthropic: "anthropic.chat",
  google: "google.chat",
  "amazon-bedrock": "amazon-bedrock.chat",
  "google-vertex": "google-vertex.chat",
  azure: "azure.chat",
  "cloudflare-workers-ai": "cloudflare-workers-ai.chat",
});

/**
 * Resolves a target provider (and an optional explicit endpoint id from the
 * availability data) to its endpoint. Returns `undefined` for anything this
 * table does not know — the caller turns that into a message naming the
 * provider.
 */
export function resolveEndpoint(provider: string, endpointId?: string): TargetEndpoint | undefined {
  const id =
    endpointId ??
    (Object.hasOwn(DEFAULT_ENDPOINT_ID, provider) ? DEFAULT_ENDPOINT_ID[provider] : undefined);
  if (id === undefined || !Object.hasOwn(ENDPOINTS, id)) return undefined;
  return ENDPOINTS[id];
}

/**
 * The POST URL for `endpoint` when serving `modelId`. `undefined` on factory
 * targets, whose URL is not knowable from a one-arg `.toApi` call.
 */
export function endpointUrl(endpoint: TargetEndpoint, modelId: string): string | undefined {
  const { url } = endpoint;
  if (url === undefined) return undefined;
  return typeof url === "function" ? url(modelId) : url;
}

/** True when the endpoint needs per-instance config and so has no static URL. */
export function isFactoryEndpoint(endpoint: TargetEndpoint): boolean {
  return endpoint.config !== undefined && endpoint.config.length > 0;
}
