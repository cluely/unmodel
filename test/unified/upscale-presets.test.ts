/**
 * Every ref `unmodel/upscale` autocompletes, compiled and validated.
 *
 * The sibling of `lipsync-presets.test.ts`, for a category with one thing to
 * enumerate rather than none: `factors`, where a row publishes a closed set.
 * The rest of the promise is the same one — every ref in the union compiles,
 * cleanly, through the provider's own validator, in both media shapes — plus
 * the two per-model refusals this category is built around, read off the
 * generated rows rather than transcribed here.
 *
 * The required set for each endpoint comes from `FAL_REQUIRED_PROBES`, which is
 * generated from fal's own OpenAPI `required` list minus everything fal
 * defaults. A hand-written list would be ten transcriptions to keep in step
 * with a weekly refresh, and the first one to go stale would turn a real
 * regression into a passing sweep.
 */
import { describe, expect, test } from "bun:test";
import { upscale } from "../../src/unified/upscale";
import { upscale as fal } from "../../src/providers/fal/unified-upscale";
import { FAL_REQUIRED_PROBES } from "../../src/providers/fal/gen/endpoints.gen";

const STILL = { url: "https://example.com/portrait.png" } as const;
const CLIP = { url: "https://example.com/take-3.mp4" } as const;
const INLINE_STILL = { data: "AAECAwQF", mimeType: "image/png" } as const;
const INLINE_CLIP = { data: "AAECAwQF", mimeType: "video/mp4" } as const;

const refs = fal.models.map((id) => `fal/${id}`);

/**
 * The rows, widened to a string index.
 *
 * `modelParams` is `as const` and keyed by literal id, which is the whole point
 * of it — but this sweep walks the roster at run time, so it needs the string
 * index the literal table deliberately does not have.
 */
const ROWS = fal.modelParams as Readonly<
  Record<
    string,
    {
      readonly keys: readonly string[];
      readonly sources?: readonly string[];
      readonly factors?: readonly number[];
      readonly factorWire?: string;
      readonly textWire?: string;
      readonly bounds?: Readonly<Record<string, { readonly min?: number; readonly max?: number }>>;
    }
  >
>;

test("the sweep covers the whole roster", () => {
  expect(refs).toHaveLength(10);
});

/**
 * The wire fields this endpoint requires that the canonical vocabulary does NOT
 * supply — its per-model extras. `image_url` and `video_url` are the two the
 * sweep already writes; anything else has to ride through `providerOptions`,
 * and an endpoint that needed one would show up here rather than as a failure.
 */
function extras(id: string): Record<string, unknown> {
  const need = (FAL_REQUIRED_PROBES as Readonly<Record<string, readonly string[]>>)[id] ?? [];
  const out: Record<string, unknown> = {};
  for (const name of need) {
    if (name === "image_url" || name === "video_url") continue;
    out[name] = "probe";
  }
  return out;
}

describe.each(refs)("%s", (ref) => {
  const id = ref.slice("fal/".length);
  const row = ROWS[id];
  const video = row?.sources?.[0] === "video";
  const options = extras(id);
  const providerOptions =
    Object.keys(options).length === 0 ? {} : { providerOptions: { fal: options } };

  test("compiles from a URL ref, with no warnings", () => {
    const result = upscale.safe({
      model: ref,
      source: video ? CLIP : STILL,
      ...providerOptions,
    } as never);
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    const params = result.params as unknown as { warnings: readonly unknown[] };
    expect(params.warnings).toEqual([]);
  });

  test("compiles from inline bytes, with no warnings", () => {
    const result = upscale.safe({
      model: ref,
      source: video ? INLINE_CLIP : INLINE_STILL,
      ...providerOptions,
    } as never);
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    const body = JSON.parse(JSON.stringify(result.params)) as Record<string, unknown>;
    expect(body[video ? "video_url" : "image_url"]).toBe(
      video ? "data:video/mp4;base64,AAECAwQF" : "data:image/png;base64,AAECAwQF",
    );
  });

  /**
   * Every multiplier an editor suggests is one the provider's own validator
   * accepts — which is the whole promise of the `factors` list, and the only
   * enumerable thing this category has.
   */
  test("every completed `factor` compiles", () => {
    const offered = row?.factors;
    if (offered === undefined) {
      // A range rather than a list: probe the ends the row publishes, which is
      // what an editor would NOT complete and a caller would still write.
      const bound = row?.bounds?.[row.factorWire ?? "upscale_factor"];
      for (const value of [bound?.min, bound?.max]) {
        if (value === undefined) continue;
        const result = upscale.safe({
          model: ref,
          source: video ? CLIP : STILL,
          factor: value,
          ...providerOptions,
        } as never);
        expect(result.ok, `${id} refused its own bound ${value}`).toBe(true);
      }
      return;
    }
    if (offered.length === 0) {
      // The empty list: `factor` is `never` at the call site, and refused here.
      const result = upscale.safe({
        model: ref,
        source: video ? CLIP : STILL,
        factor: 2,
        ...providerOptions,
      } as never);
      expect(result.ok, `${id} accepted a factor it declares none of`).toBe(false);
      return;
    }
    for (const value of offered) {
      const result = upscale.safe({
        model: ref,
        source: video ? CLIP : STILL,
        factor: value,
        ...providerOptions,
      } as never);
      expect(result.ok, `${id} refused its own completion ${value}`).toBe(true);
    }
  });

  test("`prompt` is accepted exactly where the row declares one", () => {
    // `prompt` is CANONICAL here, so it lives in the row's `textWire` rather
    // than in its `extras` — and three of the ten endpoints have it. That is
    // the per-model refusal risk R7 asks for, read straight off the generated
    // data rather than transcribed into this file.
    const declared = row?.textWire !== undefined;
    const result = upscale.safe({
      model: ref,
      source: video ? CLIP : STILL,
      prompt: "sharp fabric weave",
      ...providerOptions,
    } as never);
    expect(result.ok, id).toBe(declared);
  });
});

/**
 * The roster-wide shape of the two narrowings, asserted once rather than per
 * ref: this is the only category in the library where `sources` really varies,
 * and the only one where a row can publish an EMPTY list of values for a field
 * that is a range elsewhere.
 */
test("the roster splits both ways, which is what the two narrowings are for", () => {
  const sources = refs.map((ref) => ROWS[ref.slice("fal/".length)]?.sources?.[0]);
  expect(sources.filter((kind) => kind === "image").length).toBeGreaterThan(0);
  expect(sources.filter((kind) => kind === "video").length).toBeGreaterThan(0);

  const factors = refs.map((ref) => ROWS[ref.slice("fal/".length)]?.factors);
  expect(factors.filter((list) => list === undefined).length).toBeGreaterThan(0);
  expect(factors.filter((list) => list?.length === 0).length).toBe(1);
  expect(factors.filter((list) => (list?.length ?? 0) > 0).length).toBe(1);
});
