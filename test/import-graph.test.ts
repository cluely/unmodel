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
 * the type checker can enforce: a cycle back into `anthropic/chat.ts`
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
 *     makes cross-dialect retargeting affordable: `anthropic/chat.ts`
 *     importing `openai-compatible/interop.ts` pulls in one codec module and
 *     its type-only wire imports, not that provider's zod schema, catalog or
 *     checks. Two dialect-base exceptions are allowed and enumerated below.
 *  7. The type-only entries (`src/providers/<p>/types.ts`, `src/types/**`) are
 *     **type-only and provider-local** — amendment A8 below.
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
  { wire: "src/providers/anthropic/wire.ts", validator: "src/providers/anthropic/chat.ts" },
  { wire: "src/providers/google/wire.ts", validator: "src/providers/google/chat.ts" },
  {
    wire: "src/providers/google-vertex/wire.ts",
    validator: "src/providers/google-vertex/chat.ts",
  },
  {
    wire: "src/providers/amazon-bedrock/wire.ts",
    validator: "src/providers/amazon-bedrock/chat.ts",
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
/** A generated provider module — `src/providers/<p>/gen/*.gen.ts`. See A10-A12. */
const isGenerated = (file: string): boolean => /^src\/providers\/[^/]+\/gen\/.+\.gen\.ts$/.test(file);
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

/**
 * Amendment A1 — `src/chat/**`, the unified `unmodel/chat` entry.
 *
 * No existing rule constrained this directory (rule 4 is scoped to
 * `src/retarget/**`), and it is the one entry that speaks about *every*
 * provider at once. The ready-made entry deliberately pays for every concrete
 * chat validator so compiled bodies terminate in the same authority as the
 * provider subpaths. That fan-in is isolated to `src/chat/providers.ts`.
 *
 * The allowance is deliberately the same shape as the retarget rule (rule 4):
 * core, the two chat-scoped generated tables, `src/retarget/dialects.ts`
 * (type-only — it is the shared dialect→body map, built from type-only wire
 * leaves), provider *leaves* only, and its own directory. The sole exception
 * is the explicit validator registry; no other chat module may reach a
 * provider barrel or endpoint validator.
 *
 * A1 is completed by three sharper pins, each catching a failure the broad
 * rule above would let through:
 *
 * - **A2** the provider leaves are an enumerated set, not merely "leaves". A
 *   codec or a constraint table is a real bundle cost, so a fourth one showing
 *   up is a failing diff with a name on it — mirroring the cross-dialect pin
 *   in `cross-provider imports`.
 * - **A3** `chat-profiles.gen.ts` has exactly one production owner. It is 324 KB
 *   of generated data; the moment a second entry imports it, that entry's
 *   budget silently triples.
 * - **A4** concrete validator imports are isolated to the registry and cover
 *   all 32 statically addressable providers. Those validators deliberately
 *   bring their ordinary `.toApi` surfaces with them.
 */
describe("chat (amendment A1)", () => {
  const CHAT_CATALOG_TABLES = new Set([
    "src/catalog/chat-refs.gen.ts",
    "src/catalog/chat-profiles.gen.ts",
  ]);

  /**
   * A2 — the exact provider modules the *compiler* may reach, and why each is
   * there: three codecs, one per dialect it compiles to.
   *
   * There used to be four constraint tables here as well, held open by
   * `src/chat/constraints.ts` — a chat-side copy of the deny/enum rules. That
   * module is gone: compiled bodies terminate in the provider's own validator,
   * which applies the provider's own tables, so nothing under `src/chat` needs
   * to reach a constraints leaf at all.
   */
  const CHAT_PROVIDER_LEAVES = new Set([
    "src/providers/anthropic/interop.ts", // anthropic-messages decoder
    "src/providers/google/interop.ts", // gemini decoder
    "src/providers/openai-compatible/interop.ts", // openai-chat decoder (30 providers)
  ]);

  /**
   * A4 — the exact modules the ready-pack registry may import, one per
   * provider.
   *
   * The registry is the one file in `src/chat` allowed to reach a concrete
   * validator, and the old rule stated that as `continue` — *any* path under
   * `src/providers` — which pinned nothing: an unrelated endpoint validator, a
   * second module from an already-counted directory, or a barrel swapped in
   * for a leaf all passed. (A barrel is not free: `../providers/mistral`
   * re-exports its transcription endpoint, and ~22 KiB of transcribe schemas
   * ride into `unmodel/chat` because of it.)
   *
   * So the registry's imports are enumerated. Four providers ship a dedicated
   * `chat.ts` leaf and must use it (minimax grew one when the voice-creation
   * wave made its barrel too expensive for a chat bundle); the rest have only
   * a barrel, which is the honest module for them until they grow one.
   */
  const CHAT_REGISTRY_IMPORTS = new Set([
    "src/providers/anthropic/chat.ts",
    "src/providers/google/chat.ts",
    "src/providers/minimax/chat.ts",
    "src/providers/openai/chat.ts",
    ...[
      "alibaba",
      "baseten",
      "cerebras",
      "deepinfra",
      "deepseek",
      "fireworks-ai",
      "friendli",
      "groq",
      "huggingface",
      "inception",
      "longcat",
      "meta",
      "mistral",
      "moonshotai",
      "nebius",
      "novita-ai",
      "nvidia",
      "openrouter",
      "perplexity",
      "sarvam",
      "scaleway",
      "siliconflow",
      "stepfun",
      "togetherai",
      "upstage",
      "vercel",
      "xai",
      "zhipuai",
    ].map((provider) => `src/providers/${provider}/index.ts`),
  ]);

  test("reaches only core, the chat tables, pinned provider leaves and itself", () => {
    const chatFiles = FILES.filter((f) => under(f, "src/chat"));
    // A rule that scans an empty set passes by saying nothing.
    expect(chatFiles.length).toBeGreaterThanOrEqual(8);

    const violations: string[] = [];
    for (const file of chatFiles) {
      for (const ref of importsOf(file)) {
        if (ref.specifier === "zod") continue;
        if (under(ref.target, "src/core")) continue;
        if (under(ref.target, "src/chat")) continue;
        if (CHAT_CATALOG_TABLES.has(ref.target)) continue;
        // The dialect→body map. Type-only, and it must stay that way: it is
        // the one module outside core/chat this entry names at all.
        if (ref.target === "src/retarget/dialects.ts") {
          if (!ref.typeOnly) {
            violations.push(
              violation(file, ref, "src/retarget/dialects.ts is a type map — use `import type`"),
            );
          }
          continue;
        }
        if (under(ref.target, "src/providers")) {
          if (file === "src/chat/providers.ts") {
            if (CHAT_REGISTRY_IMPORTS.has(ref.target)) continue;
            violations.push(
              violation(
                file,
                ref,
                "the ready-pack registry imports exactly one enumerated module per provider " +
                  "(A4). A barrel where a `chat.ts` leaf exists, or a second module from a " +
                  "directory already counted, drags unrelated endpoint data into unmodel/chat " +
                  "without changing the provider count",
              ),
            );
            continue;
          }
          if (CHAT_PROVIDER_LEAVES.has(ref.target)) continue;
          const basename = ref.target.slice(ref.target.lastIndexOf("/") + 1);
          violations.push(
            violation(
              file,
              ref,
              basename === "index.ts" || !PROVIDER_LEAF_BASENAMES.has(basename)
                ? `only ${[...PROVIDER_LEAF_BASENAMES].join(" / ")} may be imported from a provider ` +
                    "directory — concrete validators belong in the explicit ready-pack registry; " +
                    "a barrel elsewhere would leak provider data into the compiler/factory graph"
                : "a leaf, but not one of one of the pinned seven (A2) — a new codec or constraint table " +
                    "is a real bundle cost, so add it to CHAT_PROVIDER_LEAVES deliberately",
            ),
          );
          continue;
        }
        if (isCatalogGen(ref.target) || ref.target === "src/catalog/index.ts") {
          violations.push(
            violation(
              file,
              ref,
              "only the explicit ready-pack registry may reach per-provider catalogs; the " +
                "compiler/factory graph must stay provider-free",
            ),
          );
          continue;
        }
        violations.push(
          violation(
            file,
            ref,
            "src/chat may import only src/core/**, src/catalog/chat-*.gen.ts, " +
              "type-only src/retarget/dialects.ts, the seven pinned provider leaves, zod, " +
              "and its own directory",
          ),
        );
      }
    }
    expect(violations).toEqual([]);
  });

  test("A2 — every pinned provider leaf is actually reached (no dead pins)", () => {
    const reached = new Set<string>();
    for (const file of FILES.filter((f) => under(f, "src/chat"))) {
      for (const ref of importsOf(file)) {
        if (CHAT_PROVIDER_LEAVES.has(ref.target)) reached.add(ref.target);
      }
    }
    expect([...reached].sort()).toEqual([...CHAT_PROVIDER_LEAVES].sort());
  });

  test("A3 — the profile table has exactly one production importer: src/chat", () => {
    // 324 KB of generated data. A second entry importing it does not fail any
    // type check and does not fail any existing test — it just triples that
    // entry's bundle. This is the only thing that catches it.
    const importers = FILES.filter((file) =>
      importsOf(file).some((ref) => ref.target === "src/catalog/chat-profiles.gen.ts"),
    );
    expect(importers.length).toBeGreaterThanOrEqual(1);
    expect(importers.filter((file) => !under(file, "src/chat"))).toEqual([]);
  });

  test("A4 — concrete provider validators are isolated to the complete registry", () => {
    const violations: string[] = [];
    for (const file of FILES.filter((f) => under(f, "src/chat"))) {
      for (const ref of importsOf(file)) {
        if (!under(ref.target, "src/providers")) continue;
        if (CHAT_PROVIDER_LEAVES.has(ref.target)) continue;
        if (file !== "src/chat/providers.ts") {
          violations.push(violation(file, ref, "concrete provider validators belong only in src/chat/providers.ts"));
        }
      }
    }
    expect(violations).toEqual([]);

    const providers = new Set(
      importsOf("src/chat/providers.ts")
        .map((ref) => providerOf(ref.target))
        .filter((provider): provider is string => provider !== undefined),
    );
    expect(providers.size).toBe(32);

    // Counting *directories* is not enough: `../providers/openai` and
    // `../providers/openai/image` both count as "openai". The exact modules
    // are pinned, and every pin has to be used, so a stale entry cannot sit
    // there quietly widening the allowance.
    const registryTargets = importsOf("src/chat/providers.ts")
      .map((ref) => ref.target)
      .filter((target) => under(target, "src/providers"));
    expect([...new Set(registryTargets)].sort()).toEqual([...CHAT_REGISTRY_IMPORTS].sort());

    const registryImporters = FILES.filter((file) =>
      importsOf(file).some((ref) => ref.target === "src/chat/providers.ts"),
    );
    expect(registryImporters).toEqual(["src/chat/index.ts"]);

    const factoryLeaks = importsOf("src/chat/factory.ts").filter(
      (ref) =>
        ref.target === "src/chat/index.ts" ||
        ref.target === "src/chat/providers.ts",
    );
    expect(factoryLeaks).toEqual([]);
  });

  test("the type-only ref table stays type-only at every call site", () => {
    // `chat-refs.gen.ts` is ~52 KB of string-literal union and zero runtime
    // values. A value import of it would be a no-op today and a bundling
    // hazard the moment anything is added to it.
    const violations: string[] = [];
    let importers = 0;
    for (const file of FILES) {
      for (const ref of importsOf(file)) {
        if (ref.target !== "src/catalog/chat-refs.gen.ts") continue;
        importers += 1;
        if (!ref.typeOnly) {
          violations.push(violation(file, ref, "the chat ref union is type-only — use `import type`"));
        }
      }
    }
    expect(importers).toBeGreaterThanOrEqual(1);
    expect(violations).toEqual([]);
  });
});

/**
 * Amendment A5 — `src/core/unified/**` and `src/unified/**`, the six unified
 * media surfaces.
 *
 * The proposition of `unmodel/image` and its five siblings is that you name
 * the providers you want and pay for those. That only holds if the *kernel*
 * costs nothing beyond itself — and a kernel is one careless import away from
 * costing everything, because it is the one module in the repo that talks
 * about every provider at once.
 *
 * So the layering is asserted in three tiers, mirroring the shape of the chat
 * rules above:
 *
 * - **A5** the kernel (`src/core/unified/**`) sees `src/core/**` and zod. Not
 *   a provider, not a catalog, not even type-only — a type-only import today
 *   is a value import after one refactor, and the rule that admits neither is
 *   the rule nobody has to think about.
 * - **A6** a category entry (`src/unified/**`) sees the kernel, its own
 *   directory, and provider adapter leaves — nothing else in a provider
 *   directory, ever. This is what makes a ready-made pack cost exactly its
 *   adapters.
 * - **A7** an adapter sees its own provider directory, the kernel and the
 *   translation warning types.
 *
 * An adapter leaf is `unified.ts`, or `unified-<category>.ts` for a provider
 * that serves more than one. The suffixed form is not a convenience: a single
 * module exporting two categories' adapters is a single *build entry* holding
 * both, so `unmodel/tts` paid for OpenAI's image catalog until the two were
 * split. One module per category is what makes A6's promise true in bytes and
 * not just in imports.
 */
describe("unified media surfaces (amendment A5)", () => {
  const isUnifiedAdapter = (file: string): boolean =>
    /^src\/providers\/[^/]+\/unified(-[a-z-]+)?\.ts$/.test(file);

  test("A5 — the kernel imports only src/core/** and zod", () => {
    const kernelFiles = FILES.filter((f) => under(f, "src/core/unified"));
    // A rule that scans an empty set passes by saying nothing.
    expect(kernelFiles.length).toBeGreaterThanOrEqual(3);

    const violations: string[] = [];
    for (const file of kernelFiles) {
      for (const ref of importsOf(file)) {
        if (ref.specifier === "zod") continue;
        if (under(ref.target, "src/core")) continue;
        violations.push(
          violation(
            file,
            ref,
            under(ref.target, "src/providers")
              ? "the unified kernel must never depend on a provider — it is the one module that " +
                  "speaks about all of them, so a single edge here lands in all six media entries"
              : "src/core/unified may import only src/core/** and zod",
          ),
        );
      }
    }
    expect(violations).toEqual([]);
  });

  test("A6 — a category entry imports only the kernel, itself, and adapter leaves", () => {
    const entries = FILES.filter((f) => under(f, "src/unified"));
    expect(entries.length).toBe(8);

    const violations: string[] = [];
    for (const file of entries) {
      for (const ref of importsOf(file)) {
        if (under(ref.target, "src/core/unified")) continue;
        if (under(ref.target, "src/unified")) continue;
        if (isUnifiedAdapter(ref.target)) continue;
        violations.push(
          violation(
            file,
            ref,
            under(ref.target, "src/providers")
              ? "a category entry reaches a provider only through its unified.ts adapter — anything " +
                  "else drags that provider's validator, schema and catalog into an entry whose " +
                  "whole proposition is that you pay for the adapters you name"
              : "src/unified may import only src/core/unified/**, its own directory, and " +
                  "src/providers/*/unified.ts",
          ),
        );
      }
    }
    expect(violations).toEqual([]);
  });

  test("A7 — an adapter imports only its own provider, the kernel, and warning types", () => {
    const adapters = FILES.filter(isUnifiedAdapter);
    // A floor rather than an equality, and it moves when a wave lands: 29 held
    // through the image and speech waves, Gemini joining both audio categories
    // added `google/unified-tts.ts` and `google/unified-stt.ts`, and fal
    // arrived with two at once (`unified-image.ts`, `unified-image-edit.ts`) —
    // 33. A rule that scans an empty set passes by saying nothing, and this one
    // is the reason a category entry can import an adapter leaf without
    // dragging that provider's neighbours in.
    expect(adapters.length).toBeGreaterThanOrEqual(33);

    const violations: string[] = [];
    for (const file of adapters) {
      const provider = providerOf(file);
      for (const ref of importsOf(file)) {
        if (ref.specifier === "zod") continue;
        if (under(ref.target, "src/core/unified")) continue;
        if (ref.target === "src/core/translate/warnings.ts") continue;
        if (providerOf(ref.target) === provider) continue;
        violations.push(
          violation(
            file,
            ref,
            "a unified adapter may import only its own provider directory, src/core/unified/**, " +
              "src/core/translate/warnings.ts and zod",
          ),
        );
      }
    }
    expect(violations).toEqual([]);
  });

  test("the eight entries exist, one per category", () => {
    const names = FILES.filter((f) => under(f, "src/unified"))
      .map((f) => f.slice("src/unified/".length, -".ts".length))
      .sort();
    expect(names).toEqual([
      "image",
      "image-edit",
      "music",
      "stt",
      "tts",
      "video",
      "voice-clone",
      "voice-design",
    ]);
  });
});

/**
 * Amendment A8 — the type-only entries: `src/providers/<p>/types.ts` and
 * `src/types/**`.
 *
 * `unmodel/<provider>/types` promises two things a type checker cannot: that
 * it costs nothing at runtime, and that importing one provider's types does
 * not drag another provider's. Both are one missing `type` keyword away from
 * being false, and neither failure produces a type error —
 * `verbatimModuleSyntax` turns a value import here straight into a value
 * import in the emitted JavaScript, which would make `unmodel/anthropic/types`
 * ship anthropic's schema, catalog and pipeline.
 *
 * So the rule is the strictest one that still lets the entries be complete:
 *
 * - **every** import is type-only, everywhere, no exceptions;
 * - a provider's types entry sees its own directory, its own generated
 *   catalog, and — because they are the same two structural exceptions rule 6
 *   already allows — the `openai-compatible` dialect base and (for
 *   `google-vertex`) `google`;
 * - the hub sees `src/core/**`, `src/chat/**` and `src/retarget/**`. Not a
 *   provider directory, not a per-provider catalog: an aggregate of every
 *   provider's wire types is the ~900 KB declaration this layout exists to
 *   avoid, and the first import that reaches for one is how it would start.
 *
 * `test/types-entries.test.ts` asserts the other half — that the built
 * JavaScript really is empty — against a real build.
 */
describe("type-only entries (amendment A8)", () => {
  const isProviderTypesEntry = (file: string): boolean =>
    /^src\/providers\/[^/]+\/types\.ts$/.test(file);

  /** The same two structural exceptions rule 6 enumerates, and no others. */
  const TYPES_ENTRY_DIALECT_BASES: ReadonlyArray<{ from: string; to: string }> = [
    { from: "*", to: "openai-compatible" },
    { from: "google-vertex", to: "google" },
  ];

  test("every import in every types entry is type-only", () => {
    const files = [...FILES.filter(isProviderTypesEntry), ...FILES.filter((f) => under(f, "src/types"))];
    // A rule that scans an empty set passes by saying nothing.
    expect(files.length).toBeGreaterThanOrEqual(71);

    const violations: string[] = [];
    for (const file of files) {
      for (const ref of importsOf(file)) {
        if (ref.typeOnly) continue;
        violations.push(
          violation(
            file,
            ref,
            "a types entry is type-only — under verbatimModuleSyntax this import is emitted " +
              "as a real one, and the entry stops being free",
          ),
        );
      }
    }
    expect(violations).toEqual([]);
  });

  test("a provider types entry stays inside its own provider", () => {
    const files = FILES.filter(isProviderTypesEntry);
    expect(files.length).toBeGreaterThanOrEqual(70);

    const violations: string[] = [];
    for (const file of files) {
      const from = providerOf(file) as string;
      for (const ref of importsOf(file)) {
        if (providerOf(ref.target) === from) continue;
        if (ref.target === `src/catalog/${from}.gen.ts`) continue;
        const to = providerOf(ref.target) ?? ref.target.split("/")[2];
        if (
          to !== undefined &&
          TYPES_ENTRY_DIALECT_BASES.some(
            (rule) => (rule.from === "*" || rule.from === from) && rule.to === to,
          )
        ) {
          continue;
        }
        violations.push(
          violation(
            file,
            ref,
            "a provider types entry may name only its own directory, its own generated " +
              "catalog, the openai-compatible dialect base and (for google-vertex) google — " +
              "anything else puts a second provider's declarations behind this subpath",
          ),
        );
      }
    }
    expect(violations).toEqual([]);
  });

  test("the hub names no provider and no per-provider catalog", () => {
    const files = FILES.filter((f) => under(f, "src/types"));
    expect(files.length).toBeGreaterThanOrEqual(1);

    const violations: string[] = [];
    for (const file of files) {
      for (const ref of importsOf(file)) {
        if (under(ref.target, "src/core")) continue;
        if (under(ref.target, "src/chat")) continue;
        if (under(ref.target, "src/retarget")) continue;
        if (under(ref.target, "src/types")) continue;
        violations.push(
          violation(
            file,
            ref,
            under(ref.target, "src/providers") || isCatalogGen(ref.target)
              ? "the hub is the CANONICAL vocabulary — provider wire types live at " +
                  "unmodel/<provider>/types, one entry each, precisely so this one stays small"
              : "src/types may import only src/core/**, src/chat/**, src/retarget/** and itself",
          ),
        );
      }
    }
    expect(violations).toEqual([]);
  });

  test("no other module imports a types entry — they are leaves, not plumbing", () => {
    const violations: string[] = [];
    for (const file of FILES) {
      if (isProviderTypesEntry(file) || under(file, "src/types")) continue;
      for (const ref of importsOf(file)) {
        if (isProviderTypesEntry(ref.target) || under(ref.target, "src/types")) {
          violations.push(
            violation(file, ref, "a types entry is a published surface, not a shared module"),
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

/**
 * Amendment A9 — the value entries: `src/providers/<p>/values.ts` and
 * `src/values/**`.
 *
 * `unmodel/<provider>/values` promises the opposite of what A8's entries
 * promise. A types entry is free and must stay free; a values entry ships real
 * bytes and must ship *only* the ones asked for. Both promises are invisible to
 * `tsc`, and this one has a specific, easy way to break: re-export a list from
 * the module that also builds a zod schema, and one import of one array drags a
 * validator, the pipeline and sometimes a generated catalog — 30–80 KiB,
 * measured, which is why the per-model tables live on import-free
 * `<category>-params.ts` leaves at all.
 *
 * So the rules are the narrowest ones that still let the entries be complete:
 *
 * - a provider's values entry names **its own directory and nothing else** —
 *   not the dialect bases A8 allows, because a value import of another
 *   provider's module is that provider's bytes, not merely its declarations;
 * - it never names an adapter (`unified*.ts`). The adapter is where the compile
 *   function and the validator import live; the data it compiles with is on the
 *   `-params` leaf beside it, and both read the same object;
 * - the hub sees the canonical value modules, the chat ref array and
 *   `src/chat/refs.ts` — enumerated, because each is a chunk;
 * - the 1,339-ref array has exactly ONE importer, for the reason A3 pins the
 *   profile table: it is 45 KiB, and a second importer would put it in a second
 *   entry without changing a line of the entry that acquired it.
 *
 * `test/values-entries.test.ts` asserts the other half — what each export
 * actually costs — against a real build.
 */
describe("value entries (amendment A9)", () => {
  const isProviderValuesEntry = (file: string): boolean =>
    /^src\/providers\/[^/]+\/values\.ts$/.test(file);
  const isUnifiedAdapter = (file: string): boolean =>
    /^src\/providers\/[^/]+\/unified(-[a-z-]+)?\.ts$/.test(file);

  /** The exact modules `src/values/**` may reach outside itself. */
  const HUB_IMPORTS = new Set([
    // The canonical arrays, and — re-exported from that same module —
    // `CANONICAL_KEY_LISTS`. One door, so the hub names one core module.
    "src/core/unified/values.ts",
    "src/chat/refs.ts", // CHAT_PROVIDERS, 32 strings
    "src/catalog/chat-refs-values.gen.ts", // CHAT_MODEL_REFS, on its own entry
  ]);

  const REF_VALUES = "src/catalog/chat-refs-values.gen.ts";

  test("a provider values entry stays inside its own provider", () => {
    const files = FILES.filter(isProviderValuesEntry);
    // A rule that scans an empty set passes by saying nothing.
    expect(files.length).toBeGreaterThanOrEqual(36);

    const violations: string[] = [];
    for (const file of files) {
      const from = providerOf(file) as string;
      for (const ref of importsOf(file)) {
        if (providerOf(ref.target) !== from) {
          violations.push(
            violation(
              file,
              ref,
              "a values entry may name only its own provider directory — a value import of " +
                "anything else is another module's bytes behind this subpath",
            ),
          );
          continue;
        }
        if (isUnifiedAdapter(ref.target)) {
          violations.push(
            violation(
              file,
              ref,
              "an adapter imports the provider's validator and core/unified/derive, so one " +
                "import from here would cost 30–80 KiB. Re-export the table from the " +
                "`<category>-params.ts` leaf the adapter itself reads",
            ),
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("the hub reaches only the enumerated canonical modules", () => {
    const files = FILES.filter((f) => under(f, "src/values"));
    expect(files.length).toBe(2);

    const violations: string[] = [];
    const reached = new Set<string>();
    for (const file of files) {
      for (const ref of importsOf(file)) {
        if (under(ref.target, "src/values")) continue;
        if (HUB_IMPORTS.has(ref.target)) {
          reached.add(ref.target);
          continue;
        }
        violations.push(
          violation(
            file,
            ref,
            under(ref.target, "src/providers")
              ? "the hub is the CANONICAL vocabulary — a provider's arrays live at " +
                  "unmodel/<provider>/values, one entry each, precisely so this one stays 2 KiB"
              : `src/values may import only ${[...HUB_IMPORTS].join(", ")} and itself`,
          ),
        );
      }
    }
    expect(violations).toEqual([]);
    // No dead pins: every allowance is used, so the set cannot quietly widen.
    expect([...reached].sort()).toEqual([...HUB_IMPORTS].sort());
  });

  test("the 1,339-ref array has exactly one importer, and it is its own entry", () => {
    const importers = FILES.filter((file) =>
      importsOf(file).some((ref) => ref.target === REF_VALUES),
    );
    expect(importers).toEqual(["src/values/chat-refs.ts"]);
  });

  test("the type-only ref union and its value twin stay separate", () => {
    // `chat-refs.gen.ts` is the union and must stay type-only everywhere (the
    // rule above in A1); `chat-refs-values.gen.ts` is the array. The generated
    // value file may reference the union — type-only — and nothing in
    // `src/chat` may reach the array: `unmodel/chat` already ships 1.7 MB and
    // has no use for a list of its own refs.
    const violations: string[] = [];
    for (const ref of importsOf(REF_VALUES)) {
      if (ref.target === "src/catalog/chat-refs.gen.ts" && ref.typeOnly) continue;
      violations.push(violation(REF_VALUES, ref, "the ref array imports its own union, type-only"));
    }
    for (const file of FILES.filter((f) => under(f, "src/chat"))) {
      for (const ref of importsOf(file)) {
        if (ref.target === REF_VALUES) violations.push(violation(file, ref, "unmodel/chat does not need the ref array"));
      }
    }
    expect(violations).toEqual([]);
  });

  test("no other module imports a values entry — they are leaves, not plumbing", () => {
    const violations: string[] = [];
    for (const file of FILES) {
      if (isProviderValuesEntry(file) || under(file, "src/values")) continue;
      for (const ref of importsOf(file)) {
        if (isProviderValuesEntry(ref.target) || under(ref.target, "src/values")) {
          violations.push(
            violation(file, ref, "a values entry is a published surface, not a shared module"),
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  /**
   * The `-params` leaves are what make A9's first rule affordable, so they get
   * the rule that keeps them cheap: their own provider directory, and the
   * kernel's `EXTRA`/type surface. A zod import, a validator or a catalog here
   * would move straight through the values entry into a client bundle.
   *
   * **Amendment A10b — the generated-params carve-out.** A provider whose rows
   * are generated has its table under `gen/`, so the leaf has to be able to
   * reach in there. But `gen/` is not one kind of thing: `<cat>-schema.gen.ts`
   * is the only generated module that imports zod, and a leaf that re-exported
   * from it would put a category's whole request schema behind
   * `unmodel/<p>/values` — the exact 30–80 KiB failure A9 exists to prevent,
   * arriving by a new door.
   *
   * So the carve-out is exactly one file: `./gen/<category>-params.gen.ts`,
   * matching the leaf's own category, and nothing else under `gen/`. That is
   * also why the generator emits the model-id list into the params file rather
   * than leaving the leaf to fetch it from `endpoints.gen.ts` — with this rule
   * there is no second module for it to fetch it from.
   */
  test("a <category>-params leaf imports only its provider and the kernel", () => {
    const leaves = FILES.filter((f) => /^src\/providers\/[^/]+\/[a-z-]+-params\.ts$/.test(f));
    expect(leaves.length).toBeGreaterThanOrEqual(50);

    const violations: string[] = [];
    for (const file of leaves) {
      const provider = providerOf(file) as string;
      // `image-edit-params.ts` → `image-edit`.
      const category = /\/([a-z-]+)-params\.ts$/.exec(file)?.[1] as string;
      for (const ref of importsOf(file)) {
        if (ref.specifier === "zod") {
          violations.push(violation(file, ref, "a params leaf holds data, not a schema"));
          continue;
        }
        if (under(ref.target, "src/core/unified")) continue;
        if (isGenerated(ref.target)) {
          if (ref.target === `src/providers/${provider}/gen/${category}-params.gen.ts`) continue;
          violations.push(
            violation(
              file,
              ref,
              `a params leaf may reach exactly one generated module — ./gen/${category}-params.gen.ts — ` +
                "and no other (A10b: `<cat>-schema.gen.ts` imports zod, and a leaf that re-exported from " +
                "it would put a whole category's request schema behind `unmodel/<p>/values`)",
            ),
          );
          continue;
        }
        if (providerOf(ref.target) === provider && !isCatalogGen(ref.target)) continue;
        violations.push(
          violation(
            file,
            ref,
            "a params leaf may import only its own provider directory and src/core/unified/**",
          ),
        );
      }
    }
    expect(violations).toEqual([]);
  });
});

/**
 * Amendments A10–A12 — the generated provider modules under
 * `src/providers/<p>/gen/**`.
 *
 * fal is the first provider here whose types are GENERATED rather than
 * transcribed: `scripts/codegen-fal.ts` reads fal's own published OpenAPI
 * documents and emits ~48 files. That is a new kind of module in this tree, and
 * it arrives with a new way to be expensive — a generated file is written by a
 * template, so a single line in the generator becomes a hundred imports in the
 * tree, and nobody reviews a hundred imports.
 *
 * The core thesis these rules protect is **the generator emits data and types;
 * hand code owns behaviour**. Each amendment is one way that could stop being
 * true:
 *
 * - **A10** — a `gen/` module is data. `<cat>-wire.gen.ts` is type-only (it
 *   costs nothing to import a body type); only `<cat>-schema.gen.ts` may import
 *   zod, because it IS the schema; and no generated module may import the
 *   pipeline, the request layer, a validator or a catalog barrel. A generated
 *   file that reached `createValidator` would be a generated *behaviour*, which
 *   is the line this whole design is drawn on.
 * - **A11** — `gen/` is private to its provider. A second provider importing
 *   another's generated tables would couple two rosters through a refresh.
 * - **A12** — the merged catalog `models.ts` is importable from `index.ts` and
 *   nothing else. This one needs its own assertion because A7's cross-provider
 *   rule cannot see it: `unified-image.ts` importing `./models` is a
 *   SAME-DIRECTORY import, which every other rule here allows. And it is the
 *   single most expensive mistake available in this provider — `models.ts` is
 *   the union of every verb's rows, so one edge from an adapter would put the
 *   editing catalog in the generation pack and, once the later waves land,
 *   seven more categories in both.
 */
describe("generated provider modules (amendments A10-A12)", () => {
  const GEN = /^src\/providers\/([^/]+)\/gen\/(.+)\.gen\.ts$/;
  const generated = FILES.filter((file) => GEN.test(file));

  /** Modules a generated file may never reach: behaviour, not data. */
  const FORBIDDEN = [
    "src/core/pipeline.ts",
    "src/core/request.ts",
    "src/core/options.ts",
    "src/core/result.ts",
  ];

  test("there are generated provider modules, so these rules assert something", () => {
    expect(generated.length).toBeGreaterThanOrEqual(40);
    // fal is the witness today; the rules are written for any provider.
    expect(generated.some((file) => file.startsWith("src/providers/fal/gen/"))).toBe(true);
  });

  test("A10: only <cat>-schema.gen.ts imports zod, and nothing imports behaviour", () => {
    const violations: string[] = [];
    for (const file of generated) {
      const isSchema = /-schema\.gen\.ts$/.test(file);
      for (const ref of importsOf(file)) {
        if (ref.specifier === "zod") {
          if (!isSchema) {
            violations.push(
              violation(file, ref, "only `<category>-schema.gen.ts` may import zod — the rest is data"),
            );
          }
          continue;
        }
        if (FORBIDDEN.includes(ref.target)) {
          violations.push(
            violation(file, ref, "a generated module is data; behaviour is hand-written beside it"),
          );
          continue;
        }
        if (/\/(index|models|constraints|checks|pricing)\.ts$/.test(ref.target) && !ref.typeOnly) {
          violations.push(
            violation(file, ref, "a generated module may not import a provider's hand modules as values"),
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("A10: wire.gen, narrow.gen, params.gen and models.gen import types only", () => {
    const violations: string[] = [];
    const dataOnly = generated.filter((file) =>
      /-(wire|narrow|params)\.gen\.ts$/.test(file) || /\/models-[a-z-]+\.gen\.ts$/.test(file),
    );
    expect(dataOnly.length).toBeGreaterThanOrEqual(20);
    for (const file of dataOnly) {
      for (const ref of importsOf(file)) {
        if (ref.typeOnly) continue;
        violations.push(
          violation(file, ref, "a data module states facts; every import it needs is a type"),
        );
      }
    }
    expect(violations).toEqual([]);
  });

  test("A11: a provider's gen/ directory is reachable only from that provider", () => {
    const violations: string[] = [];
    for (const file of FILES) {
      for (const ref of importsOf(file)) {
        const match = GEN.exec(ref.target);
        if (match === null) continue;
        const owner = match[1] as string;
        if (providerOf(file) === owner) continue;
        violations.push(
          violation(file, ref, `src/providers/${owner}/gen/** is private to ${owner} (A11)`),
        );
      }
    }
    expect(violations).toEqual([]);
  });

  /**
   * A12, and the assertion that earns its own test: nothing but `index.ts`
   * imports the merged catalog.
   *
   * Spelled as a positive list rather than as "no adapter imports it", so that
   * a future `retarget.ts` or `interop.ts` reaching for it also fails. The
   * merged catalog exists for exactly one caller — the provider's public entry,
   * which is the one place a caller has asked for every model fal serves.
   */
  test("A12: the merged catalog is importable from index.ts and nowhere else", () => {
    const merged = FILES.filter((file) => /^src\/providers\/([^/]+)\/models\.ts$/.test(file));
    const withGenSlices = merged.filter((file) =>
      importsOf(file).some((ref) => GEN.test(ref.target)),
    );
    expect(withGenSlices.length).toBeGreaterThanOrEqual(1);

    const violations: string[] = [];
    for (const catalog of withGenSlices) {
      const provider = providerOf(catalog) as string;
      for (const file of FILES) {
        if (file === catalog) continue;
        if (!importsOf(file).some((ref) => ref.target === catalog)) continue;
        if (file === `src/providers/${provider}/index.ts`) continue;
        violations.push(
          `${file} imports "./models" — the merged catalog is the union of every verb's rows, so any ` +
            "other importer ships every category's catalog to reach one (A12). Import " +
            "`./gen/models-<verb>.gen.ts` instead.",
        );
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
      "src/providers/anthropic/chat.ts", // → openai-chat (the flagship path)
      "src/providers/google/chat.ts", // → openai-chat
      // Vertex speaks the Gemini dialect, so it re-uses that codec for
      // `toSdk("ai-sdk")` rather than forking one.
      "src/providers/google-vertex/chat.ts", // → gemini
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
