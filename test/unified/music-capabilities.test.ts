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
import { music as stability } from "../../src/providers/stability/unified-music";

type Support = "native" | "derived" | "unsupported";

/** Where an encoding lands — two of the five placements the speech wave named. */
type FormatShape = "codec" | "composite";

interface Capability {
  ref: string;
  adapter: Readonly<{
    provider: string;
    unsupported?: Readonly<Partial<Record<string, string>>>;
  }>;
  durationSeconds: Support;
  /** The wire field the duration lands in, and the factor applied to it. */
  duration: { at: string; perSecond: number };
  instrumental: Support;
  seed: Support;
  format: { shape: FormatShape; at: string; inQuery: boolean };
  /** An encoding this provider can express — the probe for the format row. */
  probe: AudioFormatRequest;
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
};

const PROBE_PROMPT = "slow post-rock build, brushed drums";
const PROBE_SECONDS = 90;
const PROBE_SEED = 4242;

interface Compiled {
  body: Record<string, unknown>;
  url: string;
}

function compile(row: Capability, extra: Partial<MusicParams>): Compiled | string[] {
  const result = music.safe({ model: row.ref, prompt: PROBE_PROMPT, ...extra } as never);
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
  const scalars = [
    ["durationSeconds", row.durationSeconds, PROBE_SECONDS, { durationSeconds: PROBE_SECONDS }],
    ["instrumental", row.instrumental, true, { instrumental: true }],
    ["seed", row.seed, PROBE_SEED, { seed: PROBE_SEED }],
  ] as const;

  test.each(scalars)("%s is %s", (field, support, probe, extra) => {
    const declared = row.adapter.unsupported?.[field];
    if (support === "unsupported") {
      expect(declared, `${provider}.unsupported.${field}`).toBeDefined();
      expect(compile(row, extra as Partial<MusicParams>)).toEqual([
        `unsupported_param @ ${field}`,
      ]);
      return;
    }
    expect(declared, `${provider} must not declare ${field} unsupported`).toBeUndefined();

    const compiled = compile(row, extra as Partial<MusicParams>);
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
  test(`durationSeconds lands at \`${row.duration.at}\` × ${row.duration.perSecond}`, () => {
    const compiled = compile(row, { durationSeconds: PROBE_SECONDS });
    expect(compiled).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(compiled.body[row.duration.at]).toBe(PROBE_SECONDS * row.duration.perSecond);
  });

  test("a duration that is not a whole number of wire units is refused, not rounded", () => {
    // 90.0005 s is 90000.5 ms — expressible at Stability (seconds are
    // fractional there) and not at ElevenLabs, whose field counts integers.
    const compiled = compile(row, { durationSeconds: 90.0005 });
    if (row.duration.perSecond === 1) {
      expect(compiled).not.toBeInstanceOf(Array);
      return;
    }
    expect(compiled).toEqual(["invalid_shape @ durationSeconds"]);
  });

  test(`outputFormat lands as a ${row.format.shape} at \`${row.format.at}\``, () => {
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
    } else {
      expect(String(value)).not.toMatch(/_\d/);
    }
  });

  test("an unsupported codec is an invalid_enum_value naming what IS offered", () => {
    // `vorbis` is offered by neither provider — the one codec in the
    // vocabulary that no music route encodes.
    expect(compile(row, { outputFormat: "vorbis" })).toEqual(["invalid_enum_value @ outputFormat"]);
  });
});

test("both duration units in the category are exercised", () => {
  const units = new Set(rows.map(([, row]) => row.duration.perSecond));
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
    expect(accepted, `${provider} accepted nothing at all`).toBeGreaterThan(0);
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
      { instrumental: false },
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
