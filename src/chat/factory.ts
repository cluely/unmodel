/**
 * `unmodel/chat/factory` — assemble an exact unified chat surface from only
 * the concrete provider validators an application uses.
 *
 * ```ts
 * import { createChat } from "unmodel/chat/factory";
 * import { chat as anthropic } from "unmodel/anthropic";
 * import { chat as openai } from "unmodel/openai";
 *
 * const chat = createChat({ anthropic, openai });
 * ```
 *
 * This entry contains the canonical compiler and three dialect codecs, but no
 * ready-made provider registry, provider catalog or availability table. Each
 * supplied validator remains the terminal authority for its provider.
 */
import { UnmodelValidationError } from "../core/issues";
import type { ValidateOptions } from "../core/options";
import type { ExactKeys, Validated } from "../core/request";
import type { ValidateResult } from "../core/result";
import type {
  Apply,
  ValidatorProviderCarrier,
  ValidatorResultKindOf,
} from "../core/validator-result-kind";
import type { ChatProviderId } from "../catalog/chat-refs.gen";
import type {
  ChatBody,
  ChatDialectOf,
  ChatModelOf,
  ChatProviderOf,
  ChatResultMeta,
  ChatSdkTargets,
} from "./public-types";
import type { ChatOptions, ChatProviderRuntime } from "./validate";
import { CHAT_ENDPOINT, runChat, runChatUnknown } from "./validate";
import type { RefProblem, RefProblemKindOf } from "./refs";
import { CHAT_PROVIDERS } from "./refs";
import type { ChatParams } from "./types";

/**
 * The callable + safe surface every concrete provider chat validator has,
 * plus its claim about *which provider* it speaks for.
 *
 * The brand is what ties a registry's key to its value. Structurally, every
 * chat validator in the library is the same type — and providers routinely
 * serve the same model ids — so `{ groq: togetheraiChat }` would otherwise
 * type-check, validate against Together's catalog and pricing, and address
 * Together's host, while a caller who wrote `groq/…` sees zero warnings.
 *
 * The brand is an *optional* member, deliberately: a hand-written third-party
 * validator that carries none still satisfies every key, which keeps the
 * registry open. What it rules out is a validator that says it is some *other*
 * provider's. `createChat` closes the remaining gap at runtime by comparing
 * the key against the endpoint the validator reports.
 */
export type ChatProviderValidator<Provider extends string = string> = ((
  params: never,
  options?: ValidateOptions,
) => object) & {
  safe: (params: never, options?: ValidateOptions) => ValidateResult<object>;
} & ValidatorProviderCarrier<Provider>;

/** Provider id -> that provider's concrete chat validator. */
export type ChatProviderRegistry = {
  [K in ChatProviderId]?: ChatProviderValidator<K>;
};

/**
 * Rejects an explicitly-`undefined` entry.
 *
 * `tsconfig` does not enable `exactOptionalPropertyTypes`, so
 * `{ openai: cond ? openai : undefined }` is assignable to a `?:` property and
 * would reach the constructor as a malformed entry rather than an absent one —
 * a `TypeError` for something the type system can see. Build the registry with
 * a spread (`...(cond && { openai })`) instead.
 */
type RegisteredEntries<Registry> = {
  [K in keyof Registry]: [Extract<Registry[K], undefined>] extends [never] ? Registry[K] : never;
};

type IsAny<T> = 0 extends 1 & T ? true : false;

type AppliedProviderResult<Validator, Params> = Validator extends (
  params: Params,
  options?: ValidateOptions
) => infer Result
  ? Result
  : never;

type DeclaredProviderResult<Validator> = Validator extends (...args: never[]) => infer Result
  ? Result
  : never;

/**
 * Instantiate an *unmarked* validator with the body the compiler emits.
 *
 * Every chat validator this library ships carries a `ValidatorResultKind`, so
 * nothing in-tree takes this branch — it exists for a hand-written third-party
 * validator registered under one of the 32 provider ids, which has no marker
 * to apply. Conditional application is attempted first; a generic signature
 * whose own body type is narrower than the compiled one will not apply, and a
 * validator whose result is `any` would poison everything downstream, so both
 * fall back to the declared `ReturnType`.
 *
 * `test/types/chat.test-d.ts` exercises it with an unmarked validator, because
 * a branch no shipped code reaches is a branch that quietly stops working.
 */
type LegacyChatProviderResult<Validator, Params> = [
  AppliedProviderResult<Validator, Params>,
] extends [never]
  ? DeclaredProviderResult<Validator>
  : IsAny<AppliedProviderResult<Validator, Params>> extends true
    ? DeclaredProviderResult<Validator>
    : AppliedProviderResult<Validator, Params>;

/** Apply a marked generic validator exactly; retain structural compatibility for custom validators. */
export type ChatProviderResult<Validator, Params> = [
  ValidatorResultKindOf<Validator>,
] extends [never]
  ? LegacyChatProviderResult<Validator, Params>
  : Apply<ValidatorResultKindOf<Validator>, Params>;

/**
 * The result type of a ref whose provider is not in the registry.
 *
 * Two very different situations arrive here, and conflating them costs a
 * compile error the caller should have had:
 *
 * - **The provider half is a literal.** Whether it names a provider this build
 *   did not register (`createChat({ openai })` + `"anthropic/…"`), one
 *   `unmodel/chat` structurally cannot serve (`cohere`, `azure`,
 *   `amazon-bedrock` — see the table in `./refs`), or a plain typo
 *   (`"opnai/gpt-5"`), the call can only ever throw
 *   `TranslationUnavailableError`. Handing back a usable-looking `Validated`
 *   is a type that describes a value the program cannot produce, so it
 *   resolves to {@link UnregisteredChatProvider} instead — branded and
 *   otherwise empty, so `.request`, `.toSdk` and friends are compile errors
 *   that name the mistake at the call site.
 * - **The ref is genuinely dynamic** (`string`, or a templated id). That must
 *   stay callable, which is the convention every media pack already follows,
 *   so it keeps the structural fallback below. Note this hatch is about
 *   *models*, not providers: a model released after this build stays callable
 *   at a registered provider, while providers are a closed hand-maintained set
 *   that only a new unmodel release can grow.
 */
export interface UnregisteredChatProvider<
  Provider extends string,
  Problem extends UnservableChatReason = UnservableChatReason,
> {
  readonly __unmodel_unregisteredChatProvider: Provider;
  /**
   * Which remedy applies — the same verdict `classifyRef` computes at runtime,
   * carried into the type so the hover says *why*, not just "no". `"not-registered"`
   * is the one case with no `RefProblem` arm: the provider is servable, this
   * particular registry just does not carry it.
   */
  readonly __unmodel_refProblem: Problem;
}

/** Every reason a literal-provider ref can be unservable. */
export type UnservableChatReason = RefProblem["kind"] | "not-registered";

/** `"cohere"` → `"no-codec"`; a registered-elsewhere provider → `"not-registered"`. */
type UnservableReason<P extends string> = [P & ChatProviderId] extends [never]
  ? RefProblemKindOf<P>
  : "not-registered";

type FallbackChatResult<R extends string> = Validated<
  ChatBody<R>,
  ChatSdkTargets<ChatDialectOf<R>, ChatModelOf<R>>
>;

/** The params shape the provider sees (Gemini restores its URL-only model). */
type ProviderParamsFor<R extends string> = ChatBody<R> & {
  model: ChatModelOf<R>;
};

type UnregisteredResult<R extends string> = string extends ChatProviderOf<R>
  ? // A ref that is not statically resolvable at all. Must stay callable: a
    // model released after this build is the case the fallback exists for.
    FallbackChatResult<R>
  : // Any literal provider that is not in this registry, for whatever reason.
    // There used to be a second arm here that kept an unknown *literal* provider
    // structural, on the grounds that "the `model` position already flags it".
    // It does not: `model` is `ChatModelRef | (string & {})`, so `"opnai/gpt-5"`
    // compiles clean and used to hand back a full `Validated` for a call that
    // throws every time.
    UnregisteredChatProvider<ChatProviderOf<R>, UnservableReason<ChatProviderOf<R>>>;

type RegisteredProviderResult<Registry, R extends string> =
  ChatProviderOf<R> extends keyof Registry
    ? ChatProviderResult<Registry[ChatProviderOf<R>], ProviderParamsFor<R>>
    : UnregisteredResult<R>;

/**
 * Result of a registry-built chat surface for one model ref.
 *
 * Distributed over `R`, which is not a formality: a ref union — the ordinary
 * `flag ? "anthropic/…" : "google/…"` or a config-driven id — otherwise picks
 * one arm's body guard, fails it, and collapses the whole result to `never`
 * (silently: `never` is assignable to everything, so nothing errors until a
 * property access, and the editor completes nothing). Distributing gives the
 * honest union of per-provider results instead.
 *
 * A union result's `toSdk`/`toApi` are a union of generic signatures, which
 * TypeScript declines to call. That is left alone on purpose: intersecting
 * them into overloads would make `result.toSdk("openai")` compile against a
 * value that may be the Anthropic arm at runtime. Narrow on `target` first —
 * the union is discriminated by it.
 */
export type ChatPackResult<Registry, R extends string> = R extends string
  ? RegisteredProviderResult<Registry, R> & ChatResultMeta<R>
  : never;

/** Callable surface returned by {@link createChat}. */
export interface ChatValidator<Registry extends ChatProviderRegistry> {
  <T extends ChatParams>(
    params: T & ExactKeys<T, ChatParams>,
    options?: ChatOptions,
  ): ChatPackResult<Registry, T["model"] & string>;
  safe<T extends ChatParams>(
    params: T & ExactKeys<T, ChatParams>,
    options?: ChatOptions,
  ): ValidateResult<ChatPackResult<Registry, T["model"] & string>>;
  safeUnknown(
    params: unknown,
    options?: ChatOptions,
  ): ValidateResult<ChatPackResult<Registry, string>>;
  /** Every provider registered on this validator, sorted. */
  readonly providers: readonly (keyof Registry & string)[];
}

function providerRuntime(registry: ChatProviderRegistry): ChatProviderRuntime {
  return {
    has: (provider) => registry[provider] !== undefined,
    validate(provider, modelId, body, options) {
      const validator = registry[provider];
      if (validator === undefined) {
        throw new TypeError(`unmodel/chat: provider "${provider}" is not registered.`);
      }
      // Gemini's model is a URL path parameter. Its concrete validator accepts
      // the unstripped shape and removes `model` in its own finalizer.
      const params = provider === "google" ? { model: modelId, ...body } : body;
      const safe = validator.safe as unknown as (
        params: object,
        options?: ValidateOptions,
      ) => ValidateResult<object>;
      return safe(params, options);
    },
  };
}

/**
 * Builds a unified `chat()` backed by exactly the provider validators supplied.
 *
 * The registry replaces neither schema nor catalog data: it selects the real
 * provider validators whose closed-over catalogs remain authoritative. This is
 * also the replacement for the former `ChatOptions.catalog` override—custom
 * provider configuration belongs in the validator registered here, not in a
 * second catalog layered beside it.
 */
export function createChat<const Registry extends ChatProviderRegistry>(
  registry: Registry &
    RegisteredEntries<Registry> &
    Record<Exclude<keyof Registry, ChatProviderId>, never>,
): ChatValidator<Registry> {
  const known = new Set<string>(CHAT_PROVIDERS);
  for (const [provider, validator] of Object.entries(registry)) {
    if (!known.has(provider)) {
      throw new TypeError(
        `unmodel/chat: "${provider}" is not a statically addressable chat provider. ` +
          `Providers with a chat validator: ${CHAT_PROVIDERS.join(", ")}.`,
      );
    }
    if (typeof validator !== "function" || typeof validator.safe !== "function") {
      throw new TypeError(
        `unmodel/chat: registry entry "${provider}" must be a provider chat validator with .safe() — ` +
          `got ${validator === null ? "null" : typeof validator}. ` +
          `Import it as \`import { chat } from "unmodel/${provider}"\`.`,
      );
    }
    // The last hole the brand cannot close: a hand-written validator carrying
    // no brand, filed under the wrong key. Providers share model ids, so a
    // mis-keyed entry otherwise validates against the wrong catalog and posts
    // to the wrong host with no issue reported anywhere.
    const endpoint: unknown = (validator as { endpoint?: unknown }).endpoint;
    if (typeof endpoint === "string" && endpoint !== `${provider}.chat`) {
      throw new TypeError(
        `unmodel/chat: registry entry "${provider}" is ${endpoint.split(".")[0]}'s chat validator ` +
          `(it reports endpoint "${endpoint}"). A mis-keyed entry addresses the wrong host and prices ` +
          "against the wrong catalog without reporting anything.",
      );
    }
  }

  const runtime = providerRuntime(registry);

  function safe(params: ChatParams, options: ChatOptions = {}): ValidateResult<object> {
    return runChat(params, options, runtime).result;
  }

  function safeUnknown(params: unknown, options: ChatOptions = {}): ValidateResult<object> {
    return runChatUnknown(params, options, runtime).result;
  }

  function validator(params: ChatParams, options: ChatOptions = {}): object {
    const { result, structural } = runChat(params, options, runtime);
    if (structural !== undefined) throw structural;
    if (!result.ok) {
      throw new UnmodelValidationError(CHAT_ENDPOINT, result.errors, result.warnings);
    }
    return result.params;
  }

  validator.safe = safe;
  validator.safeUnknown = safeUnknown;
  Object.defineProperty(validator, "providers", {
    value: Object.freeze(Object.keys(registry).sort()),
    enumerable: true,
  });
  return validator as unknown as ChatValidator<Registry>;
}

export type { ChatOptions } from "./validate";
export type {
  ChatBody,
  ChatDialect,
  ChatDialectOf,
  ChatGeminiSdkParams,
  ChatModelOf,
  ChatProviderOf,
  ChatResultMeta,
  ChatSdkTargets,
} from "./public-types";
export type { ChatParams, ChatProviderId } from "./types";
