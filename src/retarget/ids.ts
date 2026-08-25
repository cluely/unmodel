/**
 * The target-id vocabulary for `.toApi(provider)` and `.toSdk(target)`.
 *
 * **One vocabulary for the whole library: models.dev catalog provider ids.**
 * You wrote `"open-ai"`, we ship `"openai"` — it is the catalog id, it is the
 * `unmodel/openai` subpath name, and it is what `catalog.getProvider()` takes.
 * `"ai-sdk"` is the single reserved non-catalog id.
 *
 * ⚠️ **Collision worth legislating up front:** `"vercel"` is already a catalog
 * provider id here — the **Vercel AI Gateway** (`unmodel/vercel`,
 * `https://ai-gateway.vercel.sh/v1`), *not* the AI SDK. So `.toApi("vercel")`
 * retargets to the Gateway's HTTP API while `.toSdk("ai-sdk")` formats params
 * for the `ai` npm package. Same company, different things.
 *
 * Hand-written rather than generated: this is not a `.gen.ts` file and so is
 * not covered by the codegen drift check, so `ids.test.ts` asserts instead
 * that `API_TARGET_IDS` is exactly the set of target providers appearing in
 * `src/catalog/availability/*.gen.ts`. A models.dev refresh that adds a new
 * destination therefore fails a test rather than producing a runtime
 * "unknown target".
 */

// ---------------------------------------------------------------------------
// `.toApi` targets
// ---------------------------------------------------------------------------

/**
 * Providers that need per-instance configuration before a URL exists, so a
 * one-argument `.toApi(provider)` can never produce a fetchable request:
 *
 * - `amazon-bedrock` — `region`
 * - `google-vertex` — `project` + `location`
 * - `azure` — the resource `endpoint` (and its `model` is a user-chosen
 *   deployment name, not a catalog id, so availability cannot know it)
 * - `cloudflare-workers-ai` — the account id is a path segment of the base URL
 *
 * `.toApi` must be sync and *total*: it either produces a fetchable request or
 * throws. There is no defensible default (guessing `us-east-1` produces
 * requests that 404 against the wrong account), and these providers already
 * have a first-class correct path via their own factories. Excluded from the
 * v1 union; the two-arg overload that accepts them is a reserved,
 * non-breaking extension.
 */
export const FACTORY_API_TARGET_IDS = [
  "amazon-bedrock",
  "azure",
  "cloudflare-workers-ai",
  "google-vertex",
] as const;

export type FactoryApiTargetId = (typeof FACTORY_API_TARGET_IDS)[number];

/**
 * Every catalog provider that appears as a `.toApi` destination in the
 * generated availability data, factory-configured ones included: the data
 * carries them so the phase-3 two-arg overload needs no codegen change.
 *
 * Every provider with a generated source table is necessarily in here too,
 * because each of its rows carries the **identity** target — a provider serves
 * its own models by definition, so `.toApi(home)` is always a valid retarget.
 * That is what puts `sarvam` on the list: nobody else in scope serves a Sarvam
 * model, so before identity targets existed it was a source with no edges and
 * never appeared as a destination.
 */
export const API_TARGET_IDS = [
  "alibaba",
  "amazon-bedrock",
  "anthropic",
  "azure",
  "baseten",
  "cerebras",
  "cloudflare-workers-ai",
  "deepinfra",
  "deepseek",
  "fireworks-ai",
  "friendli",
  "google",
  "google-vertex",
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
] as const;

export type ApiTargetId = (typeof API_TARGET_IDS)[number];

/** The v1 `.toApi` vocabulary: everything with a provider-wide static URL. */
export type StaticApiTargetId = Exclude<ApiTargetId, FactoryApiTargetId>;

export const STATIC_API_TARGET_IDS: readonly StaticApiTargetId[] = API_TARGET_IDS.filter(
  (id): id is StaticApiTargetId =>
    !(FACTORY_API_TARGET_IDS as readonly string[]).includes(id),
);

export function isApiTargetId(value: string): value is ApiTargetId {
  return (API_TARGET_IDS as readonly string[]).includes(value);
}

export function isStaticApiTargetId(value: string): value is StaticApiTargetId {
  return isApiTargetId(value) && !(FACTORY_API_TARGET_IDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// `.toSdk` targets
// ---------------------------------------------------------------------------

/**
 * SDK target ids: one per provider directory unmodel ships (the id its own
 * official SDK is reached under), plus the reserved `"ai-sdk"`.
 *
 * This union is the *vocabulary*, not the per-endpoint availability — the
 * actual `toSdk` union of a given endpoint is `keyof` its formatter map, which
 * is much narrower. `ids.test.ts` asserts this list matches the provider
 * directories on disk, so a new provider cannot silently miss its id.
 */
export const SDK_TARGET_IDS = [
  "ai-sdk",
  "alibaba",
  "amazon-bedrock",
  "anthropic",
  "assemblyai",
  "azure",
  "baseten",
  "black-forest-labs",
  "bria",
  "bytedance",
  "cartesia",
  "cerebras",
  "cloudflare-workers-ai",
  "cohere",
  "deepgram",
  "deepinfra",
  "deepseek",
  "elevenlabs",
  "fal",
  "fireworks-ai",
  "fish-audio",
  "friendli",
  "gladia",
  "google",
  "google-vertex",
  "groq",
  "huggingface",
  "hume",
  "ideogram",
  "inception",
  "inworld",
  "kling",
  "krea",
  "leonardo",
  "lightricks",
  "lmnt",
  "longcat",
  "luma",
  "meta",
  "minimax",
  "mistral",
  "moonshotai",
  "murf",
  "nebius",
  "novita-ai",
  "nvidia",
  "openai",
  "openrouter",
  "perplexity",
  "pixverse",
  "recraft",
  "resemble",
  "revai",
  "reve",
  "rime",
  "runway",
  "sarvam",
  "scaleway",
  "siliconflow",
  "smallest-ai",
  "soniox",
  "speechify",
  "speechmatics",
  "stability",
  "stepfun",
  "togetherai",
  "upstage",
  "vercel",
  "vidu",
  "xai",
  "zhipuai",
] as const;

export type SdkTargetId = (typeof SDK_TARGET_IDS)[number];

// ---------------------------------------------------------------------------
// Availability lookup types
// ---------------------------------------------------------------------------

/**
 * The `.toApi` targets available for model `M`, read off the provider's own
 * generated availability map.
 *
 * The degradation arm is `StaticApiTargetId`, **not `never`**: an unknown
 * model is a `unknown_model` *warning* everywhere else in this library, and
 * making `.toApi` uncallable for a model the catalog has not caught up on
 * would be worse than a clear runtime throw.
 *
 * The home provider is always in the union: it serves its own models by
 * definition, so `.toApi("anthropic")` on a Claude request is the identity
 * retarget — the same wire body, unchanged — which is what makes a
 * provider-generic call site (`req.toApi(userChosenProvider)`) writable.
 *
 * | the caller wrote | resolves to |
 * |---|---|
 * | `model: "claude-opus-5"` | `"anthropic" \| "openrouter" \| "vercel"` (factory targets filtered out) |
 * | `model: "claude-future-99"` | `StaticApiTargetId` — permissive, runtime-checked |
 * | `model: someRuntimeString` | `StaticApiTargetId` — permissive, runtime-checked |
 *
 * Known sharp edge: a union-typed model (`cond ? "a" : "b"`) distributes and
 * yields the *union* of both models' targets, which over-approximates. It is
 * caught at runtime by the availability guard. The `UnionToIntersection` fix
 * is deliberately not shipped — it produces famously bad hover text for a rare
 * pattern.
 */
export type ApiTargetsFor<Avail, M extends string> = M extends keyof Avail
  ? Extract<keyof Avail[M], StaticApiTargetId>
  : StaticApiTargetId;

/**
 * The target's own spelling of model `M`. Model ids are not normalized across
 * providers — the same Claude is `claude-opus-5`, `anthropic/claude-opus-5`,
 * `anthropic.claude-opus-5` and `claude-opus-5@default` — so this is what
 * makes the retargeted body's `model` field honestly typed.
 *
 * Handles both availability entry forms: the bare-string shorthand and the
 * `{ id, endpoint?, narrows? }` long form.
 */
export type ApiModelFor<Avail, M extends string, P extends PropertyKey> = M extends keyof Avail
  ? P extends keyof Avail[M]
    ? AvailabilityModelId<Avail[M][P]>
    : string
  : string;

type AvailabilityModelId<Entry> = Entry extends string
  ? Entry
  : Entry extends { id: infer Id extends string }
    ? Id
    : string;
