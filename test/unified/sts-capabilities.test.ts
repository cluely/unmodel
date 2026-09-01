/**
 * The capability table for `unmodel/sts`, committed and then **probed**.
 *
 * Four rows across two independent vendors — the two-witness floor, and the
 * smallest table in this suite. That is not a gap: two more vendors publish
 * speech-to-speech MODELS and neither publishes a route this category can
 * address, and both exclusions are recorded where tooling reads them (see the
 * `the two recorded exclusions` block at the bottom).
 *
 * ## The column that makes this category different
 *
 * `voiceAt` — where the target voice goes. It is a URL **path segment** at
 * ElevenLabs and a **form part** at Hume, which is why `voice` cannot be
 * compared by looking at the wire body alone and why every ElevenLabs fixture
 * in the golden tree carries its voice in the URL. It is also the only word in
 * the library that lands outside the request body at one provider and inside it
 * at another.
 *
 * ## The three ElevenLabs rows are ONE row
 *
 * `eleven_multilingual_sts_v2`, `eleven_english_sts_v2` and
 * `eleven_english_sts_v1` differ in what they can SPEAK and not at all in what
 * the request may say — same body, same query enum, same knobs. The table
 * states that by giving them identical entries rather than by omitting two, so
 * a future divergence has to change a row rather than appear silently.
 *
 * The other words mean what they mean everywhere else in this suite:
 *
 * | word | meaning |
 * |---|---|
 * | `native` | a rename — the value the caller wrote reaches the wire unchanged |
 * | `derived` | expressible, but computed (a composite assembled from parts) |
 * | `unsupported` | this route has no field for it; the adapter refuses it by name |
 */
import { describe, expect, test } from "bun:test";
import { sts } from "../../src/unified/sts";
import { sts as elevenlabs } from "../../src/providers/elevenlabs/unified-sts";
import { sts as hume } from "../../src/providers/hume/unified-sts";

/** Where the target voice ends up on this route. */
type VoicePlacement = { kind: "path" } | { kind: "form"; at: string };

interface Capability {
  ref: string;
  /** The wire field the recording lands in. Required binary at every row. */
  audioAt: string;
  /** Where the target voice goes — see the module header. */
  voiceAt: VoicePlacement;
  /** The voice spellings this route can address. */
  voiceSpellings: readonly ("id" | "name")[];
  /** How this route lets a caller ask for an encoding. */
  format: { at: string; kind: "codec" | "composite"; codecs: readonly string[] };
  /** Whether the encoding rides in the query string rather than the body. */
  formatInQuery: boolean;
  /** The extras this route publishes that the vocabulary has no word for. */
  extras: readonly string[];
  /** Whether the catalog prices this route per minute of processed audio. */
  priced: boolean;
}

const EL_COMPOSITE = ["mp3", "opus", "pcm_alaw", "pcm_mulaw", "pcm_s16le"] as const;
const EL_EXTRAS = [
  "enable_logging",
  "file_format",
  "remove_background_noise",
  "seed",
  "voice_settings",
] as const;

const ELEVENLABS_ROW: Omit<Capability, "ref"> = {
  audioAt: "audio",
  voiceAt: { kind: "path" },
  // An opaque handle from GET /v1/voices. `{ name }` is an error naming the id.
  voiceSpellings: ["id"],
  format: { at: "output_format", kind: "composite", codecs: EL_COMPOSITE },
  formatInQuery: true,
  extras: EL_EXTRAS,
  priced: true,
};

const TABLE: Readonly<Record<string, Capability>> = {
  "elevenlabs/multilingual-v2": { ref: "elevenlabs/eleven_multilingual_sts_v2", ...ELEVENLABS_ROW },
  "elevenlabs/english-v2": { ref: "elevenlabs/eleven_english_sts_v2", ...ELEVENLABS_ROW },
  "elevenlabs/english-v1": { ref: "elevenlabs/eleven_english_sts_v1", ...ELEVENLABS_ROW },
  "hume/voice-conversion": {
    ref: "hume/voice-conversion",
    audioAt: "audio",
    // A form part, not a path segment — the difference this table exists for.
    voiceAt: { kind: "form", at: "voice" },
    // Hume takes both and cannot tell them apart from the shape of a string,
    // which is the whole reason the canonical `Voice` has three arms.
    voiceSpellings: ["id", "name"],
    format: { at: "format", kind: "codec", codecs: ["mp3", "pcm_s16le"] },
    formatInQuery: false,
    extras: ["context", "include_timestamp_types", "strip_headers"],
    // hume.ai/pricing carries voice conversion as an availability row with no
    // rate. "Unverifiable → caveat, never catalog."
    priced: false,
  },
};

declare interface Row {
  codecs?: readonly string[];
  extras?: Readonly<Record<string, unknown>>;
}

/** The row one ref selects, read off the adapter the ref names. */
function rowOf(ref: string): Row {
  const slash = ref.indexOf("/");
  const provider = ref.slice(0, slash);
  const model = ref.slice(slash + 1);
  const table = (provider === "hume" ? hume : elevenlabs).modelParams as Readonly<
    Record<string, Row>
  >;
  const row = table[model];
  if (row === undefined) throw new Error(`${ref} has no row`);
  return row;
}

const CLIP = new Blob([new Uint8Array(64)], { type: "audio/wav" });
const audio = (): { file: Blob } => ({ file: CLIP });
const VOICE = "21m00Tcm4TlvDq8ikWAM";

test("the table covers every ref the pack can reach", () => {
  const refs = new Set(Object.values(TABLE).map((row) => row.ref));
  const shipped = [
    ...elevenlabs.models.map((id) => `elevenlabs/${id}`),
    ...hume.models.map((id) => `hume/${id}`),
  ];
  expect([...refs].sort()).toEqual(shipped.sort());
  expect(sts.providers).toEqual(["elevenlabs", "hume"]);
});

describe.each(Object.entries(TABLE))("%s", (_name, capability) => {
  const row = rowOf(capability.ref);

  test("the recording lands where the table says, as the Blob it was", () => {
    const clip = new Blob([new Uint8Array(8)], { type: "audio/wav" });
    const result = sts.safe({ model: capability.ref, audio: { file: clip }, voice: VOICE } as never);
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
    if (!result.ok) return;
    expect((result.params as Record<string, unknown>)[capability.audioAt]).toBe(clip);
  });

  /** The column this table exists for. */
  test("the target voice lands in the URL or in the body, as the table says", () => {
    const result = sts.safe({ model: capability.ref, audio: audio(), voice: VOICE } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const params = result.params as unknown as Record<string, unknown> & {
      request: { url: string };
    };

    if (capability.voiceAt.kind === "path") {
      expect(params.request.url.endsWith(`/${VOICE}`)).toBe(true);
      // …and it is NOT in the body, which is the half a wire-body diff misses.
      expect(Object.keys(params)).not.toContain("voice");
      return;
    }
    expect(params[capability.voiceAt.at]).toEqual({ id: VOICE });
    expect(params.request.url).not.toContain(VOICE);
  });

  test("the voice spellings the table claims are exactly the ones that compile", () => {
    for (const spelling of ["id", "name"] as const) {
      const result = sts.safe({
        model: capability.ref,
        audio: audio(),
        voice: { [spelling]: VOICE },
      } as never);
      expect(result.ok).toBe(capability.voiceSpellings.includes(spelling));
      if (!result.ok) {
        // A refusal names the field and the spelling that works, never a 404.
        expect(result.errors[0]?.path).toEqual(["voice"]);
        expect(result.errors[0]?.message).toContain("id");
      }
    }
    // A bare string always works: it means "whichever spelling this route takes".
    expect(sts.safe({ model: capability.ref, audio: audio(), voice: VOICE } as never).ok).toBe(true);
  });

  test("the encoding column matches the row, and every codec it claims compiles", () => {
    expect([...(row.codecs ?? [])].sort()).toEqual([...capability.format.codecs].sort());

    for (const codec of capability.format.codecs) {
      const result = sts.safe({
        model: capability.ref,
        audio: audio(),
        voice: VOICE,
        outputFormat: codec,
      } as never);
      expect(result.ok, `${capability.ref} refused ${codec}`).toBe(true);
      if (!result.ok) continue;
      const params = result.params as unknown as Record<string, unknown> & {
        request: { url: string };
      };
      // Query at one provider, body at the other — pinned rather than described.
      if (capability.formatInQuery) {
        expect(params.request.url).toContain(`${capability.format.at}=`);
        expect(Object.keys(params)).not.toContain(capability.format.at);
      } else {
        expect(params[capability.format.at]).toBeDefined();
        expect(params.request.url).not.toContain(capability.format.at);
      }
    }
  });

  test("a codec this route has no spelling for is refused by name", () => {
    const result = sts.safe({
      model: capability.ref,
      audio: audio(),
      voice: VOICE,
      outputFormat: "flac",
    } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.path).toEqual(["outputFormat"]);
  });

  test("the extras column is the row's own key set", () => {
    expect(Object.keys(row.extras ?? {}).sort()).toEqual([...capability.extras].sort());
  });

  test("the catalog prices this route, or records why it does not", () => {
    const result = sts.safe({ model: capability.ref, audio: audio(), voice: VOICE } as never, {
      media: [{ path: ["audio"], durationSeconds: 60 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate.costUSD !== undefined).toBe(capability.priced);
  });
});

describe("the vocabulary is what the two witnesses share", () => {
  test("every canonical word compiles at every ref", () => {
    for (const capability of Object.values(TABLE)) {
      const result = sts.safe({
        model: capability.ref,
        audio: audio(),
        voice: VOICE,
        outputFormat: "mp3",
      } as never);
      expect(result.ok, `${capability.ref}`).toBe(true);
    }
  });

  /**
   * The two-witness rule, as an assertion that FAILS on the day it stops being
   * true. Every knob on either wire has exactly one witness today; the moment a
   * name appears on both rows it is a vocabulary candidate, and this test is
   * where that has to be noticed.
   */
  test("no extra is published by both vendors — every one is a one-witness knob", () => {
    const el = new Set(Object.keys(rowOf("elevenlabs/eleven_multilingual_sts_v2").extras ?? {}));
    const hu = new Set(Object.keys(rowOf("hume/voice-conversion").extras ?? {}));
    expect([...el].filter((key) => hu.has(key))).toEqual([]);
    // Eight knobs, five and three — and not one canonical word among them.
    expect(el.size + hu.size).toBe(8);
  });
});

describe("the two recorded exclusions", () => {
  /**
   * Both are catalogued elsewhere in this repo with a reason, a source and a
   * date, and neither is reachable here. These assertions are what stop the
   * gap being mistaken for an oversight on the next audit run.
   */
  test("cartesia is not a provider: /voice-changer was sunset 2026-08-20", () => {
    expect(sts.providers).not.toContain("cartesia");
    const result = sts.safe({
      model: "cartesia/voice-changer",
      audio: audio(),
      voice: VOICE,
    } as never);
    expect(result.ok).toBe(false);
  });

  test("resemble is not a provider: its STS is an SSML mode of `resemble.tts`", () => {
    expect(sts.providers).not.toContain("resemble");
    const result = sts.safe({ model: "resemble/sts-v2", audio: audio(), voice: VOICE } as never);
    expect(result.ok).toBe(false);
  });
});
