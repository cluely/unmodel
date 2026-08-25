/**
 * The capability table for `unmodel/avatar`, committed and then **probed**.
 *
 * Keyed by REF rather than by provider, for `lipsync-capabilities`'s reason: at
 * fal the route is a parameter, so "which fields does this support" is a
 * per-ENDPOINT question.
 *
 * The row that earns this file is `image`. Seven of the nine endpoints require
 * a still; two — `veed/avatars` and `argil/avatars` — animate a catalogued
 * presenter out of a closed enum and have no image field at all. That is a
 * three-valued cell (`required` / `forbidden` / …never `optional`, in this
 * build), and it is the only capability table in the suite where a canonical
 * word's REQUIREDNESS varies by model rather than its support.
 *
 * The ninth row is the native one, and it is the same MODEL ID the lipsync
 * table serves: `sync/sync-3` is in both categories, and nothing separates the
 * two calls but the tag on the input item. At fal the same product needs two
 * endpoint ids to say that.
 */
import { describe, expect, test } from "bun:test";
import type { AvatarParams } from "../../src/core/unified/vocabulary/avatar";
import { avatar } from "../../src/unified/avatar";
import { avatar as fal } from "../../src/providers/fal/unified-avatar";
import { avatar as sync } from "../../src/providers/sync/unified-avatar";

type Support = "native" | "unsupported";

/** Walks a dot path into a compiled body: `"input.0.url"`. */
function pluck(body: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = body;
  for (const segment of path.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

interface Capability {
  ref: string;
  /** The POST this ref compiles to. */
  url: string;
  /** `required` — the endpoint animates a picture; `forbidden` — a catalogued id. */
  image: "required" | "forbidden";
  /** Where the still lands, as a dot path into the body. */
  imageAt: string;
  /**
   * What happens to `{ data, mimeType }`. fal fetches a `data:` URI; sync.
   * fetches URLs and asset ids only, and refuses bytes by name.
   */
  inline: "derived" | "unsupported";
  /** Where the voice track lands, as a dot path into the body. */
  audio: { at: string; support: Support };
  seed: Support;
  /** The enum field a preset-performer route wants instead of a picture. */
  performer?: { at: string; value: string };
  /** Extras the ref must ALSO carry for a minimal request to compile. */
  requires?: Readonly<Record<string, unknown>>;
}

const TABLE: Readonly<Record<string, Capability>> = {
  "sync-lipsync/v3/image-to-video": {
    ref: "fal/fal-ai/sync-lipsync/v3/image-to-video",
    url: "https://queue.fal.run/fal-ai/sync-lipsync/v3/image-to-video",
    imageAt: "image_url",
    inline: "derived",
    image: "required",
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
  },
  "omnihuman/v1.5": {
    ref: "fal/fal-ai/bytedance/omnihuman/v1.5",
    url: "https://queue.fal.run/fal-ai/bytedance/omnihuman/v1.5",
    imageAt: "image_url",
    inline: "derived",
    image: "required",
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
  },
  "kling/ai-avatar/v2/standard": {
    ref: "fal/fal-ai/kling-video/ai-avatar/v2/standard",
    url: "https://queue.fal.run/fal-ai/kling-video/ai-avatar/v2/standard",
    imageAt: "image_url",
    inline: "derived",
    image: "required",
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
  },
  "kling/ai-avatar/v2/pro": {
    ref: "fal/fal-ai/kling-video/ai-avatar/v2/pro",
    url: "https://queue.fal.run/fal-ai/kling-video/ai-avatar/v2/pro",
    imageAt: "image_url",
    inline: "derived",
    image: "required",
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
  },
  "longcat-single-avatar": {
    ref: "fal/fal-ai/longcat-single-avatar/image-audio-to-video",
    url: "https://queue.fal.run/fal-ai/longcat-single-avatar/image-audio-to-video",
    imageAt: "image_url",
    inline: "derived",
    image: "required",
    audio: { at: "audio_url", support: "native" },
    seed: "native",
  },
  "echomimic-v3": {
    ref: "fal/fal-ai/echomimic-v3",
    url: "https://queue.fal.run/fal-ai/echomimic-v3",
    imageAt: "image_url",
    inline: "derived",
    image: "required",
    audio: { at: "audio_url", support: "native" },
    seed: "native",
    // The one endpoint in the category whose `prompt` is REQUIRED, which is why
    // `prompt` is a per-model extra here rather than a canonical word.
    requires: { prompt: "a woman speaking to camera" },
  },
  "veed/avatars": {
    ref: "fal/veed/avatars/audio-to-video",
    url: "https://queue.fal.run/veed/avatars/audio-to-video",
    imageAt: "image_url",
    inline: "derived",
    image: "forbidden",
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
    performer: { at: "avatar_id", value: "emily_primary" },
    requires: { avatar_id: "emily_primary" },
  },
  "argil/avatars": {
    ref: "fal/argil/avatars/audio-to-video",
    url: "https://queue.fal.run/argil/avatars/audio-to-video",
    imageAt: "image_url",
    inline: "derived",
    image: "forbidden",
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
    performer: { at: "avatar", value: "Emma (UGC)" },
    requires: { avatar: "Emma (UGC)" },
  },

  // ---- sync., the native half ---------------------------------------------
  // One model, one URL, and the same id `unmodel/lipsync` serves — see the test
  // at the bottom of this file, which is the whole reason the row is here.
  "sync/sync-3": {
    ref: "sync/sync-3",
    url: "https://api.sync.so/v2/generate",
    imageAt: "input.0.url",
    inline: "unsupported",
    image: "required",
    audio: { at: "input.1.url", support: "native" },
    seed: "unsupported",
  },
};

const STILL = { url: "https://example.com/headshot.png" } as const;
const VOICE = { url: "https://example.com/vo.wav" } as const;
const PROBE_SEED = 4242;

interface Compiled {
  body: Record<string, unknown>;
  url: string;
}

function compile(row: Capability, extra: Partial<AvatarParams> = {}): Compiled | string[] {
  const result = avatar.safe({
    model: row.ref,
    audio: VOICE,
    ...(row.image === "required" ? { image: STILL } : {}),
    ...(row.requires ?? {}),
    ...extra,
  } as never);
  if (!result.ok) return result.errors.map((issue) => `${issue.code} @ ${issue.path.join(".")}`);
  const request = result.params as unknown as { request: { url: string } };
  return {
    body: JSON.parse(JSON.stringify(result.params)) as Record<string, unknown>,
    url: request.request.url,
  };
}

/**
 * The rows, widened to a string index.
 *
 * `modelParams` is `as const` and keyed by literal id — the whole point of it —
 * but this table walks the roster with a computed id, so it needs the string
 * index the literal table deliberately does not have.
 */
const ROWS = { ...fal.modelParams, ...sync.modelParams } as Readonly<
  Record<string, { readonly sources?: readonly string[] }>
>;

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
  expect((byProvider.get("sync") ?? []).sort()).toEqual([...sync.models].sort());
  expect([...byProvider.keys()].sort()).toEqual([...avatar.providers]);
});

test("the pack registers exactly two providers", () => {
  expect([...avatar.providers]).toEqual(["fal", "sync"]);
});

/**
 * The split, counted. Six still-driven and two performer-driven — and the row
 * field the type reads is the same one the adapter reads, so a drift between
 * "what compiles" and "what the editor offers" is not expressible.
 */
test("seven endpoints take a still and two take a catalogued performer", () => {
  const still = rows.filter(([, row]) => row.image === "required");
  const preset = rows.filter(([, row]) => row.image === "forbidden");
  expect(still).toHaveLength(7);
  expect(preset).toHaveLength(2);
  for (const [, row] of still) {
    expect([...(ROWS[bare(row.ref)]?.sources ?? [])]).toEqual(["image"]);
  }
  for (const [, row] of preset) {
    expect([...(ROWS[bare(row.ref)]?.sources ?? [])]).toEqual([]);
  }
});

describe.each(rows)("%s", (name, row) => {
  test(`the track lands at \`${row.audio.at}\``, () => {
    const compiled = compile(row);
    expect(compiled, `${name} could not compile a minimal request`).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(pluck(compiled.body, row.audio.at)).toBe(VOICE.url);
    expect(compiled.url).toBe(row.url);
  });

  test(`image is ${row.image}`, () => {
    if (row.image === "required") {
      const compiled = compile(row);
      expect(compiled).not.toBeInstanceOf(Array);
      if (Array.isArray(compiled)) return;
      expect(pluck(compiled.body, row.imageAt)).toBe(STILL.url);

      // …and omitting it is a refusal that names the field, not a 422.
      const result = avatar.safe({
        model: row.ref,
        audio: VOICE,
        ...(row.requires ?? {}),
      } as never);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.map((issue) => issue.path.join("."))).toContain("image");
      return;
    }

    // Forbidden: a still has nowhere to go, and the message names the enum
    // field this endpoint wants instead.
    const result = avatar.safe({
      model: row.ref,
      audio: VOICE,
      image: STILL,
      ...(row.requires ?? {}),
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((error) => error.path.join(".") === "image");
    expect(issue?.code).toBe("unsupported_param");
    expect(issue?.message).toContain("catalogued performer");
    expect(issue?.message).toContain(row.performer?.at ?? "");
  });

  test(`inline bytes are ${row.inline}`, () => {
    if (row.image === "forbidden") return;
    const compiled = compile(row, {
      image: { data: "AAAA", mimeType: "image/png" },
    } as Partial<AvatarParams>);
    if (row.inline === "unsupported") {
      // sync. FETCHES its inputs: a media item takes a `url` or an `assetId`
      // and nothing in the JSON body is a payload.
      expect(compiled).toEqual(["unsupported_param @ image"]);
      return;
    }
    expect(compiled).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(pluck(compiled.body, row.imageAt)).toBe("data:image/png;base64,AAAA");
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

  test("the performer enum is reachable, and only where it exists", () => {
    const performer = row.performer;
    if (performer === undefined) return;
    const compiled = compile(row);
    expect(compiled).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(pluck(compiled.body, performer.at)).toBe(performer.value);
  });
});

/**
 * The property that has to hold for every cell: a canonical word is either
 * **refused** or **sent**. Never accepted and ignored.
 */
describe("no silent drops, over the whole vocabulary", () => {
  test.each(rows)("%s", (name, row) => {
    const bare = compile(row);
    expect(bare).not.toBeInstanceOf(Array);
    if (Array.isArray(bare)) return;
    const baseline = JSON.stringify(bare);

    const probes: Array<Partial<AvatarParams>> = [
      { seed: 0 },
      { seed: PROBE_SEED },
      { image: { data: "AAAA", mimeType: "image/webp" } } as Partial<AvatarParams>,
      { audio: { data: "BBBB", mimeType: "audio/wav" } } as Partial<AvatarParams>,
      { audio: { data: "data:audio/mpeg;base64,CCCC" } } as Partial<AvatarParams>,
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
 * The category boundary, from the other side of the split asserted in
 * `lipsync-capabilities.test.ts`: no avatar endpoint takes a clip.
 */
test("no endpoint in this category is clip-driven", () => {
  for (const [, row] of rows) {
    const sources = [...(ROWS[bare(row.ref)]?.sources ?? [])];
    expect(sources).not.toContain("video");
  }
});

/**
 * The sharpest statement of the clip/still split there is, and it needed a
 * native provider to make it: ONE url, ONE model id, two categories.
 *
 * At fal the same product is `fal-ai/sync-lipsync/v3` and
 * `fal-ai/sync-lipsync/v3/image-to-video` — two endpoint ids, so the split
 * looks like a fact about paths. At sync. the path never moves and the id never
 * moves; only `input[0].type` does. If the categories were one category with an
 * optional `source`, there would be nothing left to tell these two apart.
 */
test("sync/sync-3 is in this category AND in lipsync, as the same id", () => {
  const syncModels: readonly string[] = sync.models;
  expect(syncModels).toEqual(["sync-3"]);

  const still = avatar.safe({ model: "sync/sync-3", image: STILL, audio: VOICE } as never);
  expect(still.ok, JSON.stringify(still.ok ? [] : still.errors)).toBe(true);
  if (!still.ok) return;
  const body = JSON.parse(JSON.stringify(still.params)) as Record<string, unknown>;
  const request = still.params as unknown as { request: { url: string } };

  expect(body["model"]).toBe("sync-3");
  expect(request.request.url).toBe("https://api.sync.so/v2/generate");
  // The one difference from the lipsync call: the tag on the first input item.
  expect(pluck(body, "input.0.type")).toBe("image");
  expect(pluck(body, "input.1.type")).toBe("audio");
});
