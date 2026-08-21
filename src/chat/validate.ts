/**
 * The `unmodel/chat` pipeline: validate the canonical shape, compile once, then
 * terminate in the concrete provider validator selected by the model ref.
 *
 * Canonical validation only decides whether the input can be compiled. The
 * provider's schema, catalog, constraints, capability checks and estimate stay
 * authoritative; their issue paths are translated back to the vocabulary the
 * caller wrote before being returned.
 *
 * ## Structural failures are not validation failures
 *
 * A ref naming cohere, azure or a typo'd provider is not a request with a bad
 * param — there is no request, because no body can be built at all. Those short
 * circuit before compilation with the messages `refs.ts` writes, and follow the
 * same contract `.toApi` established: the throwing form throws
 * `TranslationUnavailableError` (so the thrown type names the structural
 * cause), the `safe` form reports the identical message through `errors` with
 * `meta.structural`, because a caller who asked for `safe` opted out of
 * exceptions and this is precisely the kind they opted out of catching.
 *
 * Those issues are built **directly** rather than through the severity sink, so
 * an `options.severity` override cannot silence one and hand back an `ok: true`
 * result with no body in it.
 *
 * ## An unknown model is a warning, not an error
 *
 * models.dev is a committed snapshot; a model released after it must still be
 * callable. So an unrecognised id on a *recognised* provider warns
 * `unknown_model` and skips every model-dependent check — the same bargain
 * every provider validator in the library makes.
 */
import type { Issue } from "../core/issues";
import type { ValidateResult } from "../core/result";
import type { ValidateOptions } from "../core/options";
import { createIssueSink, partition, reportUnknownTopLevelKeys } from "../core/pipeline";
import { resolveEndpoint } from "../core/translate/endpoints";
import { TranslationUnavailableError } from "../core/translate/errors";
import { createWarningSink } from "../core/translate/warnings";
import { CHAT_ROUTE, compileChat, finalizeChat, type ChatCompileInput } from "./compile";
import { encodeChat } from "./encode";
import { chatMediaPaths, providerChatOptions } from "./media-paths";
import { classifyRef, parseModelRef, refProblemMessage } from "./refs";
import { chatParamsSchema } from "./schema";
import type { ChatParams, ChatProviderId } from "./types";
import { PROVIDER_OPTIONS_SUFFIX, unifiedPath } from "./wire-paths";

/** The endpoint label that appears in thrown errors and unknown-param messages. */
export const CHAT_ENDPOINT = "unmodel/chat";

/**
 * Validation options forwarded unchanged to the concrete provider validator.
 *
 * The former `catalog` override is intentionally absent. A replacement table
 * can disagree with the concrete provider validator's closed-over catalog,
 * which would recreate the two-authorities bug this pipeline removes. Import
 * the provider subpath (or its factory, where offered) when a custom catalog is
 * required.
 */
export type ChatOptions = ValidateOptions;

/**
 * What one run produced. `structural` is set when the ref itself is
 * unserviceable; the public `chat()` throws it verbatim so the thrown type
 * stays `TranslationUnavailableError`, while `chat.safe()` ignores it and
 * returns `result`, which carries the same message.
 */
export interface ChatOutcome {
  result: ValidateResult<object>;
  structural?: Error;
}

/** The provider-dependent end of the pipeline, supplied by `createChat()`. */
export interface ChatProviderRuntime {
  has(provider: ChatProviderId): boolean;
  validate(
    provider: ChatProviderId,
    modelId: string,
    body: object,
    options: ValidateOptions,
  ): ValidateResult<object>;
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

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

export function runChat(
  params: ChatParams,
  options: ChatOptions,
  providers: ChatProviderRuntime,
): ChatOutcome {
  const sink = createIssueSink(options);

  // --- Canonical shape ------------------------------------------------------
  const parsed = chatParamsSchema.safeParse(params);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      sink.report({
        code: "invalid_shape",
        path: issue.path.filter(
          (segment): segment is string | number =>
            typeof segment === "string" || typeof segment === "number",
        ),
        message: issue.message,
      });
    }
    return { result: { ok: false, ...partition(sink.issues) } };
  }
  reportUnknownTopLevelKeys(chatParamsSchema, params, {
    endpoint: CHAT_ENDPOINT,
    report: (issue) => sink.report(issue),
  });

  // --- Ref resolution -------------------------------------------------------
  const ref = parseModelRef(params.model);
  if (ref === undefined) {
    // A missing provider half is a *shape* problem, not a structural one: the
    // fix is in the string the caller typed, so it belongs with the other
    // layer-1 findings and must not throw `TranslationUnavailableError`.
    sink.report({
      code: "invalid_shape",
      path: ["model"],
      message: refProblemMessage({ kind: "no-slash", ref: params.model }),
    });
    return { result: { ok: false, ...partition(sink.issues) } };
  }

  const classification = classifyRef(ref.provider);
  if (classification.kind !== "supported") {
    const message = refProblemMessage(classification);
    const errors = [structuralIssue(params.model, ref.provider, message), ...sink.issues.filter((i) => i.severity === "error")];
    return {
      result: { ok: false, errors, warnings: sink.issues.filter((i) => i.severity === "warning") },
      structural: new TranslationUnavailableError(message),
    };
  }

  if (!providers.has(classification.provider)) {
    const message =
      `unmodel/chat: provider "${classification.provider}" is not registered in this chat pack. ` +
      `Add its validator to createChat({ ${classification.provider}: providerChat }).`;
    return {
      result: {
        ok: false,
        errors: [structuralIssue(params.model, ref.provider, message)],
        warnings: sink.issues.filter((issue) => issue.severity === "warning"),
      },
      structural: new TranslationUnavailableError(message),
    };
  }

  // `classifyRef` only returns `supported` for providers `ENDPOINTS` resolves,
  // so this cannot be undefined; the guard keeps the type honest.
  const endpoint = resolveEndpoint(ref.provider);
  if (endpoint === undefined) {
    const message = `unmodel: "${ref.provider}" has no entry in the endpoint table.`;
    return {
      result: { ok: false, errors: [structuralIssue(params.model, ref.provider, message)], warnings: [] },
      structural: new TranslationUnavailableError(message),
    };
  }

  // A canonical-space error means there is nothing worth compiling: the body
  // below would be built from params the caller has to fix first, and running
  // the provider validator over it produces a second round of findings about a
  // request nobody asked for. The sink stays open — the media step after
  // compilation reports into it too, and the final partition is taken there.
  const canonical = partition(sink.issues);
  if (canonical.errors.length > 0) return { result: { ok: false, ...canonical } };

  // --- Compile --------------------------------------------------------------
  // One sink for the whole translation, so `warnings` answers the single
  // question "what did compiling this request cost?" — encoder losses and
  // decoder losses are indistinguishable from where the caller stands.
  const translation = createWarningSink(CHAT_ROUTE, endpoint.id);
  const { ir, messageOrigin } = encodeChat(params, endpoint.dialect, translation.warn);
  const input: ChatCompileInput = {
    ir,
    provider: ref.provider,
    modelId: ref.modelId,
    endpoint,
    stream: params.stream === true,
  };

  let compiled;
  try {
    compiled = compileChat(input, translation.warn);
  } catch (error) {
    // `compileChat` throws only `TranslationUnavailableError`, and only for
    // states `classifyRef` should already have caught. Surfacing it through the
    // same structural channel keeps `safe()` exception-free.
    const message = error instanceof Error ? error.message : String(error);
    return {
      result: { ok: false, errors: [structuralIssue(params.model, ref.provider, message)], warnings: [] },
      structural: error instanceof Error ? error : new TranslationUnavailableError(message),
    };
  }

  // --- Provider substrate ---------------------------------------------------
  // This call is the definition of wire validity. It runs the exact same
  // schema, catalog, rules, media checks and estimate as `unmodel/<provider>`.
  const mediaPaths = chatMediaPaths(params, compiled.body, endpoint.dialect);
  // A declaration unmodel could not follow across compilation is reported into
  // the canonical sink, not silently forwarded — see `providerChatOptions`.
  const providerOptions = providerChatOptions(options, mediaPaths, (issue) => sink.report(issue));
  // Re-partitioned after the media step so a dropped declaration (or an
  // `options.severity` escalation of one) is carried, not lost behind the
  // snapshot taken before compilation.
  const compileIssues = partition(sink.issues);
  if (compileIssues.errors.length > 0) return { result: { ok: false, ...compileIssues } };

  const providerResult = providers.validate(
    classification.provider,
    ref.modelId,
    compiled.body,
    providerOptions,
  );
  // The compiled message container is the encoder's own unless the caller
  // replaced it through `providerOptions`; only then does `messageOrigin`
  // describe the body the provider validator actually inspected.
  // Indexed with the *classified* provider, not the raw ref half: since the
  // bucket keys closed to the providers the runtime honours, `ChatProviderOptions`
  // has no string index signature to fall through, and `classification.provider`
  // is the `ChatProviderId` this call was already narrowed to at line 141.
  const wireOrigin =
    params.providerOptions?.[classification.provider]?.["contents"] === undefined
      ? messageOrigin
      : undefined;
  const remap = (issue: Issue): Issue => {
    const canonicalMediaPath = mediaPaths.toCanonical(issue.path);
    const { path, unmapped } =
      canonicalMediaPath === undefined
        ? unifiedPath(endpoint.dialect, issue.path, wireOrigin)
        : { path: canonicalMediaPath, unmapped: false };
    const message =
      canonicalMediaPath === undefined
        ? issue.message
        : issue.message.replace(JSON.stringify(issue.path), JSON.stringify(path));
    // Translating the path and leaving the message alone is the worst of both:
    // the caller is told the problem is at `maxOutputTokens` in a sentence that
    // only ever says `max_completion_tokens`, which is the very thing
    // `wire-paths.ts` exists to prevent — sending them after a param that does
    // not exist in the vocabulary they used. So a *renamed* path names the wire
    // spelling it was compiled from, the same way the media kernel does. A path
    // compiled to its own name has nothing to explain and gains nothing.
    const renamed = !unmapped && path.join(".") !== issue.path.join(".");
    return {
      ...issue,
      path: [...path],
      message: unmapped
        ? message.endsWith(PROVIDER_OPTIONS_SUFFIX)
          ? message
          : `${message}${PROVIDER_OPTIONS_SUFFIX}`
        : renamed && canonicalMediaPath === undefined
          ? `${message} (compiled from \`${issue.path.join(".")}\`)`
          : message,
    };
  };

  const providerWarnings = providerResult.warnings.map(remap);
  if (!providerResult.ok) {
    return {
      result: {
        ok: false,
        errors: providerResult.errors.map(remap),
        warnings: [...compileIssues.warnings, ...providerWarnings],
      },
    };
  }

  return {
    result: {
      ok: true,
      params: finalizeChat(input, providerResult.params, translation.warnings),
      warnings: [...compileIssues.warnings, ...providerWarnings],
      estimate: providerResult.estimate,
    },
  };
}

function unknownFailureMessage(error: unknown): string {
  try {
    if (error instanceof Error && typeof error.message === "string" && error.message !== "") {
      return error.message;
    }
  } catch {
    // A proxy can throw from `getPrototypeOf` or from its `message` getter.
  }
  try {
    return String(error);
  } catch {
    return "an unknown inspection error";
  }
}

/**
 * Total boundary for JSON/queue values. Zod reports ordinary malformed values,
 * while this guard catches hostile objects whose property/proxy traps throw
 * before a schema can return a result.
 */
export function runChatUnknown(
  params: unknown,
  options: ChatOptions,
  providers: ChatProviderRuntime,
): ChatOutcome {
  try {
    return runChat(params as ChatParams, options, providers);
  } catch (error) {
    const issue: Issue = {
      severity: "error",
      code: "invalid_shape",
      path: [],
      message: `unmodel/chat: the untyped input could not be inspected safely: ${unknownFailureMessage(error)}.`,
    };
    return { result: { ok: false, errors: [issue], warnings: [] } };
  }
}
