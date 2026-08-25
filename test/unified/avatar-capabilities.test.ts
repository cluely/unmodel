/**
 * The capability table for `unmodel/avatar`, committed and then **probed**.
 *
 * Keyed by REF rather than by provider, for `lipsync-capabilities`'s reason: at
 * fal the route is a parameter, so "which fields does this support" is a
 * per-ENDPOINT question.
 *
 * The row that earns this file is `image`. Six of the eight endpoints require a
 * still; two — `veed/avatars` and `argil/avatars` — animate a catalogued
 * presenter out of a closed enum and have no image field at all. That is a
 * three-valued cell (`required` / `forbidden` / …never `optional`, in this
 * build), and it is the only capability table in the suite where a canonical
 * word's REQUIREDNESS varies by model rather than its support.
 */
import { describe, expect, test } from "bun:test";
import type { AvatarParams } from "../../src/core/unified/vocabulary/avatar";
import { avatar } from "../../src/unified/avatar";
import { avatar as fal } from "../../src/providers/fal/unified-avatar";

type Support = "native" | "unsupported";

interface Capability {
  ref: string;
  /** `required` — the endpoint animates a picture; `forbidden` — a catalogued id. */
  image: "required" | "forbidden";
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
    image: "required",
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
  },
  "omnihuman/v1.5": {
    ref: "fal/fal-ai/bytedance/omnihuman/v1.5",
    image: "required",
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
  },
  "kling/ai-avatar/v2/standard": {
    ref: "fal/fal-ai/kling-video/ai-avatar/v2/standard",
    image: "required",
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
  },
  "kling/ai-avatar/v2/pro": {
    ref: "fal/fal-ai/kling-video/ai-avatar/v2/pro",
    image: "required",
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
  },
  "longcat-single-avatar": {
    ref: "fal/fal-ai/longcat-single-avatar/image-audio-to-video",
    image: "required",
    audio: { at: "audio_url", support: "native" },
    seed: "native",
  },
  "echomimic-v3": {
    ref: "fal/fal-ai/echomimic-v3",
    image: "required",
    audio: { at: "audio_url", support: "native" },
    seed: "native",
    // The one endpoint in the category whose `prompt` is REQUIRED, which is why
    // `prompt` is a per-model extra here rather than a canonical word.
    requires: { prompt: "a woman speaking to camera" },
  },
  "veed/avatars": {
    ref: "fal/veed/avatars/audio-to-video",
    image: "forbidden",
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
    performer: { at: "avatar_id", value: "emily_primary" },
    requires: { avatar_id: "emily_primary" },
  },
  "argil/avatars": {
    ref: "fal/argil/avatars/audio-to-video",
    image: "forbidden",
    audio: { at: "audio_url", support: "native" },
    seed: "unsupported",
    performer: { at: "avatar", value: "Emma (UGC)" },
    requires: { avatar: "Emma (UGC)" },
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
const ROWS = fal.modelParams as Readonly<Record<string, { readonly sources?: readonly string[] }>>;

const rows = Object.entries(TABLE);

test("the table covers exactly the endpoints the adapter serves", () => {
  expect(rows.map(([, row]) => row.ref.slice("fal/".length)).sort()).toEqual([...fal.models].sort());
});

test("the pack registers exactly one provider", () => {
  expect([...avatar.providers]).toEqual(["fal"]);
});

/**
 * The split, counted. Six still-driven and two performer-driven — and the row
 * field the type reads is the same one the adapter reads, so a drift between
 * "what compiles" and "what the editor offers" is not expressible.
 */
test("six endpoints take a still and two take a catalogued performer", () => {
  const still = rows.filter(([, row]) => row.image === "required");
  const preset = rows.filter(([, row]) => row.image === "forbidden");
  expect(still).toHaveLength(6);
  expect(preset).toHaveLength(2);
  for (const [, row] of still) {
    expect([...(ROWS[row.ref.slice("fal/".length)]?.sources ?? [])]).toEqual(["image"]);
  }
  for (const [, row] of preset) {
    expect([...(ROWS[row.ref.slice("fal/".length)]?.sources ?? [])]).toEqual([]);
  }
});

describe.each(rows)("%s", (name, row) => {
  test(`the track lands at \`${row.audio.at}\``, () => {
    const compiled = compile(row);
    expect(compiled, `${name} could not compile a minimal request`).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(compiled.body[row.audio.at]).toBe(VOICE.url);
    expect(compiled.url).toBe(`https://queue.fal.run/${row.ref.slice("fal/".length)}`);
  });

  test(`image is ${row.image}`, () => {
    if (row.image === "required") {
      const compiled = compile(row);
      expect(compiled).not.toBeInstanceOf(Array);
      if (Array.isArray(compiled)) return;
      expect(compiled.body["image_url"]).toBe(STILL.url);

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

  test("inline bytes are DERIVED into a data: URI, never dropped", () => {
    if (row.image === "forbidden") return;
    const compiled = compile(row, {
      image: { data: "AAAA", mimeType: "image/png" },
    } as Partial<AvatarParams>);
    expect(compiled).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(compiled.body["image_url"]).toBe("data:image/png;base64,AAAA");
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
    expect(compiled.body[performer.at]).toBe(performer.value);
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
    const sources = [...(ROWS[row.ref.slice("fal/".length)]?.sources ?? [])];
    expect(sources).not.toContain("video");
  }
});
