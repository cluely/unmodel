import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CHAT_MODEL_REFS } from "../src/catalog/chat-refs-values.gen";

/**
 * The guarantees behind `unmodel/<provider>/values`, `unmodel/values` and
 * `unmodel/values/chat-refs`.
 *
 * The mirror of `test/types-entries.test.ts`, and the promises are the mirror
 * image too. A types entry promises to cost *nothing*; a values entry cannot —
 * its whole product is bytes a browser runs. So what it promises instead is
 * that the bytes are the ones you asked for, and that they are the same bytes
 * the validator uses:
 *
 *  1. **Complete.** Every provider with a unified adapter has a values entry,
 *     and that entry names the uniform `<CATEGORY>_MODEL_PARAMS` /
 *     `<CATEGORY>_MODELS` alias for every category it serves. A new adapter
 *     lands in `src/providers/<p>/unified*.ts` and nowhere else, so without
 *     this the entry silently falls one category behind on the day it ships.
 *  2. **Identical, not equal.** `values.TTS_MODEL_PARAMS` is `===` the object
 *     the adapter compiles with. A *copy* would type-check, would deep-equal on
 *     the day it was written, and would drift — which is the failure this
 *     library exists to make impossible, so it is asserted by reference.
 *  3. **Light.** Importing one export from a values entry costs that export,
 *     not that provider. This is the promise a client-side app is actually
 *     buying, it is invisible to `tsc` and to every other test, and it is
 *     defeated by a single re-export from a module that happens to build a zod
 *     schema at the top level. Measured with a real tree-shaking build against
 *     a real `dist/`, per export.
 *  4. **Packaged.** An entry with no `exports` key and no tsdown entry is a
 *     file that compiles here and 404s for everyone who installs the package.
 *
 * `test/import-graph.test.ts` (amendment A9) asserts the source-level rule that
 * makes (3) hold; this file asserts the consequence in bytes.
 */

const ROOT = resolve(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const PROVIDERS_DIR = join(ROOT, "src", "providers");

/**
 * The 47 providers that ship a values entry: exactly those with a unified
 * adapter.
 *
 * Enumerated rather than only derived, so that a provider *losing* its entry
 * fails here instead of making the sweep below vacuous. The derived set is
 * compared against it in the first test — a new adapter has to be typed out
 * here, which is the point.
 */
const PROVIDERS_WITH_VALUES: readonly string[] = [
  "alibaba",
  "assemblyai",
  "black-forest-labs",
  "breezeblue",
  "bria",
  "bytedance",
  "cartesia",
  "deepgram",
  "elevenlabs",
  "fal",
  "fish-audio",
  "gladia",
  "google",
  "heygen",
  "hume",
  "ideogram",
  "inworld",
  "kling",
  "krea",
  "leonardo",
  "lightricks",
  "lmnt",
  "luma",
  "minimax",
  "mistral",
  "mureka",
  "murf",
  "openai",
  "pixverse",
  "recraft",
  "resemble",
  "revai",
  "reve",
  "rime",
  "runway",
  "smallest-ai",
  "soniox",
  "speechify",
  "speechmatics",
  "stability",
  "stepfun",
  "sync",
  "topaz",
  "tripo3d",
  "veed",
  "vidu",
  "xai",
];

/** `"imageEdit"` → `"IMAGE_EDIT"`; every other category is its own name upper-cased. */
const CATEGORY_PREFIX: Readonly<Record<string, string>> = {
  image: "IMAGE",
  imageEdit: "IMAGE_EDIT",
  video: "VIDEO",
  lipsync: "LIPSYNC",
  avatar: "AVATAR",
  upscale: "UPSCALE",
  // The one category whose prefix is not its id upper-cased, and it cannot be:
  // `3D_MODEL_PARAMS` is not a JavaScript identifier. `THREE_D` is the same
  // spelling the `threeD` verb, the generated `FAL_THREE_D_*` constants and the
  // `three-d-*.gen.ts` file names use, for the same reason.
  "3d": "THREE_D",
  tts: "TTS",
  stt: "STT",
  music: "MUSIC",
  voiceClone: "VOICE_CLONE",
  voiceDesign: "VOICE_DESIGN",
};

const PROVIDERS: string[] = readdirSync(PROVIDERS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/** `unified.ts` / `unified-<category>.ts` — the adapter leaves, per provider. */
function adapterFilesOf(provider: string): string[] {
  return readdirSync(join(PROVIDERS_DIR, provider))
    // `[a-z0-9-]`, not `[a-z-]`: `unified-3d.ts` is a category leaf and the
    // category id starts with a digit.
    .filter((name) => /^unified(-[a-z0-9-]+)?\.ts$/.test(name))
    .sort();
}

/** Every provider with at least one adapter leaf that actually exports one. */
const DERIVED_PROVIDERS: string[] = PROVIDERS.filter((provider) =>
  adapterFilesOf(provider).some((file) =>
    /^\s*category: "/m.test(readFileSync(join(PROVIDERS_DIR, provider, file), "utf8")),
  ),
).sort();

interface Adapter {
  provider: string;
  module: string;
  category: string;
  models: readonly string[];
  modelParams: object;
  /** `tts` only — how that provider hands the audio back. */
  delivery: unknown;
}

/** Loads every adapter object a provider exports, across its leaves. */
async function adaptersOf(provider: string): Promise<Adapter[]> {
  const found: Adapter[] = [];
  for (const file of adapterFilesOf(provider)) {
    const module = (await import(join(PROVIDERS_DIR, provider, file))) as Record<string, unknown>;
    for (const value of Object.values(module)) {
      if (typeof value !== "object" || value === null) continue;
      const candidate = value as { category?: unknown; modelParams?: unknown; models?: unknown };
      if (typeof candidate.category !== "string" || typeof candidate.modelParams !== "object") {
        continue;
      }
      found.push({
        provider,
        module: file,
        category: candidate.category,
        models: candidate.models as readonly string[],
        modelParams: candidate.modelParams as object,
        delivery: (candidate as { delivery?: unknown }).delivery,
      });
    }
  }
  return found;
}

const valuesSource = (provider: string): string =>
  readFileSync(join(PROVIDERS_DIR, provider, "values.ts"), "utf8");

// The suite builds on demand, the same arrangement test/bundle-budget.test.ts
// and test/types-entries.test.ts use — `dist/` is gitignored and CI runs
// `bun test` before `bun run build`.
const built =
  existsSync(join(DIST, "values", "index.js")) ||
  (await $`bun run build`.quiet().then(() => true));

// ---------------------------------------------------------------------------
// 1. Complete
// ---------------------------------------------------------------------------

describe("values entries exist, one per provider with an adapter", () => {
  test("the enumerated list is exactly the set of providers with an adapter", () => {
    expect(DERIVED_PROVIDERS).toEqual([...PROVIDERS_WITH_VALUES]);
    // A rule that scans an empty set passes by saying nothing.
    expect(PROVIDERS_WITH_VALUES.length).toBe(47);
  });

  test("every one of them ships a values.ts, and no other provider does", () => {
    const withFile = PROVIDERS.filter((provider) =>
      existsSync(join(PROVIDERS_DIR, provider, "values.ts")),
    );
    expect(withFile).toEqual([...PROVIDERS_WITH_VALUES]);
  });

  test("the hub and the chat-ref entry exist", () => {
    expect(existsSync(join(ROOT, "src", "values", "index.ts"))).toBe(true);
    expect(existsSync(join(ROOT, "src", "values", "chat-refs.ts"))).toBe(true);
  });

  test("a chat-only overlay gets no entry — this is not an every-provider rule", () => {
    for (const provider of ["anthropic", "groq", "openrouter", "cohere", "azure"]) {
      expect(PROVIDERS, `${provider} is not a provider`).toContain(provider);
      expect(existsSync(join(PROVIDERS_DIR, provider, "values.ts"))).toBe(false);
    }
  });
});

describe("completeness — every category an adapter serves has its uniform alias", () => {
  test("src/providers/<p>/values.ts names <CATEGORY>_MODEL_PARAMS and <CATEGORY>_MODELS", async () => {
    const missing: string[] = [];
    let categories = 0;
    for (const provider of PROVIDERS_WITH_VALUES) {
      const source = valuesSource(provider);
      for (const adapter of await adaptersOf(provider)) {
        categories += 1;
        const prefix = CATEGORY_PREFIX[adapter.category];
        if (prefix === undefined) {
          missing.push(`${provider}: unknown category "${adapter.category}"`);
          continue;
        }
        for (const suffix of ["MODEL_PARAMS", "MODELS"]) {
          if (!new RegExp(`\\b${prefix}_${suffix}\\b`).test(source)) {
            missing.push(
              `${provider}.${adapter.category}: values.ts exports no ${prefix}_${suffix}. ` +
                "Every category an adapter serves gets one uniform alias — re-export the " +
                `adapter's own table from ./${adapter.module.replace(/^unified-?/, "").replace(/\.ts$/, "") || "…"}-params.`,
            );
          }
        }
      }
    }
    expect(missing).toEqual([]);
    // 67 adapters across the 45 providers today — fal alone brings ten, which
    // is more categories than any other provider serves. A floor, so the sweep
    // cannot go vacuous if `adaptersOf` ever stops finding them.
    expect(categories).toBeGreaterThanOrEqual(66);
  });

  test("the built declaration exports them too, so the promise survives the build", () => {
    expect(built).toBe(true);
    const missing: string[] = [];
    for (const provider of PROVIDERS_WITH_VALUES) {
      const declaration = join(DIST, "providers", provider, "values.d.ts");
      if (!existsSync(declaration)) {
        missing.push(`${provider}: dist/providers/${provider}/values.d.ts was not emitted`);
        continue;
      }
      const text = readFileSync(declaration, "utf8");
      if (!/_MODEL_PARAMS\b/.test(text)) missing.push(`${provider}: declaration names no table`);
    }
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Identical, not equal
// ---------------------------------------------------------------------------

describe("identity — the published table IS the adapter's table", () => {
  test("values.<CAT>_MODEL_PARAMS === adapter.modelParams, by reference", async () => {
    const drift: string[] = [];
    let checked = 0;
    for (const provider of PROVIDERS_WITH_VALUES) {
      const values = (await import(join(PROVIDERS_DIR, provider, "values.ts"))) as Record<
        string,
        unknown
      >;
      for (const adapter of await adaptersOf(provider)) {
        const prefix = CATEGORY_PREFIX[adapter.category] as string;
        checked += 1;
        if (values[`${prefix}_MODEL_PARAMS`] !== adapter.modelParams) {
          drift.push(
            `${provider}.${adapter.category}: ${prefix}_MODEL_PARAMS is not the adapter's own ` +
              "object. A copy deep-equals today and drifts tomorrow — re-export the same const.",
          );
        }
        if (values[`${prefix}_MODELS`] !== adapter.models) {
          drift.push(`${provider}.${adapter.category}: ${prefix}_MODELS is not the adapter's array`);
        }
      }
    }
    expect(drift).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(61);
  });

  test("every model id in <CAT>_MODELS has a row in <CAT>_MODEL_PARAMS", async () => {
    // The two aliases are published side by side and a picker reads them
    // together: iterate the ids, look up the row. A model in one and not the
    // other is a runtime `undefined` in that loop.
    const gaps: string[] = [];
    for (const provider of PROVIDERS_WITH_VALUES) {
      for (const adapter of await adaptersOf(provider)) {
        const rows = adapter.modelParams as Record<string, unknown>;
        for (const id of adapter.models) {
          if (!Object.hasOwn(rows, id)) gaps.push(`${provider}.${adapter.category}: ${id}`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  test("the format specs are the adapter's own too", async () => {
    // 16 of the 58 adapters carry an `AudioFormatSpec`; it is the only place a
    // caller can learn which sample rates and bitrates a codec is legal at, so
    // it is published — and by reference, for the reason above.
    let found = 0;
    const drift: string[] = [];
    for (const provider of PROVIDERS_WITH_VALUES) {
      const values = (await import(join(PROVIDERS_DIR, provider, "values.ts"))) as Record<
        string,
        unknown
      >;
      for (const name of ["TTS_FORMAT_SPEC", "MUSIC_FORMAT_SPEC"]) {
        const spec = values[name];
        if (spec === undefined) continue;
        found += 1;
        const leaf = name === "TTS_FORMAT_SPEC" ? "tts-params.ts" : "music-params.ts";
        const module = (await import(join(PROVIDERS_DIR, provider, leaf))) as Record<
          string,
          unknown
        >;
        if (module["FORMAT"] !== spec) drift.push(`${provider}: ${name} is not ./${leaf}'s FORMAT`);
        const shape = spec as { codecs?: unknown };
        if (typeof shape.codecs !== "object") drift.push(`${provider}: ${name} has no codecs map`);
      }
    }
    expect(drift).toEqual([]);
    expect(found).toBe(19);
  });

  test("the speech delivery descriptors are the adapter's own too", async () => {
    // All 15 `tts` adapters declare how the audio comes back — a fact about the
    // *response*, which is why it sits on the adapter rather than on a per-model
    // row: five of the fifteen change it per request. The entry publishes it
    // under one uniform name, by reference, for the reason above.
    // By object rather than by row: a provider whose `unified.ts` re-exports
    // the adapter its `unified-tts.ts` declares is found through both leaves,
    // and it is one descriptor either way.
    const found = new Set<unknown>();
    const drift: string[] = [];
    for (const provider of PROVIDERS_WITH_VALUES) {
      const values = (await import(join(PROVIDERS_DIR, provider, "values.ts"))) as Record<
        string,
        unknown
      >;
      for (const adapter of await adaptersOf(provider)) {
        if (adapter.category !== "tts") continue;
        if (adapter.delivery === undefined) {
          drift.push(`${provider}: the tts adapter declares no delivery`);
          continue;
        }
        found.add(adapter.delivery);
        if (values["TTS_DELIVERY"] !== adapter.delivery) {
          drift.push(`${provider}: TTS_DELIVERY is not the adapter's own object`);
        }
      }
    }
    expect(drift).toEqual([]);
    expect(found.size).toBe(19);
  });
});

describe("the never-published lists are published now", () => {
  /**
   * The nine `as const` lists that existed, were exported from their module,
   * and were reachable from no public subpath at all — the audit's own list.
   * Every other standalone list in the repo was already on its provider's
   * barrel; these were the stragglers, and a values entry is where they belong
   * (a size list is not a validator).
   */
  const STRAGGLERS: ReadonlyArray<[string, string]> = [
    ["openai", "GPT_IMAGE_2_SIZES"],
    ["openai", "GPT_IMAGE_1_SIZE_VALUES"],
    ["openai", "DALL_E_3_SIZE_VALUES"],
    ["openai", "DALL_E_2_SIZE_VALUES"],
    ["black-forest-labs", "BFL_ASPECT_RATIOS"],
    ["kling", "DURATIONS_3_15"],
    ["kling", "DURATIONS_3_10"],
    ["kling", "DURATIONS_5_10"],
    ["runway", "SEEDANCE2_SMALL_RATIOS"],
  ];

  test("each is exported from its provider's values entry, as an array", async () => {
    const missing: string[] = [];
    for (const [provider, name] of STRAGGLERS) {
      const values = (await import(join(PROVIDERS_DIR, provider, "values.ts"))) as Record<
        string,
        unknown
      >;
      const value = values[name];
      if (!Array.isArray(value)) {
        missing.push(`${provider}/values does not export ${name} as an array`);
        continue;
      }
      if (value.length === 0) missing.push(`${provider}/values exports an EMPTY ${name}`);
    }
    expect(missing).toEqual([]);
    expect(STRAGGLERS.length).toBe(9);
  });

  test("…and they are still the module's own array, not a copy", async () => {
    const sources: Readonly<Record<string, string>> = {
      GPT_IMAGE_2_SIZES: "openai/images-shared.ts",
      GPT_IMAGE_1_SIZE_VALUES: "openai/images-shared.ts",
      DALL_E_3_SIZE_VALUES: "openai/images-shared.ts",
      DALL_E_2_SIZE_VALUES: "openai/images-shared.ts",
      BFL_ASPECT_RATIOS: "black-forest-labs/aspect.ts",
      DURATIONS_3_15: "kling/shared.ts",
      DURATIONS_3_10: "kling/shared.ts",
      DURATIONS_5_10: "kling/shared.ts",
      SEEDANCE2_SMALL_RATIOS: "runway/constraints.ts",
    };
    const drift: string[] = [];
    for (const [provider, name] of STRAGGLERS) {
      const values = (await import(join(PROVIDERS_DIR, provider, "values.ts"))) as Record<
        string,
        unknown
      >;
      const origin = (await import(join(PROVIDERS_DIR, sources[name] as string))) as Record<
        string,
        unknown
      >;
      if (values[name] !== origin[name]) drift.push(`${name}: not ${sources[name]}'s array`);
    }
    expect(drift).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The hub
// ---------------------------------------------------------------------------

describe("unmodel/values — the canonical hub", () => {
  test("it publishes the ten canonical arrays, and each is non-empty and unique", async () => {
    const hub = (await import(join(ROOT, "src", "values", "index.ts"))) as Record<string, unknown>;
    const expected: Readonly<Record<string, number>> = {
      ASPECT_RATIO_PRESETS: 9,
      RESOLUTION_TIERS: 3,
      VIDEO_RESOLUTIONS: 5,
      IMAGE_OUTPUT_FORMATS: 3,
      OUTPUT_DELIVERIES: 2,
      AUDIO_FORMAT_CODECS: 11,
      AUDIO_CONTAINERS: 8,
      TIMESTAMP_GRANULARITIES: 4,
      AUDIO_INPUT_KINDS: 4,
      TTS_DELIVERY_KINDS: 5,
    };
    const problems: string[] = [];
    for (const [name, size] of Object.entries(expected)) {
      const value = hub[name];
      if (!Array.isArray(value)) {
        problems.push(`${name} is not an array`);
        continue;
      }
      if (value.length !== size) problems.push(`${name} has ${value.length} members, expected ${size}`);
      if (new Set(value).size !== value.length) problems.push(`${name} repeats a member`);
    }
    expect(problems).toEqual([]);
  });

  test("CANONICAL_KEY_LISTS is the object the kernel checks against", async () => {
    const hub = (await import(join(ROOT, "src", "values", "index.ts"))) as Record<string, unknown>;
    const kernel = (await import(join(ROOT, "src", "core", "unified", "canonical-keys.ts"))) as
      Record<string, unknown>;
    expect(hub["CANONICAL_KEY_LISTS"]).toBe(kernel["CANONICAL_KEY_LISTS"]);
    expect(Object.keys(hub["CANONICAL_KEY_LISTS"] as object).sort()).toEqual([
      // Sorted, so the digit leads.
      "3d",
      "avatar",
      "image",
      "imageEdit",
      "lipsync",
      "music",
      "stt",
      "tts",
      "upscale",
      "video",
      "voiceClone",
      "voiceDesign",
    ]);
    // The four youngest categories, written out: five words each, and the
    // words that DIFFER between them are the whole reason they are four
    // categories. A rename here is a breaking change to the request shape, so
    // it has to be typed in a diff.
    const lists = hub["CANONICAL_KEY_LISTS"] as Record<string, readonly string[]>;
    expect(lists["lipsync"]).toEqual(["model", "source", "audio", "seed", "providerOptions"]);
    expect(lists["avatar"]).toEqual(["model", "image", "audio", "seed", "providerOptions"]);
    expect(lists["upscale"]).toEqual(["model", "source", "factor", "prompt", "providerOptions"]);
    // `upscale` shares `source` with lipsync and NOTHING else: no `audio`, no
    // `seed`, and a `factor` that appears nowhere else in the library. That is
    // the shape of a category that is genuinely its own rather than an arm of
    // `imageEdit` — whose own list has `size` and `aspectRatio`, both absolute
    // where this one is a multiplier.
    expect(lists["upscale"]).not.toContain("size");
    expect(lists["upscale"]).not.toContain("aspectRatio");
    expect(lists["imageEdit"]).not.toContain("factor");
    expect(lists["3d"]).toEqual(["model", "prompt", "image", "seed", "providerOptions"]);
    // `3d` is the first category whose two content words are ALTERNATIVES: a
    // route reads `prompt` or `image`, and the row says which. It carries no
    // sizing word of any kind — a mesh has no frame — and no `n`, because these
    // routes return one object per request. `format` is deliberately absent:
    // the output container has five spellings across the two witnesses and one
    // of them is a separate HTTP call.
    for (const absent of ["size", "aspectRatio", "resolution", "n", "format", "texture"]) {
      expect(lists["3d"]).not.toContain(absent);
    }
  });

  test("CHAT_PROVIDERS is unmodel/chat's own array, not a second copy", async () => {
    const hub = (await import(join(ROOT, "src", "values", "index.ts"))) as Record<string, unknown>;
    const refs = (await import(join(ROOT, "src", "chat", "refs.ts"))) as Record<string, unknown>;
    expect(hub["CHAT_PROVIDERS"]).toBe(refs["CHAT_PROVIDERS"]);
    expect((hub["CHAT_PROVIDERS"] as readonly string[]).length).toBe(32);
  });

  test("the hub does NOT carry the 1,339 chat refs — they are their own subpath", async () => {
    const hub = (await import(join(ROOT, "src", "values", "index.ts"))) as Record<string, unknown>;
    expect(hub["CHAT_MODEL_REFS"]).toBeUndefined();
    const entry = (await import(join(ROOT, "src", "values", "chat-refs.ts"))) as Record<
      string,
      unknown
    >;
    expect(entry["CHAT_MODEL_REFS"]).toBe(CHAT_MODEL_REFS);
  });
});

describe("CHAT_MODEL_REFS — the generated runtime twin", () => {
  test("it is complete, unique, and sorted exactly like the union", () => {
    expect(CHAT_MODEL_REFS.length).toBeGreaterThanOrEqual(1_000);
    expect(new Set(CHAT_MODEL_REFS).size).toBe(CHAT_MODEL_REFS.length);
    // Sorted by provider, then by model id — the order `chatScope` emits, and
    // the order `chat-refs.gen.ts` writes the union in. A picker groups by the
    // first segment, so a provider appearing twice is a visible bug.
    const seen = new Set<string>();
    let previous = "";
    const problems: string[] = [];
    for (const ref of CHAT_MODEL_REFS) {
      const slash = ref.indexOf("/");
      expect(slash, `${ref} has no provider segment`).toBeGreaterThan(0);
      const provider = ref.slice(0, slash);
      const model = ref.slice(slash + 1);
      if (provider !== previous) {
        if (seen.has(provider)) problems.push(`${provider} appears in two runs`);
        seen.add(provider);
        previous = provider;
      } else if (model < (CHAT_MODEL_REFS[CHAT_MODEL_REFS.indexOf(ref) - 1] as string).slice(slash + 1)) {
        problems.push(`${ref} is out of order`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("every ref names a provider CHAT_PROVIDERS declares", async () => {
    const refs = (await import(join(ROOT, "src", "chat", "refs.ts"))) as {
      CHAT_PROVIDERS: readonly string[];
    };
    const providers = new Set(refs.CHAT_PROVIDERS);
    const unknown = [
      ...new Set(CHAT_MODEL_REFS.map((ref) => ref.slice(0, ref.indexOf("/")))),
    ].filter((provider) => !providers.has(provider));
    expect(unknown).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Light — measured against a real build
// ---------------------------------------------------------------------------

/**
 * What one export costs, shaken.
 *
 * The measurement a client-side app actually experiences: an entry module that
 * re-exports one name from `dist/`, bundled with tree-shaking on and `zod`
 * external, exactly as an application bundler would. It is the only thing that
 * catches the failure this layout exists to prevent — a values entry
 * re-exporting from a module that builds a zod schema at the top level, which
 * no bundler can drop and which costs 30–80 KiB per import.
 *
 * Unminified, so the numbers are comparable with every other budget in this
 * repo (and so the prose that ships in an ESM build is counted honestly).
 */
/**
 * A scratch directory OUTSIDE this package, and a bundler run OUTSIDE this
 * process.
 *
 * Both are load-bearing, and both were found by a measurement that lied.
 * Calling `Bun.build` from a test file that lives inside this repo resolves
 * `dist/`'s own chunk specifiers against this package's `exports` map and fails
 * to find them; writing the probe inside `dist/` instead picks up
 * `"sideEffects": false` and yields an empty module — a budget that passes by
 * measuring nothing. A consumer's bundler runs in *their* tree over our
 * published files, so that is what this reproduces: a runner script in a temp
 * directory, spawned once for every probe in the suite.
 */
const PROBE_DIR = mkdtempSync(join(tmpdir(), "unmodel-values-budget-"));

const RUNNER = `
import { readFileSync } from "node:fs";
const jobs = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = {};
for (const { id, entry, name } of jobs) {
  const probe = process.argv[3] + "/probe-" + id + ".mjs";
  await Bun.write(probe, "export { " + name + " } from " + JSON.stringify(entry) + ";\\n");
  const result = await Bun.build({
    entrypoints: [probe],
    format: "esm",
    minify: false,
    external: ["zod"],
    target: "browser",
  });
  if (!result.success) throw new Error(id + ": " + result.logs.join("\\n"));
  let bytes = 0;
  for (const output of result.outputs) bytes += (await output.arrayBuffer()).byteLength;
  out[id] = bytes / 1024;
}
console.log(JSON.stringify(out));
`;

interface Job {
  id: string;
  entry: string;
  name: string;
}

/**
 * What each export costs, shaken — the whole batch in one spawned bundler.
 *
 * The measurement a client-side app actually experiences: a module that
 * re-exports one name from `dist/`, bundled with tree-shaking on and `zod`
 * external, exactly as an application bundler would. It is the only thing that
 * catches the failure this layout exists to prevent — a values entry
 * re-exporting from a module that builds a zod schema at the top level, which
 * no bundler can drop and which costs 30–80 KiB per import.
 *
 * Unminified, so the numbers are comparable with every other budget in this
 * repo (and so the prose that ships in an ESM build is counted honestly).
 */
async function shakenKiB(jobs: readonly Job[]): Promise<Record<string, number>> {
  const runner = join(PROBE_DIR, "runner.mjs");
  const manifest = join(PROBE_DIR, "jobs.json");
  await Bun.write(runner, RUNNER);
  await Bun.write(manifest, JSON.stringify(jobs));
  const result = await $`bun ${runner} ${manifest} ${PROBE_DIR}`.quiet();
  return JSON.parse(result.stdout.toString()) as Record<string, number>;
}

/** The names a built entry re-exports. */
function exportsOf(file: string): string[] {
  const names = new Set<string>();
  for (const match of readFileSync(file, "utf8").matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of (match[1] as string).split(",")) {
      const trimmed = part.trim();
      if (trimmed === "") continue;
      const renamed = trimmed.split(/\s+as\s+/);
      names.add((renamed[1] ?? renamed[0] ?? "").trim());
    }
  }
  return [...names].filter(Boolean).sort();
}

const FROM_IMPORT = /^[ \t]*(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']/gm;

/** Total bytes of an entry chunk plus every chunk it statically pulls in. */
function graphKiB(entry: string): number {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(FROM_IMPORT)) {
      const specifier = match[1] as string;
      if (!specifier.startsWith(".")) continue;
      visit(resolve(dirname(file), specifier));
    }
  };
  visit(entry);
  return [...seen].reduce((total, file) => total + statSync(file).size, 0) / 1024;
}

describe("bundle discipline", () => {
  /**
   * **30 KiB per export**, against a worst measured 19.4 (runway's video model
   * lists, which sit beside that provider's 22 hand-written ratio and
   * resolution tables in one import-free leaf). The ceiling is deliberately not
   * "the worst plus a bit": the number that matters is the one below which a
   * dragged validator cannot hide, and a validator is 30–80 KiB. Before the
   * `<category>-params.ts` split this suite forced, the same measurement over
   * the adapters read 29–82 KiB with a median of 39.
   */
  const EXPORT_BUDGET_KIB = 30;

  /**
   * The whole entry's chunk graph.
   *
   * **Bumped 70 → 120 by fal's wave 1d**: 107.1 KiB measured, against 40.9 for
   * openai, the fattest of the hand-written providers. fal is not one vendor's
   * value lists — it is 140 curated endpoints across nine categories, and this
   * entry publishes every one of their per-endpoint narrowing rows: nine Kokoro
   * voice arrays, an 87-member Gemini language map, a 99-member Wizper one, and
   * ten upscale rows with two media between them.
   *
   * Which is the entry doing its job rather than failing it — the whole point
   * of `unmodel/<p>/values` is a picker that renders the endpoint's OWN
   * vocabulary — and the invariants that matter are asserted above and unmoved:
   * no zod, no validators, no catalog, and the same objects the adapters
   * compile with rather than copies of them.
   *
   * **Bumped 120 → 140 by wave 3**: 125.6 KiB measured, the tenth category's
   * nineteen endpoint rows — Trellis 2's thirty sampler parameters and Meshy's
   * twenty among them.
   */
  const ENTRY_BUDGET_KIB = 140;

  /** The hub is nine short arrays and two re-exports. 15.6 KiB of chunk graph. */
  const HUB_ENTRY_BUDGET_KIB = 20;

  /** …of which any single export shakes to at most 1.5 KiB (CANONICAL_KEY_LISTS). */
  const HUB_EXPORT_BUDGET_KIB = 3;

  /** 1,339 refs: 48.4 KiB of chunk, 49.2 shaken. Pinned so a refresh is visible. */
  const CHAT_REFS_BUDGET_KIB = 58;

  test("the build is present, so the budgets below assert something", () => {
    expect(built).toBe(true);
    for (const provider of PROVIDERS_WITH_VALUES) {
      expect(existsSync(join(DIST, "providers", provider, "values.js")), provider).toBe(true);
    }
    expect(existsSync(join(DIST, "values", "index.js"))).toBe(true);
    expect(existsSync(join(DIST, "values", "chat-refs.js"))).toBe(true);
  });

  test(`no single export from a provider entry costs more than ${EXPORT_BUDGET_KIB} KiB`, async () => {
    const jobs: Job[] = [];
    for (const provider of PROVIDERS_WITH_VALUES) {
      const entry = join(DIST, "providers", provider, "values.js");
      const names = exportsOf(entry);
      expect(names.length, `${provider}/values exports nothing`).toBeGreaterThan(0);
      for (const name of names) jobs.push({ id: `${provider}#${name}`, entry, name });
    }
    const sizes = await shakenKiB(jobs);
    const over: string[] = [];
    let measured = 0;
    let fattest = 0;
    for (const [id, kib] of Object.entries(sizes)) {
      measured += 1;
      fattest = Math.max(fattest, kib);
      if (kib > EXPORT_BUDGET_KIB) over.push(`${id} is ${kib.toFixed(1)} KiB`);
    }
    expect(
      over,
      "a values export that costs this much is re-exporting from a module with a top-level " +
        "side effect — a zod schema, a `createValidator(…)` call or a generated catalog. Move " +
        "the list to an import-free leaf and re-export it from there, the way " +
        "`google/image-constraints.ts` and the `<category>-params.ts` leaves do.",
    ).toEqual([]);
    expect(measured).toBeGreaterThanOrEqual(250);
    // …and the measurement is not vacuously zero. A probe that resolves nothing
    // reports ~0.03 KiB for every export and this budget then proves nothing,
    // which is precisely the trap the note on `PROBE_DIR` describes.
    expect(fattest, "every export measured as empty — the probe is not resolving").toBeGreaterThan(5);
  }, 180_000);

  test(`every provider entry's chunk graph stays under ${ENTRY_BUDGET_KIB} KiB`, () => {
    const over: string[] = [];
    for (const provider of PROVIDERS_WITH_VALUES) {
      const kib = graphKiB(join(DIST, "providers", provider, "values.js"));
      if (kib > ENTRY_BUDGET_KIB) over.push(`${provider}: ${kib.toFixed(1)} KiB`);
    }
    expect(over).toEqual([]);
  });

  test("no values entry's graph reaches a generated catalog or a pipeline", () => {
    // The two shapes that would blow the numbers above without any single
    // export looking suspicious. Named rather than left to the byte count,
    // because "why is this 300 KiB" is a much worse diff to read.
    const REGION = /^\/\/#region (src\/.+)$/gm;
    const leaks: string[] = [];
    for (const provider of [...PROVIDERS_WITH_VALUES, "__hub"]) {
      const entry =
        provider === "__hub"
          ? join(DIST, "values", "index.js")
          : join(DIST, "providers", provider, "values.js");
      const modules = new Set<string>();
      const seen = new Set<string>();
      const visit = (file: string): void => {
        if (seen.has(file)) return;
        seen.add(file);
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(REGION)) modules.add(match[1] as string);
        for (const match of text.matchAll(FROM_IMPORT)) {
          const specifier = match[1] as string;
          if (specifier.startsWith(".")) visit(resolve(dirname(file), specifier));
        }
      };
      visit(entry);
      for (const module of modules) {
        if (/^src\/catalog\/.*\.gen\.ts$/.test(module) && module !== "src/catalog/chat-refs-values.gen.ts") {
          leaks.push(`${provider}: ${module}`);
        }
        if (module === "src/core/pipeline.ts") leaks.push(`${provider}: ${module}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  test(`the hub stays under ${HUB_ENTRY_BUDGET_KIB} KiB, and any one of its exports under ${HUB_EXPORT_BUDGET_KIB}`, async () => {
    const entry = join(DIST, "values", "index.js");
    const kib = graphKiB(entry);
    expect(kib, `values/index is ${kib.toFixed(1)} KiB`).toBeLessThanOrEqual(HUB_ENTRY_BUDGET_KIB);

    const names = exportsOf(entry);
    expect(names).toContain("ASPECT_RATIO_PRESETS");
    const sizes = await shakenKiB(names.map((name) => ({ id: name, entry, name })));
    const over: string[] = [];
    for (const [name, size] of Object.entries(sizes)) {
      if (size > HUB_EXPORT_BUDGET_KIB) over.push(`values#${name} is ${size.toFixed(1)} KiB`);
    }
    expect(
      over,
      "the hub is nine short arrays; an export this expensive means the 1,339 chat refs, or a " +
        "provider, got in",
    ).toEqual([]);
  }, 60_000);

  test(`the chat-ref entry is the ONLY place the 1,339 refs live, and costs under ${CHAT_REFS_BUDGET_KIB} KiB`, async () => {
    const kib = graphKiB(join(DIST, "values", "chat-refs.js"));
    expect(kib, `values/chat-refs is ${kib.toFixed(1)} KiB`).toBeLessThanOrEqual(
      CHAT_REFS_BUDGET_KIB,
    );
    const entry = join(DIST, "values", "chat-refs.js");
    const shaken = (await shakenKiB([{ id: "refs", entry, name: "CHAT_MODEL_REFS" }]))[
      "refs"
    ] as number;
    expect(shaken).toBeLessThanOrEqual(CHAT_REFS_BUDGET_KIB);
    // …and it really is the expensive one, so the split is not decorative.
    expect(shaken).toBeGreaterThan(HUB_EXPORT_BUDGET_KIB * 10);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// 4. Packaged
// ---------------------------------------------------------------------------

describe("packaging", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    exports: Record<string, { types: string; default: string }>;
  };
  const tsdown = readFileSync(join(ROOT, "tsdown.config.ts"), "utf8");

  test("every values entry has an exports subpath pointing at its build output", () => {
    const problems: string[] = [];
    const expected: Array<[string, string]> = [
      ["./values", "values/index"],
      ["./values/chat-refs", "values/chat-refs"],
      ...PROVIDERS_WITH_VALUES.map(
        (provider): [string, string] => [`./${provider}/values`, `providers/${provider}/values`],
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
    expect(expected.length).toBe(PROVIDERS_WITH_VALUES.length + 2);
  });

  test("no values subpath is declared for a provider that has none", () => {
    const declared = Object.keys(pkg.exports).filter(
      (key) => key.endsWith("/values") && key !== "./values",
    );
    expect(declared.length).toBe(PROVIDERS_WITH_VALUES.length);
    for (const key of declared) {
      const provider = key.slice(2, -"/values".length);
      expect(PROVIDERS_WITH_VALUES, `exports declares "${key}"`).toContain(provider);
    }
  });
});

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe("a values entry is values", () => {
  test("every one exports at least one runtime binding — none is a types file", () => {
    const empty: string[] = [];
    const files = [
      ...PROVIDERS_WITH_VALUES.map((provider) => `src/providers/${provider}/values.ts`),
      "src/values/index.ts",
      "src/values/chat-refs.ts",
    ];
    for (const file of files) {
      const source = readFileSync(join(ROOT, file), "utf8");
      // `export {` but not `export type {` — the mirror of the types entries'
      // rule, and the failure it catches is the same one in reverse: an entry
      // that quietly became free by exporting only types.
      const runtime = [...source.matchAll(/^export\s*\{/gm)].length;
      if (runtime === 0) empty.push(`${file} exports no runtime binding`);
      if (/^export\s+type\s/m.test(source)) {
        empty.push(`${file} exports a type — a values entry publishes values; types are at /types`);
      }
    }
    expect(empty).toEqual([]);
  });

  test("the built JavaScript is not empty", () => {
    expect(built).toBe(true);
    const thin: string[] = [];
    for (const file of [
      ...PROVIDERS_WITH_VALUES.map((provider) => join(DIST, "providers", provider, "values.js")),
      join(DIST, "values", "index.js"),
      join(DIST, "values", "chat-refs.js"),
    ]) {
      if (!existsSync(file)) {
        thin.push(`${file} was not emitted — add it to tsdown.config.ts`);
        continue;
      }
      const text = readFileSync(file, "utf8");
      if (!/\bexport\b/.test(text)) thin.push(`${file} exports nothing at run time`);
    }
    expect(thin).toEqual([]);
  });
});
