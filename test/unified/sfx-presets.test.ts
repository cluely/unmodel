/**
 * Every ref `unmodel/sfx` autocompletes, compiled and validated — across both
 * providers.
 *
 * The sweep every category has, pointed at the two things this vocabulary
 * actually enumerates: each row's `codecs` list, and each row's duration
 * range. A completion list is only worth having if every value in it is one
 * the provider's own validator accepts, so the sweep compiles them rather than
 * transcribing them.
 *
 * The required set for each fal endpoint comes from `FAL_REQUIRED_PROBES`,
 * generated from fal's own OpenAPI `required` list minus everything fal
 * defaults. A hand-written list would be six transcriptions to keep in step
 * with a weekly refresh, and the first one to go stale would turn a real
 * regression into a passing sweep.
 */
import { describe, expect, test } from "bun:test";
import { sfx } from "../../src/unified/sfx";
import { sfx as elevenlabs } from "../../src/providers/elevenlabs/unified-sfx";
import { sfx as fal } from "../../src/providers/fal/unified-sfx";
import { FAL_REQUIRED_PROBES } from "../../src/providers/fal/gen/endpoints.gen";

const PROMPT = "a heavy oak door creaking open in a stone hall";

const refs = [
  ...elevenlabs.models.map((id) => `elevenlabs/${id}`),
  ...fal.models.map((id) => `fal/${id}`),
];

/**
 * The rows, widened to a string index.
 *
 * `modelParams` is `as const` and keyed by literal id, which is the whole point
 * of it — but this sweep walks the roster at run time, so it needs the string
 * index the literal table deliberately does not have.
 */
const ROWS = { ...elevenlabs.modelParams, ...fal.modelParams } as Readonly<
  Record<
    string,
    {
      readonly codecs?: readonly string[];
      readonly durationRange?: readonly [number, number];
      readonly durationInt?: true;
      readonly durationDefault?: number;
      readonly durationRequired?: true;
      readonly extras?: Readonly<Record<string, unknown>>;
    }
  >
>;

/** The bare model id a ref names. */
function modelOf(ref: string): string {
  return ref.slice(ref.indexOf("/") + 1);
}

/**
 * A request that satisfies everything the route requires but nothing else —
 * the base every sweep below adds one field to.
 */
function base(ref: string): Record<string, unknown> {
  const row = ROWS[modelOf(ref)];
  const request: Record<string, unknown> = { model: ref, prompt: PROMPT };
  if (row?.durationRequired === true) {
    request["durationSeconds"] = row.durationRange?.[0] ?? 1;
  }
  return request;
}

test("the sweep walks every ref the pack ships", () => {
  expect(refs.length).toBe(7);
  expect(new Set(refs).size).toBe(refs.length);
  for (const ref of refs) expect(ROWS[modelOf(ref)], ref).toBeDefined();
});

/**
 * fal's own `required` list, per endpoint, minus everything fal defaults —
 * generated, so a weekly refresh cannot leave this sweep asserting a stale
 * shape.
 *
 * Every route requires its prompt, under whichever of the three names it
 * spells it. Exactly one requires a second field, and that field is the
 * length: the fact `unmodel/sfx`'s required arm exists for, read straight off
 * fal's own schemas rather than transcribed.
 */
test("only CassetteAI requires a second field, and that field is the length", () => {
  const probes = FAL_REQUIRED_PROBES as Readonly<Record<string, readonly string[]>>;
  const beyondPrompt = Object.fromEntries(
    fal.models.map((id) => [
      id,
      (probes[id] ?? []).filter((name) => !["prompt", "text", "text_prompt"].includes(name)),
    ]),
  );
  expect(beyondPrompt).toEqual({
    "cassetteai/sound-effects-generator": ["duration"],
    "fal-ai/elevenlabs/sound-effects/v2": [],
    "fal-ai/stable-audio-3/small/sfx/base/text-to-audio": [],
    "fal-ai/stable-audio-3/small/sfx/text-to-audio": [],
    "mirelo-ai/sfx1.6/text-to-audio": [],
    "sonilo/v1.1/text-to-sound-effects": [],
  });
  // …and the row says the same thing, which is what the unified layer reads.
  expect(fal.models.filter((id) => ROWS[id]?.durationRequired === true)).toEqual([
    "cassetteai/sound-effects-generator",
  ]);
});

describe.each(refs)("%s", (ref) => {
  const row = ROWS[modelOf(ref)] ?? {};

  test("compiles with just the words the route requires", () => {
    const result = sfx.safe(base(ref) as never);
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
  });

  test("every codec the row completes is one the wire accepts", () => {
    const codecs = row.codecs ?? [];
    for (const codec of codecs) {
      const result = sfx.safe({ ...base(ref), outputFormat: codec } as never);
      expect(result.ok, `${ref} ${codec}: ${JSON.stringify(result.ok ? [] : result.errors)}`).toBe(
        true,
      );
    }
    // An empty list is a claim too: this route has no encoding field, and
    // asking for one is a refusal rather than a silent drop.
    if (codecs.length === 0) {
      const refused = sfx.safe({ ...base(ref), outputFormat: "mp3" } as never);
      expect(refused.ok).toBe(false);
    }
  });

  test("a codec the row does NOT list is refused, so the list is a limit", () => {
    const codecs = new Set(row.codecs ?? []);
    const absent = ["mp3", "opus", "flac", "aac", "vorbis"].find((c) => !codecs.has(c));
    if (absent === undefined) return;
    const result = sfx.safe({ ...base(ref), outputFormat: absent } as never);
    expect(result.ok, `${ref} must refuse ${absent}`).toBe(false);
  });

  test("both ends of the duration range compile, and outside it does not", () => {
    const range = row.durationRange;
    if (range === undefined) return;
    const [min, max] = range;
    for (const seconds of [min, max]) {
      const result = sfx.safe({ ...base(ref), durationSeconds: seconds } as never);
      expect(result.ok, `${ref} @${seconds}s: ${JSON.stringify(result.ok ? [] : result.errors)}`).toBe(
        true,
      );
    }
    // The native ElevenLabs leaf is the only row whose bounds live in a zod
    // schema rather than in fal's IR; both refuse, which is the point.
    for (const seconds of [min / 2, max + 1]) {
      const result = sfx.safe({ ...base(ref), durationSeconds: seconds } as never);
      expect(result.ok, `${ref} must refuse ${seconds}s`).toBe(false);
    }
  });

  test("an integer-only length refuses a fractional second", () => {
    const range = row.durationRange;
    if (row.durationInt !== true || range === undefined) return;
    const result = sfx.safe({ ...base(ref), durationSeconds: range[0] + 0.5 } as never);
    expect(result.ok, `${ref} must refuse a fractional second`).toBe(false);
  });

  test("every extra the row completes reaches the wire under its own name", () => {
    const extras = Object.keys(row.extras ?? {});
    for (const name of extras) {
      // Each extra is wire-verbatim, so a value of the right shape is enough;
      // the exact-value sweep is the provider validator's own job.
      const value = SAMPLE_EXTRA[name];
      if (value === undefined) continue;
      const result = sfx.safe({ ...base(ref), [name]: value } as never);
      expect(result.ok, `${ref} ${name}: ${JSON.stringify(result.ok ? [] : result.errors)}`).toBe(
        true,
      );
      if (!result.ok) continue;
      expect((result.params as Record<string, unknown>)[name]).toEqual(value);
    }
  });
});

/**
 * One legal value per extra name in this build, so the sweep above can prove
 * each one reaches the wire. Names not listed here are skipped rather than
 * guessed at — a wrong value would fail for the wrong reason.
 */
const SAMPLE_EXTRA: Readonly<Record<string, unknown>> = {
  loop: true,
  prompt_influence: 0.7,
  ambience: true,
  double_output: false,
  num_samples: 2,
  seed: 7,
  negative_prompt: "music",
  guidance_scale: 3,
  num_inference_steps: 12,
  enable_safety_checker: true,
  enable_prompt_expansion: false,
  sync_mode: false,
};

test("every extra name in the build has a sample, so the sweep is not vacuous", () => {
  const names = new Set<string>();
  for (const row of Object.values(ROWS)) {
    for (const name of Object.keys(row.extras ?? {})) names.add(name);
  }
  expect([...names].sort().filter((name) => SAMPLE_EXTRA[name] === undefined)).toEqual([]);
});
