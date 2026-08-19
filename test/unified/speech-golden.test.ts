/**
 * The golden matrix for `unmodel/speech`: **one canonical request, compiled by
 * every provider that can express it**, with each provider's exact wire params
 * committed to disk.
 *
 * Each directory under `golden/speech/` is one request. `canonical.json` holds
 * the words a caller writes; every other file is one provider's answer —
 * `{ ref, voice, params, url, headers, warnings? }`. The voice lives in the
 * per-provider file rather than in the canonical one because a voice id is the
 * single canonical field that genuinely cannot be shared: `"marin"` means
 * nothing to Cartesia and `"694f9389-…"` means nothing to OpenAI.
 *
 * Four things are asserted, and the third is the one that earns the layout:
 *
 * 1. **The body is exact.** Deep equality against the committed JSON, not a
 *    subset match — a param that appears out of nowhere fails just as loudly as
 *    one that goes missing.
 * 2. **The transport is exact.** `url` and `headers` are committed too, because
 *    at five of these providers the interesting half of the request is not in
 *    the body: ElevenLabs puts the format in the query string, Deepgram puts
 *    *everything* there, Fish Audio puts the model in a header and Rime puts
 *    the container in `Accept`.
 * 3. **Lossless means lossless.** Every case that is not `lossy-*` must compile
 *    with `warnings.length === 0` at *every* provider in it. That is what makes
 *    "zero warnings means the request mapped exactly" an assertion rather than
 *    a slogan.
 * 4. **Lossy means exactly this much loss.** A `lossy-*` case commits every
 *    warning (code + path + meta), so a translation that starts approximating
 *    something new fails the build instead of quietly degrading.
 *
 * The cases are chosen so that every audio-format *shape* is covered — a bare
 * codec (OpenAI, Murf, Hume), a composite string (ElevenLabs, Speechify), an
 * object (Cartesia, MiniMax), query params (Deepgram) and an `Accept` header
 * (Rime) — and so that both speed inversions appear: Rime's `timeScaleFactor`
 * on Coda and its `speedAlpha` on Mist v2, which are the same reciprocal in two
 * different fields.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { speech } from "../../src/unified/speech";

const GOLDEN = join(import.meta.dir, "golden", "speech");

interface ExpectedWarning {
  code: string;
  path: Array<string | number>;
  meta?: Record<string, unknown>;
}

interface Fixture {
  /** `"provider/model"`, the ref this fixture's request is pointed at. */
  ref: string;
  /** The provider-specific voice id or name; see the note above. */
  voice?: string;
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

test("the speech golden tree is present", () => {
  // A vacuous suite passes by asserting nothing; this is the guard against it.
  expect(caseDirs.length).toBeGreaterThanOrEqual(6);
});

describe.each(caseDirs)("golden speech/%s", (name) => {
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
    const request = {
      ...canonical,
      model: fixture.ref,
      ...(fixture.voice !== undefined && { voice: fixture.voice }),
    };

    test("compiles to the committed wire body, url and headers", () => {
      const result = speech.safe(request as never);
      expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
      if (!result.ok) return;

      const params = result.params as unknown as {
        request: { url: string; headers: Record<string, string> };
      };
      // JSON round-trip: the enumerable properties ARE the fetch body, which is
      // the property being asserted, so compare what `JSON.stringify` sees.
      expect(JSON.parse(JSON.stringify(result.params))).toEqual(fixture.params);
      expect(params.request.url).toBe(fixture.url);
      expect(params.request.headers).toEqual(fixture.headers);
    });

    test(lossy ? "reports exactly the committed warnings" : "maps exactly (no warnings)", () => {
      const result = speech.safe(request as never);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const warnings = (result.params as unknown as { warnings: readonly ExpectedWarning[] })
        .warnings;
      expect(comparable(warnings)).toEqual(comparable(fixture.warnings ?? []));
      if (!lossy) expect(warnings).toEqual([]);
      // Issue-space warnings (unknown_model and friends) are a separate
      // channel; a golden request names a real model, so there are none.
      expect(result.warnings).toEqual([]);
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
    expect([...cases.keys()].sort()).toEqual([...speech.providers]);
  });

  test("a lossy case is lossy somewhere, and a lossless one is committed lossless", () => {
    for (const name of caseDirs) {
      const fixtures = all.filter((entry) => entry.name === name).map((entry) => entry.fixture);
      const warnings = fixtures.flatMap((fixture) => fixture.warnings ?? []);
      if (name.startsWith("lossy-")) expect(warnings.length).toBeGreaterThan(0);
      else expect(fixtures.every((fixture) => fixture.warnings === undefined)).toBe(true);
    }
  });
});
