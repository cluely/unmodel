/**
 * The contract between the unified kernel and a provider adapter.
 *
 * ## The shape of the whole thing, in one paragraph
 *
 * A caller writes one camelCase request and a `"provider/model"` ref. The
 * kernel splits the ref, hands the request to that provider's
 * {@link UnifiedAdapter}, and gets back a {@link CompiledCall}: the provider's
 * own wire params, plus the provider's own validator. It then merges
 * `providerOptions`, runs *that* validator — all four layers, the estimate and
 * the finalize step — and returns what it returns. The result of a unified
 * call **is** a `Validated` from `unmodel/<provider>`, with translation
 * warnings hung off it non-enumerably. There is no second pipeline and no
 * second definition of what a valid request is.
 *
 * ## Why an adapter is a compiler and not a table
 *
 * A declarative param map handles about sixty percent of the work and then
 * stops: `resolution: "1k"` becomes `"1024x1024"` at one provider, `1024` and
 * `1024` at another, `"1K"` at a third, and a grid-snapped pair that has to be
 * computed at a fourth. The interesting cases are all *derivations*, and a
 * derivation needs a function. `derive.ts` is where the recurring ones live so
 * that forty adapters share one implementation of "16:9 at 1k on a 32-px
 * grid" — and one implementation of what to do when it does not fit exactly.
 *
 * ## The loss contract
 *
 * Identical to `.toApi()`'s, and stated in `core/translate/warnings.ts`:
 *
 * - A param the provider **cannot express** is an **error**
 *   (`unsupported_param` / `invalid_enum_value`). Never a silent drop.
 * - A param the provider expresses **approximately** — rounded, snapped,
 *   nearest-enum — is a `TranslationWarning` (`approximated_param`) naming
 *   both the requested and the achieved value.
 * - Therefore `warnings.length === 0` **means** the request mapped exactly.
 *   That equivalence is the reason both halves are strict.
 *
 * ## What the kernel runs, in order
 *
 * (`createUnified` in `./kernel.ts` implements this. The prose lives here
 * because this file is types only — it costs nothing in six bundles whose
 * whole design premise is that they are small.)
 *
 * | step | subject | why |
 * |---|---|---|
 * | ref | `model`'s first-slash prefix | decides which adapter, and there is nothing to do without one |
 * | models | the adapter's `as const` list | an unrecognised id **warns**; catalogs are snapshots |
 * | unsupported | the adapter's declared gaps | uniform message, checked before compile |
 * | compile | the adapter | canonical params → the provider's wire params |
 * | merge | `providerOptions[provider]` | deep-merged **before** validation, never after |
 * | validate | the provider's own `.safe` | all four layers, the estimate, the finalize |
 * | remap | declared provenance | wire paths → the words the caller wrote |
 *
 * ## The one design decision worth defending
 *
 * There is no zod schema in the kernel, and no second set of checks. The
 * unified surface adds a *compile step in front of* the existing provider
 * validators; it does not add a weaker validator beside them. Everything a
 * provider knows about its own API — the deny tables, the media limits, the
 * model catalog, the cost estimate, the `.request` and `.toSdk` on the way out
 * — applies to a unified call automatically, because a unified call ends in
 * exactly the same function a hand-written one does. The two cannot disagree
 * about whether a request is valid, because there is only one answer to
 * disagree about.
 *
 * What that costs: a caller who writes `{ prompt: 12 }` is caught by the
 * provider's layer 1 rather than by a canonical schema, and the issue arrives
 * at a wire path — which is what {@link CompileContext.from} exists to fix.
 * What it buys is that the six category entries are a few kilobytes of kernel
 * each, and that there is no possible drift between the two ways to call a
 * provider.
 *
 * ## Structural failures are not validation failures
 *
 * A ref naming a provider with no adapter is not a request with a bad param —
 * there is no request, because nothing can compile it. Same contract as
 * `.toApi` and `unmodel/chat`: the throwing form throws
 * `TranslationUnavailableError` so the thrown type names the structural cause,
 * and the `safe` form reports the identical message through `errors` with
 * `meta.structural`, because a caller who asked for `safe` opted out of
 * exceptions and this is precisely the kind they opted out of catching.
 *
 * Those issues are built **directly** rather than through the severity sink,
 * so an `options.severity` override cannot silence one and hand back an
 * `ok: true` result with no body in it.
 */
import type { IssueCode } from "../issues";
import type { ValidateOptions } from "../options";
// Type-only, and the same `ExactKeys` every provider validator uses — including
// its exemption list for the non-enumerable members a result carries, which is
// what makes composing one validator's output into another's input compile.
import type { ExactKeys } from "../request";
import type { ValidateResult } from "../result";
import type { TranslationWarning, Warn } from "../translate/warnings";

/**
 * The thirteen media surfaces, each of which gets its own vocabulary, its own
 * entry point, and its own adapter set.
 *
 * They are separate categories rather than one `media()` with a mode flag
 * because the vocabularies genuinely do not overlap — `voice` means nothing to
 * an image model, `aspectRatio` nothing to a transcription — and a single type
 * carrying all twelve would be a type whose valid combinations you have to
 * memorize. The voice-creation pair splits for the same reason at closer
 * range: cloning's input is audio samples, design's is a text prompt, and
 * `description` means metadata on one side and the generative instruction on
 * the other (see `vocabulary/voice-clone.ts`).
 *
 * `lipsync` and `avatar` are the closest call in the list — one vendor's single
 * product often serves both — and they split on the same test as everything
 * else here: what goes IN. Lipsync is handed a performance and preserves it;
 * avatar is handed a face and invents one. Merging them would mean a `source`
 * that is a clip at some models and a still at others, which is precisely the
 * "valid combinations you have to memorize" this list avoids.
 *
 * `upscale` splits from `imageEdit` on what comes OUT: an edit is described by
 * what the result should look like, an upscale by how much bigger it should be,
 * and `factor` is meaningless in a vocabulary whose size words are absolute.
 * Half its routes take a clip, which `imageEdit` has no word for and should not
 * grow one.
 *
 * `"3d"` is the only id in this union that is not a TypeScript identifier, and
 * the only one whose OUTPUT is not a frame at all: a mesh has no width, no
 * aspect ratio and no duration, so none of the sizing words in the five
 * categories above mean anything to it. It waited for a second witness — a
 * vocabulary read off one vendor is that vendor's schema with the names changed
 * — and joined when `tripo3d` gave one.
 *
 * `"sfx"` is the newest and the smallest, and it splits from `music` on the
 * wire rather than on taste: the two endpoints at the one vendor that serves
 * both are disjoint, with disjoint model-id enums, a length in milliseconds on
 * one side and seconds on the other, and a floor of 3 000 ms against one of
 * half a second. Merging them would force `instrumental?: boolean` onto a door
 * creak and a three-second floor onto a footstep. It arrived with five
 * independent vendor witnesses, which is the most any category here has had on
 * its first day.
 */
export type UnifiedCategory =
  | "image"
  | "imageEdit"
  | "video"
  | "lipsync"
  | "avatar"
  | "upscale"
  | "3d"
  | "tts"
  | "stt"
  | "music"
  | "sfx"
  | "voiceClone"
  | "voiceDesign";

/**
 * A finding in **canonical** space: the path names a field the caller wrote,
 * not a wire param they have never seen.
 *
 * Severity is deliberately absent. It comes from `DEFAULT_SEVERITY` in
 * `core/pipeline.ts` — the same table every provider validator uses — so that
 * an adapter cannot decide that its own `unsupported_param` is only a warning.
 * A caller's `options.severity` still overrides, as everywhere else.
 */
export interface CompileIssue {
  code: IssueCode;
  path: Array<string | number>;
  message: string;
  meta?: Record<string, unknown>;
}

/**
 * The uniform return of every function in `derive.ts`.
 *
 * `value` is absent exactly when the derivation failed, and `issues` is
 * non-empty exactly then — the two are not independent, but they are kept as
 * separate fields rather than a discriminated union because the overwhelmingly
 * common call site is `ctx.take(...)`, which needs both and cares about
 * neither.
 *
 * Warnings are *not* here. They go to the {@link Warn} sink passed in, because
 * a warning is not a result: an approximated value still has a `value`, and a
 * caller who ignored a warning got a working request. Errors stop the request;
 * warnings ride along with it.
 */
export interface Derived<T> {
  value?: T;
  issues: CompileIssue[];
}

/**
 * Everything an adapter is handed besides the request itself.
 *
 * The `Canon` parameter is not decoration: it types {@link from}'s canonical
 * half, so provenance can only be declared for fields the vocabulary actually
 * has. A typo there would otherwise degrade an error message silently, months
 * later, in the one code path nobody tests.
 */
export interface CompileContext<Canon> {
  /**
   * The **bare** model id, provider half already stripped —
   * `"gpt-image-1"`, never `"openai/gpt-image-1"`. Adapters key their
   * per-model tables off this, and it is what goes on the wire.
   */
  readonly model: string;

  /**
   * Records what compiling this request cost. The route (`unified.image →
   * openai.image`) is stamped by the kernel; an adapter supplies only `code`,
   * `path` (canonical) and `message`.
   */
  readonly warn: Warn;

  /**
   * Records a canonical-space error or warning. Every `fail` of error severity
   * stops the request before the provider's validator runs — there is no point
   * validating a body compiled from params that could not be compiled.
   */
  fail(issue: CompileIssue): void;

  /**
   * Declares that a wire param came from a canonical one.
   *
   * This is what keeps the provider validator's messages readable. That
   * validator is written against the wire body — it must be, that is the whole
   * point of reusing it — so its issues arrive at paths like `["size"]` or
   * `["parameters", "aspectRatio"]`. Telling a caller who wrote
   * `aspectRatio: "16:9"` that `size` is invalid sends them looking for a
   * param that does not exist in the vocabulary they are using.
   *
   * With provenance declared, the kernel rewrites the path to the canonical
   * name and appends `` (compiled from `size`) `` — so the message names the
   * field they wrote *and* the wire field it became, which is also the fastest
   * possible bug report.
   *
   * Undeclared wire paths are left alone. That is the right default: a param
   * that reached the body through `providerOptions` has no canonical name
   * *because the caller deliberately used the escape hatch*, and the wire
   * spelling is exactly what they typed.
   */
  from(wirePath: Array<string | number>, canonical: CanonicalField<Canon>): void;

  /**
   * Reports a {@link Derived}'s issues and hands back its value.
   *
   * The bridge between `derive.ts` (returns issues) and this context
   * (collects them). Without it every adapter opens with the same four-line
   * loop, forty times, and one of them eventually forgets it — producing a
   * request that silently ignores a failed derivation.
   */
  take<T>(derived: Derived<T>): T | undefined;
}

/**
 * The dotted paths one level into a canonical vocabulary —
 * `"dimensions.width"`, `"diarization.maxSpeakers"`. Arrays are excluded: an
 * index is not a field name, and no adapter names one.
 *
 * Depth 1 is exhaustive, not a simplification: every dotted `ctx.from` in the
 * repo is `<object field>.<leaf>`, and a canonical vocabulary two levels deep
 * would be a vocabulary problem before it was a typing one.
 */
type DottedField<T> = {
  [K in Extract<keyof T, string>]: NonNullable<T[K]> extends object
    ? NonNullable<T[K]> extends readonly unknown[]
      ? never
      : `${K}.${Extract<keyof NonNullable<T[K]>, string>}`
    : never;
}[Extract<keyof T, string>];

/**
 * A field name in the canonical vocabulary, or a dotted path into one.
 *
 * Closed, deliberately. This is not a caller-facing surface where a `(string &
 * {})` tail buys forward-compatibility — it is the adapter author's declaration
 * of *which canonical field a wire param was compiled from*, and the vocabulary
 * it names is in this very build. The tail here bought nothing and cost the
 * completions: the dotted paths it existed to permit could not be suggested,
 * and a typo degraded an error message silently, months later, in the one code
 * path nobody tests — which is exactly what {@link CompileContext.from}'s own
 * doc predicts, and what closing this found (a `ctx.from` naming a model extra
 * that is not a canonical field at all).
 *
 * An adapter that genuinely needs to name an extras key should union
 * `AnyExtraKey<A>` in here rather than reopen the tail.
 */
export type CanonicalField<Canon> = Extract<keyof Canon, string> | DottedField<Canon>;

/**
 * What an adapter produces: the provider's wire params, and the provider's own
 * validator to run them through.
 *
 * `validate` is the provider endpoint's `.safe` — nothing wrapped, nothing
 * re-implemented. That is the load-bearing decision of this whole design: the
 * unified surface adds a compile step in front of the existing validators
 * instead of adding a second, weaker validator beside them, so a unified call
 * and a hand-written provider call are checked by identical code and cannot
 * disagree.
 */
export interface CompiledCall<Wire extends object = object, Out extends object = object> {
  /** The wire body, before `providerOptions` is merged over it. */
  params: Wire;
  /** The provider endpoint's own `.safe`. */
  validate: (params: Wire, options?: ValidateOptions<Wire>) => ValidateResult<Out>;
}

/**
 * One provider's implementation of one category.
 *
 * Lives at `src/providers/<p>/unified.ts` — a leaf that may see its own
 * provider directory, `core/unified/**` and `core/translate/warnings`, and
 * nothing else. The import-graph suite enforces it, because an adapter that
 * reached sideways would put every provider it touched into every unified
 * bundle.
 */
export interface UnifiedAdapter<
  Canon,
  Wire extends object = object,
  Out extends object = object,
  Ctx = Canon,
> {
  readonly category: UnifiedCategory;
  /** The ref's first-slash prefix, e.g. `"openai"`. */
  readonly provider: string;
  /**
   * Every model this adapter serves, as bare ids.
   *
   * Two jobs: it is the runtime allow-list behind the `unknown_model` warning,
   * and — declared `as const` — it is what {@link UnifiedRef} turns into the
   * `` `${provider}/${model}` `` union a category entry autocompletes. So the
   * suggestions in an editor and the list in the warning message are the same
   * list, and cannot drift.
   */
  readonly models: readonly string[];

  /**
   * Canonical fields this provider cannot express, each with the reason.
   *
   * Checked by the kernel *before* `compile` runs, which is what makes it
   * worth declaring rather than handling inside `compile`:
   *
   * - the message is uniform across every adapter, so `n` being unsupported
   *   reads the same at all six providers that cannot do it;
   * - the capability table is derivable from data, so the suite can assert
   *   "these forty adapters, times these twelve fields" without executing a
   *   compile per cell;
   * - and `compile` gets to assume the field is absent, which removes the
   *   commonest way an adapter accidentally drops a param instead of
   *   rejecting it.
   */
  readonly unsupported?: Readonly<Partial<Record<Extract<keyof Canon, string>, string>>>;

  /**
   * `Ctx` is separate from `Canon` for the same reason `Wire`/`Out` are `any`
   * on {@link AnyUnifiedAdapter}: {@link CompileContext} is contravariant in
   * its vocabulary (through `from`'s `CanonicalField<Canon>` parameter), so an
   * adapter whose `compile` takes a *narrowed* vocabulary — `ImageEditParamsFor<"file">`,
   * `SttParamsFor<…>` — is not assignable to one typed with the wide
   * canonical vocabulary. Until `CanonicalField` closed, the `(string & {})`
   * tail was silently neutralising that contravariance; the knob makes what was
   * already happening explicit instead of restoring the tail.
   */
  compile(input: Canon, ctx: CompileContext<Ctx>): CompiledCall<Wire, Out>;
}

/**
 * The loosest adapter type that still pins the vocabulary — the constraint
 * category entries use.
 *
 * `any` for `Wire`/`Out` is deliberate and confined to this alias: an adapter
 * whose `compile` returns `CompiledCall<OpenAiImageBody, Validated<…>>` is not
 * assignable to `CompiledCall<object, object>` (the `validate` property is
 * contravariant in its parameter), so a constraint written with `object` would
 * reject every real adapter. The concrete types survive on the adapter's own
 * type and are recovered by {@link UnifiedOut}.
 */
export type AnyUnifiedAdapter<Canon> = UnifiedAdapter<Canon, any, any, any>;

// ---------------------------------------------------------------------------
// Type-level ref plumbing
// ---------------------------------------------------------------------------

/**
 * An adapter's slice of the model-ref union: `` `${provider}/${model}` ``.
 *
 * Distributes over a union of adapter types, so `createImage([openai, google])`
 * yields every ref both of them serve — from nothing but the `as const` arrays
 * the adapters already declare for the runtime check.
 */
export type UnifiedRef<A> = A extends {
  readonly provider: infer P extends string;
  readonly models: readonly (infer M extends string)[];
}
  ? `${P}/${M}`
  : never;

/** `"openai/gpt-image-1"` → `"openai"`. First slash, never last. */
export type RefProvider<R extends string> = R extends `${infer P}/${string}` ? P : never;

/** `"openrouter/black-forest-labs/flux"` → `"black-forest-labs/flux"`. */
export type RefModel<R extends string> = R extends `${string}/${infer M}` ? M : never;

/**
 * The adapter a ref selects, or the whole union when the ref is not a literal.
 *
 * The fallback is the interesting half: a ref built at runtime types as
 * `string`, which selects nothing — and degrading to the *union of every
 * adapter's result* is strictly better than degrading to `any`, because the
 * members every provider has stay typed and the ones only some have become a
 * visible union to narrow.
 */
export type AdapterFor<A, R extends string> = [Extract<A, { provider: RefProvider<R> }>] extends [
  never,
]
  ? A
  : Extract<A, { provider: RefProvider<R> }>;

/**
 * The variant set an adapter declares for one of its own fields, as a union.
 *
 * The compile-time half of a **per-route narrowing**: some categories have a
 * canonical field whose legal *shapes* depend on the route rather than on the
 * category. `stt`'s `audio` is the case that motivated this — a batch
 * API that only fetches URLs, a multipart route that only takes a `Blob`, and
 * a provider whose file API mints ids are three different types for one word —
 * so a transcribe adapter declares `audioInputs: ["url"] as const` and this
 * turns that back into `"url"`.
 *
 * Generic in the field name rather than hard-coded to `audioInputs` because
 * the kernel has no business knowing a category's field names, and because the
 * next category that needs one should not need a second copy of this.
 *
 * `Record<Field, …>` distributes over a union of adapters, which is what makes
 * the degraded case below behave: a ref that is not a literal selects every
 * adapter, and the union of everything they accept is the honest answer.
 */
export type DeclaredInputs<A, Field extends string> =
  A extends Record<Field, readonly (infer V extends string)[]>
    ? V
    : never;

/**
 * {@link DeclaredInputs}, resolved through a model ref — "which shapes may
 * `audio` take, given `model: "assemblyai/best"`".
 *
 * Composed of the two pieces that already exist rather than reimplementing
 * either: {@link AdapterFor} picks the adapter (or degrades to the whole
 * union), and `DeclaredInputs` reads what it declared. A ref built at runtime
 * therefore widens to every kind any adapter in the build accepts — open at
 * compile time, still checked at runtime, which is the same trade every model
 * list in this library makes.
 *
 * A ref naming a provider **not in this build** widens the same way, and that
 * is a remaining asymmetry rather than an endorsement: {@link UnifiedResult}
 * brands such a ref, because its call can only throw, but the *params* it
 * accepts still degrade to the union. Tightening the input position would mean
 * intersecting `model` with something wide, which discharges the `(string & {})`
 * tail and kills the completions this library exists to provide — so the refusal
 * is stated on the result, where it costs nothing.
 */
export type InputsFor<A, R extends string, Field extends string> = DeclaredInputs<
  AdapterFor<A, R>,
  Field
>;

/**
 * The `Validated` an adapter's provider endpoint returns.
 *
 * `CompiledCall<any, infer O>` and not `CompiledCall<object, infer O>`: under
 * `strictFunctionTypes` the `validate` property is contravariant in its
 * parameter, so a `CompiledCall<OpenAiImageBody, …>` does not extend a
 * `CompiledCall<object, …>` and the `infer` would never fire. `any` is the
 * only wildcard that matches in both directions.
 */
export type UnifiedOut<A> = A extends { compile: (...args: never[]) => infer C }
  ? C extends CompiledCall<any, infer O>
    ? O
    : object
  : object;

/**
 * The result of a ref whose provider is not in this build.
 *
 * Branded and otherwise empty, so `.request`, `.toSdk` and every wire field are
 * compile errors that name the provider. The call it describes cannot succeed:
 * `image({ model: "google/imagen-4.0-generate-001", … })` on a pack without the
 * google adapter throws `TranslationUnavailableError`, always — so the old type
 * (the union of every *registered* provider's `Validated`) described a value
 * the program cannot produce.
 *
 * A named property rather than a `unique symbol`, matching
 * `UnregisteredChatProvider`: the two surfaces close the same hole and should
 * read the same way. Chat's carries the reason as well, because chat has four
 * distinct remedies to name; here there is exactly one — register the adapter,
 * or fix the provider segment.
 */
export interface UnregisteredUnifiedProvider<Provider extends string> {
  readonly __unmodel_unregisteredUnifiedProvider: Provider;
}

/** The provider ids an adapter union actually registers. */
export type RegisteredProviderId<A> = A extends { readonly provider: infer P extends string }
  ? P
  : never;

/** The resolved shape — what every servable ref returns. */
type ResolvedUnifiedResult<A, R extends string> = UnifiedOut<AdapterFor<A, R>> & {
  readonly warnings: readonly TranslationWarning[];
};

/**
 * What a unified call returns: the provider's own `Validated` — enumerable
 * properties are its wire body, `.request` and `.toSdk` ride non-enumerably —
 * plus the translation warnings, likewise non-enumerable and frozen.
 *
 * Three arms, and the middle one is the point:
 *
 * 1. **No provider segment at all** (`model` built at runtime, so `RefProvider`
 *    is `never`) — resolves, because a ref this build cannot read is exactly
 *    the case the degradation exists for.
 * 2. **A literal provider this build does not register** — branded. Covers both
 *    a subset pack (`createImage([openai, ideogram])` pointed at google) and
 *    the case with no other guard at all: a typo in the provider segment, which
 *    `model`'s `(string & {})` tail admits at the input position by design.
 * 3. **Anything else** — resolves, including a model id released after the
 *    snapshot at a registered provider.
 *
 * Non-distributive on purpose: the distributive spelling additionally flags the
 * bad arm of a mixed union (`cond ? "openai/x" : "bogus/y"`) and was measured at
 * +6% instantiations, which is not worth that arm.
 *
 * `unmodel/chat` brands the same two cases through `UnregisteredChatProvider`
 * (with the remedy attached, since chat has four), so the two surfaces now give
 * the same answer to the same mistake. That symmetry is a decision, not an
 * accident: an unregistered *provider* is never a forward-compatibility case,
 * because providers are a closed hand-maintained set that only a new release
 * can grow — unlike a model id, which the snapshot legitimately lags.
 */
export type UnifiedResult<A, R extends string> = [RefProvider<R>] extends [never]
  ? ResolvedUnifiedResult<A, R>
  : [RefProvider<R> & RegisteredProviderId<A>] extends [never]
    ? UnregisteredUnifiedProvider<RefProvider<R>>
    : ResolvedUnifiedResult<A, R>;

/**
 * The untrusted-input half of a unified validator's interface.
 *
 * This is deliberately a separate method instead of an `unknown` overload on
 * `safe`: an `unknown` overload would also accept typoed object literals after
 * the strict `ExactKeys` overload rejected them, silently deleting the
 * compile-time check. `safeUnknown` is the explicit seam for JSON, CLI input,
 * and other values whose shape is not known until runtime.
 */
export interface SafeUnknown<Out> {
  safeUnknown(params: unknown, options?: ValidateOptions): ValidateResult<Out>;
}

/**
 * The caller-facing param type: the category's vocabulary, with `model`
 * replaced by the registered-ref union plus an open tail.
 *
 * Open on purpose, and for the reason every model list in this library is
 * open: a model that shipped after this snapshot must still be callable. The
 * union drives autocomplete; it does not gate the API, and an unrecognised id
 * is a `unknown_model` **warning** at runtime, never an error.
 *
 * `DistributiveOmit` rather than `Omit`, because `ImageParams` is a union (the
 * `aspectRatio` XOR `dimensions` arms) and plain `Omit` would collapse it into
 * a single object type with neither field required — quietly deleting the one
 * invariant the type exists to state.
 */
export type UnifiedInput<Canon, Ref extends string, A = never> = DistributiveOmit<
  Canon,
  "model" | "providerOptions"
> & {
  model: Ref | (string & {});
  providerOptions?: UnifiedProviderOptions<Ref, A>;
};

/**
 * The wire body one adapter compiles to.
 *
 * Read straight off the adapter's own `Wire` parameter — `CompiledCall<Wire,
 * Out>` already carries it, and the adapter declared it. `any` in the other
 * three slots for the same reason {@link AnyUnifiedAdapter} uses it: `compile`
 * is contravariant in its context and `validate` in its params, so a narrower
 * wildcard never matches.
 */
export type UnifiedWire<A> = A extends UnifiedAdapter<any, infer W, any, any>
  ? W
  : Readonly<Record<string, unknown>>;

/**
 * A deep partial that keeps an open arm at every level.
 *
 * Both escape hatches have to survive, because they are what the field is
 * *for*: an unknown KEY at any depth (a knob the provider shipped after this
 * snapshot, including a nested one — the shallow variant was measured and broke
 * exactly that case), and an unknown VALUE inside an already-closed union (a
 * new enum member on an existing key). The leaf arm is the same
 * `(string & {})` convention every generated union in this library carries:
 * the union drives autocomplete, it does not gate the API.
 */
type OpenBucket<T> = T extends readonly (infer E)[]
  ? ReadonlyArray<OpenBucket<E>> | Array<OpenBucket<E>>
  : T extends (...args: never[]) => unknown
    ? T
    : T extends object
      ? { readonly [K in keyof T]?: OpenBucket<T[K]> } & Readonly<Record<string, unknown>>
      : string extends T
        ? T
        : T extends string
          ? T | (string & {})
          : T;

/** The two-argument form: keys tied, values an open bag. */
type OpenUnifiedProviderOptions<Ref extends string> = {
  readonly [P in RefProvider<Ref>]?: Readonly<Record<string, unknown>>;
};

/** The three-argument form: keys tied, values the adapter's own wire body. */
type TypedUnifiedProviderOptions<Ref extends string, A> = {
  readonly [P in RefProvider<Ref>]?: OpenBucket<UnifiedWire<Extract<A, { provider: P }>>>;
};

/**
 * `providerOptions`, keyed by the providers this validator actually has and
 * valued by what each of them actually sends.
 *
 * Still open in the way that matters — one request literal may carry blocks
 * for **every** provider it might be pointed at, and only the ref'd one is
 * applied — but closed on the thing that is always a mistake: a key for a
 * provider that is not in this build. `{ opneai: … }` is a typo whose only
 * symptom would otherwise be an override that silently never happens, which is
 * the hardest kind of bug to see in a diff.
 *
 * **The values used to stay `Record<string, unknown>`**, on the grounds that
 * they are wire params and the unified surface has no opinion about them. That
 * reasoning does not survive contact with what the values actually are: the
 * bucket is merged into a body *this library compiled*, and then validated by
 * *this library's* validator for that provider — the adapter's declared `Wire`
 * is the unified surface's own artefact, not a foreign object it should decline
 * to look at. Merging happens before validation (`kernel.ts`), so a
 * type-contradicting value was already a runtime validator error; typing it
 * moves that error to the keystroke, which is the direction decisions.md §1
 * argues for. Nothing that compiled before stops compiling: {@link OpenBucket}
 * keeps every level open, and the two-argument form below degrades to the old
 * bag for any caller that has not threaded `A`.
 *
 * Completions are only as complete as the adapter's `Wire` interface. Where one
 * declares six fields plus an index signature for an endpoint that takes ten,
 * the list is *confidently incomplete* — an argument for tightening those Wire
 * interfaces, which is a separate pass, not for going back to a bag.
 */
export type UnifiedProviderOptions<Ref extends string, A = never> = [A] extends [never]
  ? OpenUnifiedProviderOptions<Ref>
  : TypedUnifiedProviderOptions<Ref, A>;

/** `Omit` that survives contact with a union. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * A category's validator: callable (throws) with a `.safe` (does not).
 *
 * Same two-form contract as every other validator in the library, and the same
 * reason: `safe` is for callers who have opted out of exceptions, and it must
 * never throw — including for the structural failures the throwing form
 * reports as `TranslationUnavailableError`.
 *
 * `ExactKeys` is what turns a typo'd key into a compile error. It is needed
 * *because* the params are generic: TypeScript's excess-property check does
 * not fire at an inference site, so without it `{ prompt, promt }` would infer
 * a `T` that satisfies the constraint and sail straight through to a provider
 * whose schema passes unknown keys along.
 */
export interface UnifiedValidator<Canon, A> extends SafeUnknown<UnifiedResult<A, string>> {
  <T extends UnifiedInput<Canon, UnifiedRef<A>, A>>(
    params: T & ExactKeys<T, UnifiedInput<Canon, UnifiedRef<A>, A>>,
    options?: ValidateOptions,
  ): UnifiedResult<A, T["model"] & string>;
  safe<T extends UnifiedInput<Canon, UnifiedRef<A>, A>>(
    params: T & ExactKeys<T, UnifiedInput<Canon, UnifiedRef<A>, A>>,
    options?: ValidateOptions,
  ): ValidateResult<UnifiedResult<A, T["model"] & string>>;
  /** Every provider id registered on this validator, sorted. */
  readonly providers: readonly string[];
}
