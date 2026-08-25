/**
 * Weekly leaderboard audit — Artificial Analysis vs. the unmodel catalog.
 *
 * WHAT THIS IS. The native provider wave (7fdc549) started from a one-shot
 * audit of the Artificial Analysis leaderboards; this script is that audit as
 * a program, run weekly by `.github/workflows/leaderboard-audit.yml`. It pulls
 * every ranked model from AA's official Data API, asks "can a caller reach
 * this through unmodel", and renders the gaps as a markdown report the
 * workflow posts to a rolling GitHub issue.
 *
 * REPORT ONLY. Like `codegen:fal:audit`, this never writes to the catalog and
 * never fails the run over a gap — widening a roster is a curation decision,
 * never an automated one. The exit code is 0 unless the inputs themselves are
 * broken (fetch failure, invalid alias file), which throws loudly.
 *
 * THE THREE INPUTS:
 *  1. AA's Data API (https://artificialanalysis.ai/data-api/docs) — the 11
 *     media arenas plus the language list, free tier (`/models/free`), auth
 *     via the `x-api-key` header from ARTIFICIALANALYSIS_API_KEY. Free-tier
 *     data is for internal use with attribution, which is exactly what this
 *     report is; the attribution rides in the footer. Media rows are "current,
 *     first-party foundational models with ≥1,000 arena appearances" — AA
 *     already filters out superseded models, so every row here is worth an
 *     answer. NOTE: `slug` is absent on the music and speech-to-text rows;
 *     matching falls back to the normalized display name there.
 *  2. The adapter leaves — `src/providers/<p>/unified*.ts`, the same sweep
 *     `test/values-entries.test.ts` runs: every exported adapter object
 *     (string `category`, object `modelParams`) contributes its `models` to
 *     the coverage set as `"provider/model"` refs. Chat coverage comes from
 *     the generated `src/catalog` instead (models.dev), matched exactly —
 *     substring matching over six thousand LLM ids would false-positive.
 *  3. The hand alias file `data/leaderboard-aliases.json` — the memory of
 *     every triage decision, so a name that was resolved once never
 *     resurfaces as a gap (the `curation.excluded` doctrine). See that file's
 *     $comment for the entry shape.
 *
 * HOW A ROW IS CLASSIFIED, in order:
 *  - an alias entry matching its endpoint + slug (or normalized name) wins:
 *    `covered` (refs re-validated against the coverage set every run),
 *    `partial` (served outside the unified surface — a realtime-only catalog
 *    row, a deployment-name wire validator; reason required, refs advisory)
 *    or `excluded` (no public developer API; reason required);
 *  - else auto-match: the row's slug and name are normalized (lowercase,
 *    parentheticals stripped — "(high)" is a quality preset, not a model —
 *    resolution suffixes dropped, non-alphanumerics collapsed to "-") and
 *    compared against the normalized coverage refs for the row's mapped
 *    category, exact first, then substring either way (min 6 chars, so "v2"
 *    cannot match everything). Auto-matches are REPORTED with their target,
 *    because a wrong match is worse than a gap;
 *  - else it lands in "needs triage" — the list a human turns into catalog
 *    work or alias entries.
 *
 * The report also names: alias entries whose key matched no AA row this run
 * (stale — AA renamed or retired the model), `covered` refs that no longer
 * exist in the coverage set (the model left our catalog), and AA categories
 * unmodel has no unified surface for at all (speech-to-speech today).
 *
 * Usage:
 *   bun scripts/leaderboard-audit.ts                 # fetch live, print report
 *   bun scripts/leaderboard-audit.ts --out report.md # also write the file
 *   bun scripts/leaderboard-audit.ts --fixtures dir  # offline: read <dir>/<endpoint key with / -> __>.json
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

const ROOT = resolve(import.meta.dir, "..");
const PROVIDERS_DIR = join(ROOT, "src", "providers");
const ALIASES_PATH = join(ROOT, "data", "leaderboard-aliases.json");

export const AA_BASE_URL = "https://artificialanalysis.ai/api/v2";

/**
 * Every endpoint the audit reads, keyed by the path segment under /media (or
 * "language"), mapped to the unmodel categories whose model refs can answer
 * for it. `categories: null` means unmodel has no surface of that kind — the
 * report says so once instead of listing every row as a gap.
 */
export const AA_ENDPOINTS: readonly {
  key: string;
  path: string;
  categories: readonly string[] | null;
}[] = [
  { key: "text-to-image", path: "/media/text-to-image/models/free", categories: ["image"] },
  { key: "image-editing", path: "/media/image-editing/models/free", categories: ["imageEdit"] },
  { key: "text-to-video", path: "/media/text-to-video/models/free", categories: ["video"] },
  { key: "image-to-video", path: "/media/image-to-video/models/free", categories: ["video"] },
  {
    key: "text-to-video-audio",
    path: "/media/text-to-video-audio/models/free",
    categories: ["video"],
  },
  {
    key: "image-to-video-audio",
    path: "/media/image-to-video-audio/models/free",
    categories: ["video"],
  },
  { key: "text-to-speech", path: "/media/text-to-speech/models/free", categories: ["tts"] },
  { key: "speech-to-text", path: "/media/speech-to-text/models/free", categories: ["stt"] },
  { key: "music/instrumental", path: "/media/music/instrumental/models/free", categories: ["music"] },
  { key: "music/with-vocals", path: "/media/music/with-vocals/models/free", categories: ["music"] },
  { key: "speech-to-speech", path: "/media/speech-to-speech/models/free", categories: null },
  { key: "language", path: "/language/models/free", categories: ["chat"] },
];

// ---------------------------------------------------------------------------
// AA response shapes — validated loosely (the fields we read, unknown keys
// pass), loudly (a shape change fails the run with the endpoint named).
// ---------------------------------------------------------------------------

const aaRowSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  slug: z.string().optional(),
  model_creator: z.looseObject({ name: z.string() }).optional(),
});

const aaEnvelopeSchema = z.looseObject({
  data: z.array(aaRowSchema),
});

export interface AaRow {
  id: string;
  name: string;
  slug?: string;
  creator?: string;
}

export type AaData = ReadonlyMap<string, readonly AaRow[]>;

function parseEnvelope(key: string, raw: unknown): AaRow[] {
  const parsed = aaEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Artificial Analysis response for "${key}" failed validation:\n${parsed.error.message}`,
    );
  }
  return parsed.data.data.map((row) => ({
    id: row.id,
    name: row.name,
    ...(row.slug !== undefined && { slug: row.slug }),
    ...(row.model_creator !== undefined && { creator: row.model_creator.name }),
  }));
}

/** `music/with-vocals` → `music__with-vocals.json` — the fixture filename. */
export const fixtureFileName = (key: string): string => `${key.replace(/\//g, "__")}.json`;

export async function fetchAaData(apiKey: string): Promise<AaData> {
  const data = new Map<string, readonly AaRow[]>();
  for (const endpoint of AA_ENDPOINTS) {
    const url = `${AA_BASE_URL}${endpoint.path}`;
    const response = await fetch(url, { headers: { "x-api-key": apiKey } });
    if (!response.ok) {
      throw new Error(`GET ${url} answered ${response.status} ${response.statusText}`);
    }
    data.set(endpoint.key, parseEnvelope(endpoint.key, await response.json()));
  }
  return data;
}

export function readFixtureData(dir: string): AaData {
  const data = new Map<string, readonly AaRow[]>();
  for (const endpoint of AA_ENDPOINTS) {
    const path = join(dir, fixtureFileName(endpoint.key));
    data.set(endpoint.key, parseEnvelope(endpoint.key, JSON.parse(readFileSync(path, "utf8"))));
  }
  return data;
}

// ---------------------------------------------------------------------------
// Coverage — what unmodel serves, per category.
// ---------------------------------------------------------------------------

export interface Coverage {
  /** category → sorted "provider/model" refs. */
  byCategory: ReadonlyMap<string, readonly string[]>;
}

/**
 * The adapter-leaf sweep from test/values-entries.test.ts: an adapter is any
 * exported object with a string `category` and an object `modelParams`, and
 * its `models` are that provider's refs for the category. Dynamic import runs
 * the provider modules — fine in a script, exactly as in the test.
 */
export async function sweepCoverage(): Promise<Coverage> {
  const byCategory = new Map<string, string[]>();
  const providers = readdirSync(PROVIDERS_DIR).filter((name) => {
    const dir = join(PROVIDERS_DIR, name);
    return statSync(dir).isDirectory();
  });
  for (const provider of providers.sort()) {
    const dir = join(PROVIDERS_DIR, provider);
    const leaves = readdirSync(dir)
      .filter((name) => /^unified(-[a-z-]+)?\.ts$/.test(name) && !name.endsWith(".test.ts"))
      .sort();
    for (const leaf of leaves) {
      const module = (await import(join(dir, leaf))) as Record<string, unknown>;
      for (const value of Object.values(module)) {
        if (typeof value !== "object" || value === null) continue;
        const candidate = value as { category?: unknown; modelParams?: unknown; models?: unknown };
        if (typeof candidate.category !== "string" || typeof candidate.modelParams !== "object") {
          continue;
        }
        const refs = byCategory.get(candidate.category) ?? [];
        for (const model of candidate.models as readonly string[]) {
          refs.push(`${provider}/${model}`);
        }
        byCategory.set(candidate.category, refs);
      }
    }
  }
  // Chat is not an adapter category — it comes from the generated catalog.
  const { catalog } = (await import(join(ROOT, "src", "catalog", "index.ts"))) as {
    catalog: Record<string, { models: Record<string, unknown> }>;
  };
  const chat: string[] = [];
  for (const [provider, entry] of Object.entries(catalog)) {
    for (const model of Object.keys(entry.models)) chat.push(`${provider}/${model}`);
  }
  byCategory.set("chat", chat);
  for (const refs of byCategory.values()) refs.sort();
  return { byCategory };
}

// ---------------------------------------------------------------------------
// Aliases — the hand memory of past triage decisions.
// ---------------------------------------------------------------------------

const aliasEntrySchema = z.strictObject({
  name: z.string(),
  status: z.enum(["covered", "partial", "excluded"]),
  refs: z.array(z.string()).optional(),
  reason: z.string().optional(),
  verified: z.string(),
});

const aliasFileSchema = z.strictObject({
  $comment: z.union([z.string(), z.array(z.string())]),
  entries: z.record(z.string(), aliasEntrySchema),
});

export type AliasEntry = z.infer<typeof aliasEntrySchema>;

export function parseAliases(raw: unknown): Record<string, AliasEntry> {
  const parsed = aliasFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`data/leaderboard-aliases.json failed validation:\n${parsed.error.message}`);
  }
  for (const [key, entry] of Object.entries(parsed.data.entries)) {
    if (entry.status === "covered" && (entry.refs === undefined || entry.refs.length === 0)) {
      throw new Error(`alias "${key}": status "covered" requires non-empty refs`);
    }
    if (entry.status !== "covered" && entry.reason === undefined) {
      throw new Error(`alias "${key}": status "${entry.status}" requires a reason`);
    }
  }
  return parsed.data.entries;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * One spelling for every side of a comparison: lowercase, parentheticals
 * dropped ("GPT Image 2 (high)" — the parenthetical is a preset or an alias,
 * not a model), trailing resolution tokens dropped ("Seedance 2.0 720p" — a
 * parameter, not a model), everything non-alphanumeric collapsed to "-".
 */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(\d{3,4}p|[248]k)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Substring matches under this length are noise ("v2", "pro"), not signals. */
const MIN_SUBSTRING_MATCH = 6;

export interface Classified {
  row: AaRow;
  verdict: "aliased" | "auto" | "triage";
  alias?: AliasEntry & { key: string };
  /** The coverage ref an auto-match landed on. */
  matchedRef?: string;
}

export function classifyRow(
  endpointKey: string,
  row: AaRow,
  candidates: readonly string[],
  exactOnly: boolean,
  aliases: Record<string, AliasEntry>,
  usedAliasKeys: Set<string>,
): Classified {
  const keys = [
    ...(row.slug !== undefined ? [`${endpointKey}/${row.slug}`] : []),
    `${endpointKey}/${normalizeName(row.name)}`,
  ];
  for (const key of keys) {
    const alias = aliases[key];
    if (alias !== undefined) {
      usedAliasKeys.add(key);
      return { row, verdict: "aliased", alias: { ...alias, key } };
    }
  }

  const probes = [
    ...(row.slug !== undefined ? [normalizeName(row.slug)] : []),
    normalizeName(row.name),
  ];
  for (const candidate of candidates) {
    const bare = normalizeName(candidate.slice(candidate.indexOf("/") + 1));
    const full = normalizeName(candidate);
    for (const probe of probes) {
      if (probe === bare || probe === full) return { row, verdict: "auto", matchedRef: candidate };
      if (exactOnly) continue;
      // One direction only: the leaderboard name inside a LONGER catalog id
      // ("gemini-3-1-flash-tts" ⊂ "gemini-3-1-flash-tts-preview"). The reverse
      // would let a generic catalog id ("whisper") swallow every future model
      // whose name mentions it — those cases are what the alias file is for.
      if (probe.length >= MIN_SUBSTRING_MATCH && (bare.includes(probe) || full.includes(probe))) {
        return { row, verdict: "auto", matchedRef: candidate };
      }
    }
  }
  return { row, verdict: "triage" };
}

// ---------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------

export interface EndpointResult {
  key: string;
  total: number;
  triage: Classified[];
  auto: Classified[];
  aliased: Classified[];
}

export interface AuditResult {
  endpoints: EndpointResult[];
  /** AA categories unmodel has no unified surface for. */
  notServed: { key: string; total: number }[];
  /** Alias keys that matched no AA row this run. */
  staleAliases: string[];
  /** `covered` alias refs that no longer exist in the coverage set. */
  danglingRefs: { key: string; ref: string }[];
}

export function audit(
  data: AaData,
  coverage: Coverage,
  aliases: Record<string, AliasEntry>,
): AuditResult {
  const usedAliasKeys = new Set<string>();
  const endpoints: EndpointResult[] = [];
  const notServed: { key: string; total: number }[] = [];

  for (const endpoint of AA_ENDPOINTS) {
    const rows = data.get(endpoint.key) ?? [];
    if (endpoint.categories === null) {
      notServed.push({ key: endpoint.key, total: rows.length });
      continue;
    }
    const candidates = endpoint.categories.flatMap(
      (category) => coverage.byCategory.get(category) ?? [],
    );
    // Chat: exact-only — substring matching across six thousand LLM ids would
    // hand out false positives for two-character model names.
    const exactOnly = endpoint.categories.includes("chat");
    const result: EndpointResult = {
      key: endpoint.key,
      total: rows.length,
      triage: [],
      auto: [],
      aliased: [],
    };
    for (const row of rows) {
      const classified = classifyRow(endpoint.key, row, candidates, exactOnly, aliases, usedAliasKeys);
      result[classified.verdict === "aliased" ? "aliased" : classified.verdict === "auto" ? "auto" : "triage"].push(
        classified,
      );
    }
    endpoints.push(result);
  }

  const staleAliases = Object.keys(aliases)
    .filter((key) => !usedAliasKeys.has(key))
    .sort();

  const allRefs = new Set([...coverage.byCategory.values()].flat());
  const danglingRefs: { key: string; ref: string }[] = [];
  for (const [key, entry] of Object.entries(aliases)) {
    if (entry.status !== "covered") continue;
    for (const ref of entry.refs ?? []) {
      if (!allRefs.has(ref)) danglingRefs.push({ key, ref });
    }
  }
  danglingRefs.sort((a, b) => a.key.localeCompare(b.key));

  return { endpoints, notServed, staleAliases, danglingRefs };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const label = (row: AaRow): string =>
  `**${row.name}**${row.creator !== undefined ? ` (${row.creator})` : ""}${row.slug !== undefined ? ` \`${row.slug}\`` : ""}`;

export function renderReport(result: AuditResult): string {
  const lines: string[] = [
    "# Weekly leaderboard audit",
    "",
    "Ranked models on the Artificial Analysis leaderboards, cross-checked against",
    "what unmodel serves. Report only — every widening is a curation decision;",
    "resolve a row by adding catalog coverage or an entry in",
    "`data/leaderboard-aliases.json`.",
    "",
  ];

  const totalTriage = result.endpoints.reduce((n, e) => n + e.triage.length, 0);
  lines.push(
    totalTriage === 0
      ? "**No unresolved gaps.** Every ranked model is covered, aliased or auto-matched."
      : `**${totalTriage} model${totalTriage === 1 ? "" : "s"} need triage.**`,
    "",
  );

  for (const endpoint of result.endpoints) {
    lines.push(`## ${endpoint.key} — ${endpoint.total} ranked`);
    if (endpoint.triage.length > 0) {
      lines.push("", "Needs triage:", "");
      for (const item of endpoint.triage) lines.push(`- [ ] ${label(item.row)}`);
    }
    if (endpoint.auto.length > 0) {
      lines.push("", "<details><summary>Auto-matched (verify the mapping, not the gap)</summary>", "");
      for (const item of endpoint.auto) lines.push(`- ${label(item.row)} → \`${item.matchedRef}\``);
      lines.push("", "</details>");
    }
    const excluded = endpoint.aliased.filter((item) => item.alias?.status === "excluded");
    const partial = endpoint.aliased.filter((item) => item.alias?.status === "partial");
    const covered = endpoint.aliased.filter((item) => item.alias?.status === "covered");
    const summary: string[] = [];
    if (covered.length > 0) summary.push(`${covered.length} alias-covered`);
    if (partial.length > 0)
      summary.push(`${partial.length} partial (${partial.map((i) => i.row.name).join(", ")})`);
    if (excluded.length > 0)
      summary.push(`${excluded.length} excluded (${excluded.map((i) => i.row.name).join(", ")})`);
    if (summary.length > 0) lines.push("", summary.join(" · "));
    lines.push("");
  }

  for (const entry of result.notServed) {
    lines.push(
      `## ${entry.key} — ${entry.total} ranked`,
      "",
      "unmodel has no unified surface for this category.",
      "",
    );
  }

  if (result.staleAliases.length > 0) {
    lines.push("## Stale aliases (matched no leaderboard row this run)", "");
    for (const key of result.staleAliases) lines.push(`- \`${key}\``);
    lines.push("");
  }
  if (result.danglingRefs.length > 0) {
    lines.push("## Dangling covered refs (model left the catalog)", "");
    for (const { key, ref } of result.danglingRefs) lines.push(`- \`${key}\` → \`${ref}\``);
    lines.push("");
  }

  lines.push("---", "", "Data: [Artificial Analysis](https://artificialanalysis.ai).", "");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fixturesAt = args.indexOf("--fixtures");
  const outAt = args.indexOf("--out");

  let data: AaData;
  if (fixturesAt !== -1) {
    data = readFixtureData(args[fixturesAt + 1] as string);
  } else {
    const apiKey = process.env["ARTIFICIALANALYSIS_API_KEY"];
    if (apiKey === undefined || apiKey === "") {
      throw new Error(
        "ARTIFICIALANALYSIS_API_KEY is not set (create a free key at " +
          "https://artificialanalysis.ai/api-key-management-redirect), or pass --fixtures <dir>.",
      );
    }
    data = await fetchAaData(apiKey);
  }

  const aliases = parseAliases(JSON.parse(readFileSync(ALIASES_PATH, "utf8")));
  const coverage = await sweepCoverage();
  const report = renderReport(audit(data, coverage, aliases));

  console.log(report);
  if (outAt !== -1) writeFileSync(args[outAt + 1] as string, report);
}

if (import.meta.main) {
  await main();
}
