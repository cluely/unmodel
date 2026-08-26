/**
 * Atlas Cloud drift audit — **diff only, never writes.**
 *
 * `atlascloud` has no generator (the promotion bar is recorded in
 * `data/atlascloud/curation.json`), so there is no `--refresh` to regenerate
 * from. What there IS is a keyless catalog and one keyless OpenAPI document per
 * model, both of which move without notice — Atlas's own video API reference
 * currently sends `"model": "kling-v2.0"`, an id that is not in the live
 * catalog. This script is the gate that notices.
 *
 * Four questions, in order of how badly a "yes" hurts:
 *
 * 1. **Is a curated model GONE?** It has vanished from the catalog or its
 *    schema 404s. Every request unmodel compiles for it will fail. Exit 1.
 * 2. **Has a curated model's SCHEMA changed?** A tightened bound, a new enum
 *    member, a renamed field — the committed snapshot under
 *    `data/atlascloud/openapi/` no longer matches. Exit 1, because the
 *    hand-written tables in `src/providers/atlascloud/constraints.ts` were
 *    transcribed from that snapshot and are now a second opinion about a page
 *    that has moved.
 * 3. **Has a listed PRICE moved?** Report only. Atlas publishes no unit for its
 *    rates (see `data/atlascloud/pricing.json`), so a moved figure changes
 *    nothing unmodel ships — but it is the signal that the pricing page has been
 *    touched, which is when the caveat is worth re-reading.
 * 4. **What is new and uncurated?** Report only. Widening the roster is a
 *    curation decision, never an automated one.
 *
 * ```sh
 * bun run audit:atlascloud
 * ```
 *
 * Keyless: the catalog and the schema host both answer without credentials
 * (`static.atlascloud.ai/robots.txt` is `Allow: /`), so this needs no secret and
 * runs identically in CI and locally.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MODELS_CATALOG_URL, modelSchemaUrl } from "../src/providers/atlascloud/urls";

const ROOT = resolve(import.meta.dir, "..");
const DATA_DIR = join(ROOT, "data", "atlascloud");
const OPENAPI_DIR = join(DATA_DIR, "openapi");

/** The Atlas categories this provider serves; a new id outside them is not drift. */
const SERVED_CATEGORIES = new Set(["TEXT-TO-VIDEO", "IMAGE-TO-VIDEO"]);

interface CatalogRow {
  model: string;
  type?: string;
  displayName?: string;
  categories?: string[];
  schema?: string;
  price?: {
    discount?: string;
    actual?: { base_price?: string };
    origin?: { base_price?: string };
  };
}

interface Curation {
  endpoints: Record<string, { verb: string; route: string; family: string; note: string }>;
  excluded?: { endpoints?: Record<string, string> };
}

interface Pricing {
  endpoints: Record<string, { listed: { actual: number; origin: number; discount: number } }>;
}

/** The id → snapshot file name rule, which is Atlas's own schema-URL rule. */
const slugOf = (id: string): string => `${id.replace(/\//g, "-")}.json`;

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

/** Recursively key-sorts, so a re-serialised fetch compares byte-for-byte. */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** The committed snapshot's canonical form — the same shape the fetch is put in. */
const canonical = (document: unknown): string => `${JSON.stringify(sortDeep(document), null, 2)}\n`;

async function fetchJson(url: string): Promise<unknown | undefined> {
  const response = await fetch(url);
  if (!response.ok) return undefined;
  return (await response.json()) as unknown;
}

async function main(): Promise<void> {
  const curation = await readJson<Curation>(join(DATA_DIR, "curation.json"));
  const pricing = await readJson<Pricing>(join(DATA_DIR, "pricing.json"));
  const curated = Object.keys(curation.endpoints).sort();
  const excluded = new Set(Object.keys(curation.excluded?.endpoints ?? {}));

  console.log(`Fetching ${MODELS_CATALOG_URL} ...`);
  const catalog = (await fetchJson(MODELS_CATALOG_URL)) as { data?: CatalogRow[] } | undefined;
  const listed = catalog?.data;
  if (listed === undefined) {
    console.error(`Could not read the Atlas catalog at ${MODELS_CATALOG_URL}.`);
    process.exitCode = 1;
    return;
  }
  const byId = new Map(listed.map((row) => [row.model, row]));
  const video = listed.filter((row) => row.type === "Video");
  console.log(`Atlas serves ${listed.length} models (${video.length} video); ${curated.length} curated.\n`);

  // --- 1. Gone ------------------------------------------------------------
  const gone = curated.filter((id) => !byId.has(id));
  console.log(`Curated but GONE from the catalog (${gone.length}):`);
  for (const id of gone) console.log(`  ${id}`);

  // --- 2. Schema drift ----------------------------------------------------
  const committed = new Set(await readdir(OPENAPI_DIR));
  const drifted: string[] = [];
  const unreadable: string[] = [];
  const orphans = [...committed].filter((file) => !curated.some((id) => slugOf(id) === file)).sort();

  for (const id of curated) {
    const file = slugOf(id);
    if (!committed.has(file)) {
      drifted.push(`${id}: no snapshot at data/atlascloud/openapi/${file}`);
      continue;
    }
    const live = await fetchJson(modelSchemaUrl(id));
    if (live === undefined) {
      unreadable.push(`${id}: ${modelSchemaUrl(id)} did not answer 200`);
      continue;
    }
    const before = sha256(await readFile(join(OPENAPI_DIR, file), "utf8"));
    const after = sha256(canonical(live));
    if (before !== after) {
      drifted.push(`${id}: schema changed (${before.slice(0, 12)} → ${after.slice(0, 12)})`);
    }
  }

  console.log(`\nSchema drift (${drifted.length + unreadable.length}):`);
  for (const line of [...drifted, ...unreadable]) console.log(`  ${line}`);
  if (orphans.length > 0) {
    console.log(`\nCommitted snapshots with no curated id (${orphans.length}):`);
    for (const file of orphans) console.log(`  data/atlascloud/openapi/${file}`);
  }

  // --- 3. Listed price movement (report only) -----------------------------
  const moved: string[] = [];
  for (const id of curated) {
    const row = byId.get(id);
    const before = pricing.endpoints[id]?.listed;
    if (row === undefined || before === undefined) continue;
    const now = {
      actual: Number(row.price?.actual?.base_price),
      origin: Number(row.price?.origin?.base_price),
      discount: Number(row.price?.discount),
    };
    if (now.actual !== before.actual || now.origin !== before.origin || now.discount !== before.discount) {
      moved.push(
        `${id}: actual ${before.actual}→${now.actual}, origin ${before.origin}→${now.origin}, discount ${before.discount}→${now.discount}`,
      );
    }
  }
  console.log(`\nListed figures that moved (${moved.length}) — REPORT ONLY, no row ships a cost:`);
  for (const line of moved) console.log(`  ${line}`);

  // --- 4. New and uncurated (report only) ---------------------------------
  const fresh = video
    .filter((row) => !curated.includes(row.model) && !excluded.has(row.model))
    .filter((row) => (row.categories ?? []).some((category) => SERVED_CATEGORIES.has(category)))
    .map((row) => `${row.model}${row.displayName === undefined ? "" : ` — ${row.displayName}`}`)
    .sort();
  console.log(
    `\nUncurated video models in the categories we already serve (${fresh.length}) — widening the roster is a curation decision:`,
  );
  for (const line of fresh) console.log(`  ${line}`);

  console.log("\nReport only — nothing was written.");
  if (gone.length > 0 || drifted.length > 0 || unreadable.length > 0) {
    console.error(
      "\nA curated model is gone or its schema has moved. The hand-written tables in " +
        "src/providers/atlascloud/constraints.ts were transcribed from these snapshots — re-read the " +
        "changed document, update the tables and re-commit the snapshot.",
    );
    process.exitCode = 1;
  }
}

await main();
