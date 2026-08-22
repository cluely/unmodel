/**
 * `createUnified` — the runtime that turns a set of adapters into one
 * validator.
 *
 * The design, the step-by-step table and the reasoning behind each decision
 * are in `./types.ts`, deliberately: that file is types only, so its prose
 * costs nothing in the six media bundles this one is measured in. What is left
 * here are the comments that explain a *line*, which is what a comment in a
 * runtime module is for.
 */
import type { Issue } from "../issues";
import { UnmodelValidationError } from "../issues";
import type { ValidateOptions } from "../options";
// `../issue-sink`, not `../pipeline`: the same severity rules, without the
// four-layer engine (and the zod, tokenizer and catalog types behind it) that
// this pipeline delegates rather than runs.
import { createIssueSink, partition, type IssueSink } from "../issue-sink";
import type { ValidateResult } from "../result";
import { TranslationUnavailableError } from "../translate/errors";
import { attachWarnings, createWarningSink } from "../translate/warnings";
import type {
  AnyUnifiedAdapter,
  CompileContext,
  CompileIssue,
  Derived,
  UnifiedCategory,
  UnifiedValidator,
} from "./types";
import { CANONICAL_KEY_LISTS } from "./canonical-keys";

/** The suffix an unmapped wire param's message gains when the caller put it there. */
export const PROVIDER_OPTIONS_SUFFIX = " (supplied via `providerOptions`)";

/**
 * `"imageEdit"` → `"image-edit"`. The category id is camelCase because it is a
 * TypeScript union member; the entry point, the subpath and the label in a
 * thrown error are kebab because that is what a package export looks like.
 */
export function endpointLabel(category: UnifiedCategory): string {
  return `unmodel/${category.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** What one run produced. `structural` mirrors `runChat`'s outcome shape. */
export interface UnifiedOutcome {
  result: ValidateResult<object>;
  structural?: Error;
}

/** A structural issue, built outside the sink so no override can silence it. */
function structuralIssue(model: string, provider: string, message: string): Issue {
  return {
    severity: "error",
    code: "unsupported_capability",
    path: ["model"],
    model,
    message,
    meta: { provider, structural: true },
  };
}

// ---------------------------------------------------------------------------
// providerOptions
// ---------------------------------------------------------------------------

/** Keys that must never be written through, whatever a caller passes. */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);


/** The keys `validateCanonicalEnvelope` accepts, per category. */
const CANONICAL_KEYS: Readonly<Record<UnifiedCategory, ReadonlySet<string>>> = Object.freeze({
  image: new Set<string>(CANONICAL_KEY_LISTS.image),
  imageEdit: new Set<string>(CANONICAL_KEY_LISTS.imageEdit),
  video: new Set<string>(CANONICAL_KEY_LISTS.video),
  tts: new Set<string>(CANONICAL_KEY_LISTS.tts),
  stt: new Set<string>(CANONICAL_KEY_LISTS.stt),
  music: new Set<string>(CANONICAL_KEY_LISTS.music),
});

/**
 * One category's declared vocabulary, as a literal union. Pinned by a test.
 *
 * Re-exported here rather than only from `./values` because this is where the
 * kernel's callers already look for it.
 */
export type CanonicalKeyOf<C extends UnifiedCategory> = (typeof CANONICAL_KEY_LISTS)[C][number];

export { CANONICAL_KEY_LISTS };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Runtime backstop for the canonical vocabulary and its provider escape hatch. */
function validateCanonicalEnvelope(
  category: UnifiedCategory,
  adapter: AnyUnifiedAdapter<never>,
  params: Record<string, unknown>,
  provider: string,
  registered: ReadonlyMap<string, AnyUnifiedAdapter<never>>,
  sink: IssueSink,
): void {
  const known = new Set(CANONICAL_KEYS[category]);
  const modelParams = (adapter as unknown as { modelParams?: unknown }).modelParams;
  if (isPlainObject(modelParams)) {
    for (const row of Object.values(modelParams)) {
      if (!isPlainObject(row) || !isPlainObject(row["extras"])) continue;
      for (const key of Object.keys(row["extras"])) known.add(key);
    }
  }

  for (const key of Object.keys(params)) {
    if (known.has(key)) continue;
    sink.report({
      code: "unsupported_param",
      path: [key],
      message:
        `\`${key}\` is not part of the ${endpointLabel(category)} canonical vocabulary; ` +
        "compiling it would silently drop the value.",
    });
  }

  if (!Object.hasOwn(params, "providerOptions") || params["providerOptions"] === undefined) return;
  const all = params["providerOptions"];
  if (!isPlainObject(all)) {
    sink.report({
      code: "invalid_shape",
      path: ["providerOptions"],
      message: "`providerOptions` must be an object keyed by provider id.",
    });
    return;
  }
  for (const [id, block] of Object.entries(all)) {
    if (!registered.has(id)) {
      sink.report({
        code: "unknown_param",
        path: ["providerOptions", id],
        message:
          `\`providerOptions.${id}\` does not name a provider registered on ${endpointLabel(category)}. ` +
          `Its block was not applied. Registered providers: ${[...registered.keys()].sort().join(", ")}.`,
      });
      continue;
    }
    if (isPlainObject(block)) continue;
    sink.report({
      code: "invalid_shape",
      path: ["providerOptions", id],
      message: `\`providerOptions.${id}\` must be an object of wire parameters${
        id === provider ? " for the selected provider" : ""
      }.`,
    });
  }
}

/**
 * Merges `override` over `base`: plain objects merge key-by-key, everything
 * else replaces.
 *
 * Arrays replace rather than concatenate, which is the only defensible rule —
 * an override that appended to a compiled array would make
 * `{ image_ref: [...] }` mean "add to whatever the compiler produced", and the
 * caller cannot know what that was.
 *
 * An explicit `undefined` **deletes** the key. That is the escape hatch's
 * escape hatch: it is the only way to unset something the adapter emitted, and
 * leaving an enumerable `undefined` on the body instead would put a key on the
 * wire that the provider's schema has an opinion about.
 */
export function deepMerge<T extends object>(base: T, override: Readonly<Record<string, unknown>>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (value === undefined) {
      delete out[key];
      continue;
    }
    const existing = out[key];
    out[key] = isPlainObject(existing) && isPlainObject(value) ? deepMerge(existing, value) : value;
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/**
 * Runs one unified request. Exported for the category entries, which wrap it
 * in the throwing / `safe` pair, and for the tests.
 */
export function runUnified(
  category: UnifiedCategory,
  byProvider: ReadonlyMap<string, AnyUnifiedAdapter<never>>,
  params: unknown,
  options: ValidateOptions = {},
): UnifiedOutcome {
  try {
    return runUnifiedUnchecked(category, byProvider, params, options);
  } catch (error) {
    // `safeUnknown` accepts values from outside the type system, where even
    // inspection can execute user code (getters and Proxy traps). Keep the
    // safe contract at the outermost boundary so no property read, key walk,
    // provider validator, or result decoration can leak an exception.
    const sink = createIssueSink(options);
    sink.report({
      code: "invalid_shape",
      path: [],
      message:
        `unmodel could not safely inspect these params for ${endpointLabel(category)} ` +
        `(${describeValue(error)}) — this is likely a malformed request; if the request is valid, ` +
        "please file a bug.",
    });
    return { result: { ok: false, ...partition(sink.issues) } };
  }
}

/** The pipeline body, guarded by {@link runUnified}'s total safe boundary. */
function runUnifiedUnchecked(
  category: UnifiedCategory,
  byProvider: ReadonlyMap<string, AnyUnifiedAdapter<never>>,
  params: unknown,
  options: ValidateOptions,
): UnifiedOutcome {
  const sink = createIssueSink(options);
  const label = endpointLabel(category);

  if (!isPlainObject(params)) {
    sink.report({
      code: "invalid_shape",
      path: [],
      message: `Expected an object for ${label}; got ${describeValue(params)}.`,
    });
    return { result: { ok: false, ...partition(sink.issues) } };
  }

  // --- Ref ------------------------------------------------------------------
  const model = params["model"];
  if (typeof model !== "string" || model.length === 0) {
    sink.report({
      code: "invalid_shape",
      path: ["model"],
      message: `\`model\` must be a "provider/model" string for ${label}; got ${describeValue(model)}.`,
    });
    return { result: { ok: false, ...partition(sink.issues) } };
  }
  // First slash, never last: refs like "openrouter/anthropic/claude-opus-5"
  // name provider `openrouter` and a model id that contains a slash.
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) {
    sink.report({
      code: "invalid_shape",
      path: ["model"],
      message:
        `\`model\` must be "provider/model" for ${label}; got ${JSON.stringify(model)}. ` +
        `Registered providers: ${[...byProvider.keys()].sort().join(", ")}.`,
    });
    return { result: { ok: false, ...partition(sink.issues) } };
  }
  const provider = model.slice(0, slash);
  const modelId = model.slice(slash + 1);

  const adapter = byProvider.get(provider);
  if (adapter === undefined) {
    const message =
      `unmodel: "${provider}" is not a ${category} provider in this build. ` +
      `Registered: ${[...byProvider.keys()].sort().join(", ")}.`;
    return {
      result: { ok: false, errors: [structuralIssue(model, provider, message)], warnings: [] },
      structural: new TranslationUnavailableError(message),
    };
  }

  validateCanonicalEnvelope(category, adapter, params, provider, byProvider, sink);
  const envelope = partition(sink.issues);
  if (envelope.errors.length > 0) return { result: { ok: false, ...envelope } };

  // --- Catalog: an unknown model warns, exactly as everywhere else ----------
  if (!adapter.models.includes(modelId)) {
    sink.report({
      code: "unknown_model",
      path: ["model"],
      model,
      message:
        `Model "${modelId}" is not one ${provider} declares for ${category}; ` +
        `model-dependent checks were skipped. If this model is new, this list may lag behind.`,
      meta: { provider, models: [...adapter.models] },
    });
  }

  // --- Declared gaps, before compile ---------------------------------------
  for (const [field, reason] of Object.entries(adapter.unsupported ?? {})) {
    if (params[field] == null) continue;
    sink.report({
      code: "unsupported_param",
      path: [field],
      model,
      message: `\`${field}\` is not supported by "${model}": ${reason}`,
      meta: { provider },
    });
  }

  // --- Compile --------------------------------------------------------------
  const translation = createWarningSink(`unified.${category}`, `${provider}.${category}`);
  /** Joined wire path → the canonical field it was compiled from. */
  const provenance = new Map<string, string>();

  // `any`, not `never`: the kernel builds ONE context and hands it to whichever
  // adapter the ref selected, whose vocabularies differ (and are narrowed per
  // route). `CompileContext` is contravariant in that vocabulary, so `never`
  // stopped satisfying the adapters once `CanonicalField` closed. The
  // per-adapter check is still exact — each adapter's own `compile` signature
  // types its `ctx`, and `AnyUnifiedAdapter`'s `Ctx = any` is confined to the
  // constraint, mirroring the `Wire`/`Out` decision six lines above it.
  const ctx: CompileContext<any> = {
    model: modelId,
    warn: translation.warn,
    fail: (issue) => sink.report({ ...issue, model }),
    from: (wirePath, canonical) => {
      provenance.set(wirePath.join("."), canonical);
    },
    take: <T>(derived: Derived<T>): T | undefined => {
      for (const issue of derived.issues) ctx.fail(issue);
      return derived.value;
    },
  };

  let call;
  try {
    call = adapter.compile(params as never, ctx);
  } catch (error) {
    // A `TranslationUnavailableError` is an adapter saying "not in this build",
    // which is the structural channel. Anything else is a crash on malformed
    // input, and `safe()` must not propagate it — the whole point of the form.
    if (TranslationUnavailableError.isInstance(error)) {
      return {
        result: {
          ok: false,
          errors: [structuralIssue(model, provider, error.message)],
          warnings: [],
        },
        structural: error,
      };
    }
    sink.report({
      code: "invalid_shape",
      model,
      message:
        `unmodel could not compile these params for ${model} (${String(error)}) — this is likely a ` +
        `malformed request; if the request is valid, please file a bug.`,
    });
    return { result: { ok: false, ...partition(sink.issues) } };
  }

  // A canonical-space error means the body below was compiled from params that
  // could not be compiled; validating it would produce a second, confusing
  // round of findings about a request nobody asked for.
  const compiled = partition(sink.issues);
  if (compiled.errors.length > 0) return { result: { ok: false, ...compiled } };

  // --- providerOptions, merged BEFORE validation ---------------------------
  const overrides = readProviderOptions(params, provider);
  const merged = overrides === undefined ? call.params : deepMerge(call.params, overrides);
  const overridden = new Set(overrides === undefined ? [] : Object.keys(overrides));

  // --- The provider's own validator ----------------------------------------
  const result = call.validate(merged, options);
  const remap = (issue: Issue): void => {
    // A wire key the caller supplied through `providerOptions` is theirs, not
    // the adapter's — whatever provenance the adapter declared for it describes
    // a value that this request does not contain. Remapping it would report a
    // canonical field the caller may never have written, and blame the compiler
    // for a value they typed by hand, so the escape hatch wins over the
    // declaration and the wire spelling is left exactly as they wrote it.
    const supplied = typeof issue.path[0] === "string" && overridden.has(issue.path[0]);
    const { path, unmapped } = supplied
      ? { path: [...issue.path], unmapped: true }
      : canonicalPath(provenance, issue.path);
    const viaOptions = unmapped && supplied;
    // A param that was compiled *to its own name* — which is every extra, by
    // definition: they are wire-verbatim and their provenance maps a key to
    // itself — has nothing to explain. Appending "(compiled from `background`)"
    // to a message already about `background` is noise that reads like a bug.
    const renamed = !unmapped && path.join(".") !== issue.path.join(".");
    sink.report({
      code: issue.code,
      path,
      message: unmapped
        ? viaOptions
          ? `${issue.message}${PROVIDER_OPTIONS_SUFFIX}`
          : issue.message
        : renamed
          ? `${issue.message} (compiled from \`${issue.path.join(".")}\`)`
          : issue.message,
      ...(issue.model !== undefined && { model: issue.model }),
      ...(issue.meta !== undefined && { meta: issue.meta }),
      // Preserve a deny rule's downgrade to a warning; the caller's own
      // `options.severity` still wins over it inside the sink.
      severity: issue.severity,
    });
  };

  if (!result.ok) {
    for (const issue of result.errors) remap(issue);
    for (const issue of result.warnings) remap(issue);
    return { result: { ok: false, ...partition(sink.issues) } };
  }
  for (const issue of result.warnings) remap(issue);

  const { errors, warnings } = partition(sink.issues);
  if (errors.length > 0) return { result: { ok: false, errors, warnings } };
  return {
    result: {
      ok: true,
      // `result.params` IS the provider's `Validated`. The warnings ride on it
      // non-enumerably and frozen, exactly like a retargeted result's — so
      // `JSON.stringify(result)` is still precisely the fetch body.
      params: attachWarnings(result.params, translation.warnings),
      warnings,
      estimate: result.estimate,
    },
  };
}

/** `providerOptions[provider]`, when it is a usable object. */
function readProviderOptions(
  params: Record<string, unknown>,
  provider: string,
): Record<string, unknown> | undefined {
  const all = params["providerOptions"];
  if (!isPlainObject(all)) return undefined;
  if (!Object.hasOwn(all, provider)) return undefined;
  const own = all[provider];
  return isPlainObject(own) ? own : undefined;
}

function describeValue(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    if (value instanceof Error) return `${value.name}: ${value.message}`;
  } catch {
    // A Proxy may trap even the prototype read behind `instanceof`; fall
    // through to the two formatter attempts below.
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "<uninspectable value>";
    }
  }
}

/**
 * Wire path → canonical path, using what the adapter declared.
 *
 * Longest match first, then the head segment — so a rule that pointed *inside*
 * a compiled param (`["parameters", "aspectRatio"]`) keeps its position when
 * only the head was declared.
 */
export function canonicalPath(
  provenance: ReadonlyMap<string, string>,
  path: ReadonlyArray<string | number>,
): { path: Array<string | number>; unmapped: boolean } {
  if (path.length === 0) return { path: [...path], unmapped: false };
  const joined = path.join(".");
  const whole = provenance.get(joined);
  if (whole !== undefined) return { path: [whole], unmapped: false };
  const head = path[0];
  if (typeof head === "string") {
    const mapped = provenance.get(head);
    if (mapped !== undefined) return { path: [mapped, ...path.slice(1)], unmapped: false };
  }
  return { path: [...path], unmapped: true };
}

// ---------------------------------------------------------------------------
// The public factory
// ---------------------------------------------------------------------------

/**
 * Builds a category validator from a set of adapters.
 *
 * The adapters passed decide three things at once: which providers work at
 * runtime, which refs autocomplete (`UnifiedRef` over their `as const` model
 * arrays), and what the return type is (each provider's own `Validated`). Pass
 * one adapter and the bundle contains one provider; pass the ready-made full
 * pack and it contains all of them. That is the whole reason this is a factory
 * and not a fixed function.
 */
export function createUnified<Canon, A extends AnyUnifiedAdapter<Canon>>(
  category: UnifiedCategory,
  adapters: readonly A[],
): UnifiedValidator<Canon, A> {
  const byProvider = new Map<string, AnyUnifiedAdapter<never>>();
  for (const adapter of adapters) {
    if (adapter.category !== category) {
      throw new TypeError(
        `unmodel: adapter "${adapter.provider}" declares category "${adapter.category}", ` +
          `but was registered on the "${category}" surface.`,
      );
    }
    if (byProvider.has(adapter.provider)) {
      throw new TypeError(
        `unmodel: two ${category} adapters both claim the provider id "${adapter.provider}"; ` +
          `a ref can only resolve to one.`,
      );
    }
    byProvider.set(adapter.provider, adapter as unknown as AnyUnifiedAdapter<never>);
  }
  const label = endpointLabel(category);

  function safe(params: Record<string, unknown>, options?: ValidateOptions): ValidateResult<object> {
    return runUnified(category, byProvider, params, options).result;
  }

  function safeUnknown(params: unknown, options?: ValidateOptions): ValidateResult<object> {
    return runUnified(category, byProvider, params, options).result;
  }

  function validator(params: Record<string, unknown>, options?: ValidateOptions): object {
    const { result, structural } = runUnified(category, byProvider, params, options);
    // Structural first, so the thrown type stays `TranslationUnavailableError`
    // rather than collapsing into a validation error naming no fixable param.
    if (structural !== undefined) throw structural;
    if (!result.ok) throw new UnmodelValidationError(label, result.errors, result.warnings);
    return result.params;
  }

  validator.safe = safe;
  validator.safeUnknown = safeUnknown;
  Object.defineProperty(validator, "providers", {
    value: Object.freeze([...byProvider.keys()].sort()),
    enumerable: true,
  });
  return validator as unknown as UnifiedValidator<Canon, A>;
}

export type { CompileIssue };
