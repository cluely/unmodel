/**
 * The golden matrix for `unmodel/sts`: shared canonical words compiled by both
 * providers, with each one's exact wire params committed to disk.
 *
 * ## Why `audio` and `voice` live in the per-provider file
 *
 * The voice-clone tree's arrangement, for the same reason and one word wider.
 * `audio` is a `Blob`, which JSON cannot hold, so it uses that tree's `"@blob"`
 * sentinel in both directions and each fixture names its own. `voice` is here
 * too and the reason is sharper: a voice ID is not portable — an ElevenLabs
 * handle means nothing to Hume and vice versa — so a shared `canonical.json`
 * with one `voice` in it would be a request no second provider could honestly
 * answer.
 *
 * What is left in `canonical.json` is therefore `outputFormat` and the extras,
 * which IS the interesting half: the two vendors spell the encoding in
 * genuinely different value spaces (a `codec_rate_bitrate` composite in a query
 * string, a `{ type }` object in a form part) and the matrix is where that is
 * pinned rather than described.
 *
 * ## The whole category is multipart
 *
 * Every fixture's `headers` is `{}` — deliberately, and it is the same fact at
 * both providers: `fetch` must derive the multipart boundary from the FormData
 * body, so a `content-type` header set by unmodel would break the request.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sts } from "../../src/unified/sts";

const GOLDEN = join(import.meta.dir, "golden", "sts");

/** The stand-in for a `Blob` in a fixture, in both directions (stt's sentinel). */
const BLOB_SENTINEL = "@blob";
const BLOB_BYTES = new Uint8Array(64);
const BLOB_TYPE = "audio/wav";

interface ExpectedWarning {
  code: string;
  path: Array<string | number>;
  meta?: Record<string, unknown>;
}

interface Fixture {
  /** `"provider/model"`, the ref this fixture's request is pointed at. */
  ref: string;
  /** This route's target voice — never portable; see the note above. */
  voice: string | { id: string } | { name: string };
  /** The exact enumerable wire body, with Blobs rendered as descriptors. */
  params: Record<string, unknown>;
  url: string;
  headers: Record<string, string>;
  /** Required on `lossy-*` cases, forbidden elsewhere. */
  warnings?: ExpectedWarning[];
  /** Issue-space warnings, pinned so a provider check cannot disappear quietly. */
  issues?: Array<{ code: string; path: Array<string | number> }>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** The compiled params as JSON, with every Blob rendered as a descriptor. */
function serializable(params: object): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (node instanceof Blob) return { [BLOB_SENTINEL]: { size: node.size, type: node.type } };
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, walk(value)]));
    }
    return node;
  };
  return walk({ ...params }) as Record<string, unknown>;
}

/** The three fields a warning is pinned on — the message is prose, not a contract. */
function comparable(warnings: readonly { code: string; path: unknown; meta?: unknown }[]) {
  return warnings.map((w) => ({ code: w.code, path: w.path, meta: w.meta }));
}

const caseDirs = readdirSync(GOLDEN, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

test("the sts golden tree is present", () => {
  // A vacuous suite passes by asserting nothing; this is the guard against it.
  expect(caseDirs.length).toBeGreaterThanOrEqual(4);
});

describe.each(caseDirs)("golden sts/%s", (name) => {
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
    const request = (): Record<string, unknown> => ({
      ...canonical,
      model: fixture.ref,
      audio: { file: new Blob([BLOB_BYTES], { type: BLOB_TYPE }) },
      voice: fixture.voice,
    });

    test("compiles to the committed wire body, url and headers", () => {
      const result = sts.safe(request() as never);
      expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
      if (!result.ok) return;

      const params = result.params as unknown as {
        request: { url: string; headers: Record<string, string> };
      };
      expect(serializable(result.params)).toEqual(fixture.params);
      expect(params.request.url).toBe(fixture.url);
      expect(params.request.headers).toEqual(fixture.headers);
    });

    test(lossy ? "reports exactly the committed warnings" : "maps exactly (no warnings)", () => {
      const result = sts.safe(request() as never);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const warnings = (result.params as unknown as { warnings: readonly ExpectedWarning[] })
        .warnings;
      expect(comparable(warnings)).toEqual(comparable(fixture.warnings ?? []));
      if (!lossy) expect(warnings).toEqual([]);
      expect(
        result.warnings.map((issue) => ({ code: String(issue.code), path: issue.path })),
      ).toEqual(fixture.issues ?? []);
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
    expect([...cases.keys()].sort()).toEqual([...sts.providers]);
  });

  test("a lossy case is lossy somewhere, and a lossless one is committed lossless", () => {
    for (const name of caseDirs) {
      const fixtures = all.filter((entry) => entry.name === name).map((entry) => entry.fixture);
      const warnings = fixtures.flatMap((fixture) => fixture.warnings ?? []);
      if (name.startsWith("lossy-")) expect(warnings.length).toBeGreaterThanOrEqual(1);
      else expect(warnings).toEqual([]);
    }
  });

  test("every fixture posts multipart, so no fixture sets a content-type", () => {
    // The category's defining fact, as an assertion rather than a note: both
    // wires take the recording as a form part, and fetch must derive the
    // boundary from the FormData itself.
    for (const { fixture } of all) expect(fixture.headers).toEqual({});
  });
});
