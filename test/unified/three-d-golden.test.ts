/**
 * The golden matrix for `unmodel/3d`: one canonical request, compiled by each
 * ref, with the exact wire params committed to disk.
 *
 * The first golden tree in the library with **two providers of genuinely
 * different kinds** in it — an aggregator's resale and the vendor's own API —
 * and the `prompt-only` and `image-only` cases are where that pays: the same
 * Tripo model appears twice in each, once as `fal/tripo3d/h3.1/…` and once as
 * `tripo3d/v3.1-20260211`, and the two committed bodies are visibly different
 * objects. That difference is the category's argument, made in fixtures.
 *
 * **No `lossy-` case**, and like `lipsync` and `upscale` that is a property of
 * the category rather than a gap. There is nothing here to approximate: a
 * prompt is a string, an image is a reference, a seed is an integer. The one
 * place an approximation could have crept in is the multiview route, whose
 * extra angles the canonical `image` has no word for — and that is handled by
 * curating the route that REQUIRES two views out entirely rather than by
 * silently sending one.
 *
 * Four assertions per fixture otherwise, as in every other golden tree: the
 * body is exact, the transport is exact, a non-`lossy-` case compiles with zero
 * warnings, and a `lossy-` case would commit every warning it produced.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { threeD } from "../../src/unified/3d";

const GOLDEN = join(import.meta.dir, "golden", "3d");

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

test("the 3d golden tree is present", () => {
  // A vacuous suite passes by asserting nothing; this is the guard against it.
  expect(caseDirs.length).toBeGreaterThanOrEqual(5);
});

describe.each(caseDirs)("golden 3d/%s", (name) => {
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
      const result = threeD.safe(request as never);
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
      const result = threeD.safe(request as never);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const warnings = (result.params as unknown as { warnings: readonly ExpectedWarning[] })
        .warnings;
      expect(comparable(warnings)).toEqual(comparable(fixture.warnings ?? []));
      if (!lossy) expect(warnings).toEqual([]);
      // A golden request names a real model, so the issue channel is empty.
      expect(result.warnings).toEqual([]);
    });

    test("the route selector never reaches the wire, whichever kind of route it is", () => {
      // At fal the selector is unmodel's own `endpoint` pseudo-param and must
      // be stripped; at Tripo the selector is the URL itself and `model` is a
      // real body field that must SURVIVE. Two opposite facts, one assertion
      // each, because getting either backwards produces a 4xx.
      expect(Object.keys(fixture.params)).not.toContain("endpoint");
      if (fixture.ref.startsWith("fal/")) {
        expect(fixture.url).toBe(`https://queue.fal.run/${fixture.ref.slice("fal/".length)}`);
        expect(Object.keys(fixture.params)).not.toContain("model");
      } else {
        expect(fixture.params["model"]).toBe(fixture.ref.slice(fixture.ref.indexOf("/") + 1));
      }
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
    expect([...cases.keys()].sort()).toEqual([...threeD.providers]);
  });

  /**
   * The assertion this tree exists for, and the one a "every provider is
   * covered" check cannot make: the SAME MODEL, compiled two ways, producing
   * two different bodies. If fal's adapter and Tripo's ever converged — say by
   * one of them acquiring the other's field names — this is where it would
   * show, because the two objects would stop differing.
   */
  test("the same Tripo model compiles differently through each provider", () => {
    const viaFal = all.find((c) => c.fixture.ref === "fal/tripo3d/h3.1/text-to-3d");
    const viaTripo = all.find(
      (c) => c.name === "prompt-only" && c.fixture.ref === "tripo3d/v3.1-20260211",
    );
    expect(viaFal).toBeDefined();
    expect(viaTripo).toBeDefined();
    expect(viaFal?.fixture.params).not.toEqual(viaTripo?.fixture.params);
    // fal's body has no `model` (the endpoint IS the model); Tripo's does.
    expect(Object.keys(viaFal?.fixture.params ?? {})).not.toContain("model");
    expect(viaTripo?.fixture.params["model"]).toBe("v3.1-20260211");
  });

  test("the matrix covers four of the seven vendors fal resells here", () => {
    const vendors = new Set(
      all
        .filter((c) => c.fixture.ref.startsWith("fal/"))
        .map((c) => c.fixture.ref.slice("fal/".length).split("/")[0] as string),
    );
    expect(vendors.size).toBeGreaterThanOrEqual(4);
  });

  test("both image shapes are compiled somewhere — a bare string and a LIST", () => {
    const bodies = all.map((c) => c.fixture.params);
    expect(bodies.some((b) => Array.isArray(b["image_urls"]))).toBe(true);
    expect(bodies.some((b) => typeof b["image_url"] === "string")).toBe(true);
    expect(bodies.some((b) => typeof b["input_image_url"] === "string")).toBe(true);
    expect(bodies.some((b) => typeof b["front_image_url"] === "string")).toBe(true);
    // …and Tripo's own polymorphic single string.
    expect(bodies.some((b) => typeof b["input"] === "string")).toBe(true);
  });
});
