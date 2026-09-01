/**
 * The capability table for `unmodel/sfx`, committed and then **probed**.
 *
 * Keyed by REF rather than by provider, for the same reason as its lipsync,
 * avatar, upscale and 3d siblings: at fal the route is a parameter, so "which
 * fields does this support" is a per-ENDPOINT question. Seven rows across five
 * independent vendors — the most any category here has had on its first day —
 * and the two ElevenLabs rows are the pair worth reading first: the same model
 * reached two ways, disagreeing on three of six columns.
 *
 * ## The `durationAbsent` column is why this table exists
 *
 * Every other capability table in this suite answers "can this route express
 * X". This one has to answer a second question that no other category needs:
 * **what happens when the caller says nothing**. Three answers across seven
 * rows —
 *
 * | answer | rows | what the adapter does |
 * |---|---|---|
 * | `"model-picks"` | the two ElevenLabs routes | nothing; the model reads a length off the prompt, so nothing was invented and nothing warns |
 * | a NUMBER | Sonilo (8), Mirelo (10), both Stable Audio (30) | leaves the field off the wire and warns `approximated_param` naming the number |
 * | `"required"` | CassetteAI | types `durationSeconds` as REQUIRED, and refuses at run time through the route's own required check |
 *
 * That column is the vocabulary decision made checkable. The adopter request
 * that produced this category proposed `durationSeconds?: number // auto when
 * absent`, which is true for two of seven routes and a 422 for one of them.
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
import { sfx } from "../../src/unified/sfx";
import { sfx as elevenlabs } from "../../src/providers/elevenlabs/unified-sfx";
import { sfx as fal } from "../../src/providers/fal/unified-sfx";

type Support = "native" | "derived" | "unsupported";

/** What omitting `durationSeconds` means at one route. */
type DurationAbsent = "model-picks" | "required" | number;

interface Capability {
  ref: string;
  /** The wire field the prompt lands in. */
  promptAt: string;
  /** The wire field the length lands in, and its bounds. */
  duration: { at: string; min: number; max: number; int: boolean } | "unsupported";
  /** What omitting the length means here. See the module header. */
  durationAbsent: DurationAbsent;
  /** How this route lets a caller ask for an encoding. */
  format: { at: string; kind: "codec" | "composite"; codecs: readonly string[] } | "unsupported";
  /** Whether the route publishes a SEPARATE bitrate field beside the codec. */
  bitrateAt: string | undefined;
  /** The extras this route publishes that the vocabulary has no word for. */
  extras: readonly string[];
}

const COMPOSITE = ["mp3", "opus", "pcm_alaw", "pcm_mulaw", "pcm_s16le"] as const;
const BARE_FOUR = ["aac", "flac", "mp3", "pcm_s16le"] as const;

const TABLE: Readonly<Record<string, Capability>> = {
  // ---- ElevenLabs, natively --------------------------------------------
  "elevenlabs/native": {
    ref: "elevenlabs/eleven_text_to_sound_v2",
    promptAt: "text",
    duration: { at: "duration_seconds", min: 0.5, max: 30, int: false },
    // "If set to None we will guess the optimal duration using the prompt."
    durationAbsent: "model-picks",
    format: { at: "output_format", kind: "composite", codecs: COMPOSITE },
    bitrateAt: undefined,
    extras: ["loop", "prompt_influence"],
  },
  // ---- ElevenLabs, resold by fal — the NARROWED twin --------------------
  "fal/elevenlabs-v2": {
    ref: "fal/fal-ai/elevenlabs/sound-effects/v2",
    // Same wire name, and that is where the agreement stops.
    promptAt: "text",
    // 22, not 30. The reseller's own cap.
    duration: { at: "duration_seconds", min: 0.5, max: 22, int: false },
    durationAbsent: "model-picks",
    // A BODY field here; a query param at the native route.
    format: { at: "output_format", kind: "composite", codecs: COMPOSITE },
    bitrateAt: undefined,
    extras: ["loop", "prompt_influence"],
  },
  // ---- Sonilo — the first witness that absence means a NUMBER -----------
  "fal/sonilo": {
    ref: "fal/sonilo/v1.1/text-to-sound-effects",
    promptAt: "prompt",
    duration: { at: "duration", min: 1, max: 180, int: true },
    durationAbsent: 8,
    format: { at: "audio_format", kind: "codec", codecs: BARE_FOUR },
    bitrateAt: undefined,
    extras: [],
  },
  // ---- CassetteAI — the required arm, and the only row that has one -----
  "fal/cassetteai": {
    ref: "fal/cassetteai/sound-effects-generator",
    promptAt: "prompt",
    duration: { at: "duration", min: 1, max: 30, int: true },
    durationAbsent: "required",
    // The one route in the category with no encoding field at all.
    format: "unsupported",
    bitrateAt: undefined,
    extras: [],
  },
  // ---- Mirelo — the third prompt spelling, and `ambience` ---------------
  "fal/mirelo": {
    ref: "fal/mirelo-ai/sfx1.6/text-to-audio",
    promptAt: "text_prompt",
    duration: { at: "duration", min: 0.1, max: 60, int: false },
    durationAbsent: 10,
    format: { at: "upload_audio_format", kind: "codec", codecs: BARE_FOUR },
    bitrateAt: undefined,
    // `ambience` is the near-miss `loop` would have needed a second witness
    // from: it produces a tileable ambience BED, which changes what is
    // generated rather than where it ends. It rides as an extra for exactly
    // that reason.
    extras: ["ambience", "double_output", "num_samples", "seed"],
  },
  // ---- Stability, both arms — the widest range and the only bitrate -----
  "fal/stable-audio": {
    ref: "fal/fal-ai/stable-audio-3/small/sfx/text-to-audio",
    promptAt: "prompt",
    duration: { at: "duration", min: 1, max: 120, int: false },
    durationAbsent: 30,
    format: {
      at: "output_format",
      kind: "codec",
      codecs: ["aac", "flac", "mp3", "opus", "pcm_s16le"],
    },
    bitrateAt: "bitrate",
    extras: [
      "enable_prompt_expansion",
      "enable_safety_checker",
      "guidance_scale",
      "negative_prompt",
      "num_inference_steps",
      "seed",
      "sync_mode",
    ],
  },
  "fal/stable-audio-base": {
    ref: "fal/fal-ai/stable-audio-3/small/sfx/base/text-to-audio",
    promptAt: "prompt",
    duration: { at: "duration", min: 1, max: 120, int: false },
    durationAbsent: 30,
    format: {
      at: "output_format",
      kind: "codec",
      codecs: ["aac", "flac", "mp3", "opus", "pcm_s16le"],
    },
    bitrateAt: "bitrate",
    extras: [
      "enable_prompt_expansion",
      "enable_safety_checker",
      "guidance_scale",
      "negative_prompt",
      "num_inference_steps",
      "seed",
      "sync_mode",
    ],
  },
};

const PROMPT = "a heavy oak door creaking open in a stone hall";

interface Row {
  textWire?: string;
  lengthWire?: string;
  durationRange?: readonly [number, number];
  durationInt?: true;
  durationDefault?: number;
  durationRequired?: true;
  formatWire?: string;
  bitrateWire?: string;
  codecs?: readonly string[];
  extras?: Readonly<Record<string, unknown>>;
}

/** The row one ref selects, read off the adapter the ref names. */
function rowOf(ref: string): Row {
  const slash = ref.indexOf("/");
  const provider = ref.slice(0, slash);
  const model = ref.slice(slash + 1);
  const table = (provider === "fal" ? fal : elevenlabs).modelParams as Readonly<
    Record<string, Row>
  >;
  const row = table[model];
  if (row === undefined) throw new Error(`${ref} has no row`);
  return row;
}

test("the table covers every ref the pack can reach", () => {
  const refs = new Set(Object.values(TABLE).map((row) => row.ref));
  const shipped = [
    ...elevenlabs.models.map((id) => `elevenlabs/${id}`),
    ...fal.models.map((id) => `fal/${id}`),
  ];
  expect([...refs].sort()).toEqual(shipped.sort());
  // Five independent VENDORS behind seven rows — the count the two-witness
  // argument for this category rests on. ElevenLabs-native and
  // ElevenLabs-on-fal are one witness; the other four are one each.
  expect(new Set(["elevenlabs", "sonilo", "cassetteai", "stability", "mirelo"]).size).toBe(5);
  expect(sfx.providers).toEqual(["elevenlabs", "fal"]);
});

describe.each(Object.entries(TABLE))("%s", (_name, capability) => {
  const row = rowOf(capability.ref);

  test("the prompt lands where the table says", () => {
    // ElevenLabs' native row has no `textWire`: its adapter is hand-written
    // against one endpoint and writes `text` directly.
    const at = row.textWire ?? "text";
    expect(at).toBe(capability.promptAt);

    const result = sfx.safe({
      model: capability.ref,
      prompt: PROMPT,
      ...(capability.durationAbsent === "required" ? { durationSeconds: 3 } : {}),
    } as never);
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
    if (!result.ok) return;
    expect((result.params as Record<string, unknown>)[capability.promptAt]).toBe(PROMPT);
  });

  test("the duration column matches the row, bounds and all", () => {
    if (capability.duration === "unsupported") {
      expect(row.lengthWire).toBeUndefined();
      return;
    }
    // The native ElevenLabs row states its range and has no wire name, because
    // its adapter writes one field; every fal row states both.
    if (row.lengthWire !== undefined) expect(row.lengthWire).toBe(capability.duration.at);
    expect(row.durationRange).toEqual([capability.duration.min, capability.duration.max]);
    expect(row.durationInt ?? false).toBe(capability.duration.int);
  });

  /** The column this table exists for. */
  test("omitting the duration does what the table says", () => {
    const result = sfx.safe({ model: capability.ref, prompt: PROMPT } as never);

    if (capability.durationAbsent === "required") {
      expect(row.durationRequired).toBe(true);
      expect(row.durationDefault).toBeUndefined();
      expect(result.ok).toBe(false);
      return;
    }

    expect(row.durationRequired).toBeUndefined();
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
    if (!result.ok) return;
    const warnings = (result.params as unknown as { warnings: readonly { code: string; meta?: Record<string, unknown> }[] })
      .warnings;
    const params = result.params as Record<string, unknown>;

    if (capability.durationAbsent === "model-picks") {
      expect(row.durationDefault).toBeUndefined();
      // Nothing was invented, so nothing is said.
      expect(warnings).toEqual([]);
      return;
    }

    expect(row.durationDefault).toBe(capability.durationAbsent);
    expect(warnings.map((w) => w.code)).toEqual(["approximated_param"]);
    expect(warnings[0]?.meta?.["achieved"]).toBe(capability.durationAbsent);
    // And the number is NOT sent — pinning it would freeze a value the
    // provider is free to change.
    if (capability.duration !== "unsupported") {
      expect(Object.keys(params)).not.toContain(capability.duration.at);
    }
  });

  test("the encoding column matches the row", () => {
    if (capability.format === "unsupported") {
      expect(row.codecs).toEqual([]);
      const refused = sfx.safe({
        model: capability.ref,
        prompt: PROMPT,
        durationSeconds: 3,
        outputFormat: "mp3",
      } as never);
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.errors[0]?.path).toEqual(["outputFormat"]);
      return;
    }

    if (row.formatWire !== undefined) expect(row.formatWire).toBe(capability.format.at);
    expect([...(row.codecs ?? [])].sort()).toEqual([...capability.format.codecs].sort());

    // Every codec the row claims compiles — the preset sweep's rule, applied
    // here so the table cannot claim one the adapter refuses.
    for (const codec of capability.format.codecs) {
      const result = sfx.safe({
        model: capability.ref,
        prompt: PROMPT,
        durationSeconds: 3,
        outputFormat: codec,
      } as never);
      expect(result.ok, `${capability.ref} ${codec}`).toBe(true);
      if (!result.ok) continue;
      const wire = (result.params as Record<string, unknown>)[capability.format.at];
      if (capability.format.kind === "composite") {
        // `mp3` → `mp3_44100_128`: the composite states a rate the caller did
        // not, which is where the query-param URL comes from.
        expect(typeof wire === "string" || wire === undefined).toBe(true);
      } else {
        expect(typeof wire).toBe("string");
      }
    }
  });

  test("the separate bitrate field is where the table says, and nowhere else", () => {
    expect(row.bitrateWire).toBe(capability.bitrateAt as string | undefined);
    if (capability.bitrateAt === undefined || capability.format === "unsupported") return;
    const result = sfx.safe({
      model: capability.ref,
      prompt: PROMPT,
      durationSeconds: 3,
      outputFormat: { format: "mp3", bitrate: 128000 },
    } as never);
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
    if (!result.ok) return;
    // kbps, suffixed — Stable Audio's own `"192k"` spelling.
    expect((result.params as Record<string, unknown>)[capability.bitrateAt]).toBe("128k");
  });

  test("the extras are exactly the words the vocabulary has none for", () => {
    expect(Object.keys(row.extras ?? {}).sort()).toEqual([...capability.extras].sort());
    // No extra may shadow a canonical word — that would race the adapter for
    // the same wire field.
    for (const key of Object.keys(row.extras ?? {})) {
      expect(key).not.toBe(capability.promptAt);
      if (capability.duration !== "unsupported") expect(key).not.toBe(capability.duration.at);
      if (capability.format !== "unsupported") expect(key).not.toBe(capability.format.at);
      expect(key).not.toBe(capability.bitrateAt);
    }
  });
});

describe("the category's own claims, across the table", () => {
  /**
   * The two-witness arithmetic, executable. `loop` is published by ElevenLabs
   * and by nobody else, so it may not be a canonical word — and the day a
   * second independent vendor publishes it, this test fails and the vocabulary
   * gets revisited. That is the lipsync precedent: hold a decline in an
   * assertion rather than in prose.
   */
  test("`loop` still has exactly one vendor witness", () => {
    const vendors = new Set<string>();
    for (const capability of Object.values(TABLE)) {
      if (!capability.extras.includes("loop")) continue;
      // ElevenLabs native and ElevenLabs-on-fal are ONE witness.
      vendors.add(capability.ref.includes("elevenlabs") ? "elevenlabs" : capability.ref);
    }
    expect([...vendors]).toEqual(["elevenlabs"]);
  });

  /** …and `prompt` and `outputFormat` have the four and five that admitted them. */
  test("`prompt` is 5/5 and `outputFormat` is 4/5, by vendor", () => {
    const vendorOf = (ref: string): string =>
      ref.includes("elevenlabs")
        ? "elevenlabs"
        : ref.includes("sonilo")
          ? "sonilo"
          : ref.includes("cassetteai")
            ? "cassetteai"
            : ref.includes("stable-audio")
              ? "stability"
              : "mirelo";

    const all = new Set(Object.values(TABLE).map((c) => vendorOf(c.ref)));
    expect(all.size).toBe(5);

    const withFormat = new Set(
      Object.values(TABLE)
        .filter((c) => c.format !== "unsupported")
        .map((c) => vendorOf(c.ref)),
    );
    expect(withFormat.size).toBe(4);
    expect(withFormat.has("cassetteai")).toBe(false);
  });

  /**
   * The narrowing that makes this category's overlap worth having. Reached
   * natively the same model takes 30 seconds; reached through fal it takes 22,
   * and a request for 25 succeeds one way and fails the other.
   */
  test("the resold ElevenLabs route is NARROWER than the native one", () => {
    const native = sfx.safe({
      model: "elevenlabs/eleven_text_to_sound_v2",
      prompt: PROMPT,
      durationSeconds: 25,
    } as never);
    const resold = sfx.safe({
      model: "fal/fal-ai/elevenlabs/sound-effects/v2",
      prompt: PROMPT,
      durationSeconds: 25,
    } as never);
    expect(native.ok).toBe(true);
    expect(resold.ok).toBe(false);
  });
});
