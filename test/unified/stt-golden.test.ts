/**
 * The golden matrix for `unmodel/stt`: **one canonical request, compiled
 * by every provider that can express it**, with each provider's exact wire
 * params committed to disk.
 *
 * Each directory under `golden/stt/` is one request. `canonical.json`
 * holds the words a caller writes; every other file is one provider's answer —
 * `{ ref, audio, params, url, headers, warnings?, issues? }`.
 *
 * ## Why `audio` lives in the per-provider file
 *
 * Same reason the speech matrix keeps `voice` there, and a stronger one. A
 * voice id is not portable; an audio *shape* is not even the same **type**
 * across providers. `{ url }` at AssemblyAI, `{ file }` at Cartesia,
 * `{ url }` or `{ fileId }` at Soniox — which are legal is decided by the
 * route, at compile time, by the adapter's `audioInputs`. Putting `audio` in
 * `canonical.json` would force a case to be single-shape, which would mean
 * eleven providers could never appear in one matrix at all.
 *
 * ## Blobs, and how a fixture holds one
 *
 * Four of the eleven routes are multipart, so their compiled params contain a
 * live `Blob` — which `JSON.stringify` renders as `{}`, and which no fixture
 * file can hold. The runner therefore does two substitutions:
 *
 * - **in**: `"audio": { "file": "@blob" }` becomes a real `Blob` built here,
 *   with a fixed size and media type;
 * - **out**: any `Blob` in the compiled params becomes
 *   `{ "@blob": { "size": …, "type": … } }` before the comparison.
 *
 * So the committed body is the *shape* of the multipart form — every field
 * exact, the audio part identified by size and type — which is as much as a
 * JSON fixture can honestly assert about bytes, and strictly more than
 * skipping those four providers would.
 *
 * ## What is asserted
 *
 * 1. **The body is exact.** Deep equality, not a subset match.
 * 2. **The transport is exact.** `url` and `headers` are committed too: two of
 *    these providers put options in the query string, one puts the model there,
 *    and the multipart routes are identified by their deliberately empty
 *    content-type.
 * 3. **Lossless means lossless.** Every case that is not `lossy-*` compiles
 *    with `warnings.length === 0` at *every* provider in it.
 * 4. **Lossy means exactly this much loss.** A `lossy-*` case commits every
 *    warning (code + path + meta).
 *
 * The cases cover every shape the category translates into:
 *
 * | shape | providers | case |
 * |---|---|---|
 * | audio as a URL | assemblyai, deepgram, gladia, revai, speechmatics, soniox | `minimal-url` |
 * | audio as a Blob | openai, cartesia, elevenlabs, mistral | `minimal-blob` |
 * | diarization: flag + count | assemblyai, elevenlabs, gladia, revai | `diarize-2-speakers` |
 * | diarization: bare flag / enum / inverted | deepgram, speechmatics, mistral, soniox, revai | `diarize-on` |
 * | timestamps: array / scalar / boolean | openai+mistral+cartesia / elevenlabs / deepgram+gladia | `word-timestamps` |
 * | language: three spellings | `language` / `language_code` / nested | `language-pt` |
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stt } from "../../src/unified/stt";

const GOLDEN = join(import.meta.dir, "golden", "stt");

/** The stand-in for a `Blob` in a fixture, in both directions. */
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
  /** Where this route takes its audio; see the note above. */
  audio: Record<string, string>;
  /** The exact enumerable wire body, with Blobs rendered as descriptors. */
  params: Record<string, unknown>;
  url: string;
  headers: Record<string, string>;
  /** Required on `lossy-*` cases, forbidden elsewhere. */
  warnings?: ExpectedWarning[];
  /** Issue-space warnings (`unsupported_param` with `ignored`, …). */
  issues?: Array<{ code: string; path: Array<string | number> }>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** `{ file: "@blob" }` → a real Blob; everything else passes through. */
function materialize(audio: Record<string, string>): Record<string, unknown> {
  if (audio["file"] !== BLOB_SENTINEL) return { ...audio };
  return { file: new Blob([BLOB_BYTES], { type: BLOB_TYPE }) };
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

test("the transcribe golden tree is present", () => {
  // A vacuous suite passes by asserting nothing; this is the guard against it.
  expect(caseDirs.length).toBeGreaterThanOrEqual(7);
});

describe.each(caseDirs)("golden transcribe/%s", (name) => {
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
      audio: materialize(fixture.audio),
    });

    test("compiles to the committed wire body, url and headers", () => {
      const result = stt.safe(request() as never);
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
      const result = stt.safe(request() as never);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const warnings = (result.params as unknown as { warnings: readonly ExpectedWarning[] })
        .warnings;
      expect(comparable(warnings)).toEqual(comparable(fixture.warnings ?? []));
      if (!lossy) expect(warnings).toEqual([]);
      // Issue-space warnings are a separate channel with a separate meaning;
      // pinned, so a provider that starts ignoring a param cannot do it quietly.
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

  test("every callable provider in the pack appears in at least two cases", () => {
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
    // inworld is the one provider with no fixture, and it is the one provider
    // no canonical request can reach: its route takes base64 audio inline, so
    // its adapter declares `audio` unsupported. `stt-e2e.test.ts` is
    // where that refusal is asserted instead.
    expect([...cases.keys(), "inworld"].sort()).toEqual([...stt.providers]);
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
   * Every audio shape the category accepts is committed somewhere, read off the
   * fixtures rather than asserted in prose — this is the runtime half of the
   * compile-time narrowing that `test/types/unified-stt.test-d.ts` pins.
   */
  test("all three audio shapes are exercised", () => {
    const kinds = new Set(all.flatMap(({ fixture }) => Object.keys(fixture.audio)));
    expect([...kinds].sort()).toEqual(["file", "fileId", "url"]);
  });

  /**
   * The four diarization spellings, read off the committed bodies. This is the
   * assertion the category's `diarization.enabled` decision rests on: the same
   * `{ enabled: true }` reaches a boolean, an enum member, an **inverted**
   * boolean and a flag-plus-object — and if the inversion ever flipped, a
   * caller's transcript would silently lose its speaker labels.
   */
  test("every diarization spelling is committed somewhere", () => {
    const seen = new Set<string>();
    for (const { fixture } of all) {
      const body = fixture.params as Record<string, unknown>;
      if (body["skip_diarization"] === false) seen.add("inverted");
      if (body["speaker_labels"] === true || body["diarize"] === true) seen.add("flag");
      if (body["enable_speaker_diarization"] === true) seen.add("flag");
      if (body["diarization"] === true) seen.add("flag");
      if (body["diarization_config"] !== undefined || body["speaker_options"] !== undefined) {
        seen.add("config-object");
      }
      const transcription = body["transcription_config"] as { diarization?: unknown } | undefined;
      if (transcription?.diarization === "speaker") seen.add("enum");
    }
    expect([...seen].sort()).toEqual(["config-object", "enum", "flag", "inverted"]);
  });

  /** And the three timestamp spellings, the same way. */
  test("every timestamp spelling is committed somewhere", () => {
    const seen = new Set<string>();
    for (const { fixture } of all) {
      const body = fixture.params as Record<string, unknown>;
      if (Array.isArray(body["timestamp_granularities"])) seen.add("array");
      if (typeof body["timestamps_granularity"] === "string") seen.add("scalar");
      if (body["utterances"] === false || body["sentences"] === false) seen.add("boolean");
      const config = body["transcribeConfig"] as { includeWordTimestamps?: unknown } | undefined;
      if (typeof config?.includeWordTimestamps === "boolean") seen.add("boolean");
    }
    expect([...seen].sort()).toEqual(["array", "boolean", "scalar"]);
  });
});
