/**
 * Every ref `unmodel/avatar` autocompletes, compiled and validated.
 *
 * The lipsync sweep's twin, with the one thing that category has not got: two
 * of these eight endpoints take NO still, so the sweep cannot send the same
 * request to all eight. It reads each row's `sources` to decide which shape to
 * send, which means the file also checks the thing it depends on — a row that
 * lied about taking a picture would fail here rather than at a 422.
 *
 * The required set comes from `FAL_REQUIRED_PROBES`, generated from fal's own
 * OpenAPI. That matters more here than at lipsync: three of these endpoints
 * require a field the canonical vocabulary has no word for (`prompt` at
 * echomimic, `avatar_id` at VEED, `avatar` at Argil), and a hand-written list
 * would be the thing that went stale. sync.'s one model needs nothing beyond
 * the canonical words, and the inline-bytes half FORKS there — sync. fetches
 * its inputs and has no field a payload can go in.
 */
import { describe, expect, test } from "bun:test";
import { avatar } from "../../src/unified/avatar";
import { avatar as fal } from "../../src/providers/fal/unified-avatar";
import { avatar as heygen } from "../../src/providers/heygen/unified-avatar";
import { avatar as sync } from "../../src/providers/sync/unified-avatar";
import { avatar as veed } from "../../src/providers/veed/unified-avatar";
import { FAL_REQUIRED_PROBES } from "../../src/providers/fal/gen/endpoints.gen";
import { FAL_AVATAR_CONSTRAINTS } from "../../src/providers/fal/gen/avatar-narrow.gen";

const STILL = { url: "https://example.com/headshot.png" } as const;
const VOICE = { url: "https://example.com/vo.wav" } as const;
const INLINE_STILL = { data: "AAECAwQF", mimeType: "image/png" } as const;
const INLINE_VOICE = { data: "BgcICQoL", mimeType: "audio/wav" } as const;

const falRefs = fal.models.map((id) => `fal/${id}`);
const syncRefs = sync.models.map((id) => `sync/${id}`);
const veedRefs = veed.models.map((id) => `veed/${id}`);
const heygenRefs = heygen.models.map((id) => `heygen/${id}`);
const refs = [...falRefs, ...syncRefs, ...veedRefs, ...heygenRefs];

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
const ROWS = {
  ...fal.modelParams,
  ...heygen.modelParams,
  ...sync.modelParams,
  ...veed.modelParams,
} as Readonly<
  Record<string, { readonly keys?: readonly string[]; readonly sources?: readonly string[] }>
>;

test("the sweep covers the whole roster", () => {
  expect(falRefs).toHaveLength(8);
  expect(syncRefs).toHaveLength(1);
  expect(veedRefs).toHaveLength(1);
  expect(heygenRefs).toHaveLength(2);
  expect(refs).toHaveLength(12);
});

/**
 * The wire fields this endpoint requires that the canonical vocabulary does not
 * supply, filled with a value the endpoint's own IR accepts — its first enum
 * member where it has one, a sentence where it does not.
 */
function extras(ref: string): Record<string, unknown> {
  // VEED is the one NATIVE row in the category with a required extra:
  // `FabricInput.resolution` is in `required` with no `default`, so a request
  // without it is a 422 and the adapter refuses it by name. It is written here
  // rather than derived because there is no machine-readable required-set for
  // this provider to derive it from — VEED's spec is read by hand.
  if (providerOf(ref) === "veed") return { resolution: "720p" };
  if (providerOf(ref) !== "fal") return {};
  const id = bare(ref);
  const need = (FAL_REQUIRED_PROBES as Readonly<Record<string, readonly string[]>>)[id] ?? [];
  const vocab = (FAL_AVATAR_CONSTRAINTS as Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>)[id];
  const out: Record<string, unknown> = {};
  for (const name of need) {
    if (name === "image_url" || name === "audio_url") continue;
    out[name] = vocab?.[name]?.[0] ?? "a woman speaking to camera";
  }
  return out;
}

describe.each(refs)("%s", (ref) => {
  const id = bare(ref);
  const provider = providerOf(ref);
  const takesStill = ROWS[id]?.sources?.includes("image") === true;
  const options = extras(ref);
  const providerOptions =
    Object.keys(options).length === 0 ? {} : { providerOptions: { [provider]: options } };
  /** Where the still and the track land, which is a provider fact. */
  const at = (body: Record<string, unknown>, kind: "image" | "audio"): unknown => {
    if (provider === "fal" || provider === "veed") return body[`${kind}_url`];
    if (provider === "heygen") {
      // The asymmetry this category's `inline` column exists for: the still is
      // a tagged object with three arms, the track beside it is a bare string.
      if (kind === "audio") return body["audio_url"];
      return (body["image"] as { url?: string } | undefined)?.url;
    }
    const input = body["input"] as ReadonlyArray<{ type: string; url?: string }> | undefined;
    return input?.find((item) => item.type === kind)?.url;
  };

  test(`is ${takesStill ? "still-driven" : "performer-driven"}, and compiles from URL refs`, () => {
    const result = avatar.safe({
      model: ref,
      audio: VOICE,
      ...(takesStill ? { image: STILL } : {}),
      ...providerOptions,
    } as never);
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    const body = JSON.parse(JSON.stringify(result.params)) as Record<string, unknown>;
    expect(at(body, "image") !== undefined).toBe(takesStill);
  });

  test(
    provider === "fal"
      ? "compiles from inline bytes, with no warnings"
      : provider === "heygen"
        ? "takes the still's bytes structurally and refuses the track's"
        : "refuses inline bytes by name, naming the upload endpoint",
    () => {
      const result = avatar.safe({
        model: ref,
        audio: INLINE_VOICE,
        ...(takesStill ? { image: INLINE_STILL } : {}),
        ...providerOptions,
      } as never);
      if (provider === "heygen") {
        // HeyGen has a real `base64` arm on `image` and NOT on `audio_url`, so
        // one request is half-accepted and the refusal names the field that
        // failed rather than the provider.
        expect(result.ok).toBe(false);
        if (result.ok) return;
        const paths = result.errors.map((issue) => issue.path.join("."));
        expect(paths).toContain("audio");
        expect(paths).not.toContain("image");
        return;
      }
      if (provider !== "fal") {
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors.map((issue) => issue.path.join("."))).toContain("image");
        return;
      }
      expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
      if (!result.ok) return;
      expect(result.warnings).toEqual([]);
      const body = JSON.parse(JSON.stringify(result.params)) as Record<string, unknown>;
      expect(at(body, "audio")).toBe("data:audio/wav;base64,BgcICQoL");
      if (takesStill) expect(at(body, "image")).toBe("data:image/png;base64,AAECAwQF");
    },
  );

  test("the `image` arm matches the row, in both directions", () => {
    // Sending a still to a performer route, and omitting one at a still route,
    // are the two mistakes this category exists to catch. Both are refused at
    // the canonical path, whichever way round the row says.
    const wrong = avatar.safe({
      model: ref,
      audio: VOICE,
      ...(takesStill ? {} : { image: STILL }),
      ...providerOptions,
    } as never);
    expect(wrong.ok, id).toBe(false);
    if (wrong.ok) return;
    expect(wrong.errors.map((issue) => issue.path.join(".")), id).toContain("image");
  });

  test("`seed` is accepted exactly where the row declares it", () => {
    const declared = ROWS[id]?.keys?.includes("seed") === true;
    const result = avatar.safe({
      model: ref,
      audio: VOICE,
      ...(takesStill ? { image: STILL } : {}),
      seed: 7,
      ...providerOptions,
    } as never);
    expect(result.ok, id).toBe(declared);
  });
});
