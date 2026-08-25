/**
 * The golden matrix for `unmodel/avatar`: one canonical request, compiled by
 * each ref, with the exact wire params committed to disk.
 *
 * Two cases, and they are the two the category is defined by. `minimal-url` is
 * the still-driven shape — a picture, a track, and nothing else — and
 * `preset-performer` is the other kind entirely: `veed/avatars/audio-to-video`
 * animates a catalogued presenter and has NO image field, so its canonical
 * request has no `image` in it at all and names the presenter through the
 * escape hatch. A committed body is the clearest possible statement that those
 * are two different requests to one category.
 *
 * Like its lipsync twin, this tree has **no `lossy-` case**, and for the same
 * reason: there is no unit to convert and no enum to snap onto here. The
 * assertion at the bottom makes that a check rather than a claim.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { avatar } from "../../src/unified/avatar";

const GOLDEN = join(import.meta.dir, "golden", "avatar");

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

test("the avatar golden tree is present", () => {
  // A vacuous suite passes by asserting nothing; this is the guard against it.
  expect(caseDirs.length).toBeGreaterThanOrEqual(2);
});

describe.each(caseDirs)("golden avatar/%s", (name) => {
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
      const result = avatar.safe(request as never);
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
      const result = avatar.safe(request as never);
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
    expect([...cases.keys()].sort()).toEqual([...avatar.providers]);
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
   * Every committed body carries the voice track, whichever kind of route it
   * is — the one canonical word this category cannot do without.
   */
  test("every case commits an audio_url", () => {
    for (const { name, fixture } of all) {
      expect(fixture.params["audio_url"], name).toBeString();
    }
  });
});
