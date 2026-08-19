/**
 * Validation **layer 3** against a wire body that the caller did not write.
 *
 * Both consumers are in that position and neither can use `core/pipeline`'s
 * copy: `.toApi(provider)` checks the *target's* deny/enum tables against a
 * body the translator just produced, and `unmodel/chat` checks the compiled
 * dialect body against the tables of whichever provider the model ref named.
 * In both cases the params object the pipeline would have inspected — the
 * caller's — is in a different vocabulary from the body the API will receive,
 * so the check has to run on the body.
 *
 * Extracted into its own module rather than exported from `retarget.ts`
 * because `unmodel/chat` needs exactly this function and none of the retarget
 * engine: importing `retarget.ts` for it would put `createToApi` and the
 * availability vocabulary into an entry that has no `.toApi` at all.
 *
 * This is deliberately deny/enum **only**, matching `TargetValidation`: media
 * rules and `extraCheck`s need the params in their source shape, and family
 * `match` predicates that read a generated catalog (xai's) are exactly the
 * import this layer exists to avoid.
 */
import type { Issue, IssueSeverity } from "../issues";
import type { EndpointConstraints, FamilyRule } from "../constraint-types";

/** Layer-3 findings are errors unless the rule marks the param merely ignored. */
const DENY_SEVERITY: IssueSeverity = "error";

/**
 * Runs the hand-written deny/enum tables over `body`, appending to `out`.
 *
 * This is the layer that catches the case the translation feature exists for:
 * send a body carrying `logprobs` to groq and you get a named error citing
 * groq's compatibility doc, instead of a 400 from the wire.
 */
export function checkConstraints(
  constraints: readonly EndpointConstraints[] | undefined,
  body: object,
  modelId: string,
  out: Issue[],
): void {
  if (constraints === undefined) return;
  const record = body as Record<string, unknown>;
  for (const table of constraints) {
    // A `FamilyRule` narrows its table to the models it matches. Duck-typed
    // rather than discriminated because the caller declares these as the base
    // `EndpointConstraints[]`, which `FamilyRule[]` widens into — and applying
    // a family's denies to every model would reject requests the target
    // accepts, which is worse than not checking.
    const match = (table as Partial<FamilyRule>).match;
    if (typeof match === "function" && !match(modelId)) continue;
    for (const [param, rule] of Object.entries(table.deny ?? {})) {
      // Explicit `null` means "provider default" on these APIs, so it is unset.
      if (record[param] == null) continue;
      const ignored = rule.ignored === true;
      out.push({
        severity: ignored ? "warning" : DENY_SEVERITY,
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
        severity: "error",
        code: "invalid_enum_value",
        path: [param],
        model: modelId,
        message: `\`${param}\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")} for "${modelId}"; got ${JSON.stringify(value)}.`,
        meta: { allowed: [...allowed], value },
      });
    }
  }
}
