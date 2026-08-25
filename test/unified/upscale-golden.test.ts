/**
 * The golden matrix for `unmodel/upscale`: one canonical request, compiled by
 * each ref, with the exact wire params committed to disk.
 *
 * The second tree in the library with **no `lossy-` case in it**, and — like
 * `unmodel/lipsync` — that is a property of the category rather than a gap in
 * the fixtures. There is nothing here to approximate: a multiplier is a number
 * the endpoint takes or refuses, a source is a reference either way, and a
 * prompt is a string. The one place an approximation could have crept in is
 * `factor` at `fal-ai/aura-sr`, whose only legal value is 4 — and that is an
 * `invalid_enum_value` rather than a snap, which is exactly what keeps this
 * tree clean.
 *
 * Same four assertions as every other golden tree otherwise: the body is exact,
 * the transport is exact, a non-`lossy-` case compiles with zero warnings, and
 * a `lossy-` case would commit every warning it produced.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { upscale } from "../../src/unified/upscale";

const GOLDEN = join(import.meta.dir, "golden", "upscale");

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
  headers: Record<string, string>;
  /** Required on `lossy-*` cases, forbidden elsewhere. */
  warnings?: ExpectedWarning[];
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

test("the upscale golden tree is present", () => {
  // A vacuous suite passes by asserting nothing; this is the guard against it.
  expect(caseDirs.length).toBeGreaterThanOrEqual(6);
});

describe.each(caseDirs)("golden upscale/%s", (name) => {
  const dir = join(GOLDEN, name);
  const canonical = readJson<Record<string, unknown>>(join(dir, "canonical.json"));
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".json") && file !== "canonical.json")
    .sort();
  const lossy = name.startsWith("lossy-");

  test("the case names at least one ref", () => {
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  describe.each(files)("%s", (file) => {
    const fixture = readJson<Fixture>(join(dir, file));
    const request = { ...canonical, model: fixture.ref };

    test("compiles to the committed wire body, url and headers", () => {
      const result = upscale.safe(request as never);
      expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
      if (!result.ok) return;
      const params = result.params as unknown as {
        request: { url: string; headers: Record<string, string> };
      };
      // JSON round-trip: the enumerable properties ARE the body, which is the
      // property being asserted, so compare what `JSON.stringify` sees.
      expect(JSON.parse(JSON.stringify(result.params))).toEqual(fixture.params);
      expect(params.request.url).toBe(fixture.url);
      expect(params.request.headers).toEqual(fixture.headers);
    });

    test(lossy ? "reports exactly the committed warnings" : "maps exactly (no warnings)", () => {
      const result = upscale.safe(request as never);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const warnings = (result.params as unknown as { warnings: readonly ExpectedWarning[] })
        .warnings;
      expect(comparable(warnings)).toEqual(comparable(fixture.warnings ?? []));
      if (!lossy) expect(warnings).toEqual([]);
      // A golden request names a real model, so the issue channel is empty.
      expect(result.warnings).toEqual([]);
    });

    test("the route selector never reaches the wire, whichever kind it is", () => {
      // At fal the selector is unmodel's own `endpoint` pseudo-param and must
      // be stripped; at Topaz the URL is chosen from the model and `model` is a
      // real form field that must SURVIVE. Two opposite facts, one assertion
      // each, because getting either backwards produces a 4xx.
      expect(Object.keys(fixture.params)).not.toContain("endpoint");
      if (fixture.ref.startsWith("fal/")) {
        expect(fixture.url).toBe(`https://queue.fal.run/${fixture.ref.slice("fal/".length)}`);
        expect(Object.keys(fixture.params)).not.toContain("model");
        expect(fixture.headers).toEqual({ "content-type": "application/json" });
        return;
      }
      const model = fixture.ref.slice(fixture.ref.indexOf("/") + 1);
      expect(fixture.params["model"]).toBe(model);
      expect(fixture.url).toMatch(/^https:\/\/api\.topazlabs\.com\/image\/v1\/enhance(-gen)?\/async$/);
      // Topaz's submit paths declare only `multipart/form-data`, so the headers
      // are EMPTY on purpose: `fetch` derives the boundary from the FormData and
      // a hand-set content-type would break the request. Post
      // `topaz.toFormData(params)`, never `JSON.stringify`.
      expect(fixture.headers).toEqual({});
    });
  });
});

describe("the matrix itself", () => {
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
    expect([...cases.keys()].sort()).toEqual([...upscale.providers]);
  });

  /**
   * The assertion with teeth at an aggregator: "every provider is covered" is a
   * much weaker claim when one provider id is ten endpoints. This one says half
   * the roster is compiled somewhere, across four different vendors.
   */
  test("the matrix covers at least half the roster, across four vendors", () => {
    const refs = new Set(all.map((entry) => entry.fixture.ref));
    expect(refs.size).toBeGreaterThanOrEqual(5);
    for (const family of ["clarity", "topaz", "seedvr", "esrgan"]) {
      expect([...refs].some((ref) => ref.includes(family)), family).toBe(true);
    }
  });

  /**
   * Both media, committed. This is the fact that separates the category from
   * `unmodel/image-edit`, and it is read off the fixtures rather than asserted
   * in prose: some case somewhere has to send a `video_url`.
   */
  test("the tree exercises both source shapes", () => {
    const keys = new Set(all.flatMap(({ fixture }) => Object.keys(fixture.params)));
    expect(keys.has("image_url")).toBe(true);
    expect(keys.has("video_url")).toBe(true);
  });

  test("nothing in this category is lossy, and the tree says so", () => {
    expect(caseDirs.filter((name) => name.startsWith("lossy-"))).toEqual([]);
    const withWarnings = all
      .filter((entry) => (entry.fixture.warnings ?? []).length > 0)
      .map((entry) => entry.name);
    expect(withWarnings).toEqual([]);
  });

  /**
   * Inline bytes become a `data:` URI, and the media type in it is the one the
   * caller stated — read off the committed body rather than asserted in prose.
   */
  test("the inline-bytes case commits a real data: URI", () => {
    const fixtures = all.filter((entry) => entry.name === "inline-bytes");
    expect(fixtures.length).toBeGreaterThanOrEqual(1);
    for (const { fixture } of fixtures) {
      expect(fixture.params["image_url"]).toBe("data:image/png;base64,AAECAwQF");
    }
  });

  /**
   * The multiplier reaches the wire under the name that endpoint uses, and the
   * two spellings are both committed somewhere.
   */
  test("both factor spellings are committed", () => {
    const keys = new Set(all.flatMap(({ fixture }) => Object.keys(fixture.params)));
    expect(keys.has("upscale_factor")).toBe(true);
    expect(keys.has("scale")).toBe(true);
  });

  /**
   * The assertion this tree exists for now that the category has two providers,
   * and the one a "every provider is covered" check cannot make: the same
   * REQUEST, compiled two ways, producing two different bodies at two different
   * hosts.
   *
   * `described/` is the case both can serve, because `prompt` is the one
   * canonical word they share — and even there they agree on nothing else. fal
   * names the source `image_url` and posts JSON to its queue; Topaz names it
   * `source_url`, keeps the model in the body, and posts a form.
   */
  test("the same prompted request compiles differently through each provider", () => {
    const viaFal = all.find((c) => c.name === "described" && c.fixture.ref.startsWith("fal/"));
    const natively = all.find((c) => c.name === "described" && c.fixture.ref.startsWith("topaz/"));
    expect(viaFal, "described/ needs a fal fixture").toBeDefined();
    expect(natively, "described/ needs a topaz fixture").toBeDefined();
    if (viaFal === undefined || natively === undefined) return;

    expect(viaFal.fixture.params).not.toEqual(natively.fixture.params);
    expect(viaFal.fixture.params["prompt"]).toBe(natively.fixture.params["prompt"]);
    expect(Object.keys(viaFal.fixture.params)).toContain("image_url");
    expect(Object.keys(natively.fixture.params)).toContain("source_url");
    expect(viaFal.fixture.headers).toEqual({ "content-type": "application/json" });
    expect(natively.fixture.headers).toEqual({});
  });

  /**
   * `factor` is committed at fal and committed NOWHERE at Topaz, because Topaz
   * has no multiplier on either route — it states an absolute output size. Read
   * off the fixtures rather than asserted in prose.
   */
  test("no Topaz fixture carries a multiplier, at either spelling", () => {
    const topaz = all.filter(({ fixture }) => fixture.ref.startsWith("topaz/"));
    expect(topaz.length).toBeGreaterThanOrEqual(2);
    for (const { fixture } of topaz) {
      expect(Object.keys(fixture.params)).not.toContain("upscale_factor");
      expect(Object.keys(fixture.params)).not.toContain("scale");
      expect(Object.keys(fixture.params)).not.toContain("factor");
    }
  });
});
