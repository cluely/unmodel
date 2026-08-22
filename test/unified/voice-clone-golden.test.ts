/**
 * The golden matrix for `unmodel/voice-clone`: shared canonical words compiled
 * by every provider that can express them, with each one's exact wire params
 * committed to disk.
 *
 * ## Why `samples` lives in the per-provider file
 *
 * Like stt's `audio`, the recordings' SHAPE is the one canonical field that is
 * deliberately not portable across providers — `{ file }` at the multipart
 * four, `{ data }` at Inworld, `{ fileId }` at MiniMax — so `canonical.json`
 * holds the words a caller writes portably and each provider's fixture names
 * its own `samples`. Blobs use the stt tree's `"@blob"` sentinel in both
 * directions.
 *
 * ## The case split this category forces
 *
 * `name` is required by five wires and REFUSED by MiniMax (its caller-chosen
 * `voiceId` is the handle, and `voiceId` is refused by the other five) — so
 * MiniMax has its own `caller-id*` cases and appears in no shared one. That
 * asymmetry is the vocabulary telling the truth about the wires, and the
 * matrix documents it rather than papering over it.
 *
 * ## The one standing issue-channel warning
 *
 * Fish Audio's wire validator warns whenever `visibility` is omitted (the
 * public-by-default footgun), so every fish fixture without an explicit
 * visibility pins that issue — the warning is the point, not noise.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { voiceClone } from "../../src/unified/voice-clone";

const GOLDEN = join(import.meta.dir, "golden", "voice-clone");

/** The stand-in for a `Blob` in a fixture, in both directions. */
const BLOB_SENTINEL = "@blob";
const BLOB_BYTES = new Uint8Array(64);
const BLOB_TYPE = "audio/wav";

interface ExpectedWarning {
  code: string;
  path: Array<string | number>;
  meta?: Record<string, unknown>;
}

interface FixtureSample {
  audio: Record<string, string>;
  transcript?: string;
}

interface Fixture {
  /** `"provider/model"`, the ref this fixture's request is pointed at. */
  ref: string;
  /** This route's recordings; see the note above. */
  samples: FixtureSample[];
  /** The exact enumerable wire body, with Blobs rendered as descriptors. */
  params: Record<string, unknown>;
  url: string;
  headers: Record<string, string>;
  /** Required on `lossy-*` cases, forbidden elsewhere. */
  warnings?: ExpectedWarning[];
  /** Issue-space warnings (fish's visibility-omitted footgun, …). */
  issues?: Array<{ code: string; path: Array<string | number> }>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** `{ audio: { file: "@blob" } }` → a real Blob; everything else passes through. */
function materialize(samples: FixtureSample[]): Array<Record<string, unknown>> {
  return samples.map((sample) => ({
    audio:
      sample.audio["file"] === BLOB_SENTINEL
        ? { file: new Blob([BLOB_BYTES], { type: BLOB_TYPE }) }
        : { ...sample.audio },
    ...(sample.transcript !== undefined && { transcript: sample.transcript }),
  }));
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

test("the voice-clone golden tree is present", () => {
  // A vacuous suite passes by asserting nothing; this is the guard against it.
  expect(caseDirs.length).toBeGreaterThanOrEqual(6);
});

describe.each(caseDirs)("golden voice-clone/%s", (name) => {
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
      samples: materialize(fixture.samples),
    });

    test("compiles to the committed wire body, url and headers", () => {
      const result = voiceClone.safe(request() as never);
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
      const result = voiceClone.safe(request() as never);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const warnings = (result.params as unknown as { warnings: readonly ExpectedWarning[] })
        .warnings;
      expect(comparable(warnings)).toEqual(comparable(fixture.warnings ?? []));
      if (!lossy) expect(warnings).toEqual([]);
      // Issue-space warnings are a separate channel with a separate meaning;
      // pinned, so fish's visibility footgun cannot disappear quietly.
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
    expect([...cases.keys()].sort()).toEqual([...voiceClone.providers]);
  });

  test("a lossy case is lossy somewhere, and a lossless one is committed lossless", () => {
    for (const name of caseDirs) {
      const fixtures = all.filter((entry) => entry.name === name).map((entry) => entry.fixture);
      const warnings = fixtures.flatMap((fixture) => fixture.warnings ?? []);
      if (name.startsWith("lossy-")) expect(warnings.length).toBeGreaterThanOrEqual(1);
      else expect(warnings).toEqual([]);
    }
  });
});
