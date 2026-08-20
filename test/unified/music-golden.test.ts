/**
 * The golden matrix for `unmodel/music`: **one canonical request, compiled by
 * both providers**, with each one's exact wire params committed to disk.
 *
 * The smallest matrix in the library, and the one with the sharpest single
 * assertion in it: `durationSeconds: 90` is `music_length_ms: 90000` at
 * ElevenLabs and `duration: 90` at Stability. That factor of a thousand is the
 * whole reason the canonical word carries its unit, and `duration-90s` is where
 * it stops being a claim — if the conversion ever drifted, one provider would
 * quietly generate a ninety-*millisecond* track and bill for the attempt.
 *
 * Same four assertions as every other golden tree: the body is exact, the
 * transport is exact (ElevenLabs puts the encoding in the query string,
 * Stability in a form field), a non-`lossy-` case compiles with zero warnings,
 * and a `lossy-` case commits every warning it does produce.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { music } from "../../src/unified/music";

const GOLDEN = join(import.meta.dir, "golden", "music");

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

test("the music golden tree is present", () => {
  // A vacuous suite passes by asserting nothing; this is the guard against it.
  expect(caseDirs.length).toBeGreaterThanOrEqual(4);
});

describe.each(caseDirs)("golden music/%s", (name) => {
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

    test("compiles to the committed wire body, url and headers", () => {
      const result = music.safe(request as never);
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
      const result = music.safe(request as never);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const warnings = (result.params as unknown as { warnings: readonly ExpectedWarning[] })
        .warnings;
      expect(comparable(warnings)).toEqual(comparable(fixture.warnings ?? []));
      if (!lossy) expect(warnings).toEqual([]);
      // A golden request names a real model, so the issue channel is empty.
      expect(result.warnings).toEqual([]);
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
    expect([...cases.keys()].sort()).toEqual([...music.providers]);
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
   * The conversion, read off the committed bodies rather than asserted in
   * prose — 90 seconds, two units, one canonical word.
   */
  test("the same duration is committed in both units", () => {
    const durations = new Map<string, unknown>();
    for (const { name, fixture } of all) {
      if (name !== "duration-90s") continue;
      const body = fixture.params;
      durations.set(
        fixture.ref.slice(0, fixture.ref.indexOf("/")),
        body["music_length_ms"] ?? body["duration"],
      );
    }
    expect(durations.get("elevenlabs")).toBe(90000);
    expect(durations.get("stability")).toBe(90);
  });
});
