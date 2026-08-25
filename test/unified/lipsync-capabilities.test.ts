/**
 * The capability table for `unmodel/lipsync`, committed and then **probed**.
 *
 * Keyed by REF rather than by provider, which is the honest shape here and a
 * departure from its five siblings. At fal the route is a parameter, so "which
 * fields does this support" is a per-ENDPOINT question and a per-provider table
 * would answer it ten ways at once.
 *
 * Two providers now, and four of fal's ten endpoints are the OTHER provider's
 * models resold — which makes the interesting rows the ones that face each
 * other. `fal/fal-ai/sync-lipsync/v2` and `sync/lipsync-2` are the same
 * weights, and they disagree on where the clip lands (a flat `video_url` versus
 * `input[0].url` in a tagged array), on where the mismatch mode lands
 * (`sync_mode` at the root versus `options.sync_mode`) and on whether inline
 * bytes are expressible at all. Neither is a superset.
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
import { lipsync as sync } from "../../src/providers/sync/unified-lipsync";

type Support = "native" | "derived" | "unsupported";

interface Capability {
  ref: string;
  /** The POST this ref compiles to. */
  url: string;
  /** Where the clip lands, as a dot path into the body. */
  source: { at: string; support: Support };
  /** Where the voice track lands, as a dot path into the body. */
  audio: { at: string; support: Support };
  seed: Support;
  /**
   * What happens to `{ data, mimeType }`. fal fetches a `data:` URI; sync.
   * fetches URLs and asset ids only, and refuses bytes by name.
   */
  inline: "derived" | "unsupported";
  /**
   * This endpoint's own word for "what to do when the audio outlasts the clip",
   * as a dot path — `sync_mode` at fal, `options.sync_mode` at sync.
   */
  mismatch: string | undefined;
}

/** Walks a dot path into a compiled body: `"input.0.url"`. */
function pluck(body: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = body;
  for (const segment of path.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

const TABLE: Readonly<Record<string, Capability>> = {
  "sync-lipsync/v3": {
    ref: "fal/fal-ai/sync-lipsync/v3",
    url: "https://queue.fal.run/fal-ai/sync-lipsync/v3",
    inline: "derived",
    source: { at: "video_url", support: "native" },
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
    mismatch: "sync_mode",
  },
  "sync-lipsync/v2": {
    ref: "fal/fal-ai/sync-lipsync/v2",
    url: "https://queue.fal.run/fal-ai/sync-lipsync/v2",
    inline: "derived",
    source: { at: "video_url", support: "native" },
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
    mismatch: "sync_mode",
  },
  "sync-lipsync/v2/pro": {
    ref: "fal/fal-ai/sync-lipsync/v2/pro",
    url: "https://queue.fal.run/fal-ai/sync-lipsync/v2/pro",
    inline: "derived",
    source: { at: "video_url", support: "native" },
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
    mismatch: "sync_mode",
  },
  "veed/lipsync": {
    ref: "fal/veed/lipsync",
    url: "https://queue.fal.run/veed/lipsync",
    inline: "derived",
    source: { at: "video_url", support: "native" },
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
    mismatch: undefined,
  },
  "veed/lipsync/v2": {
    ref: "fal/veed/lipsync/v2",
    url: "https://queue.fal.run/veed/lipsync/v2",
    inline: "derived",
    source: { at: "video_url", support: "native" },
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
    mismatch: undefined,
  },
  latentsync: {
    ref: "fal/fal-ai/latentsync",
    url: "https://queue.fal.run/fal-ai/latentsync",
    inline: "derived",
    source: { at: "video_url", support: "native" },
    audio: { at: "audio_url", support: "native" },
    // The ONE endpoint in the category with a seed, which is why this is a
    // per-model refusal rather than an adapter-wide `unsupported` (risk R7).
    seed: "native",
    mismatch: "loop_mode",
  },
  "kling/lipsync": {
    ref: "fal/fal-ai/kling-video/lipsync/audio-to-video",
    url: "https://queue.fal.run/fal-ai/kling-video/lipsync/audio-to-video",
    inline: "derived",
    source: { at: "video_url", support: "native" },
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
    mismatch: undefined,
  },
  "pixverse/lipsync": {
    ref: "fal/fal-ai/pixverse/lipsync",
    url: "https://queue.fal.run/fal-ai/pixverse/lipsync",
    inline: "derived",
    source: { at: "video_url", support: "native" },
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
    mismatch: undefined,
  },
  "heygen/v3/lipsync/precision": {
    ref: "fal/fal-ai/heygen/v3/lipsync/precision",
    url: "https://queue.fal.run/fal-ai/heygen/v3/lipsync/precision",
    inline: "derived",
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
    url: "https://queue.fal.run/fal-ai/heygen/v3/lipsync/speed",
    inline: "derived",
    source: { at: "video_url", support: "native" },
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
    mismatch: undefined,
  },

  // ---- sync., the native half ---------------------------------------------
  // One URL for all five models, and the body is a tagged ARRAY rather than two
  // flat fields — which is what carries `refId`s, `segments` and dubbing, none
  // of which survives fal's flattening of the same models.
  "sync/lipsync-2": {
    ref: "sync/lipsync-2",
    url: "https://api.sync.so/v2/generate",
    inline: "unsupported",
    source: { at: "input.0.url", support: "native" },
    audio: { at: "input.1.url", support: "native" },
    seed: "unsupported",
    // The same five-arm enum fal exposes at the root on its resale of this very
    // model, one level down. Same vendor, same word, two nestings — which is
    // why it is a per-model extra at both and not canonical vocabulary.
    mismatch: "options.sync_mode",
  },
  "sync/sync-3": {
    ref: "sync/sync-3",
    url: "https://api.sync.so/v2/generate",
    inline: "unsupported",
    source: { at: "input.0.url", support: "native" },
    audio: { at: "input.1.url", support: "native" },
    seed: "unsupported",
    mismatch: "options.sync_mode",
  },
  "sync/react-1": {
    ref: "sync/react-1",
    url: "https://api.sync.so/v2/generate",
    inline: "unsupported",
    source: { at: "input.0.url", support: "native" },
    audio: { at: "input.1.url", support: "native" },
    seed: "unsupported",
    mismatch: "options.sync_mode",
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

/** The bare model id a ref points at, and the provider it names. */
const bare = (ref: string): string => ref.slice(ref.indexOf("/") + 1);
const providerOf = (ref: string): string => ref.slice(0, ref.indexOf("/"));

test("the table covers every endpoint both adapters serve", () => {
  const byProvider = new Map<string, string[]>();
  for (const [, row] of rows) {
    const list = byProvider.get(providerOf(row.ref)) ?? [];
    list.push(bare(row.ref));
    byProvider.set(providerOf(row.ref), list);
  }
  expect((byProvider.get("fal") ?? []).sort()).toEqual([...fal.models].sort());
  // sync. is sampled rather than exhausted: five models, one route, and the
  // three here are the three SHAPES — the default, the classic and the
  // expressive one. `lipsync-presets.test.ts` sweeps the whole roster.
  const syncRows = byProvider.get("sync") ?? [];
  expect(syncRows.length).toBeGreaterThanOrEqual(3);
  const syncModels: readonly string[] = sync.models;
  for (const id of syncRows) expect(syncModels).toContain(id);
  expect([...byProvider.keys()].sort()).toEqual([...lipsync.providers]);
});

test("the pack registers exactly two providers", () => {
  expect([...lipsync.providers]).toEqual(["fal", "sync"]);
});

describe.each(rows)("%s", (name, row) => {
  test(`the clip lands at \`${row.source.at}\` and the track at \`${row.audio.at}\``, () => {
    const compiled = compile(row);
    expect(compiled, `${name} could not compile a minimal request`).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(pluck(compiled.body, row.source.at)).toBe(CLIP.url);
    expect(pluck(compiled.body, row.audio.at)).toBe(VOICE.url);
    expect(compiled.url).toBe(row.url);
  });

  test(`inline bytes are ${row.inline}`, () => {
    const compiled = compile(row, {
      source: { data: "AAAA", mimeType: "video/mp4" },
    } as Partial<LipsyncParams>);
    if (row.inline === "unsupported") {
      // sync. FETCHES its inputs: a media item takes a `url` or an `assetId`
      // and nothing in the JSON body is a payload, so the refusal names the
      // asset-upload endpoint rather than building a `data:` URI it would fail
      // to fetch.
      expect(compiled).toEqual(["unsupported_param @ source"]);
      return;
    }
    expect(compiled).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(pluck(compiled.body, row.source.at)).toBe("data:video/mp4;base64,AAAA");
  });

  test("inline bytes with no media type are refused, not guessed", () => {
    // A `data:;base64,` string is a 400 at every one of these routes, so the
    // refusal names the field rather than building one. At the routes that take
    // no bytes at all the refusal comes one step earlier and says so instead.
    expect(compile(row, { source: { data: "AAAA" } } as Partial<LipsyncParams>)).toEqual([
      row.inline === "unsupported" ? "unsupported_param @ source" : "invalid_shape @ source",
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
      // The row states the PATH the word lands at, because the same word nests
      // differently at the two providers.
      if (row.mismatch !== undefined && row.mismatch.endsWith(word)) {
        expect(compiled, `${name} should take ${word}`).not.toBeInstanceOf(Array);
        if (Array.isArray(compiled)) continue;
        expect(pluck(compiled.body, row.mismatch)).toBe(value);
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
  const ROWS = { ...fal.modelParams, ...sync.modelParams } as Readonly<
    Record<string, { readonly sources?: readonly string[] }>
  >;
  const declared = Object.values(ROWS).map((entry) => [...(entry.sources ?? [])]);
  expect(declared.every((sources) => sources.length === 1 && sources[0] === "video")).toBe(true);
  for (const [, row] of rows) expect(ROWS[bare(row.ref)]?.sources).toEqual(["video"]);
});

/**
 * The comparison the second provider exists to make.
 *
 * `fal/fal-ai/sync-lipsync/v2` and `sync/lipsync-2` are the same weights — fal
 * even keeps sync.'s own `model: "lipsync-2"` field on the wire — and the two
 * requests do not look alike. Two flat URL fields at the reseller; a tagged
 * array at the vendor, with the shared `sync_mode` one level down under
 * `options`. And each can do something the other cannot: fal takes inline
 * bytes, sync. takes `segments` and `dubParams`.
 */
test("the same sync. model disagrees with itself through the two providers", () => {
  const viaFal = TABLE["sync-lipsync/v2"] as Capability;
  const natively = TABLE["sync/lipsync-2"] as Capability;

  expect(viaFal.source.at).toBe("video_url");
  expect(natively.source.at).toBe("input.0.url");
  expect(viaFal.mismatch).toBe("sync_mode");
  expect(natively.mismatch).toBe("options.sync_mode");
  expect(viaFal.inline).toBe("derived");
  expect(natively.inline).toBe("unsupported");

  // And the wire body proves it, rather than the table asserting it.
  const falBody = compile(viaFal);
  const syncBody = compile(natively);
  expect(falBody).not.toBeInstanceOf(Array);
  expect(syncBody).not.toBeInstanceOf(Array);
  if (Array.isArray(falBody) || Array.isArray(syncBody)) return;
  // Natively the model id IS a body field. At fal the ENDPOINT is the model, so
  // the same id has moved into the URL and out of the body entirely — and
  // `sync_mode`, sync.'s own word, is the one thing the resale kept.
  expect(syncBody.body["model"]).toBe("lipsync-2");
  expect(falBody.body["model"]).toBeUndefined();
  expect(falBody.url).toContain("sync-lipsync/v2");
  expect(
    Object.keys((fal.modelParams["fal-ai/sync-lipsync/v2" as never] as {
      extras: Record<string, unknown>;
    }).extras),
  ).toEqual(["sync_mode"]);
  expect(Object.keys(falBody.body).sort()).not.toEqual(Object.keys(syncBody.body).sort());

  // The two request MODES sync. has and fal's resale cannot express at all.
  const nativeExtras = Object.keys(
    (sync.modelParams["lipsync-2"] as { extras: Record<string, unknown> }).extras,
  );
  for (const mode of ["segments", "dubParams"]) expect(nativeExtras, mode).toContain(mode);
  const falExtras = Object.keys(
    (fal.modelParams["fal-ai/sync-lipsync/v2" as never] as { extras: Record<string, unknown> })
      .extras,
  );
  for (const mode of ["segments", "dubParams"]) expect(falExtras, mode).not.toContain(mode);
});
