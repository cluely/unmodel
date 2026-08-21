/**
 * The capability table for `unmodel/stt`, committed and then **probed**.
 *
 * The table below is the answer to "what does this provider do with `audio` /
 * `language` / `languages` / `diarization` / `timestamps` / `prompt`", written
 * once, in one place, in four words:
 *
 * | word | meaning |
 * |---|---|
 * | `native` | a rename — the value the caller wrote reaches the wire unchanged |
 * | `derived` | expressible, but computed: reshaped, converted or re-spelled |
 * | `unsupported` | the provider has no field for it; the kernel rejects it before compile |
 * | `implied` | the route always does it, and has no field to say so |
 *
 * `implied` is the one that needs defending, and it is the same shape as
 * `tts`'s `ref` row (where the voice *is* the model). Four of these APIs —
 * AssemblyAI, Rev AI, Soniox, Speechmatics — return word timings on every
 * response and offer no granularity field at all. Declaring `timestamps`
 * unsupported would lie about what the route does; accepting `"segment"` would
 * lie about what it returns. So the value that **agrees** compiles to nothing
 * and every value that disagrees is an `invalid_enum_value` naming what the
 * route reports — both halves asserted below, and the cells enumerated once in
 * `IMPLIED_CELLS` so a fifth cannot appear without being typed out.
 *
 * A table on its own is documentation that rots. Each row is therefore asserted
 * against behaviour, and the `audio` row is asserted in both directions: every
 * kind an adapter declares must compile, and every kind it does not must be an
 * `unsupported_param` whose message names the kinds it takes.
 */
import { describe, expect, test } from "bun:test";
import type {
  AudioInputKind,
  Diarization,
  TimestampGranularity,
  SttParams,
} from "../../src/core/unified/vocabulary/stt";
import { stt } from "../../src/unified/stt";
import { stt as assemblyai } from "../../src/providers/assemblyai/unified";
import { stt as cartesia } from "../../src/providers/cartesia/unified-stt";
import { stt as deepgram } from "../../src/providers/deepgram/unified-stt";
import { stt as elevenlabs } from "../../src/providers/elevenlabs/unified-stt";
import { stt as gladia } from "../../src/providers/gladia/unified";
import { stt as google } from "../../src/providers/google/unified-stt";
import { stt as inworld } from "../../src/providers/inworld/unified-stt";
import { stt as mistral } from "../../src/providers/mistral/unified";
import { stt as openai } from "../../src/providers/openai/unified-stt";
import { stt as revai } from "../../src/providers/revai/unified";
import { stt as soniox } from "../../src/providers/soniox/unified";
import { stt as speechmatics } from "../../src/providers/speechmatics/unified";

type Support = "native" | "derived" | "unsupported" | "implied";

/** Where a diarization decision lands on the wire — the four shapes. */
type DiarizationShape =
  /** A boolean that is `true` when it is on. */
  | "flag"
  /** A boolean that is `false` when it is on (Rev AI's `skip_diarization`). */
  | "inverted"
  /** An enum member (`"speaker"` / `"none"`). */
  | "enum";

/** And where a timestamp granularity lands. */
type TimestampShape =
  /** A `timestamp_granularities`-shaped list. */
  | "array"
  /** One granularity name in one field. */
  | "scalar"
  /**
   * A **grouping** switch. Word timings come back unconditionally and the only
   * knob decides whether they are also grouped into segments — so asking for
   * `"word"` states `false`, which is what keeps the granularity on the wire
   * instead of inherited from a default the caller cannot see.
   */
  | "boolean"
  /** A plain "emit word timings" flag: `true` when `"word"` was asked for. */
  | "flag"
  /** The route always reports word timings and has no field to say so. */
  | "implied";

interface Capability {
  ref: string;
  /** The adapter, so the `unsupported` column can be checked against data. */
  adapter: Readonly<{
    provider: string;
    audioInputs: readonly AudioInputKind[];
    unsupported?: Readonly<Partial<Record<string, string>>>;
  }>;
  /**
   * A ref this row's `timestamps` probe must use instead. OpenAI is the only
   * entry that needs one: `timestamp_granularities` is whisper-1's alone, and
   * its own constraint table denies the array everywhere else — so the row's
   * primary ref (which has to support `languages` and `prompt`) cannot probe it.
   */
  timestampsRef?: string;
  language: Support;
  languages: Support;
  prompt: Support;
  /** How diarization is turned on, and where. Dotted paths are nested. */
  diarization: { shape: DiarizationShape; at: string } | "unsupported";
  /** Which speaker counts have a wire field. */
  counts: { speakers: boolean; minSpeakers: boolean; maxSpeakers: boolean };
  timestamps: { shape: TimestampShape; at?: string };
  /** A granularity this route does NOT report — the refusal probe. */
  absentGranularity: TimestampGranularity;
}

/** One row per provider, ordered as `src/unified/stt.ts` registers them. */
const TABLE: Readonly<Record<string, Capability>> = {
  openai: {
    ref: "openai/gpt-transcribe",
    adapter: openai,
    timestampsRef: "openai/whisper-1",
    language: "derived",
    languages: "derived",
    prompt: "native",
    diarization: "unsupported",
    counts: { speakers: false, minSpeakers: false, maxSpeakers: false },
    timestamps: { shape: "array", at: "timestamp_granularities" },
    absentGranularity: "character",
  },
  deepgram: {
    ref: "deepgram/nova-3",
    adapter: deepgram,
    language: "native",
    languages: "native",
    prompt: "unsupported",
    diarization: { shape: "flag", at: "diarize" },
    counts: { speakers: false, minSpeakers: false, maxSpeakers: false },
    timestamps: { shape: "boolean", at: "utterances" },
    absentGranularity: "character",
  },
  assemblyai: {
    ref: "assemblyai/universal-2",
    adapter: assemblyai,
    language: "derived",
    languages: "native",
    prompt: "unsupported",
    diarization: { shape: "flag", at: "speaker_labels" },
    counts: { speakers: true, minSpeakers: true, maxSpeakers: true },
    timestamps: { shape: "implied" },
    absentGranularity: "segment",
  },
  elevenlabs: {
    ref: "elevenlabs/scribe_v2",
    adapter: elevenlabs,
    language: "derived",
    languages: "unsupported",
    prompt: "unsupported",
    diarization: { shape: "flag", at: "diarize" },
    counts: { speakers: true, minSpeakers: false, maxSpeakers: false },
    timestamps: { shape: "scalar", at: "timestamps_granularity" },
    absentGranularity: "segment",
  },
  gladia: {
    ref: "gladia/solaria-1",
    adapter: gladia,
    language: "derived",
    languages: "native",
    prompt: "unsupported",
    diarization: { shape: "flag", at: "diarization" },
    counts: { speakers: true, minSpeakers: true, maxSpeakers: true },
    timestamps: { shape: "boolean", at: "sentences" },
    absentGranularity: "character",
  },
  google: {
    ref: "google/gemini-2.5-flash",
    adapter: google,
    // `audioTranscriptionConfig.languageCodes` is documented "BCP-47 language
    // codes" and carries the FULL tag — the opposite of `google.tts`, whose
    // `languageCode` is a primary subtag. One entry pins, several are the
    // candidate set, so both canonical words reach the same array.
    language: "native",
    languages: "native",
    // Verbatim, but as a text **part** beside the audio rather than a field:
    // this endpoint has no prompt slot because the whole request is a prompt.
    prompt: "native",
    diarization: {
      shape: "flag",
      at: "generationConfig.audioTranscriptionConfig.diarization",
    },
    // A bare boolean: @google/genai's `AudioTranscriptionConfig` declares no
    // speaker-count member at all.
    counts: { speakers: false, minSpeakers: false, maxSpeakers: false },
    timestamps: {
      shape: "flag",
      at: "generationConfig.audioTranscriptionConfig.wordTimestamp",
    },
    absentGranularity: "segment",
  },
  speechmatics: {
    ref: "speechmatics/standard",
    adapter: speechmatics,
    language: "native",
    languages: "native",
    prompt: "unsupported",
    diarization: { shape: "enum", at: "transcription_config.diarization" },
    counts: { speakers: false, minSpeakers: false, maxSpeakers: false },
    timestamps: { shape: "implied" },
    absentGranularity: "segment",
  },
  mistral: {
    ref: "mistral/voxtral-mini-latest",
    adapter: mistral,
    language: "derived",
    languages: "unsupported",
    prompt: "unsupported",
    diarization: { shape: "flag", at: "diarize" },
    counts: { speakers: false, minSpeakers: false, maxSpeakers: false },
    timestamps: { shape: "array", at: "timestamp_granularities" },
    absentGranularity: "character",
  },
  soniox: {
    ref: "soniox/stt-async-v5",
    adapter: soniox,
    language: "derived",
    languages: "native",
    prompt: "native",
    diarization: { shape: "flag", at: "enable_speaker_diarization" },
    counts: { speakers: false, minSpeakers: false, maxSpeakers: false },
    timestamps: { shape: "implied" },
    absentGranularity: "segment",
  },
  revai: {
    ref: "revai/machine",
    adapter: revai,
    language: "derived",
    languages: "unsupported",
    prompt: "unsupported",
    diarization: { shape: "inverted", at: "skip_diarization" },
    counts: { speakers: true, minSpeakers: false, maxSpeakers: false },
    timestamps: { shape: "implied" },
    absentGranularity: "segment",
  },
  cartesia: {
    ref: "cartesia/ink-whisper",
    adapter: cartesia,
    language: "derived",
    languages: "unsupported",
    prompt: "unsupported",
    diarization: "unsupported",
    counts: { speakers: false, minSpeakers: false, maxSpeakers: false },
    timestamps: { shape: "array", at: "timestamp_granularities" },
    absentGranularity: "segment",
  },
  inworld: {
    // The Groq route, not `inworld/inworld-stt-1`: "Word timestamps &
    // diarization … not yet for Inworld", which that model's own validator
    // reports — so the first-party id cannot probe two of the rows below.
    ref: "inworld/groq/whisper-large-v3",
    adapter: inworld,
    language: "native",
    languages: "unsupported",
    prompt: "native",
    diarization: { shape: "flag", at: "transcribeConfig.enableSpeakerDiarization" },
    counts: { speakers: false, minSpeakers: false, maxSpeakers: false },
    timestamps: { shape: "flag", at: "transcribeConfig.includeWordTimestamps" },
    absentGranularity: "segment",
  },
};

/**
 * The four `implied` timestamp cells, enumerated so a fifth has to be typed out
 * here — the exemption is the sweep's only hole, and an unenumerated hole is
 * how a silent drop eventually walks through one.
 */
const IMPLIED_CELLS = ["assemblyai", "revai", "soniox", "speechmatics"];

const PROBE_LANGUAGE = "pt-BR";
/** Includes `"en"`, which AssemblyAI's `language_codes` requires. */
const PROBE_LANGUAGES = ["en", "pt-BR"];
const PROBE_PROMPT = "Acme Corp, quarterly results";
const AUDIO_KINDS: readonly AudioInputKind[] = ["file", "url", "fileId", "data"];

/** Valid base64, and a RIFF header, so the byte-count checks have something real. */
const PROBE_BASE64 = "UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";

const AUDIO_FOR: Readonly<Record<AudioInputKind, () => Record<string, unknown>>> = {
  file: () => ({ file: new Blob([new Uint8Array(64)], { type: "audio/wav" }) }),
  url: () => ({ url: "https://example.com/interview.wav" }),
  fileId: () => ({ fileId: "f_2f8a" }),
  data: () => ({ data: PROBE_BASE64, mimeType: "audio/wav" }),
};

/** The compiled request, in the three places a param can end up. */
interface Compiled {
  body: Record<string, unknown>;
  url: string;
  headers: Record<string, string>;
}

function compile(
  row: Capability,
  extra: Partial<SttParams>,
  ref = row.ref,
): Compiled | string[] {
  const kind = row.adapter.audioInputs[0] as AudioInputKind;
  const result = stt.safe({
    model: ref,
    audio: AUDIO_FOR[kind](),
    ...extra,
  } as never);
  if (!result.ok) return result.errors.map((issue) => `${issue.code} @ ${issue.path.join(".")}`);
  const request = result.params as unknown as {
    request: { url: string; headers: Record<string, string> };
  };
  // A Blob has no JSON form; replace it with a stable descriptor so the
  // "did the request change" comparison below still means something.
  const body = JSON.parse(
    JSON.stringify(result.params, (_key, value: unknown) =>
      value instanceof Blob ? `blob:${value.size}:${value.type}` : value,
    ),
  ) as Record<string, unknown>;
  return { body, url: request.request.url, headers: request.request.headers };
}

/** Does this exact value appear anywhere in the compiled request? */
function carries(compiled: Compiled, value: string | number | boolean): boolean {
  const wanted = String(value);
  let found = false;
  const walk = (node: unknown): void => {
    if (found) return;
    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
      if (String(node) === wanted) found = true;
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node !== null && typeof node === "object") for (const item of Object.values(node)) walk(item);
  };
  walk(compiled.body);
  if (found) return true;
  // A param that rides in the URL query or a header counts: the question is
  // whether the caller's value reached the provider unchanged, not which
  // envelope carried it.
  return (
    [...new URL(compiled.url).searchParams.values()].includes(wanted) ||
    Object.values(compiled.headers).includes(wanted)
  );
}

/** The whole request as one string, for the "it changed something" check. */
function serialize(compiled: Compiled): string {
  return JSON.stringify([compiled.body, compiled.url, compiled.headers]);
}

/** The value at a dotted path, wherever the provider put it. */
function wireValue(compiled: Compiled, at: string): unknown {
  const segments = at.split(".");
  let node: unknown = compiled.body;
  for (const segment of segments) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  if (node !== undefined) return node;
  if (segments.length === 1) {
    const query = new URL(compiled.url).searchParams;
    if (query.has(at)) return query.get(at);
    return compiled.headers[at];
  }
  return undefined;
}

const rows = Object.entries(TABLE);

test("the table covers exactly the providers in the pack", () => {
  expect(rows.map(([provider]) => provider).sort()).toEqual([...stt.providers]);
});

describe.each(rows)("%s", (provider, row) => {
  // -------------------------------------------------------------------------
  // audio — the flagship row, in both directions
  // -------------------------------------------------------------------------

  test("accepts exactly the audio kinds it declares", () => {
    for (const kind of AUDIO_KINDS) {
      const result = stt.safe({ model: row.ref, audio: AUDIO_FOR[kind]() } as never);
      const declared = row.adapter.audioInputs.includes(kind);
      if (declared) {
        expect(result.ok, `${provider} refused a declared \`${kind}\``).toBe(true);
        continue;
      }
      expect(result.ok, `${provider} accepted an undeclared \`${kind}\``).toBe(false);
      if (result.ok) continue;
      const issue = result.errors[0];
      expect(issue?.code).toBe("unsupported_param");
      expect(issue?.path).toEqual(["audio"]);
      // …and the message names what this route DOES take, which is the half a
      // caller can act on.
      for (const accepted of row.adapter.audioInputs) {
        expect(String(issue?.message)).toContain(`{ ${accepted} }`);
      }
    }
  });

  test("declares its audio kinds as a non-empty set the runtime agrees with", () => {
    expect(row.adapter.audioInputs.length).toBeGreaterThan(0);
    expect(row.adapter.unsupported?.["audio"]).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // The scalar rows
  // -------------------------------------------------------------------------

  const scalars = [
    ["language", row.language, PROBE_LANGUAGE, { language: PROBE_LANGUAGE }],
    ["languages", row.languages, PROBE_LANGUAGES[1] as string, { languages: PROBE_LANGUAGES }],
    ["prompt", row.prompt, PROBE_PROMPT, { prompt: PROBE_PROMPT }],
  ] as const;

  test.each(scalars)("%s is %s", (field, support, probe, extra) => {
    const declared = row.adapter.unsupported?.[field];
    if (support === "unsupported") {
      // Declared on the adapter, so the kernel's uniform message applies…
      expect(declared, `${provider}.unsupported.${field}`).toBeDefined();
      // …and it really is refused, at the canonical path.
      expect(compile(row, extra as Partial<SttParams>)).toEqual([
        `unsupported_param @ ${field}`,
      ]);
      return;
    }
    expect(declared, `${provider} must not declare ${field} unsupported`).toBeUndefined();

    const compiled = compile(row, extra as Partial<SttParams>);
    expect(compiled, `${provider} could not compile a ${field} probe`).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    expect(carries(compiled, probe), `${provider} ${field} verbatim`).toBe(support === "native");

    // …and it reached the wire at all.
    const without = compile(row, {});
    expect(Array.isArray(without)).toBe(false);
    if (Array.isArray(without)) return;
    expect(serialize(compiled), `${provider} silently dropped ${field}`).not.toBe(
      serialize(without),
    );
  });

  // -------------------------------------------------------------------------
  // diarization
  // -------------------------------------------------------------------------

  test("diarization lands in its documented shape", () => {
    const on: Diarization = { enabled: true };
    if (row.diarization === "unsupported") {
      expect(row.adapter.unsupported?.["diarization"]).toBeDefined();
      expect(compile(row, { diarization: on })).toEqual(["unsupported_param @ diarization"]);
      return;
    }
    expect(row.adapter.unsupported?.["diarization"]).toBeUndefined();

    const compiled = compile(row, { diarization: on });
    expect(compiled).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    const value = wireValue(compiled, row.diarization.at);
    expect(value, `${provider} wrote nothing at ${row.diarization.at}`).toBeDefined();

    switch (row.diarization.shape) {
      case "inverted":
        // The one adapter where the canonical boolean and the wire boolean
        // disagree about which way is which.
        expect(String(value)).toBe("false");
        break;
      case "enum":
        expect(String(value)).toBe("speaker");
        break;
      default:
        expect(String(value)).toBe("true");
    }

    // And off is expressible too, distinguishably.
    const off = compile(row, { diarization: { enabled: false } });
    expect(off).not.toBeInstanceOf(Array);
    if (Array.isArray(off)) return;
    expect(serialize(off)).not.toBe(serialize(compiled));
  });

  test.each(["speakers", "minSpeakers", "maxSpeakers"] as const)(
    "diarization.%s is refused unless there is a field for it",
    (count) => {
      if (row.diarization === "unsupported") return;
      const compiled = compile(row, { diarization: { enabled: true, [count]: 2 } });
      if (!row.counts[count]) {
        expect(compiled).toEqual([`unsupported_param @ diarization.${count}`]);
        return;
      }
      expect(compiled).not.toBeInstanceOf(Array);
      if (Array.isArray(compiled)) return;
      expect(carries(compiled, 2), `${provider} dropped diarization.${count}`).toBe(true);
    },
  );

  // -------------------------------------------------------------------------
  // timestamps
  // -------------------------------------------------------------------------

  test(`timestamps lands as ${row.timestamps.shape}`, () => {
    const ref = row.timestampsRef ?? row.ref;
    const compiled = compile(row, { timestamps: "word" }, ref);
    expect(compiled, `${provider} could not compile a timestamps probe`).not.toBeInstanceOf(Array);
    if (Array.isArray(compiled)) return;
    const bare = compile(row, {}, ref);
    expect(Array.isArray(bare)).toBe(false);
    if (Array.isArray(bare)) return;

    if (row.timestamps.shape === "implied") {
      // The claim: this route always reports word timings, so asking for them
      // costs the request nothing at all.
      expect(IMPLIED_CELLS).toContain(provider);
      expect(serialize(compiled)).toBe(serialize(bare));
      return;
    }
    const value = wireValue(compiled, row.timestamps.at as string);
    expect(value, `${provider} wrote nothing at ${row.timestamps.at}`).toBeDefined();
    expect(serialize(compiled), `${provider} silently dropped timestamps`).not.toBe(
      serialize(bare),
    );
    switch (row.timestamps.shape) {
      case "array":
        expect(value).toEqual(["word"]);
        break;
      case "scalar":
        expect(value).toBe("word");
        break;
      case "flag":
        // "Emit word timings", asked for directly.
        expect(String(value)).toBe("true");
        break;
      default:
        // A grouping switch: word timings are already coming back, and `false`
        // says "do not group them into segments".
        expect(String(value)).toBe("false");
    }
  });

  test("a granularity this route does not report is refused by name", () => {
    const ref = row.timestampsRef ?? row.ref;
    expect(compile(row, { timestamps: row.absentGranularity }, ref)).toEqual([
      "invalid_enum_value @ timestamps",
    ]);
  });

  test('timestamps: "none" is never an error', () => {
    const ref = row.timestampsRef ?? row.ref;
    expect(compile(row, { timestamps: "none" }, ref)).not.toBeInstanceOf(Array);
  });
});

// ---------------------------------------------------------------------------
// The provider that used to be unreachable
// ---------------------------------------------------------------------------

describe("inworld", () => {
  /**
   * Inworld shipped for one wave with `audioInputs: []` and `audio` declared
   * unsupported — a registered provider no canonical request could reach. The
   * `"data"` kind retired that, and this is the regression: the base64 payload
   * the caller writes has to arrive at `audioData.content` unchanged.
   */
  test("compiles a `{ data }` request into audioData.content", () => {
    const result = stt.safe({
      model: "inworld/inworld/inworld-stt-1",
      audio: { data: PROBE_BASE64, mimeType: "audio/wav" },
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params).toMatchObject({ audioData: { content: PROBE_BASE64 } });
  });

  test("declares no `audio` gap at all any more", () => {
    expect(inworld.audioInputs).toEqual(["data"]);
    expect((inworld.unsupported as Record<string, unknown>)["audio"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The property that has to hold for every cell, not just the probed ones
// ---------------------------------------------------------------------------

describe("no silent drops, over every canonical field", () => {
  /**
   * The one property the loss contract cannot survive losing: a canonical param
   * is either **refused** or **sent**. Never accepted and ignored.
   *
   * The probes above check one value per field; this checks every value in the
   * matrix against every provider — including the combinations (a `language`
   * and a `languages` together, a diarization with three counts) that no single
   * probe exercises.
   */
  const PROBES: Array<Partial<SttParams>> = [
    { language: "en" },
    { language: "pt-BR" },
    { language: "cmn-Hans-CN" },
    { languages: ["en"] },
    { languages: ["en", "pt"] },
    { language: "en", languages: ["en", "pt"] },
    { diarization: { enabled: true } },
    { diarization: { enabled: false } },
    { diarization: { enabled: true, speakers: 2 } },
    { diarization: { enabled: true, minSpeakers: 2 } },
    { diarization: { enabled: true, maxSpeakers: 4 } },
    { diarization: { enabled: true, minSpeakers: 2, maxSpeakers: 4 } },
    { timestamps: "word" },
    { timestamps: "segment" },
    { timestamps: "character" },
    { prompt: PROBE_PROMPT },
    { language: "pt", timestamps: "word", prompt: PROBE_PROMPT },
  ];

  test.each(rows)("%s", (provider, row) => {
    const bare = compile(row, {});
    expect(Array.isArray(bare), `${provider} could not compile a bare request`).toBe(false);
    if (Array.isArray(bare)) return;

    let accepted = 0;
    const dropped: string[] = [];
    for (const probe of PROBES) {
      // The `implied` cells are the enumerated exemption: `timestamps: "word"`
      // there is a request that legitimately compiles to nothing, because the
      // route already does it. Every other combination must change something.
      const impliedOnly =
        row.timestamps.shape === "implied" &&
        Object.keys(probe).length === 1 &&
        probe.timestamps === "word";
      const compiled = compile(row, probe);
      if (Array.isArray(compiled)) continue; // refused — the other half of the contract
      accepted += 1;
      if (impliedOnly) continue;
      if (serialize(compiled) === serialize(bare)) dropped.push(JSON.stringify(probe));
    }
    expect(accepted, `${provider} accepted nothing at all`).toBeGreaterThan(0);
    expect(dropped, `${provider} accepted and ignored a param`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting properties of the table itself
// ---------------------------------------------------------------------------

test("every audio kind in the vocabulary is served by some provider", () => {
  const kinds = new Set(rows.flatMap(([, row]) => row.adapter.audioInputs));
  expect([...kinds].sort()).toEqual(["data", "file", "fileId", "url"]);
});

test("every diarization shape in the category is exercised", () => {
  const shapes = new Set(
    rows
      .map(([, row]) => row.diarization)
      .filter((cell): cell is { shape: DiarizationShape; at: string } => cell !== "unsupported")
      .map((cell) => cell.shape),
  );
  expect([...shapes].sort()).toEqual(["enum", "flag", "inverted"]);
});

test("every timestamp shape in the category is exercised", () => {
  const shapes = new Set(rows.map(([, row]) => row.timestamps.shape));
  expect([...shapes].sort()).toEqual(["array", "boolean", "flag", "implied", "scalar"]);
});

test("the implied cells are exactly the four routes with no granularity field", () => {
  const implied = rows
    .filter(([, row]) => row.timestamps.shape === "implied")
    .map(([provider]) => provider)
    .sort();
  expect(implied).toEqual(IMPLIED_CELLS);
});
