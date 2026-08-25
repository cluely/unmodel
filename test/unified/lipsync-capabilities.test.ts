/**
 * The capability table for `unmodel/lipsync`, committed and then **probed**.
 *
 * One provider and ten endpoints, so the table is keyed by REF rather than by
 * provider — which is the honest shape here and a departure from its five
 * siblings. At fal the route is a parameter, so "which fields does this
 * support" is a per-ENDPOINT question and a per-provider table would answer it
 * ten ways at once.
 *
 * The words mean what they mean everywhere else in this suite:
 *
 * | word | meaning |
 * |---|---|
 * | `native` | a rename — the value the caller wrote reaches the wire unchanged |
 * | `derived` | expressible, but computed (a `data:` URI built from inline bytes) |
 * | `unsupported` | this endpoint has no field for it; the adapter refuses it by name |
 */
import { describe, expect, test } from "bun:test";
import type { LipsyncParams } from "../../src/core/unified/vocabulary/lipsync";
import { lipsync } from "../../src/unified/lipsync";
import { lipsync as fal } from "../../src/providers/fal/unified-lipsync";

type Support = "native" | "derived" | "unsupported";

interface Capability {
  ref: string;
  /** The wire field the clip lands in. */
  source: { at: string; support: Support };
  /** The wire field the voice track lands in. */
  audio: { at: string; support: Support };
  seed: Support;
  /** This endpoint's own word for "what to do when the audio outlasts the clip". */
  mismatch: string | undefined;
}

const TABLE: Readonly<Record<string, Capability>> = {
  "sync-lipsync/v3": {
    ref: "fal/fal-ai/sync-lipsync/v3",
    source: { at: "video_url", support: "native" },
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
    mismatch: "sync_mode",
  },
  "sync-lipsync/v2": {
    ref: "fal/fal-ai/sync-lipsync/v2",
    source: { at: "video_url", support: "native" },
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
    mismatch: "sync_mode",
  },
  "sync-lipsync/v2/pro": {
    ref: "fal/fal-ai/sync-lipsync/v2/pro",
    source: { at: "video_url", support: "native" },
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
    mismatch: "sync_mode",
  },
  "veed/lipsync": {
    ref: "fal/veed/lipsync",
    source: { at: "video_url", support: "native" },
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
    mismatch: undefined,
  },
  "veed/lipsync/v2": {
    ref: "fal/veed/lipsync/v2",
    source: { at: "video_url", support: "native" },
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
    mismatch: undefined,
  },
  latentsync: {
    ref: "fal/fal-ai/latentsync",
    source: { at: "video_url", support: "native" },
    audio: { at: "audio_url", support: "native" },
    // The ONE endpoint in the category with a seed, which is why this is a
    // per-model refusal rather than an adapter-wide `unsupported` (risk R7).
    seed: "native",
    mismatch: "loop_mode",
  },
  "kling/lipsync": {
    ref: "fal/fal-ai/kling-video/lipsync/audio-to-video",
    source: { at: "video_url", support: "native" },
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
    mismatch: undefined,
  },
  "pixverse/lipsync": {
    ref: "fal/fal-ai/pixverse/lipsync",
    source: { at: "video_url", support: "native" },
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
    mismatch: undefined,
  },
  "heygen/v3/lipsync/precision": {
    ref: "fal/fal-ai/heygen/v3/lipsync/precision",
    source: { at: "video_url", support: "native" },
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
    // HeyGen spells the mismatch idea `enable_dynamic_duration` (a boolean),
    // which is a third spelling of the idea `sync_mode` and `loop_mode` already
    // spell two ways — more evidence for keeping it out of the vocabulary.
    mismatch: undefined,
  },
  "heygen/v3/lipsync/speed": {
    ref: "fal/fal-ai/heygen/v3/lipsync/speed",
    source: { at: "video_url", support: "native" },
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
    mismatch: undefined,
  },
};

const CLIP = { url: "https://example.com/take-3.mp4" } as const;
const VOICE = { url: "https://example.com/vo.wav" } as const;
const PROBE_SEED = 4242;

interface Compiled {
  body: Record<string, unknown>;
  url: string;
}

function compile(row: Capability, extra: Partial<LipsyncParams> = {}): Compiled | string[] {
  const result = lipsync.safe({
    model: row.ref,
    source: CLIP,
    audio: VOICE,
    ...extra,
  } as never);
  if (!result.ok) return result.errors.map((issue) => `${issue.code} @ ${issue.path.join(".")}`);
  const request = result.params as unknown as { request: { url: string } };
  return {
    body: JSON.parse(JSON.stringify(result.params)) as Record<string, unknown>,
    url: request.request.url,
  };
}

const rows = Object.entries(TABLE);

test("the table covers exactly the endpoints the adapter serves", () => {
  expect(rows.map(([, row]) => row.ref.slice("fal/".length)).sort()).toEqual([...fal.models].sort());
});

test("the pack registers exactly one provider", () => {
  expect([...lipsync.providers]).toEqual(["fal"]);
});

describe.each(rows)("%s", (name, row) => {
  test(`the clip lands at \`${row.source.at}\` and the track at \`${row.audio.at}\``, () => {
    const compiled = compile(row);
    expect(compiled, `${name} could not compile a minimal request`).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(compiled.body[row.source.at]).toBe(CLIP.url);
    expect(compiled.body[row.audio.at]).toBe(VOICE.url);
    expect(compiled.url).toBe(`https://queue.fal.run/${row.ref.slice("fal/".length)}`);
  });

  test("inline bytes are DERIVED into a data: URI, never dropped", () => {
    const compiled = compile(row, {
      source: { data: "AAAA", mimeType: "video/mp4" },
    } as Partial<LipsyncParams>);
    expect(compiled).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(compiled.body[row.source.at]).toBe("data:video/mp4;base64,AAAA");
  });

  test("inline bytes with no media type are refused, not guessed", () => {
    // A `data:;base64,` string is a 400 at every one of these routes, so the
    // refusal names the field rather than building one.
    expect(compile(row, { source: { data: "AAAA" } } as Partial<LipsyncParams>)).toEqual([
      "invalid_shape @ source",
    ]);
  });

  test(`seed is ${row.seed}`, () => {
    const compiled = compile(row, { seed: PROBE_SEED });
    if (row.seed === "unsupported") {
      expect(compiled).toEqual(["unsupported_param @ seed"]);
      return;
    }
    expect(compiled).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(compiled.body["seed"]).toBe(PROBE_SEED);
  });

  test("the duration-mismatch knob is this endpoint's own word, or none", () => {
    const bare = compile(row);
    expect(bare).not.toBeInstanceOf(Array);
    if (Array.isArray(bare)) return;

    for (const [word, value] of [
      ["sync_mode", "bounce"],
      ["loop_mode", "pingpong"],
    ] as const) {
      const compiled = compile(row, { [word]: value } as never);
      if (row.mismatch === word) {
        expect(compiled, `${name} should take ${word}`).not.toBeInstanceOf(Array);
        if (Array.isArray(compiled)) continue;
        expect(compiled.body[word]).toBe(value);
      } else {
        // Not this endpoint's word: the kernel's envelope check refuses it as
        // a key no model on this adapter declares, or the extras check does.
        // Either way it must not reach the wire silently.
        if (!Array.isArray(compiled)) {
          expect(compiled.body[word], `${name} accepted ${word} it does not declare`).toBeUndefined();
        }
      }
    }
  });
});

/**
 * The property that has to hold for every cell, not just the probed ones: a
 * canonical word is either **refused** or **sent**. Never accepted and ignored.
 */
describe("no silent drops, over the whole vocabulary", () => {
  test.each(rows)("%s", (name, row) => {
    const bare = compile(row);
    expect(bare).not.toBeInstanceOf(Array);
    if (Array.isArray(bare)) return;
    const baseline = JSON.stringify(bare);

    const probes: Array<Partial<LipsyncParams>> = [
      { seed: 0 },
      { seed: PROBE_SEED },
      { source: { data: "AAAA", mimeType: "video/webm" } } as Partial<LipsyncParams>,
      { audio: { data: "BBBB", mimeType: "audio/wav" } } as Partial<LipsyncParams>,
      { audio: { data: "data:audio/mpeg;base64,CCCC" } } as Partial<LipsyncParams>,
    ];
    const dropped: string[] = [];
    for (const probe of probes) {
      const compiled = compile(row, probe);
      if (Array.isArray(compiled)) continue; // refused — the other half
      if (JSON.stringify(compiled) === baseline) dropped.push(JSON.stringify(probe));
    }
    expect(dropped, `${name} accepted and ignored a param`).toEqual([]);
  });
});

/**
 * The category's own boundary, asserted from the table rather than from prose:
 * every lipsync endpoint takes its performance as a CLIP. The day one takes a
 * still, this test fails and the `sources` mechanism is what will carry it.
 */
test("every endpoint in this category is clip-driven", () => {
  for (const [, row] of rows) expect(row.source.at).toBe("video_url");
  const declared = Object.values(fal.modelParams).map((entry) => [...(entry.sources ?? [])]);
  expect(declared.every((sources) => sources.length === 1 && sources[0] === "video")).toBe(true);
});
