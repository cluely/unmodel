/**
 * Type-only markers a validator carries for the benefit of registries.
 *
 * Two facts about a validator are invisible to its structural type, and a
 * registry needs both.
 *
 * 1. **Its result for an input the registry supplies.** TypeScript cannot
 *    instantiate an arbitrary generic call signature with a type supplied by
 *    another generic, so validators that need that precision expose a result
 *    *kind*; {@link Apply} substitutes the concrete input into its output.
 * 2. **Which provider it speaks for.** Every chat validator has the same
 *    callable shape, so nothing structural stops one being filed under
 *    another's key. {@link ValidatorProviderCarrier} makes the claim explicit.
 *
 * Both are declared with `unique symbol` keys so they are nominal, and both
 * are optional so adding one never grows a fake runtime member.
 */
export interface ValidatorResultKind {
  readonly input: unknown;
  readonly output: unknown;
}

/** Apply a validator result kind to one concrete input type. */
export type Apply<Kind extends ValidatorResultKind, Input> = (
  Kind & { readonly input: Input }
)["output"];

declare const validatorResultKind: unique symbol;

/**
 * Nominal, type-only carrier attached to a validator's public signature.
 *
 * The property is optional so adding the marker does not make otherwise
 * compatible validator implementations grow a fake runtime member. Extraction
 * checks for the symbol in `keyof` first, which keeps unmarked functions from
 * structurally matching an all-optional interface.
 */
export interface ValidatorResultKindCarrier<Kind extends ValidatorResultKind> {
  readonly [validatorResultKind]?: Kind;
}

/** Extract the result kind from a marked validator, or `never` when absent. */
export type ValidatorResultKindOf<Validator> = typeof validatorResultKind extends keyof Validator
  ? Validator extends ValidatorResultKindCarrier<infer Kind>
    ? Kind
    : never
  : never;

declare const validatorProvider: unique symbol;

/**
 * Nominal, type-only statement of *which provider* a validator speaks for.
 *
 * A registry keyed by provider id has two independent claims in it — the key
 * and the value — and nothing structural relates them: every chat validator
 * has the same callable shape, and two providers routinely serve the same
 * model ids, so `{ groq: togetheraiChat }` type-checks, validates against
 * Together's catalog and pricing, and addresses Together's host, all while a
 * caller who wrote `groq/…` sees zero warnings. Making the value carry its own
 * provider id is what turns that into a compile error.
 *
 * The property is optional, so a hand-written third-party validator that
 * carries no brand still satisfies `ChatProviderValidator<P>` for any `P` —
 * the deliberate escape hatch. What the brand rules out is a validator that
 * says it is *some other* provider's.
 */
export interface ValidatorProviderCarrier<Provider extends string> {
  readonly [validatorProvider]?: Provider;
}

/** The provider a marked validator speaks for, or `never` when unbranded. */
export type ValidatorProviderOf<Validator> = typeof validatorProvider extends keyof Validator
  ? Validator extends ValidatorProviderCarrier<infer Provider>
    ? Provider
    : never
  : never;
