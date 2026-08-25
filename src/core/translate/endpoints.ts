/**
 * The hand-written target endpoint table: which wire dialect each retarget
 * destination speaks, where its URL is, what static non-auth headers it needs,
 * and which header the caller's own credential goes in.
 *
 * That last column names a header; it never holds a value. It is here because
 * retargeting invalidates it — a request that moves from `anthropic` to
 * `openai` needs `authorization: Bearer` where it had `x-api-key`, and this
 * table is the only place that knows both halves of that swap.
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

/**
 * Where the caller's credential goes — the header **name** and the scheme word
 * that prefixes the value, never a value. This is the same class of data as
 * `ProviderInfo.env`, which already names the env var the key is read from:
 * naming `x-api-key` is not holding a key.
 *
 * It exists because retargeting changes it. `.request.url` moving from
 * Anthropic to OpenAI silently invalidates the `x-api-key` header the caller
 * already wrote, and the table that computes the new URL is the only thing that
 * knows the new header.
 *
 * One way in per row. Four targets accept a second one, recorded here rather
 * than as a row, because a consumer rendering `{ header, scheme }` should be
 * shown the way that always works:
 *
 * - **google** accepts the key as a `?key=` query parameter instead of the
 *   header. Never that: a key in a URL lands in browser history, proxy logs
 *   and referrer headers.
 * - **azure** accepts a Microsoft Entra ID token as `authorization: Bearer`
 *   alongside its own `api-key` header. The API-key form is the one that needs
 *   no directory setup, so it is the one named.
 * - **google-vertex** is OAuth *only* — the value is a short-lived access token
 *   (Application Default Credentials, `gcloud auth print-access-token`), not
 *   the `x-goog-api-key` the Gemini Developer API takes. Same vendor, two
 *   different credentials: the retarget hazard in miniature.
 * - **amazon-bedrock** signs with SigV4 unless bearer tokens are enabled. A
 *   signature over method, path, headers and body is not a header name and a
 *   value, so that form is not expressible here at all.
 */
export interface EndpointAuth {
  /**
   * Header name, spelled lowercase. HTTP header names are case-insensitive, so
   * the casing here is a house convention rather than a wire requirement — but
   * a single spelling is what lets `endpoints.test.ts` compare it against
   * {@link TargetEndpoint.headers} without a normalisation step of its own.
   */
  readonly header: string;
  /**
   * The word before the credential: `authorization: Bearer <key>`. **Absent**
   * when the header value is the bare key, which is the norm for the
   * vendor-specific header names (`x-api-key`, `x-goog-api-key`, `api-key`).
   *
   * `"Key"` is fal's, and it is the reason this union is a union rather than a
   * boolean: `authorization: Key <FAL_KEY>`, the literal word `Key`. fal's own
   * published OpenAPI security scheme describes the header as a plain API key
   * and OMITS the prefix, so a formatter that believed the schema would emit a
   * header fal rejects. It is stated here, and derived nowhere — the same
   * treatment `"Token"` (vidu) already gets.
   */
  readonly scheme?: "Bearer" | "Basic" | "Token" | "Key";
}

export interface TargetEndpoint {
  /** `"<provider>.<endpoint>"`, e.g. `"anthropic.chat"`. */
  readonly id: string;
  /** models.dev provider id, e.g. `"anthropic"`. */
  readonly provider: string;
  readonly dialect: DialectId;
  /** Static non-auth headers. Auth is always the caller's job. */
  readonly headers: Readonly<Record<string, string>>;
  /**
   * The header that job goes in. Never present in {@link headers} — that
   * separation is asserted per row in `endpoints.test.ts`.
   */
  readonly auth: EndpointAuth;
  /**
   * The POST URL. A function when the surface puts the model id in the path
   * (Gemini's `models/{model}:generateContent`). **Absent on factory targets**
   * — see `config`.
   */
  readonly url?: string | ((modelId: string) => string);
  /**
   * The POST URL when the caller asked to **stream**, for the surfaces where
   * streaming is a different *method* rather than a body flag.
   *
   * Only Gemini needs it: `openai-chat` and `anthropic-messages` both stream
   * in-body (`stream: true`) and post to the same URL, so they leave this
   * absent and `endpointStreamUrl` falls back to {@link endpointUrl}. Google
   * instead exposes `:streamGenerateContent?alt=sse`, and a body flag there is
   * simply ignored — which is why the unified encoder withholds `stream` from
   * the Gemini IR and the compile step swaps the URL instead.
   */
  readonly streamUrl?: string | ((modelId: string) => string);
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

// The four descriptors, shared by reference across the rows below. Their prose
// is on `EndpointAuth`, which is erased: JSDoc on a `const` survives into the
// emitted bundle, and these are four objects every provider entry carries.
//
// Not exported. `src/chat/refs.ts` mirrors them rather than importing them,
// because importing any binding from this module retains the whole URL table —
// see the note on `CHAT_AUTH` there.

/** `authorization: Bearer <key>` — every OpenAI-compatible surface. */
const BEARER_AUTH: EndpointAuth = Object.freeze({ header: "authorization", scheme: "Bearer" });

/** `x-api-key: <key>`, bare. */
const ANTHROPIC_AUTH: EndpointAuth = Object.freeze({ header: "x-api-key" });

/** `x-goog-api-key: <key>`, bare. */
const GOOGLE_AUTH: EndpointAuth = Object.freeze({ header: "x-goog-api-key" });

/** `api-key: <key>`, bare. */
const AZURE_AUTH: EndpointAuth = Object.freeze({ header: "api-key" });

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

// Speaking chat-completions and taking `authorization: Bearer` are the same
// fact for all 30 of these — the compatibility layer they each advertise is
// defined against OpenAI's own auth — so the header is supplied once here
// rather than repeated per row.
function openaiChatEndpoint(provider: string, url: string): TargetEndpoint {
  return {
    id: `${provider}.chat`,
    provider,
    dialect: "openai-chat",
    headers: JSON_ONLY,
    auth: BEARER_AUTH,
    url,
  };
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
        auth: ANTHROPIC_AUTH,
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
        auth: GOOGLE_AUTH,
        url: (modelId: string) =>
          `https://generativelanguage.googleapis.com/v1beta/models/${stripModelsPrefix(modelId)}:generateContent`,
        // `?alt=sse` is not optional decoration: without it the streaming
        // method returns a JSON *array* of chunks rather than an SSE stream,
        // which every streaming client in the ecosystem mis-parses.
        streamUrl: (modelId: string) =>
          `https://generativelanguage.googleapis.com/v1beta/models/${stripModelsPrefix(modelId)}:streamGenerateContent?alt=sse`,
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
        // The bearer-token form; SigV4 signing is the other one and is not
        // expressible as a header name (see `EndpointAuth`).
        auth: BEARER_AUTH,
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
        // An OAuth access token, not the `x-goog-api-key` its `google` sibling
        // three rows up takes (see `EndpointAuth`).
        auth: BEARER_AUTH,
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
        auth: BEARER_AUTH,
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
        // The one openai-chat target that does NOT take `authorization:
        // Bearer` by default: Azure's own header is `api-key`, bare.
        auth: AZURE_AUTH,
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
        // A Cloudflare API token, not the account id: the account id is a path
        // segment on the URL and carries no authority on its own.
        auth: BEARER_AUTH,
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

/**
 * The POST URL for `endpoint` when serving `modelId` **as a stream**.
 *
 * Falls back to {@link endpointUrl} whenever the endpoint declares no
 * `streamUrl`, which is the common case: chat-completions and
 * `/v1/messages` both stream from the same URL with `stream: true` in the
 * body. Callers therefore never need to branch on the dialect — they branch on
 * whether the caller asked to stream.
 */
export function endpointStreamUrl(
  endpoint: TargetEndpoint,
  modelId: string,
): string | undefined {
  const { streamUrl } = endpoint;
  if (streamUrl === undefined) return endpointUrl(endpoint, modelId);
  return typeof streamUrl === "function" ? streamUrl(modelId) : streamUrl;
}

/** True when the endpoint needs per-instance config and so has no static URL. */
export function isFactoryEndpoint(endpoint: TargetEndpoint): boolean {
  return endpoint.config !== undefined && endpoint.config.length > 0;
}
