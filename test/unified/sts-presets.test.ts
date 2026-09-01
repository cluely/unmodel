/**
 * Every ref `unmodel/sts` autocompletes, compiled and validated — across both
 * providers.
 *
 * The sweep every category has, pointed at the one thing this vocabulary
 * enumerates: each row's `codecs` list. A completion list is only worth having
 * if every value in it is one the provider's own validator accepts, so the
 * sweep compiles them rather than transcribing them.
 *
 * The other two narrowable-looking words are deliberately NOT swept, and it is
 * worth saying why here rather than leaving the absence to be read as a gap:
 * `voice` has no closed list at either vendor (per-account catalogs, cloned
 * voices, thousands of entries), and `audio` has exactly one shape. Sweeping a
 * one-member set proves nothing the type system has not already stated.
 */
import { describe, expect, test } from "bun:test";
import { sts } from "../../src/unified/sts";
import { sts as elevenlabs } from "../../src/providers/elevenlabs/unified-sts";
import { sts as hume } from "../../src/providers/hume/unified-sts";

const CLIP = new Blob([new Uint8Array(64)], { type: "audio/wav" });
const audio = (): { file: Blob } => ({ file: CLIP });
const VOICE = "21m00Tcm4TlvDq8ikWAM";

const refs = [
  ...elevenlabs.models.map((id) => `elevenlabs/${id}`),
  ...hume.models.map((id) => `hume/${id}`),
];

/**
 * The rows, widened to a string index.
 *
 * `modelParams` is `as const` and keyed by literal id, which is the whole point
 * of it — but this sweep walks the roster at run time, so it needs the string
 * index the literal table deliberately does not have.
 */
const ROWS = { ...elevenlabs.modelParams, ...hume.modelParams } as Readonly<
  Record<
    string,
    {
      readonly codecs?: readonly string[];
      readonly extras?: Readonly<Record<string, unknown>>;
    }
  >
>;

function rowOf(ref: string): (typeof ROWS)[string] {
  const row = ROWS[ref.slice(ref.indexOf("/") + 1)];
  if (row === undefined) throw new Error(`${ref} has no row`);
  return row;
}

test("the sweep covers every ref both adapters publish", () => {
  expect(refs.length).toBe(4);
  expect([...sts.providers]).toEqual(["elevenlabs", "hume"]);
});

describe.each(refs)("%s", (ref) => {
  const row = rowOf(ref);

  test("the minimum request — a recording and a target voice — compiles", () => {
    const result = sts.safe({ model: ref, audio: audio(), voice: VOICE } as never);
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
  });

  test("every codec the row completes is one the provider's validator accepts", () => {
    const codecs = row.codecs ?? [];
    expect(codecs.length).toBeGreaterThan(0);
    for (const format of codecs) {
      // The shorthand…
      const bare = sts.safe({
        model: ref,
        audio: audio(),
        voice: VOICE,
        outputFormat: format,
      } as never);
      expect(bare.ok, `${ref} refused ${format}`).toBe(true);
      // …and the object spelling, which is the half a caller reaches for
      // precisely when they care about the encoding.
      const object = sts.safe({
        model: ref,
        audio: audio(),
        voice: VOICE,
        outputFormat: { format },
      } as never);
      expect(object.ok, `${ref} refused { format: ${format} }`).toBe(true);
    }
  });

  test("every extra the row publishes is one the provider's validator accepts", () => {
    // The extras' VALUES come from each wire's own interface, so the sweep
    // sends a documented value per key rather than a generic one.
    const probes: Readonly<Record<string, unknown>> = {
      remove_background_noise: true,
      seed: 12345,
      voice_settings: { stability: 0.4 },
      file_format: "other",
      enable_logging: true,
      strip_headers: true,
      context: { generation_id: "gen_1" },
      include_timestamp_types: ["word"],
    };
    for (const key of Object.keys(row.extras ?? {})) {
      expect(Object.keys(probes)).toContain(key);
      const result = sts.safe({
        model: ref,
        audio: audio(),
        voice: VOICE,
        [key]: probes[key],
      } as never);
      expect(result.ok, `${ref} refused extra ${key}`).toBe(true);
    }
  });

  test("an extra the row does NOT publish is refused by name", () => {
    const foreign = ref.startsWith("hume/") ? "seed" : "strip_headers";
    const result = sts.safe({
      model: ref,
      audio: audio(),
      voice: VOICE,
      [foreign]: ref.startsWith("hume/") ? 7 : true,
    } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.path).toEqual([foreign]);
  });
});
