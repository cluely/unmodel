/**
 * Every ref `unmodel/3d` autocompletes, compiled and validated — across both
 * providers.
 *
 * The sibling of `upscale-presets.test.ts` for a category with nothing
 * enumerable in its vocabulary at all: there is no `factors` list here, no
 * duration set, no codec map. What this sweep asserts instead is the thing the
 * category IS: every ref compiles in exactly the moods its row declares, and is
 * refused in the ones it does not, with no case having to be transcribed into
 * this file.
 *
 * The required set for each fal endpoint comes from `FAL_REQUIRED_PROBES`,
 * generated from fal's own OpenAPI `required` list minus everything fal
 * defaults. A hand-written list would be nineteen transcriptions to keep in
 * step with a weekly refresh, and the first one to go stale would turn a real
 * regression into a passing sweep. The four Tripo refs need no such probe:
 * their two routes require exactly `model` plus the one input, which the sweep
 * already writes.
 */
import { describe, expect, test } from "bun:test";
import { threeD } from "../../src/unified/3d";
import { threeD as fal } from "../../src/providers/fal/unified-3d";
import { threeD as tripo3d } from "../../src/providers/tripo3d/unified";
import { FAL_REQUIRED_PROBES } from "../../src/providers/fal/gen/endpoints.gen";

const PROMPT = "a brass astrolabe on a walnut stand";
const PHOTO = { url: "https://example.com/chair.png" } as const;
const INLINE = { data: "AAECAwQF", mimeType: "image/png" } as const;

const falRefs = fal.models.map((id) => `fal/${id}`);
const tripoRefs = tripo3d.models.map((id) => `tripo3d/${id}`);
const refs = [...falRefs, ...tripoRefs];

/**
 * The rows, widened to a string index.
 *
 * `modelParams` is `as const` and keyed by literal id, which is the whole point
 * of it — but this sweep walks the roster at run time, so it needs the string
 * index the literal table deliberately does not have.
 */
const ROWS = { ...fal.modelParams, ...tripo3d.modelParams } as Readonly<
  Record<
    string,
    {
      readonly keys?: readonly string[];
      readonly inputs?: readonly string[];
      readonly imageWire?: string;
      readonly imageWireList?: true;
      readonly seedWire?: string;
      readonly bounds?: Readonly<Record<string, { readonly min?: number; readonly max?: number }>>;
    }
  >
>;

test("the sweep covers the whole roster, both providers", () => {
  expect(falRefs).toHaveLength(19);
  expect(tripoRefs).toHaveLength(4);
  expect(refs).toHaveLength(23);
});

/**
 * The wire fields a fal endpoint requires that the canonical vocabulary does
 * NOT supply — its per-model extras. The image spellings are the four the sweep
 * already writes; anything else has to ride through `providerOptions`, and an
 * endpoint that needed one would show up here rather than as a failure.
 */
function extras(ref: string): Record<string, unknown> {
  if (!ref.startsWith("fal/")) return {};
  const id = ref.slice("fal/".length);
  const need = (FAL_REQUIRED_PROBES as Readonly<Record<string, readonly string[]>>)[id] ?? [];
  const row = ROWS[id];
  const out: Record<string, unknown> = {};
  for (const name of need) {
    if (name === "prompt" || name === row?.imageWire) continue;
    out[name] = "probe";
  }
  return out;
}

describe.each(refs)("%s", (ref) => {
  const id = ref.slice(ref.indexOf("/") + 1);
  const row = ROWS[id];
  const readsText = row?.inputs?.includes("text") === true;
  const readsImage = row?.inputs?.includes("image") === true;
  const provider = ref.slice(0, ref.indexOf("/"));
  const options = extras(ref);
  const providerOptions =
    Object.keys(options).length === 0 ? {} : { providerOptions: { [provider]: options } };

  test("compiles in every mood its row declares, with no warnings", () => {
    if (readsText) {
      const result = threeD.safe({ model: ref, prompt: PROMPT, ...providerOptions } as never);
      expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
      if (!result.ok) return;
      expect(result.warnings).toEqual([]);
      expect((result.params as unknown as { warnings: readonly unknown[] }).warnings).toEqual([]);
    }
    if (readsImage) {
      const result = threeD.safe({ model: ref, image: PHOTO, ...providerOptions } as never);
      expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
      if (!result.ok) return;
      expect(result.warnings).toEqual([]);
    }
  });

  test("and is refused in the moods it does not", () => {
    // The refusals are read off the generated rows rather than transcribed —
    // risk R7's rule, applied to a category where the arms are the vocabulary.
    if (!readsText) {
      const result = threeD.safe({ model: ref, image: PHOTO, prompt: PROMPT, ...providerOptions } as never);
      const named = result.ok
        ? result.warnings.some((i) => i.path?.[0] === "prompt")
        : result.errors.some((i) => i.path?.[0] === "prompt");
      expect(named, `${id} accepted a prompt it declares no field for`).toBe(true);
    }
    if (!readsImage) {
      const result = threeD.safe({ model: ref, prompt: PROMPT, image: PHOTO, ...providerOptions } as never);
      expect(result.ok, `${id} accepted an image it declares no field for`).toBe(false);
    }
  });

  test("the image lands under this route's own spelling", () => {
    if (!readsImage) return;
    const result = threeD.safe({ model: ref, image: PHOTO, ...providerOptions } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = JSON.parse(JSON.stringify(result.params)) as Record<string, unknown>;
    const wire = provider === "tripo3d" ? "input" : (row?.imageWire as string);
    expect(body[wire], `${id}.${wire}`).toEqual(
      row?.imageWireList === true ? [PHOTO.url] : PHOTO.url,
    );
  });

  test("inline bytes reach fal as a data URI and are refused by Tripo", () => {
    if (!readsImage) return;
    const result = threeD.safe({ model: ref, image: INLINE, ...providerOptions } as never);
    if (provider === "tripo3d") {
      // Tripo's `input` is a token, a URL or a task id — never bytes. Refusing
      // it here names the upload endpoint; sending a `data:` URI would be a
      // 4xx with a worse message.
      expect(result.ok, `${id} accepted inline bytes`).toBe(false);
      return;
    }
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
    if (!result.ok) return;
    const body = JSON.parse(JSON.stringify(result.params)) as Record<string, unknown>;
    const wire = row?.imageWire as string;
    expect(body[wire]).toEqual(
      row?.imageWireList === true
        ? ["data:image/png;base64,AAECAwQF"]
        : "data:image/png;base64,AAECAwQF",
    );
  });

  test("`seed` is accepted exactly where the row declares a seed field", () => {
    const params = readsText ? { prompt: PROMPT } : { image: PHOTO };
    const result = threeD.safe({ model: ref, ...params, seed: 7, ...providerOptions } as never);
    expect(result.ok, id).toBe(row?.seedWire !== undefined || provider === "tripo3d");
  });
});

/**
 * The roster-wide shape of the one narrowing, asserted once rather than per ref:
 * this is the only category in the library where a row moves two canonical
 * fields in opposite directions, and all three of its arms are populated.
 */
test("all three input arms are real, across both providers", () => {
  const arms = refs.map((ref) => {
    const row = ROWS[ref.slice(ref.indexOf("/") + 1)];
    const text = row?.inputs?.includes("text") === true;
    const image = row?.inputs?.includes("image") === true;
    return text && image ? "both" : text ? "text" : "image";
  });
  expect(arms.filter((a) => a === "text").length).toBeGreaterThan(0);
  expect(arms.filter((a) => a === "image").length).toBeGreaterThan(0);
  expect(arms.filter((a) => a === "both").length).toBeGreaterThan(0);
  // Every one of Tripo's four is a both-arm, because there the route follows
  // the input rather than the id — which is the whole difference between the
  // native provider and the aggregator's resale of the same models.
  for (const ref of tripoRefs) {
    const row = ROWS[ref.slice("tripo3d/".length)];
    expect(row?.inputs, ref).toEqual(["image", "text"]);
  }
});

test("the image has four wire spellings at fal and one at Tripo", () => {
  const spellings = new Set(
    falRefs
      .map((ref) => ROWS[ref.slice("fal/".length)]?.imageWire)
      .filter((wire): wire is string => wire !== undefined),
  );
  expect([...spellings].sort()).toEqual([
    "front_image_url",
    "image_url",
    "image_urls",
    "input_image_url",
  ]);
});
