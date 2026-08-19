import { describe, expect, test } from "bun:test";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname, relative, resolve as resolvePath } from "node:path";

/**
 * Dependency rules for the retarget/translate machinery.
 *
 * The `.toApi()` / `.toSdk(target)` design turns provider modules into
 * consumers of a shared translation layer, which is only acyclic if the layer
 * depends on *leaf* modules — the wire types + zod schema of a dialect —
 * rather than on the validator modules that own them. That is not something
 * the type checker can enforce: a cycle back into `anthropic/messages.ts`
 * type-checks fine, it just quietly drags the pipeline, the catalog and every
 * check into any bundle that touches translation.
 *
 * So the rules are asserted here, by scanning import statements:
 *
 *  1. `src/providers/<p>/wire.ts` is a LEAF — zod, type-only catalog ids,
 *     type-only core types, and sibling wire leaves. Nothing else, and in
 *     particular never `core/pipeline`, `core/request`, or a validator.
 *  2. `src/core/**` never imports `src/providers/**`, not even type-only.
 *     This covers the future `src/core/translate/**` hub.
 *  3. `src/core/translate/endpoints.ts` (future) imports nothing at all.
 *  4. `src/retarget/**` (future) may reach provider directories only through
 *     leaf modules — `wire.ts`, `constraints.ts`, `interop.ts` — never a
 *     provider `index.ts` or validator module.
 *  5. `src/providers/<p>/interop.ts` (the dialect codec spokes) import
 *     only `src/core/translate/**`, zod, and their own directory's leaves;
 *     any other same-directory import must be type-only.
 *  6. A provider **endpoint** module may reach another provider's directory
 *     only through its `interop.ts` — never `index.ts`, a validator, a
 *     `constraints.ts` or a `catalog/<other>.gen`. This is the rule that
 *     makes cross-dialect retargeting affordable: `anthropic/messages.ts`
 *     importing `openai-compatible/interop.ts` pulls in one codec module and
 *     its type-only wire imports, not that provider's zod schema, catalog or
 *     checks. Two dialect-base exceptions are allowed and enumerated below.
 */

const ROOT = resolvePath(import.meta.dir, "..");
const SRC = join(ROOT, "src");

/** Core modules that are pure type surfaces a wire leaf may reference. */
const CORE_TYPE_MODULES = new Set([
  "src/core/catalog-types.ts",
  "src/core/constraint-types.ts",
  "src/core/issues.ts",
  "src/core/options.ts",
  "src/core/result.ts",
]);

/** Provider-directory modules the retarget layer is allowed to reach into. */
const PROVIDER_LEAF_BASENAMES = new Set(["wire.ts", "constraints.ts", "interop.ts"]);

/**
 * The dialect leaves the translation layer is built on. Listed explicitly so
 * deleting or renaming one is a deliberate, reviewable change rather than a
 * silently vacuous test.
 */
const DIALECT_LEAVES: ReadonlyArray<{ wire: string; validator: string }> = [
  { wire: "src/providers/anthropic/wire.ts", validator: "src/providers/anthropic/messages.ts" },
  { wire: "src/providers/google/wire.ts", validator: "src/providers/google/generate-content.ts" },
  {
    wire: "src/providers/google-vertex/wire.ts",
    validator: "src/providers/google-vertex/generate-content.ts",
  },
  {
    wire: "src/providers/amazon-bedrock/wire.ts",
    validator: "src/providers/amazon-bedrock/converse.ts",
  },
  {
    wire: "src/providers/openai-compatible/wire.ts",
    validator: "src/providers/openai-compatible/chat-completions.ts",
  },
];

interface ImportRef {
  /** The raw specifier as written. */
  specifier: string;
  /** Repo-relative path when the specifier resolves inside the repo, else the specifier. */
  target: string;
  /** `import type` / `export type` — erased at runtime. */
  typeOnly: boolean;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Source files under `src/`, excluding colocated tests. */
function sourceFiles(): string[] {
  return walk(SRC)
    .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test-d.ts"))
    .map((file) => relative(ROOT, file))
    .sort();
}

/** Resolves a relative specifier to a repo-relative file path. */
function resolveSpecifier(fromFile: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  const base = resolvePath(ROOT, dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, join(base, "index.ts"), base]) {
    if (existsSync(candidate)) return relative(ROOT, candidate);
  }
  // Unresolvable (a module a later phase has not written yet) — keep the
  // normalized path so the rules below can still classify it.
  return relative(ROOT, base);
}

/**
 * `[^;]*?` rather than `[\s\S]*?` on purpose. A real `import`/`export … from`
 * clause never contains a semicolon before its `from`, while `export interface
 * Foo { a: string; … }` does — and with an unbounded lazy span that
 * declaration would swallow everything up to the next `from "…"` anywhere in
 * the file, including one inside a doc-comment example. That produced a
 * phantom edge (`openai-compatible/index.ts` "importing"
 * `catalog/availability/groq.gen` from a JSDoc snippet), which is exactly the
 * kind of false positive that gets a rule deleted instead of believed.
 */
const FROM_IMPORT = /^[ \t]*(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']/gm;
const BARE_IMPORT = /^[ \t]*import\s*["']([^"']+)["']/gm;
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
const REQUIRE = /\brequire\(\s*["']([^"']+)["']\s*\)/g;

function importsOf(file: string): ImportRef[] {
  const text = readFileSync(join(ROOT, file), "utf8");
  const refs: ImportRef[] = [];
  const push = (specifier: string, statement: string): void => {
    refs.push({
      specifier,
      target: resolveSpecifier(file, specifier),
      typeOnly: /^[ \t]*(?:import|export)\s+type\s/.test(statement),
    });
  };
  for (const match of text.matchAll(FROM_IMPORT)) push(match[1] as string, match[0]);
  for (const match of text.matchAll(BARE_IMPORT)) push(match[1] as string, match[0]);
  for (const match of text.matchAll(DYNAMIC_IMPORT)) push(match[1] as string, match[0]);
  for (const match of text.matchAll(REQUIRE)) push(match[1] as string, match[0]);
  return refs;
}

const isWireLeaf = (file: string): boolean => /^src\/providers\/[^/]+\/wire\.ts$/.test(file);
const isInterop = (file: string): boolean => /^src\/providers\/[^/]+\/interop\.ts$/.test(file);
const isCatalogGen = (file: string): boolean => /^src\/catalog\/.*\.gen\.ts$/.test(file);
const under = (file: string, dir: string): boolean => file.startsWith(`${dir}/`);

/** `"src/providers/anthropic/wire.ts"` → `"anthropic"`. */
function providerOf(file: string): string | undefined {
  return /^src\/providers\/([^/]+)\//.exec(file)?.[1];
}

/** A violation line that names the file, the specifier and the reason. */
function violation(file: string, ref: ImportRef, why: string): string {
  return `${file} imports "${ref.specifier}" — ${why}`;
}

const FILES = sourceFiles();

describe("wire leaves", () => {
  test("every dialect wire leaf exists and its validator consumes it", () => {
    for (const { wire, validator } of DIALECT_LEAVES) {
      expect(existsSync(join(ROOT, wire))).toBe(true);
      const consumed = importsOf(validator).some((ref) => ref.target === wire);
      expect(consumed, `${validator} must import its wire leaf ${wire}`).toBe(true);
    }
  });

  test("import only zod, type-only catalog ids, type-only core types, and sibling leaves", () => {
    const violations: string[] = [];
    for (const file of FILES.filter(isWireLeaf)) {
      for (const ref of importsOf(file)) {
        if (ref.specifier === "zod") continue;
        if (isWireLeaf(ref.target)) continue;
        if (isCatalogGen(ref.target)) {
          if (!ref.typeOnly) {
            violations.push(
              violation(file, ref, "catalog data must be `import type` in a wire leaf (bundle size)"),
            );
          }
          continue;
        }
        if (CORE_TYPE_MODULES.has(ref.target)) {
          if (!ref.typeOnly) {
            violations.push(violation(file, ref, "core imports must be `import type` in a wire leaf"));
          }
          continue;
        }
        violations.push(
          violation(
            file,
            ref,
            "a wire leaf may import only zod, sibling wire leaves, type-only catalog ids " +
              `and type-only core types (${[...CORE_TYPE_MODULES].join(", ")})`,
          ),
        );
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("core", () => {
  test("never imports src/providers, not even type-only", () => {
    const violations: string[] = [];
    for (const file of FILES.filter((f) => under(f, "src/core"))) {
      for (const ref of importsOf(file)) {
        if (under(ref.target, "src/providers")) {
          violations.push(violation(file, ref, "src/core must not depend on any provider module"));
        }
      }
    }
    expect(violations).toEqual([]);
  });

  // Future: the hand-written target endpoint table is literal strings and URL
  // builders only, so it can be imported from anywhere without pulling a graph.
  test("core/translate/endpoints.ts imports nothing", () => {
    const file = "src/core/translate/endpoints.ts";
    if (!existsSync(join(ROOT, file))) return;
    expect(importsOf(file).map((ref) => ref.specifier)).toEqual([]);
  });
});

describe("retarget", () => {
  // Future: src/retarget/** is created by the .toApi phase. Until then this
  // scans an empty set and passes — the point is that it cannot be added
  // without the rule already applying to it.
  test("reaches providers only through wire/constraints/interop leaves", () => {
    const violations: string[] = [];
    for (const file of FILES.filter((f) => under(f, "src/retarget"))) {
      for (const ref of importsOf(file)) {
        if (!under(ref.target, "src/providers")) continue;
        const basename = ref.target.slice(ref.target.lastIndexOf("/") + 1);
        const depth = ref.target.split("/").length;
        // "src/providers/x" or "src/providers/x/index.ts" — the provider barrel.
        if (basename === "index.ts" || depth === 3) {
          violations.push(
            violation(file, ref, "a provider index re-exports its validator and catalog — cycle"),
          );
          continue;
        }
        if (!PROVIDER_LEAF_BASENAMES.has(basename)) {
          violations.push(
            violation(
              file,
              ref,
              `only ${[...PROVIDER_LEAF_BASENAMES].join(" / ")} may be imported from a provider directory`,
            ),
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("cross-provider imports", () => {
  /**
   * The two structural exceptions, enumerated so adding a third is a
   * deliberate, reviewable act rather than a quiet import:
   *
   * - `openai-compatible` is the shared *dialect base*, not a provider: all 31
   *   fleet overlays and `openai/chat.ts` compose their endpoint out of it.
   * - `google-vertex` serves Google's own dialect and re-uses `google`'s wire
   *   leaf and checks rather than forking them.
   */
  const DIALECT_BASES: ReadonlyArray<{ from: string; to: string }> = [
    { from: "*", to: "openai-compatible" },
    { from: "google-vertex", to: "google" },
  ];

  const allowedBase = (from: string, to: string): boolean =>
    DIALECT_BASES.some((rule) => (rule.from === "*" || rule.from === from) && rule.to === to);

  test("a provider module reaches another provider only through its interop.ts", () => {
    const violations: string[] = [];
    for (const file of FILES.filter((f) => under(f, "src/providers"))) {
      const from = providerOf(file);
      if (from === undefined) continue;
      for (const ref of importsOf(file)) {
        if (!under(ref.target, "src/providers")) continue;
        const to = providerOf(ref.target) ?? ref.target.split("/")[2];
        if (to === undefined || to === from) continue;
        if (allowedBase(from, to)) continue;
        const basename = ref.target.slice(ref.target.lastIndexOf("/") + 1);
        if (basename === "interop.ts") continue;
        violations.push(
          violation(
            file,
            ref,
            `an endpoint module may import another provider's interop.ts only — "${basename}" drags ${to}'s validator, schema or catalog into this bundle`,
          ),
        );
      }
    }
    expect(violations).toEqual([]);
  });

  test("the cross-dialect wiring that pays for a codec is exactly the declared set", () => {
    // A codec import is a real bundle cost, so the set of modules that pay it
    // is pinned here: a new one shows up as a failing diff with a name on it.
    const expected = new Set([
      "src/providers/anthropic/messages.ts", // → openai-chat (the flagship path)
      "src/providers/google/generate-content.ts", // → openai-chat
      // Vertex speaks the Gemini dialect, so it re-uses that codec for
      // `toSdk("ai-sdk")` rather than forking one.
      "src/providers/google-vertex/generate-content.ts", // → gemini
      "src/providers/openrouter/index.ts", // → gemini + anthropic-messages
      "src/providers/vercel/index.ts", // → gemini + anthropic-messages
      // The seven fleet overlays whose generated availability data names
      // `google` as a target (the Gemma rows google also serves). The type
      // union promises `.toApi("google")` on those models, so the codec has to
      // be here — a declared edge with no decoder throws at runtime, which is
      // strictly worse than the bundle cost of the shared gemini chunk. The
      // list below is exactly the set the `every declared .toApi edge has a
      // codec` test in test/interop/retarget-e2e.test.ts derives from the data.
      "src/providers/cloudflare-workers-ai/index.ts", // → gemini
      "src/providers/deepinfra/index.ts", // → gemini
      "src/providers/friendli/index.ts", // → gemini
      "src/providers/huggingface/index.ts", // → gemini
      "src/providers/nvidia/index.ts", // → gemini
      "src/providers/scaleway/index.ts", // → gemini
      "src/providers/siliconflow/index.ts", // → gemini
    ]);
    const actual = new Set(
      FILES.filter((file) => under(file, "src/providers") && !isInterop(file)).filter((file) =>
        importsOf(file).some(
          (ref) =>
            !ref.typeOnly &&
            ref.target.endsWith("/interop.ts") &&
            providerOf(ref.target) !== providerOf(file),
        ),
      ),
    );
    expect([...actual].sort()).toEqual([...expected].sort());
  });
});

/**
 * Ownership of the generated availability tables.
 *
 * Each `src/catalog/availability/<id>.gen.ts` is the retarget data for exactly
 * one provider, and the whole reason there is no `index.ts` barrel is that
 * `unmodel/anthropic` must pay for anthropic's ~2 KB table and not the fleet's
 * ~290 KB. That only holds if each file has exactly one importer and it is the
 * provider that owns it — an invariant that currently holds by convention and
 * would break silently the first time someone reached sideways for a table.
 *
 * The "exactly one" half also catches the reverse waste: a table generated for
 * a provider whose endpoint module wires no `api:` is dead weight in the repo.
 * `data/availability-overrides.json`'s `targetOnly` list is how a provider opts
 * out of having a source table generated at all.
 */
describe("generated availability tables", () => {
  const availabilityDir = join(SRC, "catalog", "availability");

  function importersOf(gen: string): string[] {
    return FILES.filter((file) => importsOf(file).some((ref) => ref.target === gen));
  }

  test("every table is imported exactly once, by the provider that owns it", () => {
    const generated = readdirSync(availabilityDir)
      .filter((name) => name.endsWith(".gen.ts"))
      .sort();
    // A vacuous sweep would be worse than no sweep.
    expect(generated.length).toBeGreaterThan(20);

    const violations: string[] = [];
    for (const name of generated) {
      const gen = `src/catalog/availability/${name}`;
      const owner = name.slice(0, -".gen.ts".length);
      const importers = importersOf(gen);
      if (importers.length === 0) {
        violations.push(
          `${gen} has no importer — generated data nothing consumes. Either wire ` +
            `\`api:\` in src/providers/${owner}/, or add "${owner}" to \`targetOnly\` ` +
            `in data/availability-overrides.json so it stops being emitted.`,
        );
        continue;
      }
      if (importers.length > 1) {
        violations.push(`${gen} is imported by ${importers.length} modules: ${importers.join(", ")}`);
      }
      for (const importer of importers) {
        if (providerOf(importer) !== owner) {
          violations.push(
            `${importer} imports ${gen} — an availability table may be imported only ` +
              `from src/providers/${owner}/**, or the per-subpath bundle stops being per-subpath`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("no module outside a provider directory reaches the availability layer", () => {
    const violations: string[] = [];
    for (const file of FILES) {
      for (const ref of importsOf(file)) {
        if (!under(ref.target, "src/catalog/availability")) continue;
        if (providerOf(file) !== undefined) continue;
        violations.push(violation(file, ref, "only a provider module may import its own table"));
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("interop spokes", () => {
  // Future: src/providers/<p>/interop.ts holds the per-dialect codec. It may
  // see the hub and its own dialect; anything else is another provider's
  // bundle leaking into this one.
  test("import only core/translate, zod, and their own dialect", () => {
    const violations: string[] = [];
    for (const file of FILES.filter(isInterop)) {
      const provider = providerOf(file);
      for (const ref of importsOf(file)) {
        if (ref.specifier === "zod") continue;
        if (under(ref.target, "src/core/translate")) continue;
        if (providerOf(ref.target) === provider) {
          const basename = ref.target.slice(ref.target.lastIndexOf("/") + 1);
          if (!ref.typeOnly && !PROVIDER_LEAF_BASENAMES.has(basename)) {
            violations.push(
              violation(
                file,
                ref,
                "same-directory imports must be type-only unless they are wire/constraints leaves",
              ),
            );
          }
          continue;
        }
        violations.push(
          violation(
            file,
            ref,
            "an interop spoke may import only src/core/translate/**, zod, and its own provider directory",
          ),
        );
      }
    }
    expect(violations).toEqual([]);
  });
});
