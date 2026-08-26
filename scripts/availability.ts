/**
 * Cross-provider model availability derivation.
 *
 * Pure module: no I/O, no filesystem, no clock. `scripts/codegen.ts` reads the
 * snapshot and `data/availability-overrides.json`, calls `buildAvailability`,
 * and writes the rendered files. Output is a pure function of its inputs so
 * `bun run codegen` is byte-identical on reruns.
 *
 * ## The identity problem
 *
 * models.dev does not normalize model ids. One model, six spellings, all in
 * the committed snapshot today:
 *
 *   groq                   openai/gpt-oss-120b
 *   cerebras               gpt-oss-120b
 *   cloudflare-workers-ai  @cf/openai/gpt-oss-120b
 *   fireworks-ai           accounts/fireworks/models/gpt-oss-120b
 *   amazon-bedrock         openai.gpt-oss-120b-1:0
 *   google-vertex          openai/gpt-oss-120b-maas
 *
 * so a naive "same id ⇒ same model" join returns *empty* results for exactly
 * the case that matters.
 *
 * ## The heuristic
 *
 * A **conjunction** of two independent normalizations — an id tail and a
 * normalized display name — both of which must agree. Measured over the 36
 * providers unmodel ships a chat validator for (1597 chat-capable rows):
 *
 *   id-tail only      287 groups   3 intra-provider collisions
 *   name only         283 groups  24 intra-provider collisions  ← merges `-fast` SKUs
 *   id AND name       268 groups   2 intra-provider collisions  ← chosen
 *
 * An *intra-provider collision* — one provider contributing two distinct
 * non-alias ids to one group — is the cheapest available false-positive
 * proxy, since within a single provider distinct catalog entries are distinct
 * products. The 2 residual collisions are the same benign case twice
 * (amazon-bedrock lists `openai.gpt-oss-120b` and `openai.gpt-oss-120b-1:0`)
 * and are pinned by the collision-budget test in `availability.test.ts`.
 *
 * `family` is deliberately **not** a join key: its granularity is
 * inconsistent across providers (the same model is `gpt` on one and
 * `gpt-codex` on another). It is useful only as a negative probe.
 */
import { z } from "zod";
import { pascalCase, quote } from "./emit";
import type {
  AvailabilityEntry,
  AvailabilityMap,
  AvailabilityNarrows,
} from "../src/core/translate/availability-types";

// ---------------------------------------------------------------------------
// Snapshot subset. Deliberately independent of codegen.ts's full schema —
// availability needs six fields, and staying loose means an unrelated
// upstream addition can never break this pipeline.
// ---------------------------------------------------------------------------

const modalityEnum = z.enum(["text", "image", "audio", "video", "pdf"]);

const availModelSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  family: z.string().optional(),
  tool_call: z.boolean().optional(),
  cost: z.looseObject({ input: z.number().optional(), output: z.number().optional() }).optional(),
  modalities: z.object({
    input: z.array(modalityEnum),
    output: z.array(modalityEnum),
  }),
  limit: z.looseObject({ context: z.number() }),
});

const availProviderSchema = z.looseObject({
  id: z.string(),
  models: z.record(z.string(), availModelSchema),
});

const availSnapshotSchema = z.record(z.string(), availProviderSchema);

type Modality = z.output<typeof modalityEnum>;

// ---------------------------------------------------------------------------
// Overrides — the committed manual valve (data/availability-overrides.json).
// ---------------------------------------------------------------------------

/**
 * `"<providerGlob>:<idGlob>"`. `*` matches any run of characters in either
 * half; everything else is literal. Split on the *first* colon — provider ids
 * never contain one, model ids do (`openai.gpt-oss-120b-1:0`).
 */
const rowRefSchema = z.string().regex(/^[^:]+:.+$/, "expected \"<provider>:<model-id>\"");

export const overridesSchema = z.object({
  /**
   * The generation scope, listed explicitly rather than inferred by scanning
   * `src/providers/` — codegen must not depend on the filesystem layout. A
   * test asserts this list matches the chat-validator directories on disk.
   */
  providers: z.array(z.string()).min(1),
  /**
   * In-scope providers that participate only as retarget **destinations** — no
   * `<id>.gen.ts` source file is emitted for them.
   *
   * `amazon-bedrock` and `azure` are factory-configured: they have no
   * provider-wide URL, so they are excluded from the one-argument `.toApi`
   * union and their endpoint modules wire no `api:`. A source table for them
   * would be ~23 KB of generated code that nothing imports. They must stay in
   * `providers` because other providers' rows legitimately *target* them (the
   * data carries factory targets so the reserved two-argument overload needs
   * no codegen change) — this list only suppresses the source half.
   */
  targetOnly: z.array(z.string()).default([]),
  /**
   * Edges the heuristic found that must not ship. Both refs accept `*`
   * globs, and the edge is removed in **both** directions.
   */
  deny: z.array(z.tuple([rowRefSchema, rowRefSchema])).default([]),
  /**
   * Equivalences the heuristic missed. Refs must be exact (no globs) and must
   * resolve to in-scope rows, so a snapshot rename fails codegen instead of
   * silently dropping the override.
   */
  force: z.array(z.tuple([rowRefSchema, rowRefSchema])).default([]),
  /**
   * Rows a provider serves on a **different wire surface** than its chat
   * endpoint, removed from `unmodel/chat`'s ref tables.
   *
   * models.dev records a modality signature, not a route. `chatScope`'s
   * `isTextModel` therefore admits every text-out row a provider lists,
   * including the ones that provider's OWN chat endpoint rejects — OpenAI's
   * codex models (`/v1/responses` only), its embeddings, its image and
   * realtime rows. Each of those shipped as a `ChatModelRef` that compiled to
   * a Chat Completions body the API refuses. The reachability knowledge exists
   * in the repo (`NonChatModelId` in `src/providers/openai/chat.ts`) but as a
   * *type*, which codegen cannot enumerate — so it is restated here, as data,
   * with the same `"<provider>:<idGlob>"` spelling `deny` and `force` use.
   *
   * Scope is deliberately narrow: this filters the three `unmodel/chat` tables
   * only, NOT the per-provider availability tables. `.toApi` is a substrate
   * question — `openai.chat` still accepts these ids with a warning, because
   * refusing what the API might one day fulfil is not this library's job.
   *
   * Unlike `deny`, EVERY entry (glob or not) must match at least one in-scope
   * row. The set is small and hand-curated per provider, so an entry that
   * matches nothing is an upstream rename that has silently stopped excluding
   * something, and that is exactly the failure this field exists to prevent.
   */
  chatScopeExclude: z.array(rowRefSchema).default([]),
});

export type AvailabilityOverrides = z.output<typeof overridesSchema>;

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** amazon-bedrock cross-region inference profiles: `us.`, `eu.`, `global.`, … */
const REGION = /^(us|eu|apac|au|jp|global|ca|sa|il|me|us-gov)\./;
/** amazon-bedrock model-owner prefixes: `anthropic.claude-opus-5`. */
const DOT_ORG =
  /^(anthropic|openai|meta|amazon|mistral|cohere|ai21|deepseek|zai|qwen|writer|luma|stability|twelvelabs|minimax|moonshot|xai|nvidia|google)\./;
/** openrouter routing/pricing SKUs — same weights, different service tier. */
const TIER = /(:free|:thinking|:extended|:nitro|:online|:floor)$/;

/**
 * Strips every provider-specific decoration from a model id, leaving the tail
 * that providers actually share. `alias` marks region- and tier-scoped
 * spellings: they still get their own source entry, but they never win
 * canonical-target selection and never count as a collision.
 */
export function normalizeId(raw: string): { key: string; alias: boolean } {
  let s = raw.toLowerCase();
  let alias = TIER.test(s) || /^(pro|tee|turbo)\//.test(s);
  s = s.split("/").pop() ?? s; // strip every org/path prefix, keep the tail
  s = s.split("@")[0] ?? s; // vertex "claude-opus-5@default"
  while (REGION.test(s)) {
    s = s.replace(REGION, "");
    alias = true;
  }
  s = s.replace(DOT_ORG, ""); // bedrock "anthropic.claude-opus-5"
  // Version separators: providers disagree on `.` vs `-` for the SAME model.
  // Anthropic ships `claude-haiku-4-5`; OpenRouter and Vercel ship
  // `anthropic/claude-haiku-4.5`. Without this collapse the two never join,
  // and 170 directed edges the display-name half already agrees on go missing
  // — including Claude on OpenRouter, which turns `.toApi("openrouter")` into
  // a compile error on models OpenRouter demonstrably serves. Scoped to
  // digit-dot-digit so it cannot touch an org prefix or a file extension, and
  // the name half of the conjunction still guards against a bad merge.
  s = s.replace(/(\d)\.(\d)/g, "$1-$2");
  s = s.replace(/-v?\d+:\d+$/, "").replace(/:\d+$/, ""); // "-v1:0", "-1:0"
  s = s
    .replace(/-maas$/, "")
    .replace(/^databricks-/, "")
    .replace(TIER, "");
  return { key: s, alias };
}

/**
 * Display name modulo punctuation, parentheticals (`(latest)`, `(EU)`) and
 * vendor prefixes (`MiniMax: MiniMax M1`). This is the second, independent
 * half of the conjunction — it is what stops `claude-opus-5` from merging
 * with an unrelated id that happens to share a tail.
 */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, " ") // "(EU)", "(latest)", "(20250805)"
    .replace(/^[a-z0-9 .-]+:\s*/, "") // "MiniMax: MiniMax M1"
    .replace(/[^a-z0-9.]+/g, "");
}

// ---------------------------------------------------------------------------
// Wire surfaces
//
// Hand-written, like `src/core/translate/endpoints.ts`: models.dev records no
// wire-surface information at all. Two providers serve more than one surface,
// so the availability value cannot always be a bare id.
// ---------------------------------------------------------------------------

/** The endpoint a provider's models sit on unless a surface rule says otherwise. */
const DEFAULT_ENDPOINT: Readonly<Record<string, string>> = {
  anthropic: "anthropic.chat",
  "amazon-bedrock": "amazon-bedrock.chat",
  google: "google.chat",
  "google-vertex": "google-vertex.chat",
};

/** Falls back to `<provider>.chat` — the OpenAI-compatible fleet plus openai itself. */
export function defaultEndpointOf(providerId: string): string {
  return DEFAULT_ENDPOINT[providerId] ?? `${providerId}.chat`;
}

interface SurfaceRule {
  match: RegExp;
  endpoint: string;
}

/**
 * Rows that are *not* on their provider's default surface.
 *
 * google-vertex spans three: Gemini `generateContent` (the default), an
 * OpenAI-compatible chat surface for its `-maas` models, and an
 * Anthropic-shaped `rawPredict` surface for Claude. The Claude rule is
 * exercised by the codegen fixtures but produces nothing against the real
 * snapshot: v1 denies every Claude↔vertex edge because unmodel has no
 * rawPredict module (see data/availability-overrides.json).
 *
 * azure deliberately has **no** rule. It also serves Claude, but on a wire
 * surface nobody has verified, so those rows are denied rather than labelled
 * with a guess.
 */
const SURFACE_RULES: Readonly<Record<string, readonly SurfaceRule[]>> = {
  "google-vertex": [
    { match: /-maas$/, endpoint: "google-vertex.chatMaas" },
    { match: /claude/, endpoint: "google-vertex.chatRawPredict" },
  ],
};

function endpointOf(providerId: string, modelId: string): string {
  for (const rule of SURFACE_RULES[providerId] ?? []) {
    if (rule.match.test(modelId)) return rule.endpoint;
  }
  return defaultEndpointOf(providerId);
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

interface Row {
  provider: string;
  id: string;
  name: string;
  /** `${idKey}||${nameKey}` — the group key before the union passes. */
  key: string;
  /** Region/tier spelling, or a dated snapshot linked to an undated alias. */
  alias: boolean;
  context: number;
  inputs: readonly Modality[];
}

/** One provider contributing two distinct non-alias ids to a single group. */
export interface Collision {
  group: string;
  provider: string;
  ids: readonly string[];
}

export interface AvailabilityBuild {
  /** Provider id → its availability map. Only providers with ≥1 entry. */
  providers: Map<string, AvailabilityMap>;
  /** Sorted, stable — the input to the collision-budget test. */
  collisions: Collision[];
  /** `<provider>: <undated> <-> <dated>` strings, sorted. Diagnostics only. */
  aliasLinks: string[];
  /** Groups spanning more than one provider. Diagnostics only. */
  multiProviderGroups: number;
}

function globToRegExp(glob: string): RegExp {
  const body = glob
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}$`);
}

/**
 * A parsed `"<providerGlob>:<idGlob>"`. Exported alongside
 * {@link parseRowRef} / {@link rowRefMatches} because `scripts/codegen.ts`
 * applies the same spelling to `chatScopeExclude`, and two glob dialects for
 * one file's refs would be a silent trap.
 */
export interface RowMatcher {
  provider: RegExp;
  id: RegExp;
  exact: boolean;
}

export function parseRowRef(ref: string): RowMatcher {
  const colon = ref.indexOf(":");
  const provider = ref.slice(0, colon);
  const id = ref.slice(colon + 1);
  return {
    provider: globToRegExp(provider),
    id: globToRegExp(id),
    exact: !provider.includes("*") && !id.includes("*"),
  };
}

export function rowRefMatches(m: RowMatcher, provider: string, id: string): boolean {
  return m.provider.test(provider) && m.id.test(id);
}

function matches(m: RowMatcher, row: Row): boolean {
  return rowRefMatches(m, row.provider, row.id);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Canonical target selection: prefer a non-alias row, then the shortest id,
 * then lexicographic. Deterministic, so codegen stays a pure function of the
 * snapshot. Picks `anthropic.claude-opus-5` over `us.anthropic.claude-opus-5`
 * and `openai.gpt-oss-120b` over `openai.gpt-oss-120b-1:0`.
 */
function pickCanonical(rows: readonly Row[]): Row | undefined {
  let best: Row | undefined;
  for (const row of rows) {
    if (best === undefined) {
      best = row;
      continue;
    }
    if (row.alias !== best.alias) {
      if (!row.alias) best = row;
      continue;
    }
    if (row.id.length !== best.id.length) {
      if (row.id.length < best.id.length) best = row;
      continue;
    }
    if (compare(row.id, best.id) < 0) best = row;
  }
  return best;
}

/**
 * Chat scope. `modalities.output` including `text` is necessary but nowhere
 * near sufficient — models.dev records embeddings, rerankers, transcription
 * and music generation as text-out too, and each of those landed in the chat
 * availability tables and got offered as a `.toApi` source and target. A chat
 * body for any of them addresses an endpoint that does not exist.
 *
 * Two signals, both structural (no id or name matching):
 *
 * 1. **Billing.** A model that charges for input and *nothing* for output does
 *    not generate tokens. That is exactly an embedding or a transcription
 *    model — measured over the in-scope snapshot it selects 19 embedding rows
 *    plus `scaleway:whisper-large-v3`, and no chat model except
 *    `azure:model-router`, whose output price models.dev simply does not
 *    record (azure is target-only, §`targetOnly`, so nothing is lost).
 * 2. **Media generation.** A row that emits `audio` or `video` and does *not*
 *    do tool calls is a music, speech or realtime-voice model — Lyria, the
 *    `gpt-realtime-*` family, `grok-voice-*`, the live-translate previews.
 *    The `tool_call` conjunct is what keeps the omni chat models (which chat
 *    *and* speak) in scope, and image-out rows are deliberately untouched:
 *    `gemini-3-pro-image` and friends really are `generateContent` requests.
 */
function isChatRow(model: z.output<typeof availModelSchema>): boolean {
  const output = model.modalities.output;
  if (!output.includes("text")) return false;
  const cost = model.cost;
  if (cost !== undefined && (cost.output ?? 0) === 0 && (cost.input ?? 0) > 0) return false;
  if (model.tool_call !== true && output.some((m) => m === "audio" || m === "video")) return false;
  return true;
}

function narrowsFor(source: Row, target: Row): AvailabilityNarrows | undefined {
  const narrows: { context?: number; drops?: Modality[] } = {};
  if (target.context < source.context) narrows.context = target.context;
  const drops = source.inputs.filter((m) => !target.inputs.includes(m));
  if (drops.length > 0) narrows.drops = drops;
  return narrows.context === undefined && narrows.drops === undefined ? undefined : narrows;
}

export function buildAvailability(snapshot: unknown, overrides: unknown): AvailabilityBuild {
  const parsedOverrides = overridesSchema.safeParse(overrides);
  if (!parsedOverrides.success) {
    const details = parsedOverrides.error.issues
      .slice(0, 20)
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`availability overrides failed validation:\n${details}`);
  }
  const config = parsedOverrides.data;

  const parsedSnapshot = availSnapshotSchema.safeParse(snapshot);
  if (!parsedSnapshot.success) {
    const details = parsedSnapshot.error.issues
      .slice(0, 20)
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`models.dev snapshot failed availability validation:\n${details}`);
  }

  // --- collect the in-scope rows ------------------------------------------
  const scope = [...config.providers].sort(compare);
  const seen = new Set<string>();
  for (const id of scope) {
    if (seen.has(id)) throw new Error(`availability overrides: duplicate provider "${id}"`);
    seen.add(id);
  }

  const targetOnly = new Set(config.targetOnly);
  for (const id of targetOnly) {
    if (!seen.has(id)) {
      throw new Error(
        `availability overrides: targetOnly lists "${id}", which is not in \`providers\`. ` +
          `A target-only provider must still be in scope — it is only its own source file that is suppressed.`,
      );
    }
  }

  const rows: Row[] = [];
  for (const providerId of scope) {
    const provider = parsedSnapshot.data[providerId];
    if (provider === undefined) {
      throw new Error(
        `availability overrides list provider "${providerId}", which is not in the snapshot.`,
      );
    }
    const models = Object.values(provider.models).sort((a, b) => compare(a.id, b.id));
    for (const model of models) {
      // Chat scope — see `isChatRow`. Media availability beyond this is not
      // derivable from the snapshot at all (the image/speech/video providers
      // unmodel implements are hand catalogs, absent from models.dev).
      if (!isChatRow(model)) continue;
      const norm = normalizeId(model.id);
      rows.push({
        provider: providerId,
        id: model.id,
        name: model.name,
        key: `${norm.key}||${normalizeName(model.name)}`,
        alias: norm.alias,
        context: model.limit.context,
        inputs: model.modalities.input,
      });
    }
  }

  // --- union-find over group keys -----------------------------------------
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    for (;;) {
      const next = parent.get(root);
      if (next === undefined || next === root) break;
      root = next;
    }
    // Path compression, iterative (group counts reach the thousands).
    let cursor = x;
    for (;;) {
      const next = parent.get(cursor);
      if (next === undefined || next === cursor) break;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    // Lexicographically smaller root wins — deterministic regardless of
    // insertion order.
    if (compare(ra, rb) < 0) parent.set(rb, ra);
    else parent.set(ra, rb);
  };
  for (const row of rows) if (!parent.has(row.key)) parent.set(row.key, row.key);

  const byProvider = new Map<string, Row[]>();
  for (const row of rows) {
    const list = byProvider.get(row.provider);
    if (list === undefined) byProvider.set(row.provider, [row]);
    else list.push(row);
  }

  // --- alias pass: undated alias ↔ dated snapshot, same provider ----------
  // Without it anthropic's flagship ids split their target sets: the undated
  // `claude-haiku-4-5` offers {azure, google-vertex} while the dated
  // `claude-haiku-4-5-20251001` offers {amazon-bedrock} only.
  const aliasLinks: string[] = [];
  for (const providerId of scope) {
    const list = byProvider.get(providerId) ?? [];
    for (const undated of list) {
      for (const dated of list) {
        if (dated === undated) continue;
        if (!dated.id.startsWith(`${undated.id}-`)) continue;
        if (!/^\d{8}$/.test(dated.id.slice(undated.id.length + 1))) continue;
        // Corroborate with the display name modulo "(latest)".
        if (normalizeName(undated.name) !== normalizeName(dated.name)) continue;
        aliasLinks.push(`${providerId}: ${undated.id} <-> ${dated.id}`);
        // The dated spelling becomes an alias so the undated one wins
        // canonical selection and the pair is not read as a collision.
        dated.alias = true;
        union(undated.key, dated.key);
      }
    }
  }
  aliasLinks.sort(compare);

  // --- force overrides -----------------------------------------------------
  const rowsByRef = new Map<string, Row>();
  for (const row of rows) rowsByRef.set(`${row.provider}:${row.id}`, row);
  for (const [a, b] of config.force) {
    const rowA = rowsByRef.get(a);
    const rowB = rowsByRef.get(b);
    const missing = [
      rowA === undefined ? a : undefined,
      rowB === undefined ? b : undefined,
    ].filter((x): x is string => x !== undefined);
    if (missing.length > 0) {
      throw new Error(
        `availability overrides: force pair references unknown in-scope row(s) ${missing
          .map((m) => `"${m}"`)
          .join(", ")}. Refs must be exact and chat-capable; fix or remove the override.`,
      );
    }
    union(rowA!.key, rowB!.key);
  }

  // --- group ---------------------------------------------------------------
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const root = find(row.key);
    const list = groups.get(root);
    if (list === undefined) groups.set(root, [row]);
    else list.push(row);
  }

  // --- collisions (the false-positive proxy) -------------------------------
  const collisions: Collision[] = [];
  for (const [group, members] of groups) {
    const perProvider = new Map<string, string[]>();
    for (const row of members) {
      if (row.alias) continue;
      const list = perProvider.get(row.provider);
      if (list === undefined) perProvider.set(row.provider, [row.id]);
      else list.push(row.id);
    }
    for (const [provider, ids] of perProvider) {
      if (ids.length > 1) collisions.push({ group, provider, ids: [...ids].sort(compare) });
    }
  }
  collisions.sort(
    (a, b) => compare(a.group, b.group) || compare(a.provider, b.provider),
  );

  // --- deny overrides ------------------------------------------------------
  const denies = config.deny.map(([a, b]) => {
    // An exact (glob-free) ref that matches nothing is almost always drift —
    // upstream renamed the model and the override silently stopped applying.
    // Fail codegen instead. Globs are intentionally broad, so they are exempt.
    for (const raw of [a, b]) {
      const matcher = parseRowRef(raw);
      if (matcher.exact && !rows.some((row) => matches(matcher, row))) {
        throw new Error(
          `availability overrides: deny ref "${raw}" matches no in-scope chat row. ` +
            `Fix or remove the override (use a "*" glob if the breadth is intentional).`,
        );
      }
    }
    return [parseRowRef(a), parseRowRef(b)] as const;
  });
  const isDenied = (a: Row, b: Row): boolean =>
    denies.some(
      ([x, y]) => (matches(x, a) && matches(y, b)) || (matches(x, b) && matches(y, a)),
    );

  // --- emit ----------------------------------------------------------------
  //
  // One entry per in-scope chat row of every non-targetOnly provider — *not*
  // only the rows in multi-provider groups — and every entry starts with the
  // **identity target**: the row's own provider.
  //
  // A provider serves its own models by definition, so `.toApi("openai")` on
  // an OpenAI model is a legitimate (lossless, no-op) retarget, and it is what
  // makes provider-generic call sites writable. Omitting it cost twice: the
  // autocomplete union for `gpt-5.2` offered "openrouter" | "vercel" but not
  // the home provider, and a model nobody else serves had no row at all, so
  // its union degraded to the permissive `StaticApiTargetId` arm — 28 targets
  // that every one fail at runtime.
  type MutableMap = Record<string, Record<string, AvailabilityEntry>>;
  const out = new Map<string, MutableMap>();

  // Diagnostic only, and still counted over *groups*: it measures how many
  // models more than one provider serves, which self-entries do not change.
  let multiProviderGroups = 0;
  for (const members of groups.values()) {
    if (new Set(members.map((r) => r.provider)).size >= 2) multiProviderGroups += 1;
  }

  for (const source of rows) {
    // Target-only providers stay reachable as destinations (below) but get
    // no source table of their own — nothing would import it.
    if (targetOnly.has(source.provider)) continue;

    const entries = new Map<string, AvailabilityEntry>();

    // The identity target. It needs no group and no catalog corroboration —
    // the row *is* the evidence — and `narrows` is meaningless against
    // itself, so a self-entry never carries any.
    //
    // It does still pass through `isDenied`: a deny pair whose two halves both
    // match this one row is the overrides file saying this row's wire surface
    // must not ship at all (google-vertex's Claude rows sit on an
    // Anthropic-shaped `rawPredict` surface unmodel has no module for), and
    // that has to hold for the identity edge too — otherwise codegen emits an
    // endpoint id `src/core/translate/endpoints.ts` cannot resolve.
    if (!isDenied(source, source)) {
      const endpoint = endpointOf(source.provider, source.id);
      entries.set(
        source.provider,
        endpoint === defaultEndpointOf(source.provider) ? source.id : { id: source.id, endpoint },
      );
    }

    const members = groups.get(find(source.key)) ?? [];
    if (new Set(members.map((r) => r.provider)).size > 1) {
      const candidatesByProvider = new Map<string, Row[]>();
      for (const candidate of members) {
        if (candidate.provider === source.provider) continue;
        if (isDenied(source, candidate)) continue;
        const list = candidatesByProvider.get(candidate.provider);
        if (list === undefined) candidatesByProvider.set(candidate.provider, [candidate]);
        else list.push(candidate);
      }
      for (const targetProvider of candidatesByProvider.keys()) {
        const target = pickCanonical(candidatesByProvider.get(targetProvider)!);
        if (target === undefined) continue;
        const endpoint = endpointOf(target.provider, target.id);
        const narrows = narrowsFor(source, target);
        entries.set(
          targetProvider,
          endpoint === defaultEndpointOf(target.provider) && narrows === undefined
            ? target.id
            : {
                id: target.id,
                ...(endpoint === defaultEndpointOf(target.provider) ? {} : { endpoint }),
                ...(narrows === undefined ? {} : { narrows }),
              },
        );
      }
    }

    // Empty only when the row's own surface is denied and no other provider
    // serves it — a row that has nowhere to go is not addressable at all.
    if (entries.size === 0) continue;
    // Deterministic key order, with the identity target taking its plain
    // lexicographic place among the cross-provider ones rather than being
    // hoisted first: emission order is data, not emphasis.
    const targets: Record<string, AvailabilityEntry> = {};
    for (const targetProvider of [...entries.keys()].sort(compare)) {
      targets[targetProvider] = entries.get(targetProvider)!;
    }
    const existing = out.get(source.provider);
    if (existing === undefined) out.set(source.provider, { [source.id]: targets });
    else existing[source.id] = targets;
  }

  // Sort providers and each provider's source ids so emission order is stable.
  const sorted = new Map<string, AvailabilityMap>();
  for (const providerId of [...out.keys()].sort(compare)) {
    const map = out.get(providerId)!;
    const ordered: MutableMap = {};
    for (const modelId of Object.keys(map).sort(compare)) ordered[modelId] = map[modelId]!;
    sorted.set(providerId, ordered);
  }

  return { providers: sorted, collisions, aliasLinks, multiProviderGroups };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderEntry(entry: AvailabilityEntry): string {
  if (typeof entry === "string") return quote(entry);
  const fields = [`id: ${quote(entry.id)}`];
  if (entry.endpoint !== undefined) fields.push(`endpoint: ${quote(entry.endpoint)}`);
  if (entry.narrows !== undefined) {
    const narrows: string[] = [];
    if (entry.narrows.context !== undefined) narrows.push(`context: ${entry.narrows.context}`);
    if (entry.narrows.drops !== undefined) {
      narrows.push(`drops: [${entry.narrows.drops.map(quote).join(", ")}]`);
    }
    fields.push(`narrows: { ${narrows.join(", ")} }`);
  }
  return `{ ${fields.join(", ")} }`;
}

/**
 * Renders one `src/catalog/availability/<id>.gen.ts`. There is deliberately
 * no index barrel: `unmodel/anthropic` must pay for anthropic's ~4 KB
 * table, not the fleet's ~350 KB.
 */
export function renderAvailabilityFile(
  providerId: string,
  availability: AvailabilityMap,
  header: string,
): string {
  const lines: string[] = [];
  for (const modelId of Object.keys(availability)) {
    const targets = availability[modelId]!;
    lines.push(`  ${quote(modelId)}: {`);
    for (const targetId of Object.keys(targets)) {
      lines.push(`    ${quote(targetId)}: ${renderEntry(targets[targetId]!)},`);
    }
    lines.push("  },");
  }

  return `${header}
import type { AvailabilityMap } from "../../core/translate/availability-types";

/**
 * Which providers serve ${providerId}'s chat models, and what each one calls
 * them. Source model id → target provider id → the target's own id.
 *
 * ${providerId} itself is always among the targets: a provider serves its own
 * models by definition, so the identity retarget \`.toApi("${providerId}")\` is
 * valid (and lossless) for every row here, including rows nobody else serves.
 *
 * A bare string means the target's default endpoint; the object form carries
 * a non-default \`endpoint\` and/or \`narrows\` metadata (a smaller context
 * window, or input modalities the target does not accept) so \`.toApi\` can
 * warn without loading the target provider's catalog.
 */
export const availability = {
${lines.join("\n")}
} as const satisfies AvailabilityMap;

export type ${pascalCase(providerId)}Availability = typeof availability;
`;
}
