/**
 * Every ref `unmodel/lipsync` autocompletes, compiled and validated.
 *
 * The sibling of `video-presets.test.ts` for a category with almost nothing to
 * enumerate — which is exactly why the file is worth having. `unmodel/lipsync`
 * has no durations, no tiers and no ratios; the only thing a row narrows is
 * `sources`, and the only thing an editor suggests is the REF. So the promise
 * this sweep checks is the one that is left: every ref in the union compiles,
 * cleanly, through the provider's own validator — in both media shapes.
 *
 * The required set for each fal endpoint comes from `FAL_REQUIRED_PROBES`, which
 * is generated from fal's own OpenAPI `required` list minus everything fal
 * defaults. A hand-written list would be ten transcriptions to keep in step
 * with a weekly refresh, and the first one to go stale would turn a real
 * regression into a passing sweep. sync.'s five models need nothing beyond the
 * canonical words, so the same sweep runs over them with an empty extras map —
 * and the inline-bytes half FORKS there, because sync. fetches its inputs and
 * has no field a payload can go in.
 */
import { describe, expect, test } from "bun:test";
import { lipsync } from "../../src/unified/lipsync";
import { lipsync as fal } from "../../src/providers/fal/unified-lipsync";
import { lipsync as sync } from "../../src/providers/sync/unified-lipsync";
import { FAL_REQUIRED_PROBES } from "../../src/providers/fal/gen/endpoints.gen";

const CLIP = { url: "https://example.com/take-3.mp4" } as const;
const VOICE = { url: "https://example.com/vo.wav" } as const;
const INLINE_CLIP = { data: "AAECAwQF", mimeType: "video/mp4" } as const;
const INLINE_VOICE = { data: "BgcICQoL", mimeType: "audio/wav" } as const;

const falRefs = fal.models.map((id) => `fal/${id}`);
const syncRefs = sync.models.map((id) => `sync/${id}`);
const refs = [...falRefs, ...syncRefs];

/** The bare model id a ref points at, and the provider it names. */
const bare = (ref: string): string => ref.slice(ref.indexOf("/") + 1);
const providerOf = (ref: string): string => ref.slice(0, ref.indexOf("/"));

/**
 * The rows, widened to a string index.
 *
 * `modelParams` is `as const` and keyed by literal id, which is the whole point
 * of it — but this sweep walks the roster at run time, so it needs the string
 * index the literal table deliberately does not have.
 */
const ROWS = { ...fal.modelParams, ...sync.modelParams } as Readonly<
  Record<string, { readonly keys?: readonly string[]; readonly sources?: readonly string[] }>
>;

test("the sweep covers the whole roster", () => {
  expect(falRefs).toHaveLength(10);
  expect(syncRefs).toHaveLength(5);
  expect(refs).toHaveLength(15);
});

/**
 * The wire fields this endpoint requires that the canonical vocabulary does NOT
 * supply — its per-model extras. `video_url` and `audio_url` are the two the
 * sweep already writes; anything else has to ride through `providerOptions`,
 * and an endpoint that needed one would show up here rather than as a failure.
 */
function extras(ref: string): Record<string, unknown> {
  if (providerOf(ref) !== "fal") return {};
  const id = bare(ref);
  const need = (FAL_REQUIRED_PROBES as Readonly<Record<string, readonly string[]>>)[id] ?? [];
  const out: Record<string, unknown> = {};
  for (const name of need) {
    if (name === "video_url" || name === "audio_url") continue;
    out[name] = "probe";
  }
  return out;
}

describe.each(refs)("%s", (ref) => {
  const id = bare(ref);
  const provider = providerOf(ref);
  const options = extras(ref);
  const providerOptions =
    Object.keys(options).length === 0 ? {} : { providerOptions: { [provider]: options } };

  test("compiles from URL refs, with no warnings", () => {
    const result = lipsync.safe({ model: ref, source: CLIP, audio: VOICE, ...providerOptions } as never);
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    const params = result.params as unknown as { warnings: readonly unknown[] };
    expect(params.warnings).toEqual([]);
  });

  test(
    provider === "fal"
      ? "compiles from inline bytes, with no warnings"
      : "refuses inline bytes by name, naming the upload endpoint",
    () => {
      const result = lipsync.safe({
        model: ref,
        source: INLINE_CLIP,
        audio: INLINE_VOICE,
        ...providerOptions,
      } as never);
      if (provider !== "fal") {
        // sync. FETCHES its inputs — a media item takes a `url` or an
        // `assetId`, and nothing in the JSON body is a payload. Refusing is the
        // only honest answer; the message names POST /v2/assets/upload.
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors.map((issue) => issue.path.join("."))).toContain("source");
        return;
      }
      expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
      if (!result.ok) return;
      expect(result.warnings).toEqual([]);
      const body = JSON.parse(JSON.stringify(result.params)) as Record<string, unknown>;
      expect(body["video_url"]).toBe("data:video/mp4;base64,AAECAwQF");
      expect(body["audio_url"]).toBe("data:audio/wav;base64,BgcICQoL");
    },
  );

  test("`seed` is accepted exactly where the row declares it", () => {
    // `seed` is CANONICAL here, so it lives in the row's `keys` rather than in
    // its `extras` — and exactly one of the ten endpoints has it. That is the
    // per-model refusal risk R7 asks for, read straight off the generated data
    // rather than transcribed into this file.
    // sync. publishes no seed anywhere, so its five rows declare no `keys` at
    // all and the answer is the same `false` by a different route.
    const declared = ROWS[id]?.keys?.includes("seed") === true;
    const result = lipsync.safe({ model: ref, source: CLIP, audio: VOICE, seed: 7, ...providerOptions } as never);
    expect(result.ok, id).toBe(declared);
  });
});
