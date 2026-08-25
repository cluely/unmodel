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
 * would be the thing that went stale.
 */
import { describe, expect, test } from "bun:test";
import { avatar } from "../../src/unified/avatar";
import { avatar as fal } from "../../src/providers/fal/unified-avatar";
import { FAL_REQUIRED_PROBES } from "../../src/providers/fal/gen/endpoints.gen";
import { FAL_AVATAR_CONSTRAINTS } from "../../src/providers/fal/gen/avatar-narrow.gen";

const STILL = { url: "https://example.com/headshot.png" } as const;
const VOICE = { url: "https://example.com/vo.wav" } as const;
const INLINE_STILL = { data: "AAECAwQF", mimeType: "image/png" } as const;
const INLINE_VOICE = { data: "BgcICQoL", mimeType: "audio/wav" } as const;

const refs = fal.models.map((id) => `fal/${id}`);

/**
 * The rows, widened to a string index.
 *
 * `modelParams` is `as const` and keyed by literal id, which is the whole point
 * of it — but this sweep walks the roster at run time, so it needs the string
 * index the literal table deliberately does not have.
 */
const ROWS = fal.modelParams as Readonly<
  Record<string, { readonly keys: readonly string[]; readonly sources?: readonly string[] }>
>;

test("the sweep covers the whole roster", () => {
  expect(refs).toHaveLength(8);
});

/**
 * The wire fields this endpoint requires that the canonical vocabulary does not
 * supply, filled with a value the endpoint's own IR accepts — its first enum
 * member where it has one, a sentence where it does not.
 */
function extras(id: string): Record<string, unknown> {
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
  const id = ref.slice("fal/".length);
  const takesStill = ROWS[id]?.sources?.includes("image") === true;
  const options = extras(id);
  const providerOptions = Object.keys(options).length === 0 ? {} : { providerOptions: { fal: options } };

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
    expect(Object.hasOwn(body, "image_url")).toBe(takesStill);
  });

  test("compiles from inline bytes, with no warnings", () => {
    const result = avatar.safe({
      model: ref,
      audio: INLINE_VOICE,
      ...(takesStill ? { image: INLINE_STILL } : {}),
      ...providerOptions,
    } as never);
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    const body = JSON.parse(JSON.stringify(result.params)) as Record<string, unknown>;
    expect(body["audio_url"]).toBe("data:audio/wav;base64,BgcICQoL");
    if (takesStill) expect(body["image_url"]).toBe("data:image/png;base64,AAECAwQF");
  });

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
    const declared = ROWS[id]?.keys.includes("seed") === true;
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
