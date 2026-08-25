/**
 * Shared emission primitives for the code generators.
 *
 * Two generators write TypeScript into `src/` — `scripts/codegen.ts` (the
 * models.dev catalog) and `scripts/codegen-fal.ts` (the fal.ai endpoint
 * surface) — and both are held to the same contract: output is a pure
 * function of committed inputs, with no timestamps and stable ordering, so
 * that `bun run codegen && git diff --exit-code` is a meaningful CI check.
 *
 * That contract lives in these helpers. `quote`/`num` go through
 * `JSON.stringify` so escaping is the language's, not ours; `sortKeysDeep` is
 * what makes a re-fetched snapshot diff on content rather than on key order;
 * `renderLimit`/`renderMediaCost` are the *one* spelling of a `ModelInfo` row's
 * numeric blocks, so a catalog row and a hand-transcribed media row cannot
 * drift into two dialects of the same object.
 *
 * Nothing here imports `src/`. Both generators must remain runnable against a
 * tree whose generated files are absent or broken.
 */

/** A string literal, escaped the way the language escapes it. */
export function quote(value: string): string {
  return JSON.stringify(value);
}

/** A numeric literal — `JSON.stringify` so `0.1` stays `0.1`, never `1e-1`. */
export function num(value: number): string {
  return JSON.stringify(value);
}

/** "amazon-bedrock" → "AmazonBedrock"; "openai" → "Openai"; "302ai" → "_302ai". */
export function pascalCase(id: string): string {
  const pascal = id
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => (part[0]?.toUpperCase() ?? "") + part.slice(1))
    .join("");
  return /^[0-9]/.test(pascal) ? `_${pascal}` : pascal;
}

/** "amazon-bedrock" → "amazonBedrock". */
export function camelCase(id: string): string {
  const pascal = pascalCase(id);
  return (pascal[0]?.toLowerCase() ?? "") + pascal.slice(1);
}

export function renderStringArray(values: readonly string[]): string {
  return `[${values.map(quote).join(", ")}]`;
}

/** The `ModelInfo["limit"]` block. */
export interface LimitInput {
  context: number;
  output?: number;
  input?: number;
  characters?: number;
}

/** `{ context: 200000, output: 64000 }` — one spelling, shared by both emitters. */
export function renderLimit(limit: LimitInput): string {
  const fields = [`context: ${num(limit.context)}`];
  if (limit.output !== undefined) fields.push(`output: ${num(limit.output)}`);
  if (limit.input !== undefined) fields.push(`input: ${num(limit.input)}`);
  if (limit.characters !== undefined) fields.push(`characters: ${num(limit.characters)}`);
  return `{ ${fields.join(", ")} }`;
}

/**
 * The media-priced half of `ModelCost` — the four units
 * `src/providers/HAND_CATALOGS.md` legislates for models that are not billed
 * by token: `perImage`, `perVideoSecond`, `perMillionCharacters` (TTS input)
 * and `perAudioMinute` (STT).
 *
 * The omit-never-undefined rule is the point of the helper. A `ModelCost`
 * field that is present and `undefined` reads, at every call site, exactly
 * like a rate of zero once it has been through JSON or a spread; a field that
 * is *absent* is the honest encoding of "this provider does not publish a rate
 * in a unit this type can express" — which is the common case for fal, where
 * per-megapixel, tiered and conditional rates are deliberately kept out of
 * `ModelCost` and left to hand pricing tables. So an all-undefined input
 * returns `undefined` (emit no `cost:` line at all) rather than `{}`.
 */
export interface MediaCostInput {
  perImage?: number;
  perVideoSecond?: number;
  perMillionCharacters?: number;
  perAudioMinute?: number;
}

export function renderMediaCost(cost: MediaCostInput): string | undefined {
  const fields: string[] = [];
  const push = (key: string, value: number | undefined) => {
    if (value !== undefined) fields.push(`${key}: ${num(value)}`);
  };
  push("perImage", cost.perImage);
  push("perVideoSecond", cost.perVideoSecond);
  push("perMillionCharacters", cost.perMillionCharacters);
  push("perAudioMinute", cost.perAudioMinute);
  if (fields.length === 0) return undefined;
  return `{ ${fields.join(", ")} }`;
}

/** Recursively sorts object keys so the committed snapshot diffs cleanly. */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value === "object" && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
