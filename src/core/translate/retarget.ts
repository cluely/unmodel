/**
 * The generic `.toApi(provider)` engine.
 *
 * Dialect-agnostic and data-driven: it knows about availability tables, the
 * endpoint table and the warning contract, and nothing about any specific
 * provider. That is what lets it live in `src/core/` at all — core never
 * imports `src/providers/**` (import-graph rule 1), so every provider-shaped
 * fact (the target's zod schema, its constraint tables, its SDK formatters,
 * the dialect codecs) arrives through the spec.
 *
 * Two paths, and the split is the whole performance story. Measured over the
 * generated availability data, **92.2% of directed edges never change dialect**
 * (4602/5088 are openai-chat → openai-chat, 74 more gemini → gemini; the
 * identity edge every row now carries is same-dialect by construction). Those
 * take the same-dialect path: respell the model id, swap the URL and headers,
 * re-validate. They never touch the IR, so they carry no round-trip risk at
 * all. Only the remaining ~8% pay for an encode/decode pair.
 */
import type { ZodType } from "zod";
import type { Issue, IssueSeverity } from "../issues";
import type { EndpointConstraints, FamilyRule } from "../constraint-types";
import type { ValidateResult } from "../result";
import type { ApiRetargetOutcome, ApiRetargeter, RequestMeta, SdkFormatters } from "../request";
import { toValidated } from "../request";
import type { AvailabilityMap, AvailabilityTarget } from "./availability-types";
import { lookupAvailability } from "./availability-types";
import type { DecodeContext } from "./ir";
import type { DialectId, TargetEndpoint } from "./endpoints";
import { endpointUrl, isFactoryEndpoint, resolveEndpoint } from "./endpoints";
import { TranslationUnavailableError } from "./errors";
import { geminiSdkParams } from "./sdk-shapes";
import type { TranslationWarning, Warn } from "./warnings";
import { attachWarnings, createWarningSink } from "./warnings";

export { TranslationUnavailableError } from "./errors";

/**
 * Target-side re-validation inputs. Per design-types §4.4 this is the schema
 * layer + the constraint layer, and deliberately **not** the catalog layers:
 * `over_context` / `unknown_model` / capability checks would need the target's
 * full generated catalog (349 models for openrouter), which is exactly the
 * import that would sink the per-subpath bundle. The documented escape hatch
 * for full catalog-aware validation is to compose —
 * `openrouterChat(claude.toApi("openrouter"))`.
 */
export interface TargetValidation {
  /** The target dialect's loose wire schema (validation layer 1). */
  schema?: ZodType;
  /** The target provider's constraint tables for this endpoint (layer 3). */
  constraints?: readonly EndpointConstraints[];
}

/**
 * A dialect decoder: IR → the target dialect's wire body. Supplied by codecs.
 *
 * `ctx` is what tells the decoder which model id to write, which provider it
 * is writing for (a few mappings are target-conditional) and what the
 * generated availability data says the target narrows. It is optional so a
 * codec can be driven directly by the golden-fixture suite, but `createToApi`
 * always passes it.
 */
export type Decoder<IR> = (ir: IR, warn: Warn, ctx?: DecodeContext) => object;

/** A dialect encoder: this endpoint's wire body → IR. Supplied by codecs. */
export type Encoder<Body, IR> = (body: Body, warn: Warn) => IR;

export interface RetargetSpec<Body extends object, IR = unknown> {
  /** The dialect this endpoint's body is written in. */
  from: DialectId;
  /** Source endpoint id, e.g. `"anthropic.chat"`. */
  endpoint: string;
  /** Reads the source model id off the body (or out of the closure). */
  modelId: (body: Body) => string | undefined;
  /** The generated per-provider availability table. */
  availability: AvailabilityMap;
  /**
   * Writes the target's spelling of the model id into a same-dialect copy of
   * the body. Defaults to `{ ...body, model }`, which is correct for every
   * dialect that carries `model` on the wire; endpoints that strip the model
   * into the URL (google.chat) must supply their own.
   */
  withModelId?: (body: Body, targetModelId: string) => object;
  /** IR encoder. Required for cross-dialect retargets; omit for fleet-only endpoints. */
  encode?: Encoder<Body, IR>;
  /**
   * Decoders for the dialects THIS endpoint declares, as a plain object
   * literal at the call site so a bundler sees exactly which codecs it needs.
   */
  decoders?: Readonly<Partial<Record<DialectId, Decoder<IR>>>>;
  /** Target-side re-validation inputs, per resolved endpoint. */
  targetValidation?: (endpoint: TargetEndpoint) => TargetValidation | undefined;
  /** SDK formatters to hang on the retargeted result. */
  sdkFor?: (endpoint: TargetEndpoint, body: object, targetModelId: string) => SdkFormatters;
}

/**
 * Default SDK formatters for a retargeted result.
 *
 * `openai-chat` and `anthropic-messages` get an identity formatter because
 * those SDKs' param objects *are* the wire body. Gemini needs real shaping
 * (`{ model, contents, config }`), which `geminiSdkParams` supplies — the same
 * function `google.chat`'s own `toSdk("google")` uses, so the two
 * cannot drift.
 *
 * `bedrock-converse` still gets none, and deliberately: a `toSdk` target that
 * exists but produces the wrong shape is worse than one that does not exist.
 * The empty arm is unreachable today (no endpoint declares a converse decoder)
 * but is what the message below is for when one does.
 */
function defaultSdkFor(
  endpoint: TargetEndpoint,
  body: object,
  targetModelId: string,
): SdkFormatters {
  switch (endpoint.dialect) {
    case "openai-chat":
      return { openai: () => body };
    case "anthropic-messages":
      return { anthropic: () => body };
    case "gemini":
      return { google: () => geminiSdkParams(targetModelId, body) };
    default:
      return {};
  }
}

const DEFAULT_SEVERITY = { deny: "error", enums: "error", schema: "error" } as const;

/** Runs validation layer 1 (shape) against the target dialect's schema. */
function checkSchema(schema: ZodType | undefined, body: object, out: Issue[]): void {
  if (schema === undefined) return;
  const parsed = schema.safeParse(body);
  if (parsed.success) return;
  for (const issue of parsed.error.issues) {
    out.push({
      severity: DEFAULT_SEVERITY.schema,
      code: "invalid_shape",
      path: issue.path.filter(
        (segment): segment is string | number =>
          typeof segment === "string" || typeof segment === "number",
      ),
      message: issue.message,
    });
  }
}

/**
 * Runs validation layer 3 (the target's hand-written deny/enum tables). This
 * is the layer that catches the case the whole feature exists for: retarget an
 * `openai.chat` body carrying `logprobs` to groq and you get a named error
 * citing groq's compatibility doc, instead of a 400 from the wire.
 */
function checkConstraints(
  constraints: readonly EndpointConstraints[] | undefined,
  body: object,
  modelId: string,
  out: Issue[],
): void {
  if (constraints === undefined) return;
  const record = body as Record<string, unknown>;
  for (const table of constraints) {
    // A `FamilyRule` narrows its table to the models it matches. Duck-typed
    // rather than discriminated because `TargetValidation.constraints` is
    // declared as the base `EndpointConstraints[]`, which `FamilyRule[]`
    // widens into — and applying a family's denies to every model would
    // reject requests the target accepts, which is worse than not checking.
    const match = (table as Partial<FamilyRule>).match;
    if (typeof match === "function" && !match(modelId)) continue;
    for (const [param, rule] of Object.entries(table.deny ?? {})) {
      // Explicit `null` means "provider default" on these APIs, so it is unset.
      if (record[param] == null) continue;
      const ignored = rule.ignored === true;
      out.push({
        severity: (ignored ? "warning" : DEFAULT_SEVERITY.deny) as IssueSeverity,
        code: "unsupported_param",
        path: [param],
        model: modelId,
        message: ignored
          ? `\`${param}\` is silently ignored by the API for "${modelId}": ${rule.reason}`
          : `\`${param}\` is not supported by "${modelId}": ${rule.reason}`,
        meta: { source: rule.source, ...(ignored && { ignored: true }) },
      });
    }
    for (const [param, allowed] of Object.entries(table.enums ?? {})) {
      const value = record[param];
      if (value == null || allowed.includes(value as string | number)) continue;
      out.push({
        severity: DEFAULT_SEVERITY.enums,
        code: "invalid_enum_value",
        path: [param],
        model: modelId,
        message: `\`${param}\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")} for "${modelId}"; got ${JSON.stringify(value)}.`,
        meta: { allowed: [...allowed], value },
      });
    }
  }
}

/** Turns the generated `narrows` metadata into warnings, no target catalog needed. */
function pushNarrowingWarnings(
  entry: AvailabilityTarget,
  target: string,
  push: (warning: Omit<TranslationWarning, "from" | "to">) => void,
): void {
  const narrows = entry.narrows;
  if (narrows === undefined) return;
  if (narrows.context !== undefined) {
    push({
      code: "capability_narrowed",
      path: ["model"],
      message: `${target} serves "${entry.id}" with a ${narrows.context}-token context window, which is smaller than the source model's; a request that fits on the source may not fit here.`,
      meta: { context: narrows.context },
    });
  }
  if (narrows.drops !== undefined && narrows.drops.length > 0) {
    push({
      code: "capability_narrowed",
      path: ["model"],
      message: `${target} serves "${entry.id}" without ${narrows.drops.join(", ")} input; content of those kinds will be rejected.`,
      meta: { drops: [...narrows.drops] },
    });
  }
}

/**
 * A retarget that is impossible in this *build* rather than invalid for this
 * *request*.
 *
 * Both halves of the outcome are filled in, and that is the whole point:
 * `.toApi` throws `structural` verbatim (so the thrown type keeps naming the
 * structural cause), while `.toApiSafe` reports the identical message through
 * `result.errors` instead of throwing. A `safe()` caller has explicitly opted
 * out of exceptions, and these failures are reachable from typed, compiling
 * code — the generated availability union promises the edge — so making them
 * the one case `safe()` still throws on would defeat the form entirely.
 */
function structuralFailure(
  route: string,
  target: string,
  modelId: string | undefined,
  message: string,
): ApiRetargetOutcome {
  return {
    route,
    result: {
      ok: false,
      errors: [
        {
          severity: "error",
          code: "unsupported_capability",
          path: ["model"],
          ...(modelId !== undefined && { model: modelId }),
          message,
          meta: { target, structural: true },
        },
      ],
      warnings: [],
    },
    structural: new TranslationUnavailableError(message),
  };
}

function unavailableIssue(
  modelId: string | undefined,
  target: string,
  known: readonly string[] | undefined,
): Issue {
  const available =
    known === undefined
      ? "unknown model — catalog data may lag behind"
      : known.length === 0
        ? "no other provider in the catalog serves it"
        : known.join(", ");
  return {
    severity: "error",
    code: "unsupported_capability",
    path: ["model"],
    ...(modelId !== undefined && { model: modelId }),
    message: `"${modelId ?? "(no model)"}" is not served by ${target} according to the models.dev catalog. Available: ${available}.`,
    meta: { target, ...(known !== undefined && { available: [...known] }) },
  };
}

/**
 * Builds the `init.api` retargeter for one validated body. The returned
 * function is what `toValidated` turns into `.toApi` (throws) and
 * `.toApiSafe` (returns a `ValidateResult`).
 */
export function createToApi<Body extends object, IR = unknown>(
  spec: RetargetSpec<Body, IR>,
): (body: Body) => ApiRetargeter {
  /**
   * The provider this endpoint belongs to, read off its id
   * (`"anthropic.chat"` → `"anthropic"`). Provider ids never contain a
   * dot; endpoint ids always do.
   */
  const homeProvider = spec.endpoint.slice(0, spec.endpoint.indexOf("."));

  return (body) => (target) => {
    const modelId = spec.modelId(body);
    const sourceEntry =
      modelId !== undefined && Object.hasOwn(spec.availability, modelId)
        ? spec.availability[modelId]
        : undefined;
    const entry =
      modelId === undefined ? undefined : lookupAvailability(spec.availability, modelId, target);

    // The availability table names the provider; the endpoint table says what
    // wire surface that provider serves this model on.
    const endpoint = resolveEndpoint(target, entry?.endpoint);
    if (endpoint === undefined) {
      return structuralFailure(
        `${spec.endpoint} → ${target}`,
        target,
        modelId,
        `unmodel: "${target}" is not a known \`.toApi\` target. Targets are models.dev provider ids (e.g. "openrouter", "groq", "vercel").`,
      );
    }

    const route = `${spec.endpoint} → ${endpoint.id}`;

    if (isFactoryEndpoint(endpoint)) {
      return structuralFailure(
        route,
        target,
        modelId,
        `unmodel: ${route} is not available through one-argument \`.toApi("${target}")\` — ${target} has no provider-wide URL; it needs ${(endpoint.config ?? []).join(" + ")} that this call never supplied. Use ${target}'s own factory instead.`,
      );
    }

    /**
     * **Home is always a valid target, by definition.** An endpoint's own
     * provider serves the model the caller just validated against it, whatever
     * the generated catalog does or does not know — so a model released after
     * the committed models.dev snapshot still retargets home, as the identity
     * hop, instead of being told its home provider does not serve it.
     *
     * Scoped to models with no row in the table at all: codegen emits an
     * identity entry for every in-scope row, so a row that *is* present and
     * still omits its home provider means a hand-written or stale table, and
     * the normal availability error is the honest answer there.
     */
    const resolved: AvailabilityTarget | undefined =
      entry ??
      (sourceEntry === undefined && modelId !== undefined && endpoint.provider === homeProvider
        ? { id: modelId }
        : undefined);

    if (resolved === undefined) {
      const known = sourceEntry === undefined ? undefined : Object.keys(sourceEntry);
      return {
        route,
        result: { ok: false, errors: [unavailableIssue(modelId, target, known)], warnings: [] },
      };
    }

    const sink = createWarningSink(spec.endpoint, endpoint.id);
    // Only an actual respelling is worth auditing. The identity retarget and
    // the (rarer) cross-provider hop where both providers happen to spell the
    // model the same way change nothing about `model`, so a warning there
    // would be noise in a list whose whole contract is "everything here is
    // something the translation cost you".
    if (resolved.id !== modelId) {
      sink.push({
        code: "id_respelled",
        path: ["model"],
        message: `"${modelId}" is spelled "${resolved.id}" on ${target}; the retargeted body carries the target's id.`,
        meta: { from: modelId, to: resolved.id },
      });
    }

    let out: object;
    if (endpoint.dialect === spec.from) {
      // The 92.2% path: no IR, no codec, no round-trip risk.
      out =
        spec.withModelId !== undefined
          ? spec.withModelId(body, resolved.id)
          : { ...body, model: resolved.id };
    } else {
      const decode = spec.decoders?.[endpoint.dialect];
      if (spec.encode === undefined || decode === undefined) {
        return structuralFailure(
          route,
          target,
          modelId,
          `unmodel: ${route} crosses wire dialects (${spec.from} → ${endpoint.dialect}) and this build ships no codec for that pair. Same-dialect targets still work; call ${endpoint.provider}'s own validator directly in the meantime.`,
        );
      }
      out = decode(spec.encode(body, sink.warn), sink.warn, {
        targetModelId: resolved.id,
        provider: endpoint.provider,
        endpoint: endpoint.id,
        ...(resolved.narrows !== undefined && { narrows: resolved.narrows }),
      });
    }

    pushNarrowingWarnings(resolved, target, sink.push);

    const url = endpointUrl(endpoint, resolved.id);
    // Belt and braces: `isFactoryEndpoint` already rejected every entry the
    // table declares without a URL, so this only fires if the two fall out of
    // sync — better a named error than `undefined` in a fetch call.
    if (url === undefined) {
      return structuralFailure(
        route,
        target,
        modelId,
        `unmodel: ${route} has no resolvable URL in the endpoint table.`,
      );
    }
    const request: RequestMeta = { url, method: "POST", headers: { ...endpoint.headers } };

    // Layers 1 + 3 against the TARGET. Layers 2 and 4 (catalog, context,
    // budget) are deliberately skipped — see TargetValidation.
    const issues: Issue[] = [];
    const validation = spec.targetValidation?.(endpoint);
    checkSchema(validation?.schema, out, issues);
    checkConstraints(validation?.constraints, out, resolved.id, issues);
    const errors = issues.filter((issue) => issue.severity === "error");
    const warnings = issues.filter((issue) => issue.severity === "warning");
    if (errors.length > 0) return { route, result: { ok: false, errors, warnings } };

    const sdk = (spec.sdkFor ?? defaultSdkFor)(endpoint, out, resolved.id);
    const validated = toValidated(out, request, { sdk });
    const params = attachWarnings(validated as object, sink.warnings);
    // Which provider this became, for logging and for narrowing on the result.
    // Non-enumerable like everything else that is not the wire body.
    Object.defineProperty(params, "target", {
      value: endpoint.provider,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    const result: ValidateResult<object> = { ok: true, params, warnings, estimate: {} };
    return { route, result } satisfies ApiRetargetOutcome;
  };
}
