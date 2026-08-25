/**
 * The golden matrix for `unmodel/lipsync`: one canonical request, compiled by
 * each ref, with the exact wire params committed to disk.
 *
 * The smallest matrix in the library and — uniquely — one with **no `lossy-`
 * case in it**, which is a property of the category rather than a gap in the
 * fixtures. Every other golden tree has one: image approximates a ratio into
 * pixels, video snaps a duration onto an enum, tts rounds a speed. This
 * category has nothing to approximate. A clip is a reference, a track is a
 * reference, and a seed is an integer; there is no unit to convert and no enum
 * to snap onto, so a lipsync request either maps exactly or is refused. The
 * "no lossy case" assertion at the bottom is that claim made executable — the
 * day a lipsync route grows a knob that has to be approximated, it fails and
 * someone writes the fixture.
 *
 * Same four assertions as every other golden tree otherwise: the body is exact,
 * the transport is exact, a non-`lossy-` case compiles with zero warnings, and
 * a `lossy-` case would commit every warning it produced.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lipsync } from "../../src/unified/lipsync";

const GOLDEN = join(import.meta.dir, "golden", "lipsync");

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

test("the lipsync golden tree is present", () => {
  // A vacuous suite passes by asserting nothing; this is the guard against it.
  expect(caseDirs.length).toBeGreaterThanOrEqual(4);
});

describe.each(caseDirs)("golden lipsync/%s", (name) => {
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
      const result = lipsync.safe(request as never);
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
      const result = lipsync.safe(request as never);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const warnings = (result.params as unknown as { warnings: readonly ExpectedWarning[] })
        .warnings;
      expect(comparable(warnings)).toEqual(comparable(fixture.warnings ?? []));
      if (!lossy) expect(warnings).toEqual([]);
      // A golden request names a real model, so the issue channel is empty.
      expect(result.warnings).toEqual([]);
    });

    test("`endpoint` never reaches the wire", () => {
      // fal's route selector is unmodel's, not fal's — the committed body is
      // the exact fetch payload, and this is the one key that must not be in
      // it however the request was written.
      expect(Object.keys(fixture.params)).not.toContain("endpoint");
      expect(fixture.url).toBe(`https://queue.fal.run/${fixture.ref.slice("fal/".length)}`);
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
    expect([...cases.keys()].sort()).toEqual([...lipsync.providers]);
  });

  /**
   * fal serves eight endpoints behind one provider id, so "every provider is
   * covered" is a much weaker claim here than in the other trees. This is the
   * assertion with teeth: at least half the roster is compiled somewhere in the
   * matrix, including one endpoint from each vendor family.
   */
  test("the matrix covers at least half the roster, across four vendors", () => {
    const refs = new Set(all.map((entry) => entry.fixture.ref));
    expect(refs.size).toBeGreaterThanOrEqual(4);
    for (const family of ["sync-lipsync", "veed", "latentsync", "kling-video"]) {
      expect([...refs].some((ref) => ref.includes(family)), family).toBe(true);
    }
  });

  /**
   * The category has nothing to approximate — see the module header. This
   * asserts it rather than assuming it: no committed fixture carries a warning,
   * and no case dir is named `lossy-`.
   */
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
   * fal takes every file input as a reference and never as multipart, so this
   * is the only way bytes reach it.
   */
  test("the inline-bytes case commits real data: URIs on both media fields", () => {
    const fixtures = all.filter((entry) => entry.name === "inline-bytes");
    expect(fixtures.length).toBeGreaterThanOrEqual(1);
    for (const { fixture } of fixtures) {
      expect(fixture.params["video_url"]).toBe("data:video/mp4;base64,AAECAwQF");
      expect(fixture.params["audio_url"]).toBe("data:audio/wav;base64,BgcICQoL");
    }
  });
});
