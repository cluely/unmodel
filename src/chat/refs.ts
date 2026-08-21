/**
 * Model refs: `"provider/model"` → a provider and a model id, plus a verdict
 * on whether `unmodel/chat` can actually serve that provider.
 *
 * Two jobs, and the second is the interesting one.
 *
 * **Parsing** is one line of code and one decision: split on the **first**
 * slash. openrouter and vercel serve models whose *own* ids contain slashes
 * (`"anthropic/claude-opus-5"`), so `"openrouter/anthropic/claude-opus-5"` is
 * provider `openrouter`, model `anthropic/claude-opus-5`. Splitting on the
 * last slash — the implementation everyone writes first — turns that into a
 * request for a provider named `openrouter/anthropic`, which resolves to
 * nothing and produces an "unknown provider" error naming a provider the user
 * never typed.
 *
 * **Classifying** exists because "this provider is not in the union" is four
 * genuinely different situations, and collapsing them into one message costs
 * the user an afternoon:
 *
 * | provider | why not | what they should do |
 * |---|---|---|
 * | `cohere` | fifth wire dialect, no codec in v1 | use `unmodel/cohere`'s own `chat()` |
 * | `azure`, `cloudflare-workers-ai`, `google-vertex` | factory-configured: the URL embeds a resource endpoint / account id / project+location that a bare ref cannot carry | use the provider subpath, which takes that config |
 * | `amazon-bedrock` | *both* — factory-configured **and** the `bedrock-converse` codec is not written | use `unmodel/amazon-bedrock` |
 * | anything else | typo, or a provider unmodel has no chat validator for | check the id |
 *
 * The factory branch names the *specific* config keys the target needs, read
 * from the same `ENDPOINTS` table the retarget layer resolves against, so the
 * message cannot drift from the truth.
 *
 * This module imports only `src/core/translate/endpoints.ts`, which by
 * construction imports nothing at all — so reaching for `parseModelRef` never
 * drags a graph behind it.
 */
import type { DialectId, EndpointConfigKey } from "../core/translate/endpoints";
import { isFactoryEndpoint, resolveEndpoint } from "../core/translate/endpoints";
import type { ChatProviderId } from "../catalog/chat-refs.gen";

/**
 * Every provider `chat()` can send to, as a runtime array.
 *
 * Hand-written rather than generated, because a 32-element string array is
 * cheaper to read here than to chase into a `.gen.ts`; the generated
 * `ChatProviderId` union is the authority and `test/chat/refs.test.ts`
 * asserts the two agree *in both directions* at compile time, so drift is a
 * failed build rather than a runtime surprise.
 *
 * Sorted, so the "did you mean" list in an error message is stable.
 */
export const CHAT_PROVIDERS = [
  "alibaba",
  "anthropic",
  "baseten",
  "cerebras",
  "deepinfra",
  "deepseek",
  "fireworks-ai",
  "friendli",
  "google",
  "groq",
  "huggingface",
  "inception",
  "longcat",
  "meta",
  "minimax",
  "mistral",
  "moonshotai",
  "nebius",
  "novita-ai",
  "nvidia",
  "openai",
  "openrouter",
  "perplexity",
  "sarvam",
  "scaleway",
  "siliconflow",
  "stepfun",
  "togetherai",
  "upstage",
  "vercel",
  "xai",
  "zhipuai",
] as const satisfies readonly ChatProviderId[];

const CHAT_PROVIDER_SET: ReadonlySet<string> = new Set(CHAT_PROVIDERS);

/**
 * Providers unmodel ships a chat validator for but `unmodel/chat` cannot
 * reach, each with the reason. Enumerated rather than derived so that adding
 * a fifth codec (or wiring a factory overload) is a deliberate edit here with
 * a message to update, not a silent change of behaviour.
 */
const NO_CODEC_PROVIDERS = ["cohere", "amazon-bedrock"] as const;

const NO_CODEC: ReadonlySet<string> = new Set(NO_CODEC_PROVIDERS);

/** The `NO_CODEC` set as a type — one declaration, so the two cannot disagree. */
export type NoCodecChatProviderId = (typeof NO_CODEC_PROVIDERS)[number];

/**
 * Factory-configured providers unmodel ships a chat validator for.
 *
 * Hand-written rather than derived from `ENDPOINTS`, for the same reason
 * `CHAT_PROVIDERS` is: `isFactoryEndpoint` is a runtime predicate over a table
 * this module reaches through a function, and a type cannot call it.
 * `test/chat/refs.test.ts` pins this union against `classifyRef`'s own verdict
 * in both directions, so adding a factory endpoint without updating it is a
 * failed build rather than a type that quietly lies.
 */
export type FactoryChatProviderId = "azure" | "cloudflare-workers-ai" | "google-vertex" | "amazon-bedrock";

/**
 * `classifyRef(P).kind`, at the type level, for a provider id known at compile
 * time — `never` for a provider `unmodel/chat` can actually serve.
 *
 * The point is the *hover*: a branded unservable result that names `"no-codec"`
 * or `"factory"` tells the reader which of the four remedies in this module's
 * table applies, where a bare brand only says "no".
 */
export type RefProblemKindOf<P extends string> = [P & ChatProviderId] extends [never]
  ? [P & FactoryChatProviderId] extends [never]
    ? [P & NoCodecChatProviderId] extends [never]
      ? "unknown-provider"
      : "no-codec"
    : [P & NoCodecChatProviderId] extends [never]
      ? "factory"
      : "factory-and-no-codec"
  : never;

export interface ModelRef {
  provider: string;
  modelId: string;
}

/**
 * `"openrouter/anthropic/claude-opus-5"` → `{ provider: "openrouter", modelId:
 * "anthropic/claude-opus-5" }`. `undefined` when there is no slash at all, or
 * when either half is empty — a ref is a shape, and a malformed one is not a
 * provider lookup that happens to miss.
 */
export function parseModelRef(ref: string): ModelRef | undefined {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) return undefined;
  return { provider: ref.slice(0, slash), modelId: ref.slice(slash + 1) };
}

/** The wire dialect a provider speaks, or `undefined` if unmodel has no entry. */
export function dialectOf(provider: string): DialectId | undefined {
  return resolveEndpoint(provider)?.dialect;
}

/** Why a ref cannot be served. One arm per genuinely different remedy. */
export type RefProblem =
  /** `"gpt-5"` — no provider half at all. */
  | { kind: "no-slash"; ref: string }
  /** A chat provider whose wire format has no codec: `cohere`. */
  | { kind: "no-codec"; provider: string }
  /** Factory-configured: the URL needs config a bare ref cannot carry. */
  | { kind: "factory"; provider: string; config: readonly EndpointConfigKey[] }
  /** `amazon-bedrock`: factory-configured *and* no `bedrock-converse` codec. */
  | { kind: "factory-and-no-codec"; provider: string; config: readonly EndpointConfigKey[] }
  /** Not a provider unmodel knows at all. */
  | { kind: "unknown-provider"; provider: string };

export type RefClassification =
  | { kind: "supported"; provider: ChatProviderId; dialect: DialectId }
  | RefProblem;

/** The config keys a factory target needs, straight from the endpoint table. */
function configKeysOf(provider: string): readonly EndpointConfigKey[] {
  const endpoint = resolveEndpoint(provider);
  return endpoint?.config ?? [];
}

/**
 * Classifies the **provider half** of a ref. Split out from
 * `classifyModelRef` because the compile path already has the provider by the
 * time it needs a verdict, and re-parsing to get one would be the kind of
 * duplication that lets the two disagree.
 */
export function classifyRef(provider: string): RefClassification {
  if (CHAT_PROVIDER_SET.has(provider)) {
    // Every entry in CHAT_PROVIDERS resolves — that is what the
    // `endpoints.ts` agreement test in test/chat/refs.test.ts pins — so the
    // fallback here is unreachable and exists only to keep the type honest.
    return {
      kind: "supported",
      provider: provider as ChatProviderId,
      dialect: dialectOf(provider) ?? "openai-chat",
    };
  }
  const endpoint = resolveEndpoint(provider);
  const factory = endpoint !== undefined && isFactoryEndpoint(endpoint);
  const noCodec = NO_CODEC.has(provider);
  if (factory && noCodec) {
    return { kind: "factory-and-no-codec", provider, config: configKeysOf(provider) };
  }
  if (factory) return { kind: "factory", provider, config: configKeysOf(provider) };
  if (noCodec) return { kind: "no-codec", provider };
  return { kind: "unknown-provider", provider };
}

/** Parses and classifies in one step. */
export function classifyModelRef(ref: string): RefClassification {
  const parsed = parseModelRef(ref);
  if (parsed === undefined) return { kind: "no-slash", ref };
  return classifyRef(parsed.provider);
}

/** A short, stable sample of valid ids for a "did you mean" line. */
function sampleProviders(): string {
  return ["openai", "anthropic", "google", "groq", "openrouter"].map((id) => `"${id}"`).join(", ");
}

/**
 * Renders a problem as prose, following `Issue`'s discipline from
 * `../core/issues`: name the thing, say why, say what to do instead. The
 * caller wraps this in the right `IssueCode` — `invalid_shape` for
 * `no-slash`, `unknown_model` for the rest — since only the caller knows
 * which surface it is reporting on.
 */
export function refProblemMessage(problem: RefProblem): string {
  switch (problem.kind) {
    case "no-slash":
      return (
        `\`model: "${problem.ref}"\` is missing its provider: \`unmodel/chat\` takes ` +
        `"provider/model" refs (e.g. "openai/${problem.ref}"), because one \`chat()\` ` +
        `serves every provider and the ref is what says which wire format to build. ` +
        `The provider is everything before the FIRST slash, so model ids that contain ` +
        `slashes work too ("openrouter/anthropic/claude-opus-5").`
      );
    case "no-codec":
      return (
        `"${problem.provider}" has a chat validator but no translator: its wire format is a ` +
        `fifth dialect that \`unmodel/chat\` cannot compile to. Use \`unmodel/${problem.provider}\`'s ` +
        `own \`chat()\`, which validates that format exactly.`
      );
    case "factory":
      return (
        `"${problem.provider}" is factory-configured — its URL embeds ` +
        `${problem.config.map((key) => `\`${key}\``).join(" and ")}, which a bare ` +
        `"provider/model" ref cannot carry — so it is not reachable from \`unmodel/chat\`. ` +
        `Use \`unmodel/${problem.provider}\`, which takes that configuration.`
      );
    case "factory-and-no-codec":
      return (
        `"${problem.provider}" is out of reach for two independent reasons: it speaks the ` +
        `bedrock-converse dialect, which has no translator in v1, and it is ` +
        `factory-configured (its URL embeds ` +
        `${problem.config.map((key) => `\`${key}\``).join(" and ")}). Fixing either one alone ` +
        `would not help. Use \`unmodel/${problem.provider}\`'s own \`chat()\`.`
      );
    case "unknown-provider":
      return (
        `"${problem.provider}" is not a provider \`unmodel/chat\` can send to. It takes the ` +
        `${CHAT_PROVIDERS.length} providers with a chat validator and a translatable wire format ` +
        `(${sampleProviders()}, …); \`CHAT_PROVIDERS\` is the full list.`
      );
  }
}
