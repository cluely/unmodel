/**
 * The golden matrix for `unmodel/image`: **one canonical request, compiled by
 * every provider that can express it**, with each provider's exact wire params
 * committed to disk.
 *
 * Each directory under `golden/image/` is one request. `canonical.json` holds
 * the words a caller writes; every other file is one provider's answer —
 * `{ ref, params, url, warnings?, issues? }`. Unlike the speech matrix there is
 * no per-provider field to carry: a prompt and a shape mean the same thing
 * everywhere, which is the whole reason this category has a single canonical
 * `canonical.json` per case and nothing else.
 *
 * Four things are asserted, and the third is the one that earns the layout:
 *
 * 1. **The body is exact.** Deep equality against the committed JSON, not a
 *    subset match — a param that appears out of nowhere fails just as loudly as
 *    one that goes missing.
 * 2. **The route is exact.** `url` is committed too, because at five of these
 *    providers the model *is* the route: `black-forest-labs/flux-2-pro` and
 *    `flux-pro-1.1-ultra` differ only in a URL, and so do stability's three
 *    generate routes, ideogram's two, reve's two and kling's two. A body
 *    assertion alone would let a ref quietly compile to the wrong endpoint.
 * 3. **Lossless means lossless.** Every case that is not `lossy-*` must compile
 *    with `warnings.length === 0` at *every* provider in it. That is what makes
 *    "zero warnings means the request mapped exactly" an assertion rather than
 *    a slogan.
 * 4. **Lossy means exactly this much loss.** A `lossy-*` case commits every
 *    warning (code + path + meta), so a translation that starts approximating
 *    something new fails the build instead of quietly degrading.
 *
 * `issues` is the one field the speech matrix does not have, and it exists
 * because two of these providers ship catalogs with retired models on them:
 * every Imagen 4 id is announced for shutdown, so a google fixture carries a
 * `deprecated_model` **issue** warning. That is a different channel from a
 * translation warning — it says nothing about what compiling cost — so it is
 * pinned separately rather than folded in, and a case that grows an unexpected
 * one still fails.
 *
 * The cases are chosen so that every *sizing class* in `derive.ts` is covered
 * by some fixture:
 *
 * | class | function | where |
 * |---|---|---|
 * | S1 | `toRatioEnum` | google, stability, luma, kling, vidu, bria, krea, reve, recraft, ideogram 3.0, runway |
 * | S2 | `toPixels` | black-forest-labs, leonardo |
 * | S3 | `toSizeEnum` | openai (dall-e / gpt-image-1), ideogram 4.0 |
 * | S4 | `toSizeFreeform` | openai (gpt-image-2), bytedance |
 * | S5 | `toRatioString` | black-forest-labs' ultra route (`ratio-21x9`) |
 * | S6 | `toTier` | google, bria, kling, vidu, krea, bytedance, runway |
 * | — | `pixelsToRatio` | every fixture in `lossy-dimensions-to-shape` |
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { image } from "../../src/unified/image";

const GOLDEN = join(import.meta.dir, "golden", "image");

interface ExpectedWarning {
  code: string;
  path: Array<string | number>;
  meta?: Record<string, unknown>;
}

interface Fixture {
  /** `"provider/model"`, the ref this fixture's request is pointed at. */
  ref: string;
  /** The exact enumerable wire body. */
  params: Record<string, unknown>;
  url: string;
  /** Translation warnings. Required on `lossy-*` cases, forbidden elsewhere. */
  warnings?: ExpectedWarning[];
  /** Issue-space warnings (`deprecated_model`, …) — a different channel. */
  issues?: Array<{ code: string; path: Array<string | number> }>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** The three fields a warning is pinned on — the message is prose, not a contract. */
function comparable(warnings: readonly { code: string; path: unknown; meta?: unknown }[]) {
  return warnings.map((w) => ({ code: w.code, path: w.path, meta: w.meta }));
}

const caseDirs = readdirSync(GOLDEN, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

test("the image golden tree is present", () => {
  // A vacuous suite passes by asserting nothing; this is the guard against it.
  expect(caseDirs.length).toBeGreaterThanOrEqual(10);
});

describe.each(caseDirs)("golden image/%s", (name) => {
  const dir = join(GOLDEN, name);
  const canonical = readJson<Record<string, unknown>>(join(dir, "canonical.json"));
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".json") && file !== "canonical.json")
    .sort();
  const lossy = name.startsWith("lossy-");

  test("the case names at least one provider", () => {
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  describe.each(files)("%s", (file) => {
    const fixture = readJson<Fixture>(join(dir, file));
    const request = { ...canonical, model: fixture.ref };

    test("compiles to the committed wire body and route", () => {
      const result = image.safe(request as never);
      expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
      if (!result.ok) return;

      const params = result.params as unknown as { request: { url: string } };
      // JSON round-trip: the enumerable properties ARE the fetch body, which is
      // the property being asserted, so compare what `JSON.stringify` sees.
      expect(JSON.parse(JSON.stringify(result.params))).toEqual(fixture.params);
      expect(params.request.url).toBe(fixture.url);
    });

    test(lossy ? "reports exactly the committed warnings" : "maps exactly (no warnings)", () => {
      const result = image.safe(request as never);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const warnings = (result.params as unknown as { warnings: readonly ExpectedWarning[] })
        .warnings;
      expect(comparable(warnings)).toEqual(comparable(fixture.warnings ?? []));
      if (!lossy) expect(warnings).toEqual([]);
      // Issue-space warnings are a separate channel with a separate meaning;
      // pinned, so a new one cannot arrive unnoticed and a retired model
      // cannot quietly stop being announced as one.
      expect(
        result.warnings.map((issue) => ({ code: String(issue.code), path: issue.path })),
      ).toEqual(fixture.issues ?? []);
    });
  });
});

describe("the matrix itself", () => {
  /** Every fixture in the tree, with the case it belongs to. */
  const all = caseDirs.flatMap((name) =>
    readdirSync(join(GOLDEN, name))
      .filter((file) => file.endsWith(".json") && file !== "canonical.json")
      .map((file) => ({ name, fixture: readJson<Fixture>(join(GOLDEN, name, file)) })),
  );

  test("every provider in the pack appears in at least two cases", () => {
    const cases = new Map<string, Set<string>>();
    for (const { name, fixture } of all) {
      const provider = fixture.ref.slice(0, fixture.ref.indexOf("/"));
      const seen = cases.get(provider) ?? new Set<string>();
      seen.add(name);
      cases.set(provider, seen);
    }
    const thin = [...cases.entries()]
      .filter(([, seen]) => seen.size < 2)
      .map(([provider]) => provider);
    expect(thin).toEqual([]);
    expect([...cases.keys()].sort()).toEqual([...image.providers]);
  });

  test("a lossy case is lossy somewhere, and a lossless one is committed lossless", () => {
    for (const name of caseDirs) {
      const fixtures = all.filter((entry) => entry.name === name).map((entry) => entry.fixture);
      const warnings = fixtures.flatMap((fixture) => fixture.warnings ?? []);
      if (name.startsWith("lossy-")) expect(warnings.length).toBeGreaterThan(0);
      else expect(fixtures.every((fixture) => fixture.warnings === undefined)).toBe(true);
    }
  });

  /**
   * The routes, not just the bodies. Five providers here dispatch on the model
   * id inside `compile`, and a dispatch that picked the wrong sibling would
   * still produce a plausible body — so the URL set each provider reaches is
   * pinned as a set.
   */
  test("the multi-route providers reach every route they dispatch to", () => {
    const urls = new Map<string, Set<string>>();
    for (const { fixture } of all) {
      const provider = fixture.ref.slice(0, fixture.ref.indexOf("/"));
      const seen = urls.get(provider) ?? new Set<string>();
      seen.add(fixture.url);
      urls.set(provider, seen);
    }
    // black-forest-labs: the model IS the route, so every ref is its own URL.
    expect([...(urls.get("black-forest-labs") ?? [])].sort()).toEqual([
      "https://api.bfl.ai/v1/flux-2-pro",
      "https://api.bfl.ai/v1/flux-pro-1.1",
      "https://api.bfl.ai/v1/flux-pro-1.1-ultra",
    ]);
    // ideogram: a 3.0 ref and a 4.0 ref are two different endpoints.
    expect([...(urls.get("ideogram") ?? [])].sort()).toEqual([
      "https://api.ideogram.ai/v1/ideogram-v3/generate",
      "https://api.ideogram.ai/v1/ideogram-v4/generate",
    ]);
  });
});
