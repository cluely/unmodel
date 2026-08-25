/**
 * The capability table for `unmodel/music`, committed and then **probed**.
 *
 * Two providers and five canonical words, so the table is small — and the one
 * row that matters most is `durationSeconds`, where the two providers disagree
 * about the unit by a factor of a thousand. That is exactly the kind of
 * disagreement a translation layer exists to absorb, and exactly the kind that
 * is catastrophic and invisible when it goes wrong: a ninety-millisecond track
 * still returns 200 OK.
 *
 * The four words mean what they mean everywhere else in this suite:
 *
 * | word | meaning |
 * |---|---|
 * | `native` | a rename — the value the caller wrote reaches the wire unchanged |
 * | `derived` | expressible, but computed |
 * | `unsupported` | the provider has no field for it; the kernel rejects it before compile |
 */
import { describe, expect, test } from "bun:test";
import type { AudioFormatRequest } from "../../src/core/unified/vocabulary/audio";
import type { MusicParams } from "../../src/core/unified/vocabulary/music";
import { music } from "../../src/unified/music";
import { music as elevenlabs } from "../../src/providers/elevenlabs/unified-music";
import { music as google } from "../../src/providers/google/unified-music";
import { music as mureka } from "../../src/providers/mureka/unified";
import { music as stability } from "../../src/providers/stability/unified-music";

type Support = "native" | "derived" | "unsupported";

/** Where an encoding lands — three of the five placements the speech wave named. */
type FormatShape = "codec" | "composite" | "object";

interface Capability {
  ref: string;
  adapter: Readonly<{
    provider: string;
    unsupported?: Readonly<Partial<Record<string, string>>>;
  }>;
  /**
   * Canonical params every plain probe for this provider must carry. Mureka is
   * the entry that needs one: the song route requires `lyrics` (a per-model
   * extra), so a bare prompt is (correctly) rejected before any row could be
   * observed.
   */
  base?: Partial<MusicParams>;
  /**
   * The full extra set for the `instrumental` probe, when `base` cannot ride
   * along — mureka's `instrumental: true` compiles to the instrumental route,
   * where the song route's `lyrics` is a cross-route error.
   */
  instrumentalProbe?: Partial<MusicParams>;
  durationSeconds: Support;
  /** The wire field the duration lands in, and the factor applied to it. Absent when `durationSeconds` is unsupported. */
  duration?: { at: string; perSecond: number };
  instrumental: Support;
  seed: Support;
  /** Absent when the provider has no output-format field at all. */
  format?: { shape: FormatShape; at: string; inQuery: boolean };
  /** An encoding this provider can express — the probe for the format row. */
  probe?: AudioFormatRequest;
}

const TABLE: Readonly<Record<string, Capability>> = {
  elevenlabs: {
    ref: "elevenlabs/music_v1",
    adapter: elevenlabs,
    durationSeconds: "derived",
    duration: { at: "music_length_ms", perSecond: 1000 },
    instrumental: "native",
    seed: "native",
    format: { shape: "composite", at: "output_format", inQuery: true },
    probe: { format: "mp3", sampleRate: 44100, bitrate: 128000 },
  },
  stability: {
    ref: "stability/stable-audio-2",
    adapter: stability,
    durationSeconds: "native",
    duration: { at: "duration", perSecond: 1 },
    instrumental: "unsupported",
    seed: "native",
    format: { shape: "codec", at: "output_format", inQuery: false },
    probe: "mp3",
  },
  mureka: {
    ref: "mureka/mureka-9.5",
    adapter: mureka,
    // POST /v1/song/generate requires `lyrics` (per-model extra) …
    base: { lyrics: "[Verse]\nBrushed drums under a slow tide." } as Partial<MusicParams>,
    // … and the instrumental route refuses it, so that probe rides alone.
    instrumentalProbe: { instrumental: true },
    durationSeconds: "unsupported",
    instrumental: "derived",
    seed: "unsupported",
    // No output-format field on either route: succeeded tasks answer mp3 +
    // flac/wav URLs unconditionally.
  },
  google: {
    ref: "google/lyria-3-pro-preview",
    adapter: google,
    durationSeconds: "unsupported",
    instrumental: "unsupported",
    seed: "native",
    format: { shape: "object", at: "response_format", inQuery: false },
    probe: "mp3",
  },
};

const PROBE_PROMPT = "slow post-rock build, brushed drums";
const PROBE_SECONDS = 90;
const PROBE_SEED = 4242;

interface Compiled {
  body: Record<string, unknown>;
  url: string;
}

function compile(
  row: Capability,
  extra: Partial<MusicParams>,
  { omitBase = false }: { omitBase?: boolean } = {},
): Compiled | string[] {
  const base = omitBase ? undefined : row.base;
  const result = music.safe({ model: row.ref, prompt: PROBE_PROMPT, ...base, ...extra } as never);
  if (!result.ok) return result.errors.map((issue) => `${issue.code} @ ${issue.path.join(".")}`);
  const request = result.params as unknown as { request: { url: string } };
  return {
    body: JSON.parse(JSON.stringify(result.params)) as Record<string, unknown>,
    url: request.request.url,
  };
}

function carries(compiled: Compiled, value: string | number | boolean): boolean {
  const wanted = String(value);
  let found = false;
  const walk = (node: unknown): void => {
    if (found) return;
    if (typeof node !== "object" || node === null) {
      if (String(node) === wanted) found = true;
      return;
    }
    for (const item of Object.values(node)) walk(item);
  };
  walk(compiled.body);
  return found || [...new URL(compiled.url).searchParams.values()].includes(wanted);
}

function serialize(compiled: Compiled): string {
  return JSON.stringify([compiled.body, compiled.url]);
}

function wireValue(compiled: Compiled, at: string, inQuery: boolean): unknown {
  if (inQuery) return new URL(compiled.url).searchParams.get(at);
  return compiled.body[at];
}

const rows = Object.entries(TABLE);

test("the table covers exactly the providers in the pack", () => {
  expect(rows.map(([provider]) => provider).sort()).toEqual([...music.providers]);
});

describe.each(rows)("%s", (provider, row) => {
  const instrumentalExtra = row.instrumentalProbe ?? { instrumental: true };
  const scalars = [
    [
      "durationSeconds",
      row.durationSeconds,
      PROBE_SECONDS,
      { durationSeconds: PROBE_SECONDS },
      false,
    ],
    ["instrumental", row.instrumental, true, instrumentalExtra, row.instrumentalProbe !== undefined],
    ["seed", row.seed, PROBE_SEED, { seed: PROBE_SEED }, false],
  ] as const;

  test.each(scalars)("%s is %s", (field, support, probe, extra, omitBase) => {
    const declared = row.adapter.unsupported?.[field];
    if (support === "unsupported") {
      expect(declared, `${provider}.unsupported.${field}`).toBeDefined();
      expect(compile(row, extra as Partial<MusicParams>, { omitBase })).toEqual([
        `unsupported_param @ ${field}`,
      ]);
      return;
    }
    expect(declared, `${provider} must not declare ${field} unsupported`).toBeUndefined();

    const compiled = compile(row, extra as Partial<MusicParams>, { omitBase });
    expect(compiled, `${provider} could not compile a ${field} probe`).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(carries(compiled, probe), `${provider} ${field} verbatim`).toBe(support === "native");

    const without = compile(row, {});
    expect(Array.isArray(without)).toBe(false);
    if (Array.isArray(without)) return;
    expect(serialize(compiled), `${provider} silently dropped ${field}`).not.toBe(
      serialize(without),
    );
  });

  /**
   * The unit, asserted as arithmetic rather than as a fixture. `perSecond` is
   * the only number in this category that can be wrong in a way the API will
   * happily accept.
   */
  test(`durationSeconds ${row.duration ? `lands at \`${row.duration.at}\` × ${row.duration.perSecond}` : "has no wire field"}`, () => {
    if (row.duration === undefined) {
      // The provider has no duration field at all — the scalar row above
      // already proved the kernel rejects it before compile.
      expect(row.durationSeconds).toBe("unsupported");
      return;
    }
    const compiled = compile(row, { durationSeconds: PROBE_SECONDS });
    expect(compiled).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(compiled.body[row.duration.at]).toBe(PROBE_SECONDS * row.duration.perSecond);
  });

  test("a duration that is not a whole number of wire units is refused, not rounded", () => {
    if (row.duration === undefined) return;
    // 90.0005 s is 90000.5 ms — expressible at Stability (seconds are
    // fractional there) and not at ElevenLabs, whose field counts integers.
    const compiled = compile(row, { durationSeconds: 90.0005 });
    if (row.duration.perSecond === 1) {
      expect(compiled).not.toBeInstanceOf(Array);
      return;
    }
    expect(compiled).toEqual(["invalid_shape @ durationSeconds"]);
  });

  test(`outputFormat ${row.format ? `lands as a ${row.format.shape} at \`${row.format.at}\`` : "has no wire field"}`, () => {
    if (row.format === undefined || row.probe === undefined) {
      // No format field anywhere on the wire — the kernel must say so.
      expect(row.adapter.unsupported?.outputFormat, `${provider}.unsupported.outputFormat`).toBeDefined();
      expect(compile(row, { outputFormat: "mp3" })).toEqual(["unsupported_param @ outputFormat"]);
      return;
    }
    const compiled = compile(row, { outputFormat: row.probe });
    expect(compiled).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    const value = wireValue(compiled, row.format.at, row.format.inQuery);
    expect(value, `${provider} wrote nothing at ${row.format.at}`).toBeDefined();

    const without = compile(row, {});
    if (!Array.isArray(without)) {
      expect(serialize(compiled), `${provider} silently dropped outputFormat`).not.toBe(
        serialize(without),
      );
    }

    if (row.format.shape === "composite") {
      // codec + rate (+ bitrate), joined — the shape that has to be assembled.
      expect(String(value)).toMatch(/^[a-z0-9]+_\d+(_\d+)?$/);
    } else if (row.format.shape === "codec") {
      expect(String(value)).not.toMatch(/_\d/);
    } else {
      // "object" — a nested response-format block (google's Interactions API).
      expect(typeof value).toBe("object");
    }
  });

  test("an unsupported codec is refused, never silently sent", () => {
    // `vorbis` is offered by no music route — the one codec in the vocabulary
    // nothing here encodes. Providers with a format field name what IS
    // offered; providers without one reject the param outright.
    expect(compile(row, { outputFormat: "vorbis" })).toEqual([
      row.format === undefined
        ? "unsupported_param @ outputFormat"
        : "invalid_enum_value @ outputFormat",
    ]);
  });
});

test("both duration units in the category are exercised", () => {
  const units = new Set(
    rows.flatMap(([, row]) => (row.duration === undefined ? [] : [row.duration.perSecond])),
  );
  expect([...units].sort((a, b) => a - b)).toEqual([1, 1000]);
});

// ---------------------------------------------------------------------------
// The property that has to hold for every cell, not just the probed ones
// ---------------------------------------------------------------------------

const ALL_CODECS = [
  "mp3",
  "aac",
  "flac",
  "opus",
  "vorbis",
  "pcm_s16le",
  "pcm_s24le",
  "pcm_s32le",
  "pcm_f32le",
  "pcm_mulaw",
  "pcm_alaw",
] as const;
const ALL_CONTAINERS = [undefined, "wav", "raw", "ogg", "mp3", "webm"] as const;
const ALL_RATES = [undefined, 8000, 16000, 22050, 24000, 44100, 48000] as const;
const ALL_BITRATES = [undefined, 32000, 128_000, 320_000] as const;

describe("no silent drops, over the whole outputFormat matrix", () => {
  /**
   * The one property the loss contract cannot survive losing: an `outputFormat`
   * is either **refused** or **sent**. Never accepted and ignored.
   */
  test.each(rows)("%s", (provider, row) => {
    const bare = compile(row, {});
    expect(Array.isArray(bare)).toBe(false);
    if (Array.isArray(bare)) return;
    let accepted = 0;
    const dropped: string[] = [];

    for (const format of ALL_CODECS) {
      for (const container of ALL_CONTAINERS) {
        for (const sampleRate of ALL_RATES) {
          for (const bitrate of ALL_BITRATES) {
            const outputFormat = {
              format,
              ...(container !== undefined && { container }),
              ...(sampleRate !== undefined && { sampleRate }),
              ...(bitrate !== undefined && { bitrate }),
            };
            const compiled = compile(row, { outputFormat } as Partial<MusicParams>);
            if (Array.isArray(compiled)) continue; // refused — the other half
            accepted += 1;
            if (serialize(compiled) === serialize(bare)) dropped.push(JSON.stringify(outputFormat));
          }
        }
      }
    }
    if (row.format === undefined) {
      // No format field on the wire — the kernel must have refused every cell.
      expect(accepted, `${provider} has no format field yet accepted an encoding`).toBe(0);
    } else {
      expect(accepted, `${provider} accepted nothing at all`).toBeGreaterThan(0);
    }
    expect(dropped, `${provider} accepted and ignored an encoding`).toEqual([]);
  });

  /** And the same property for the other four canonical words. */
  test.each(rows)("%s, over the non-format params", (provider, row) => {
    const bare = compile(row, {});
    expect(Array.isArray(bare)).toBe(false);
    if (Array.isArray(bare)) return;
    const probes: Array<Partial<MusicParams>> = [
      { durationSeconds: 30 },
      { durationSeconds: 90 },
      { durationSeconds: 0.5 },
      { instrumental: true },
      // Route-dispatch adapters (mureka) have no wire field for the default:
      // `instrumental: false` IS the song route, so bare and false compile
      // identically there — a route selection, not a dropped control.
      ...(row.instrumentalProbe === undefined ? [{ instrumental: false }] : []),
      { seed: 0 },
      { seed: PROBE_SEED },
      { durationSeconds: 45, seed: 1, instrumental: true },
    ];
    const dropped: string[] = [];
    for (const probe of probes) {
      const compiled = compile(row, probe);
      if (Array.isArray(compiled)) continue;
      if (serialize(compiled) === serialize(bare)) dropped.push(JSON.stringify(probe));
    }
    expect(dropped, `${provider} accepted and ignored a param`).toEqual([]);
  });
});
