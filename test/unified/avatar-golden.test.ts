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

    test("the route selector never reaches the wire, whichever kind it is", () => {
      // Four providers, four answers, and getting any of them backwards is a
      // 4xx rather than a wrong picture:
      //
      // | provider | selector | where it ends up |
      // |---|---|---|
      // | fal | `endpoint`, unmodel's own pseudo-param | the URL, stripped from the body |
      // | sync. | `model`, a real body field | the body, at ONE url for the whole provider |
      // | VEED | none | the PATH is the model |
      // | HeyGen | `mode` / `engine.type`, real body fields | the body, under a different name from the id |
      expect(Object.keys(fixture.params)).not.toContain("endpoint");
      const provider = fixture.ref.slice(0, fixture.ref.indexOf("/"));
      const model = fixture.ref.slice(fixture.ref.indexOf("/") + 1);
      if (provider === "fal") {
        expect(fixture.url).toBe(`https://queue.fal.run/${model}`);
        return;
      }
      if (provider === "sync") {
        expect(fixture.params["model"]).toBe(model);
        expect(fixture.url).toBe("https://api.sync.so/v2/generate");
        return;
      }
      if (provider === "veed") {
        // The id is the last path segment, and there is no selector in the body
        // at all — the smallest possible answer to "which model".
        expect(fixture.params["model"]).toBeUndefined();
        expect(fixture.url).toBe(`https://api.veed.io/v1/${model}`);
        return;
      }
      expect(provider).toBe("heygen");
      // One url per CATEGORY, and the id is spelled differently on the wire
      // from the way a ref spells it: `lipsync-speed` becomes `mode: "speed"`
      // and `avatar_iv` becomes `engine: { type: "avatar_iv" }`.
      expect(fixture.params["model"]).toBeUndefined();
      expect(fixture.url.startsWith("https://api.heygen.com/v3/")).toBe(true);
      const mode = fixture.params["mode"];
      const engine = fixture.params["engine"] as { type?: string } | undefined;
      expect(mode === undefined ? engine?.type : `lipsync-${String(mode)}`).toBe(model);
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
   * Every committed body carries the voice track, whichever kind of route it is
   * — the one canonical word this category cannot do without. Where it LANDS is
   * a provider fact: a flat `audio_url` at fal, an `{ type: "audio" }` item in
   * the `input` array at sync.
   */
  test("every case commits the voice track, at whichever coordinate", () => {
    for (const { name, fixture } of all) {
      const provider = fixture.ref.slice(0, fixture.ref.indexOf("/"));
      if (provider === "sync") {
        // The one provider where the track is an ITEM in a tagged array rather
        // than a field: `input[]` is what carries several voices, `refId`s,
        // `segments` and dubbing.
        const input = fixture.params["input"] as ReadonlyArray<{ type: string; url?: string }>;
        const track = input.find((item) => item.type === "audio");
        expect(track?.url, name).toBeString();
        continue;
      }
      // fal, VEED and HeyGen all spell it `audio_url`, and at HeyGen that is
      // itself a finding: the neighbouring `image` field on the SAME request is
      // a tagged object with three arms, and the track is a bare string with
      // one.
      expect(fixture.params["audio_url"], name).toBeString();
    }
  });

  /**
   * The whole argument for the clip/still split, committed rather than
   * described: the two sync. fixtures in this tree name the SAME model id as
   * the ones in `golden/lipsync/`, hit the SAME url, and differ only in the tag
   * on the first input item.
   */
  test("the sync. fixtures differ from their lipsync twins by one tag", () => {
    const natively = all.filter(({ fixture }) => fixture.ref.startsWith("sync/"));
    expect(natively.length).toBeGreaterThanOrEqual(2);
    for (const { name, fixture } of natively) {
      expect(fixture.ref, name).toBe("sync/sync-3");
      expect(fixture.url, name).toBe("https://api.sync.so/v2/generate");
      const input = fixture.params["input"] as ReadonlyArray<{ type: string }>;
      expect(input[0]?.type, name).toBe("image");
    }
  });
});
