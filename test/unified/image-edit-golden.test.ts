/**
 * The golden matrix for `unmodel/image-edit`: **one canonical request, compiled
 * by every provider that can express it**, with each provider's exact wire
 * params committed to disk.
 *
 * Each directory under `golden/image-edit/` is one request. `canonical.json`
 * holds the words a caller writes; every other file is one provider's answer —
 * `{ ref, image, params, url, headers, warnings?, issues? }`.
 *
 * ## Why `image` lives in the per-provider file
 *
 * Same reason the transcribe matrix keeps `audio` there. An image *shape* is not
 * the same **type** across providers: `{ file }` at OpenAI and Ideogram,
 * `{ data }` or `{ url }` at Black Forest Labs, `{ file }` or `{ url }` at
 * Recraft — and which are legal is decided by the route, at compile time, by the
 * adapter's `imageInputs`. Putting `image` in `canonical.json` would force a
 * case to be single-shape, which would mean four providers could never appear in
 * one matrix at all.
 *
 * ## Blobs, and how a fixture holds one
 *
 * Three of the four routes are multipart, so their compiled params contain a
 * live `Blob` — which `JSON.stringify` renders as `{}`, and which no fixture
 * file can hold. The runner therefore does the same two substitutions the
 * transcribe matrix does:
 *
 * - **in**: `"image": { "file": "@blob" }` becomes a real `Blob` built here,
 *   with a fixed size and media type;
 * - **out**: any `Blob` in the compiled params becomes
 *   `{ "@blob": { "size": …, "type": … } }` before the comparison.
 *
 * So the committed body is the *shape* of the multipart form — every field
 * exact, the picture identified by size and type — which is as much as a JSON
 * fixture can honestly assert about bytes, and strictly more than skipping three
 * of the four providers would.
 *
 * ## What is asserted
 *
 * 1. **The body is exact.** Deep equality, not a subset match.
 * 2. **The transport is exact.** `url` and `headers` are committed too: the ref
 *    *is* the route at Black Forest Labs, and the multipart routes are
 *    identified by their deliberately empty content-type — which at Recraft
 *    flips to a JSON one when the same request carries a URL instead of a Blob.
 * 3. **Lossless means lossless.** Every case that is not `lossy-*` compiles with
 *    `warnings.length === 0` at *every* provider in it.
 * 4. **Lossy means exactly this much loss.** A `lossy-*` case commits every
 *    warning (code + path + meta).
 *
 * The cases cover every shape the category translates into:
 *
 * | shape | providers | case |
 * |---|---|---|
 * | image as a Blob / base64 / URL | openai, ideogram / bfl / bfl | `minimal` |
 * | `strength`, native and **inverted** | recraft / ideogram | `strength-half` |
 * | shape as free-form pixels / a ratio string / a ratio enum | openai / bfl / ideogram | `sized-16x9` |
 * | a strength between two whole numbers | ideogram (warns) + recraft (exact) | `lossy-strength-third` |
 * | a ratio no pixel grid hits exactly | openai (warns) + bfl (reduces, exact) | `lossy-ultrawide` |
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { imageEdit } from "../../src/unified/image-edit";

const GOLDEN = join(import.meta.dir, "golden", "image-edit");

/** The stand-in for a `Blob` in a fixture, in both directions. */
const BLOB_SENTINEL = "@blob";
const BLOB_BYTES = new Uint8Array(64);
const BLOB_TYPE = "image/png";

interface ExpectedWarning {
  code: string;
  path: Array<string | number>;
  meta?: Record<string, unknown>;
}

interface Fixture {
  /** `"provider/model"`, the ref this fixture's request is pointed at. */
  ref: string;
  /** Where this route takes its source picture; see the note above. */
  image: Record<string, string>;
  /** The exact enumerable wire body, with Blobs rendered as descriptors. */
  params: Record<string, unknown>;
  url: string;
  headers: Record<string, string>;
  /** Required on `lossy-*` cases, forbidden elsewhere. */
  warnings?: ExpectedWarning[];
  /** Issue-space warnings (`unknown_model`, `unsupported_param` downgrades, …). */
  issues?: Array<{ code: string; path: Array<string | number> }>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** `{ file: "@blob" }` → a real Blob; everything else passes through. */
function materialize(image: Record<string, string>): Record<string, unknown> {
  if (image["file"] !== BLOB_SENTINEL) return { ...image };
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

test("the image-edit golden tree is present", () => {
  // A vacuous suite passes by asserting nothing; this is the guard against it.
  expect(caseDirs.length).toBeGreaterThanOrEqual(5);
});

describe.each(caseDirs)("golden image-edit/%s", (name) => {
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
      image: materialize(fixture.image),
    });

    test("compiles to the committed wire body, url and headers", () => {
      const result = imageEdit.safe(request() as never);
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
      const result = imageEdit.safe(request() as never);
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

    test("`operation` is a discriminant and never reaches the wire", () => {
      // It picks the shape of the request, not a field on it — and every one of
      // these APIs would pass an unknown key straight through to a 4xx.
      expect(Object.keys(fixture.params)).not.toContain("operation");
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
    // Unlike transcribe, there is no unreachable provider here: all four
    // adapters accept at least one shape a canonical request can carry.
    expect([...cases.keys()].sort()).toEqual([...imageEdit.providers]);
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
   * Every image shape the category accepts is committed somewhere, read off the
   * fixtures rather than asserted in prose — this is the runtime half of the
   * compile-time narrowing that `test/types/unified-image-edit.test-d.ts` pins.
   */
  test("all three image shapes are exercised", () => {
    const kinds = new Set(all.flatMap(({ fixture }) => Object.keys(fixture.image)));
    expect([...kinds].sort()).toEqual(["data", "file", "url"]);
  });

  /**
   * The strength inversion, read off the committed bodies rather than asserted
   * in prose. This is the assertion the category's `strength` decision rests on:
   * the same `strength: 0.5` reaches a wire value of `0.5` at one provider and
   * `50` on a **backwards** 0–100 scale at another — and if the inversion ever
   * flipped, a caller asking to barely change their picture would get one they
   * do not recognise, with no warning and no error.
   */
  test("both strength directions are committed somewhere", () => {
    const seen = new Set<string>();
    for (const { fixture } of all) {
      const body = fixture.params as Record<string, unknown>;
      if (typeof body["strength"] === "number") seen.add("native");
      if (typeof body["image_weight"] === "number") seen.add("inverted");
    }
    expect([...seen].sort()).toEqual(["inverted", "native"]);
  });

  /**
   * A canonical `strength: 0.5` is `image_weight: 50` — which is also remix's
   * own documented default. Pinned here rather than left as a coincidence,
   * because it is the single value that proves the map is linear *and*
   * correctly oriented: an off-by-one scale or a flipped one would both land
   * somewhere else.
   */
  test("half strength is the midpoint of the inverted scale", () => {
    const halves = all
      .filter(({ name }) => name === "strength-half")
      .map(({ fixture }) => fixture.params as Record<string, unknown>);
    expect(halves.length).toBeGreaterThan(0);
    for (const body of halves) {
      if (body["image_weight"] !== undefined) expect(body["image_weight"]).toBe(50);
      if (body["strength"] !== undefined) expect(body["strength"]).toBe(0.5);
    }
  });

  /** And the three size vocabularies, the same way. */
  test("every sizing spelling is committed somewhere", () => {
    const seen = new Set<string>();
    for (const { fixture } of all) {
      const body = fixture.params as Record<string, unknown>;
      if (typeof body["size"] === "string") seen.add("pixels");
      if (typeof body["aspect_ratio"] === "string") {
        seen.add(body["aspect_ratio"].includes("x") ? "ratio-enum" : "ratio-string");
      }
    }
    expect([...seen].sort()).toEqual(["pixels", "ratio-enum", "ratio-string"]);
  });
});
