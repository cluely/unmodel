import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { MULTIPART_ONLY, REGISTRY } from "../src/cli-registry";

/**
 * The guarantees behind `unmodel/<provider>/types` and `unmodel/types`.
 *
 * Those entries make three promises, and all three are the kind that hold by
 * convention until the day they quietly don't:
 *
 *  1. **Complete.** Every endpoint address the CLI can validate has a
 *     `<Endpoint>Body` type on its provider's types entry. A new endpoint
 *     lands in `src/cli-registry.ts` and nowhere else, so without this test the
 *     types entry silently falls one endpoint behind on the day it ships.
 *  2. **Zero runtime.** Every export is a `type`, so the emitted JavaScript is
 *     an empty module. One `export const` — or one `import` that forgot its
 *     `type` under `verbatimModuleSyntax` — turns a free import into a
 *     provider's whole validator graph, and nothing else in the suite would
 *     notice: the entry would still type-check and still export the right
 *     names.
 *  3. **Packaged.** A types entry with no `exports` key in package.json and no
 *     tsdown entry is a file that compiles in this repo and 404s for everyone
 *     who installs the package.
 *
 * Each is asserted against the real artefact rather than the intention: the
 * source for (1) and (2)'s syntax, the **built** `dist/` for (2)'s bytes and
 * (1)'s emitted declaration, and package.json/tsdown.config.ts for (3).
 */

const ROOT = resolve(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const PROVIDERS_DIR = join(ROOT, "src", "providers");

const PROVIDERS: string[] = readdirSync(PROVIDERS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/** `"imageEditSearchAndReplace"` → `"ImageEditSearchAndReplaceBody"`. */
const bodyTypeFor = (verb: string): string => `${verb[0]?.toUpperCase()}${verb.slice(1)}Body`;

/** Every `<provider>.<endpoint>` id, CLI-runnable and multipart-only alike. */
const ENDPOINT_IDS: string[] = [...Object.keys(REGISTRY), ...Object.keys(MULTIPART_ONLY)].sort();

const typesSource = (provider: string): string =>
  readFileSync(join(PROVIDERS_DIR, provider, "types.ts"), "utf8");

/**
 * Does this source export `name` as a type — either as a declared alias, or as
 * a member of a re-export block?
 *
 * Both spellings count on purpose. The uniform category name is usually a new
 * alias, but at cohere, fish-audio, hume, smallest-ai and openai it is ALREADY
 * the provider's wire spelling, and the address-vs-wire law says the wire name
 * wins rather than acquiring a duplicate. What the caller can import is the
 * same either way, which is what this test is about.
 */
function exportsTypeNamed(source: string, name: string): boolean {
  if (new RegExp(`^export type ${name}\\b`, "m").test(source)) return true;
  for (const block of source.matchAll(/^export type \{([\s\S]*?)\} from "[^"]+";/gm)) {
    const names = (block[1] as string).split(",").map((entry) => entry.trim());
    if (names.includes(name)) return true;
  }
  return false;
}

// CI runs `bun test` before `bun run build`, and `dist/` is gitignored, so the
// suite builds on demand rather than depending on run order — the same
// arrangement test/bundle-budget.test.ts uses.
const built =
  existsSync(join(DIST, "types", "index.js")) ||
  (await $`bun run build`.quiet().then(() => true));

describe("types entries exist, one per provider", () => {
  test("every provider directory ships a types.ts", () => {
    const missing = PROVIDERS.filter(
      (provider) => !existsSync(join(PROVIDERS_DIR, provider, "types.ts")),
    );
    expect(missing).toEqual([]);
    // A rule that scans an empty set passes by saying nothing.
    expect(PROVIDERS.length).toBeGreaterThanOrEqual(70);
  });

  test("the hub exists", () => {
    expect(existsSync(join(ROOT, "src", "types", "index.ts"))).toBe(true);
  });
});

describe("completeness — every endpoint address has a Body type", () => {
  test("the id list is the registry's, so this cannot go vacuous", () => {
    expect(ENDPOINT_IDS.length).toBeGreaterThanOrEqual(155);
    for (const id of ENDPOINT_IDS) expect(id).toMatch(/^[a-z0-9-]+\.[A-Za-z0-9]+$/);
  });

  test("src/providers/<p>/types.ts exports <Endpoint>Body for every registered id", () => {
    const missing: string[] = [];
    for (const id of ENDPOINT_IDS) {
      const [provider, verb] = id.split(".") as [string, string];
      const file = join(PROVIDERS_DIR, provider, "types.ts");
      if (!existsSync(file)) {
        missing.push(`${id}: src/providers/${provider}/types.ts does not exist`);
        continue;
      }
      const name = bodyTypeFor(verb);
      if (!exportsTypeNamed(typesSource(provider), name)) {
        missing.push(
          `${id}: src/providers/${provider}/types.ts exports no type named ${name}. ` +
            "Every endpoint address gets one uniform category alias — add " +
            `\`export type ${name} = <the wire body>;\`, or (if ${name} is already ` +
            "this provider's wire spelling) re-export it by that name.",
        );
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * The five providers whose chat surface is a *factory* — their URL needs
   * configuration a bare `"provider/model"` ref cannot carry, which is exactly
   * why `src/cli-registry.ts` has no id for them (and why `unmodel/chat`
   * refuses them). They still serve chat, so their types entry still names the
   * body, and the loop above cannot see that. Enumerated so the set stays
   * deliberate rather than accidental.
   */
  const FACTORY_CHAT_PROVIDERS = [
    "amazon-bedrock",
    "azure",
    "cloudflare-workers-ai",
    "google-vertex",
    "openai-compatible",
  ];

  test("the factory-configured providers name their chat body too", () => {
    const missing: string[] = [];
    for (const provider of FACTORY_CHAT_PROVIDERS) {
      if (!exportsTypeNamed(typesSource(provider), "ChatBody")) {
        missing.push(`${provider}: types.ts exports no ChatBody`);
      }
      // …and they are genuinely absent from the registry, or this list is stale.
      const registered = ENDPOINT_IDS.some((id) => id.startsWith(`${provider}.`));
      if (registered) missing.push(`${provider} IS in the registry — drop it from this list`);
    }
    expect(missing).toEqual([]);
  });

  test("the built declaration exports it too, so the promise survives the build", () => {
    expect(built).toBe(true);
    const missing: string[] = [];
    for (const id of ENDPOINT_IDS) {
      const [provider, verb] = id.split(".") as [string, string];
      const declaration = join(DIST, "providers", provider, "types.d.ts");
      if (!existsSync(declaration)) {
        missing.push(`${id}: dist/providers/${provider}/types.d.ts was not emitted`);
        continue;
      }
      const name = bodyTypeFor(verb);
      // The emitted declaration ends in one flat `export { … }` list.
      if (!new RegExp(`\\b${name}\\b`).test(readFileSync(declaration, "utf8"))) {
        missing.push(`${id}: dist/providers/${provider}/types.d.ts does not export ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("zero runtime", () => {
  /**
   * A types entry that emits *any* code has stopped being free. 200 bytes is
   * not a budget so much as a tripwire: tsdown emits a genuinely empty file
   * today, and the smallest real export (`export const x = 1;` plus a source
   * map comment) clears this immediately.
   */
  const EMPTY_JS_BUDGET_BYTES = 200;

  test("every source file is type-only syntax", () => {
    const violations: string[] = [];
    const files = [
      ...PROVIDERS.map((provider) => `src/providers/${provider}/types.ts`),
      "src/types/index.ts",
    ];
    for (const file of files) {
      const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!/^(?:import|export)\b/.test(line)) return;
        if (/^(?:import|export) type\b/.test(line)) return;
        violations.push(`${file}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(
      violations,
      "a types entry may contain `import type` / `export type` statements and nothing else — " +
        "under verbatimModuleSyntax a value import here is a value import in the emitted JS",
    ).toEqual([]);
  });

  test("every built entry is an empty JavaScript module", () => {
    expect(built).toBe(true);
    const fat: string[] = [];
    const files = [
      ...PROVIDERS.map((provider) => join(DIST, "providers", provider, "types.js")),
      join(DIST, "types", "index.js"),
    ];
    for (const file of files) {
      if (!existsSync(file)) {
        fat.push(`${file} was not emitted — add it to tsdown.config.ts`);
        continue;
      }
      const bytes = statSync(file).size;
      if (bytes > EMPTY_JS_BUDGET_BYTES) {
        fat.push(`${file} is ${bytes} B — a types entry must emit no runtime`);
        continue;
      }
      const text = readFileSync(file, "utf8");
      if (/\bexport\b/.test(text)) fat.push(`${file} still exports a runtime binding: ${text.trim()}`);
    }
    expect(fat).toEqual([]);
  });
});

describe("packaging", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    exports: Record<string, { types: string; default: string }>;
  };
  const tsdown = readFileSync(join(ROOT, "tsdown.config.ts"), "utf8");

  test("every types entry has an exports subpath pointing at its build output", () => {
    const problems: string[] = [];
    const expected: Array<[string, string]> = [
      ["./types", "types/index"],
      ...PROVIDERS.map(
        (provider): [string, string] => [`./${provider}/types`, `providers/${provider}/types`],
      ),
    ];
    for (const [subpath, out] of expected) {
      const entry = pkg.exports[subpath];
      if (entry === undefined) {
        problems.push(`package.json exports is missing "${subpath}"`);
        continue;
      }
      if (entry.types !== `./dist/${out}.d.ts` || entry.default !== `./dist/${out}.js`) {
        problems.push(`package.json "${subpath}" points at ${JSON.stringify(entry)}`);
      }
      if (!tsdown.includes(`"${out}": "src/${out}.ts"`)) {
        problems.push(`tsdown.config.ts has no entry for ${out}`);
      }
    }
    expect(problems).toEqual([]);
    expect(expected.length).toBe(PROVIDERS.length + 1);
  });

  test("no types subpath is declared for a provider that has none", () => {
    const declared = Object.keys(pkg.exports).filter(
      (key) => key.endsWith("/types") && key !== "./types",
    );
    expect(declared.length).toBe(PROVIDERS.length);
    for (const key of declared) {
      const provider = key.slice(2, -"/types".length);
      expect(PROVIDERS, `exports declares "${key}"`).toContain(provider);
    }
  });
});
