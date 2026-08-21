/**
 * The capability table for `unmodel/tts`, committed and then **probed**.
 *
 * The table below is the answer to "what does this provider do with
 * `voice` / `outputFormat` / `speed` / `language`", written once, in one
 * place, in four words:
 *
 * | word | meaning |
 * |---|---|
 * | `native` | a rename — the value the caller wrote reaches the wire unchanged |
 * | `derived` | expressible, but computed: reshaped, converted or re-spelled |
 * | `unsupported` | the provider has no field for it; the kernel rejects it before compile |
 * | `ref` | carried by the model ref instead (Deepgram, where the voice *is* the model) |
 *
 * A table on its own is documentation that rots. Each row is therefore
 * asserted against behaviour:
 *
 * - `unsupported` must be **declared** on the adapter (so the kernel's uniform
 *   message applies) *and* actually rejected, at the canonical path, with
 *   `unsupported_param`;
 * - `native` must compile **and** the probe value must appear verbatim in the
 *   request that comes out — body, url or header;
 * - `derived` must compile and the probe value must **not** appear verbatim,
 *   because something else was sent in its place;
 * - `ref` must accept a voice that agrees with the model and reject one that
 *   does not.
 *
 * `outputFormat` gets its own column: it is never a plain rename anywhere (a
 * codec always has a provider spelling), so what is worth pinning is the
 * *shape* — which of the five placements the encoding lands in, and under
 * which key. That is what makes "F1–F5 are all covered" checkable rather than
 * a claim in a commit message.
 */
import { describe, expect, test } from "bun:test";
import type { AudioFormatRequest } from "../../src/core/unified/vocabulary/audio";
import type { TtsParams } from "../../src/core/unified/vocabulary/tts";
import { tts } from "../../src/unified/tts";
import { tts as cartesia } from "../../src/providers/cartesia/unified-tts";
import { tts as deepgram } from "../../src/providers/deepgram/unified-tts";
import { tts as elevenlabs } from "../../src/providers/elevenlabs/unified-tts";
import { tts as fishAudio } from "../../src/providers/fish-audio/unified";
import { tts as google } from "../../src/providers/google/unified-tts";
import { tts as hume } from "../../src/providers/hume/unified";
import { tts as inworld } from "../../src/providers/inworld/unified-tts";
import { tts as lmnt } from "../../src/providers/lmnt/unified";
import { tts as minimax } from "../../src/providers/minimax/unified-tts";
import { tts as murf } from "../../src/providers/murf/unified";
import { tts as openai } from "../../src/providers/openai/unified";
import { tts as resemble } from "../../src/providers/resemble/unified";
import { tts as rime } from "../../src/providers/rime/unified";
import { tts as smallestAi } from "../../src/providers/smallest-ai/unified";
import { tts as speechify } from "../../src/providers/speechify/unified";

type Support = "native" | "derived" | "unsupported" | "ref";

/** Where an encoding lands on the wire — the five placements in the category. */
type FormatShape =
  /** F1: one scalar naming a codec (`response_format: "mp3"`). */
  | "codec"
  /** F2: one string carrying codec + rate + bitrate (`"mp3_44100_128"`). */
  | "composite"
  /** F3: a nested object (`audio_setting: { format, sample_rate, bitrate }`). */
  | "object"
  /** F4: query params on the request URL. */
  | "query"
  /** F5: an HTTP request header. */
  | "header";

interface Capability {
  ref: string;
  /** A voice this provider's own validator accepts — voices are never portable. */
  voice_id: string;
  /** The adapter, so the `unsupported` column can be checked against data. */
  adapter: Readonly<{
    provider: string;
    unsupported?: Readonly<Partial<Record<string, string>>>;
  }>;
  /**
   * Canonical params every probe for this provider must carry. Cartesia is the
   * only entry that needs one: `output_format` is required on its wire and it
   * documents no default, so a request without one is (correctly) rejected
   * before any other row could be observed.
   */
  base?: Partial<TtsParams>;
  voice: Support;
  speed: Support;
  language: Support;
  format: { shape: FormatShape; at: string };
  /** An encoding this provider can express — the probe for the format row. */
  probe: AudioFormatRequest;
}

const MP3_FULL: AudioFormatRequest = { format: "mp3", sampleRate: 44100, bitrate: 128000 };

/**
 * One row per provider. Ordered as `src/unified/tts.ts` registers them, so
 * the two lists read the same way.
 */
const TABLE: Readonly<Record<string, Capability>> = {
  openai: {
    ref: "openai/gpt-4o-mini-tts",
    voice_id: "marin",
    adapter: openai,
    voice: "native",
    speed: "native",
    language: "unsupported",
    format: { shape: "codec", at: "response_format" },
    probe: "mp3",
  },
  elevenlabs: {
    ref: "elevenlabs/eleven_flash_v2_5",
    voice_id: "JBFqnCBsd6RMkjVDRZzb",
    adapter: elevenlabs,
    voice: "native",
    speed: "native",
    language: "derived",
    format: { shape: "composite", at: "output_format" },
    probe: MP3_FULL,
  },
  cartesia: {
    ref: "cartesia/sonic-3.5",
    voice_id: "694f9389-aac1-45b6-b726-9d9369183238",
    adapter: cartesia,
    voice: "native",
    speed: "native",
    language: "derived",
    format: { shape: "object", at: "output_format" },
    probe: MP3_FULL,
    base: { outputFormat: MP3_FULL },
  },
  deepgram: {
    ref: "deepgram/aura-2-thalia-en",
    voice_id: "aura-2-thalia-en",
    adapter: deepgram,
    voice: "ref",
    speed: "native",
    language: "unsupported",
    format: { shape: "query", at: "encoding" },
    probe: "mp3",
  },
  google: {
    // The one provider whose voice is a **name** rather than an id — the thirty
    // presets `prebuiltVoiceConfig.voiceName` publishes.
    ref: "google/gemini-2.5-flash-preview-tts",
    voice_id: "Kore",
    adapter: google,
    voice: "native",
    // No rate field anywhere in `SpeechConfig`; the guide steers pace with
    // natural-language direction inside the prompt.
    speed: "unsupported",
    // `languageCode` is a primary subtag, so "pt-BR" goes out as "pt".
    language: "derived",
    // `generationConfig.responseFormat.audio` is `{ mimeType, sampleRate,
    // bitRate }` — the F3 shape, two levels down.
    format: { shape: "object", at: "generationConfig" },
    probe: MP3_FULL,
  },
  hume: {
    ref: "hume/octave-2",
    voice_id: "Ito",
    adapter: hume,
    voice: "native",
    speed: "native",
    language: "unsupported",
    format: { shape: "object", at: "format" },
    probe: "mp3",
  },
  minimax: {
    ref: "minimax/speech-2.8-hd",
    voice_id: "English_Graceful_Lady",
    adapter: minimax,
    voice: "native",
    speed: "native",
    language: "derived",
    format: { shape: "object", at: "audio_setting" },
    probe: MP3_FULL,
  },
  rime: {
    ref: "rime/coda",
    voice_id: "astra",
    adapter: rime,
    voice: "native",
    speed: "derived",
    language: "derived",
    format: { shape: "header", at: "accept" },
    probe: "mp3",
  },
  lmnt: {
    ref: "lmnt/blizzard",
    voice_id: "leah",
    adapter: lmnt,
    voice: "native",
    speed: "unsupported",
    language: "derived",
    format: { shape: "codec", at: "format" },
    probe: "mp3",
  },
  "fish-audio": {
    ref: "fish-audio/s2.1-pro",
    voice_id: "802e3bc2b27e49c2995d23ef70e6ac89",
    adapter: fishAudio,
    voice: "native",
    speed: "native",
    language: "unsupported",
    format: { shape: "codec", at: "format" },
    probe: "mp3",
  },
  murf: {
    ref: "murf/gen2",
    voice_id: "en-US-natalie",
    adapter: murf,
    voice: "native",
    speed: "derived",
    language: "native",
    format: { shape: "codec", at: "format" },
    probe: "mp3",
  },
  resemble: {
    ref: "resemble/resemble-ultra",
    voice_id: "55592656",
    adapter: resemble,
    voice: "native",
    speed: "unsupported",
    language: "unsupported",
    format: { shape: "codec", at: "output_format" },
    probe: "mp3",
  },
  "smallest-ai": {
    ref: "smallest-ai/lightning_v3.1_pro",
    voice_id: "meher",
    adapter: smallestAi,
    voice: "native",
    speed: "native",
    language: "derived",
    format: { shape: "codec", at: "output_format" },
    probe: "mp3",
  },
  speechify: {
    ref: "speechify/simba-3.0",
    voice_id: "geffen_32",
    adapter: speechify,
    voice: "native",
    speed: "unsupported",
    language: "native",
    format: { shape: "composite", at: "output_format" },
    probe: { format: "mp3", sampleRate: 24000, bitrate: 128000 },
  },
  inworld: {
    ref: "inworld/inworld-tts-2",
    voice_id: "Dennis",
    adapter: inworld,
    voice: "native",
    speed: "native",
    language: "native",
    format: { shape: "object", at: "audioConfig" },
    probe: "mp3",
  },
};

/**
 * The speed probe. 1.1 rather than something more dramatic because it has to
 * be inside *every* provider's documented range — ElevenLabs stops at 1.2 and
 * Murf's percentage field at 1.5 — so that the row being tested is the
 * mapping, not the bounds.
 */
const PROBE_SPEED = 1.1;
const PROBE_LANGUAGE = "pt-BR";

/** The compiled request, in the three places a param can end up. */
interface Compiled {
  body: Record<string, unknown>;
  url: string;
  headers: Record<string, string>;
}

function compile(row: Capability, extra: Partial<TtsParams>): Compiled | string[] {
  const result = tts.safe({
    model: row.ref,
    text: "A probe.",
    voice: row.voice_id,
    ...row.base,
    ...extra,
  } as never);
  if (!result.ok) return result.errors.map((issue) => `${issue.code} @ ${issue.path.join(".")}`);
  const request = result.params as unknown as {
    request: { url: string; headers: Record<string, string> };
  };
  return {
    body: JSON.parse(JSON.stringify(result.params)) as Record<string, unknown>,
    url: request.request.url,
    headers: request.request.headers,
  };
}

/** Does this exact value appear anywhere in the compiled request? */
function carries(compiled: Compiled, value: string | number): boolean {
  const wanted = String(value);
  let found = false;
  const walk = (node: unknown): void => {
    if (found) return;
    if (typeof node === "string" || typeof node === "number") {
      if (String(node) === wanted) found = true;
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const item of Object.values(node)) walk(item);
    }
  };
  walk(compiled.body);
  if (found) return true;
  // A param that rides in the URL (path or query) or in a header counts: the
  // question is whether the caller's value reached the provider unchanged, not
  // which envelope carried it.
  return compiled.url.includes(wanted) || Object.values(compiled.headers).includes(wanted);
}

/**
 * The whole request as one string, for the "it changed something" check below.
 *
 * A `derived` row only says the caller's value is not on the wire verbatim —
 * which a **silent drop** also satisfies. Comparing the request against the
 * same request without the field is what tells the two apart, and it is the
 * one property the loss contract cannot be allowed to lose.
 */
function serialize(compiled: Compiled): string {
  return JSON.stringify([compiled.body, compiled.url, compiled.headers]);
}

/** The value under `at`, wherever the provider put it. */
function wireValue(compiled: Compiled, at: string): unknown {
  if (Object.hasOwn(compiled.body, at)) return compiled.body[at];
  const query = new URL(compiled.url).searchParams;
  if (query.has(at)) return query.get(at);
  return compiled.headers[at];
}

const rows = Object.entries(TABLE);

test("the table covers exactly the providers in the pack", () => {
  expect(rows.map(([provider]) => provider).sort()).toEqual([...tts.providers]);
});

describe.each(rows)("%s", (provider, row) => {
  const scalars = [
    ["voice", row.voice, row.voice_id, {}],
    ["speed", row.speed, PROBE_SPEED, { speed: PROBE_SPEED }],
    ["language", row.language, PROBE_LANGUAGE, { language: PROBE_LANGUAGE }],
  ] as const;

  test.each(scalars)("%s is %s", (field, support, probe, extra) => {
    const declared = row.adapter.unsupported?.[field];
    if (support === "unsupported") {
      // Declared on the adapter, so the kernel's uniform message applies…
      expect(declared, `${provider}.unsupported.${field}`).toBeDefined();
      // …and it really is refused, at the canonical path.
      const compiled = compile(row, { [field]: probe } as Partial<TtsParams>);
      expect(compiled).toEqual([`unsupported_param @ ${field}`]);
      return;
    }
    expect(declared, `${provider} must not declare ${field} unsupported`).toBeUndefined();

    if (support === "ref") {
      // Deepgram: the voice IS the model. Agreeing is fine…
      const agreeing = compile(row, {});
      expect(Array.isArray(agreeing)).toBe(false);
      // …and disagreeing is an error naming the model, never a silent pick.
      const disagreeing = compile(row, { voice: "aura-2-zeus-en" });
      expect(disagreeing).toEqual(["invalid_enum_value @ voice"]);
      return;
    }

    const compiled = compile(row, extra as Partial<TtsParams>);
    expect(compiled, `${provider} could not compile a ${field} probe`).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(carries(compiled, probe), `${provider} ${field} verbatim`).toBe(support === "native");

    // …and it reached the wire at all: `voice` is in the base request, so it is
    // the only row where "with" and "without" are the same request.
    if (field !== "voice") {
      const without = compile(row, {});
      expect(Array.isArray(without)).toBe(false);
      if (Array.isArray(without)) return;
      expect(serialize(compiled), `${provider} silently dropped ${field}`).not.toBe(
        serialize(without),
      );
    }
  });

  test(`outputFormat lands as a ${row.format.shape} at \`${row.format.at}\``, () => {
    const compiled = compile(row, { outputFormat: row.probe });
    expect(compiled).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    const value = wireValue(compiled, row.format.at);
    expect(value, `${provider} wrote nothing at ${row.format.at}`).toBeDefined();

    // The same anti-silent-drop check as the scalar rows get.
    const without = compile(row, { outputFormat: undefined });
    if (!Array.isArray(without)) {
      expect(serialize(compiled), `${provider} silently dropped outputFormat`).not.toBe(
        serialize(without),
      );
    }

    switch (row.format.shape) {
      case "object":
        expect(typeof value).toBe("object");
        break;
      case "composite":
        // codec + rate (+ bitrate), joined — the shape that has to be assembled.
        expect(String(value)).toMatch(/^[a-z0-9]+_\d+(_\d+)?$/);
        break;
      case "query":
        expect(new URL(compiled.url).searchParams.has(row.format.at)).toBe(true);
        break;
      case "header":
        expect(compiled.headers[row.format.at]).toBe(String(value));
        break;
      default:
        expect(typeof value).toBe("string");
        expect(String(value)).not.toMatch(/_\d/);
    }
  });

  test("an unsupported codec is an invalid_enum_value naming what IS offered", () => {
    // `vorbis` is offered by none of the fifteen — the one codec in the
    // vocabulary that no provider in this pack encodes.
    const compiled = compile(row, { outputFormat: "vorbis" });
    expect(compiled).toEqual(["invalid_enum_value @ outputFormat"]);
  });
});

test("every format shape in the category is exercised by some provider", () => {
  const shapes = new Set(rows.map(([, row]) => row.format.shape));
  expect([...shapes].sort()).toEqual(["codec", "composite", "header", "object", "query"]);
});

test("both speed spellings that are not the identity are exercised", () => {
  // Rime's reciprocal and Murf's percentage delta are the two conversions in
  // this category; the rest are renames.
  const derived = rows.filter(([, row]) => row.speed === "derived").map(([provider]) => provider);
  expect(derived.sort()).toEqual(["murf", "rime"]);
});

// ---------------------------------------------------------------------------
// The property that has to hold for every cell, not just the probed ones
// ---------------------------------------------------------------------------

/** Every codec and container the vocabulary can express, crossed. */
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
const ALL_RATES = [undefined, 8000, 16000, 24000, 44100, 48000] as const;
const ALL_BITRATES = [undefined, 32000, 128_000] as const;

describe("no silent drops, over the whole outputFormat matrix", () => {
  /**
   * The one property the loss contract cannot survive losing: an
   * `outputFormat` is either **refused** or **sent**. Never accepted and
   * ignored.
   *
   * The probes above check one encoding per provider; this checks all 1,188 of
   * them per provider, which is what caught a Speechify request carrying a
   * bitrate with no sample rate — a combination its composite cannot spell,
   * and which was quietly compiling to no format field at all.
   */
  test.each(rows)("%s", (provider, row) => {
    // Cartesia's wire REQUIRES an encoding, so its base request already carries
    // one and "the request changed" is not available as a signal there.
    const needsFormat = row.base?.outputFormat !== undefined;
    const bare = compile(row, {});
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
            const compiled = compile(row, { outputFormat } as Partial<TtsParams>);
            if (Array.isArray(compiled)) continue; // refused — the other half of the contract
            accepted += 1;
            // "It changed the request" is the signal, because a provider may
            // legitimately land the same encoding under either of two keys
            // (Speechify's container-only `audio_format` versus its composite
            // `output_format`). Cartesia is the exception: its wire REQUIRES a
            // format, so there is no formatless base to compare against and the
            // check falls back to "the format field exists".
            const landed =
              needsFormat || Array.isArray(bare)
                ? wireValue(compiled, row.format.at) !== undefined
                : serialize(compiled) !== serialize(bare);
            if (!landed) dropped.push(JSON.stringify(outputFormat));
          }
        }
      }
    }
    expect(accepted, `${provider} accepted nothing at all`).toBeGreaterThan(0);
    expect(dropped, `${provider} accepted and ignored an encoding`).toEqual([]);
  });
});
