import { describe, expect, test } from "bun:test";
import {
  tts,
  TTS_URL,
  MAX_TEXT_CHARACTERS,
  MAX_DESCRIPTION_CHARACTERS,
  MAX_GENERATIONS,
} from "./tts";
import { models } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = tts.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("hume.tts happy path", () => {
  test("returns a wire-pure body with hidden toSdk/request", () => {
    const params = {
      utterances: [{ text: "Hello from Octave.", description: "Warm and steady." }],
      format: { type: "mp3" as const },
      num_generations: 1,
    };
    const v = tts(params);

    expect(Object.keys(v)).toEqual(["utterances", "format", "num_generations"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(TTS_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("toSdk camelCases the keys the hume TS SDK expects", () => {
    const v = tts({
      utterances: [
        {
          text: "Hi",
          description: "Calm",
          speed: 1.2,
          trailing_silence: 0.5,
          voice: { name: "Ito", provider: "HUME_AI" },
        },
      ],
      context: { utterances: [{ text: "earlier turn", trailing_silence: 1 }] },
      include_timestamp_types: ["word"],
      num_generations: 2,
      split_utterances: false,
      strip_headers: true,
      temperature: 0.8,
      version: "2",
    });

    expect(v.toSdk("hume")).toEqual({
      utterances: [
        {
          text: "Hi",
          description: "Calm",
          speed: 1.2,
          trailingSilence: 0.5,
          voice: { name: "Ito", provider: "HUME_AI" },
        },
      ],
      context: { utterances: [{ text: "earlier turn", trailingSilence: 1 }] },
      includeTimestampTypes: ["word"],
      numGenerations: 2,
      splitUtterances: false,
      stripHeaders: true,
      temperature: 0.8,
      version: "2",
    });
  });

  test("toSdk maps a generation-id context to generationId", () => {
    const v = tts({ utterances: [{ text: "x" }], context: { generation_id: "gen_1" } });
    expect(v.toSdk("hume").context).toEqual({ generationId: "gen_1" });
  });

  test("toSdk drops explicit nulls (null means provider default)", () => {
    const v = tts({
      utterances: [{ text: "x", description: null, voice: null }],
      context: null,
      temperature: null,
    });
    expect(v.toSdk("hume")).toEqual({ utterances: [{ text: "x" }] });
  });

  test("unknown top-level key warns", () => {
    const r = safeUnchecked({ utterances: [{ text: "x" }], model: "octave-2" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("unknown_param");
  });
});

describe("hume.tts version → Octave mapping", () => {
  test('version "2" resolves to the octave-2 catalog row', () => {
    const r = tts.safe({ utterances: [{ text: "x", voice: { id: "v1" } }], version: "2" });
    expect(r.ok).toBe(true);
    // octave-2 is a preview model, so it carries status "beta" (not deprecated).
    expect(models["octave-2"].status).toBe("beta");
  });

  test("an omitted version still costs and caps against the octave row", () => {
    const r = tts.safe({ utterances: [{ text: "a".repeat(1000) }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.15, 10);
  });

  test("a numeric version is invalid_shape — the enum is the strings 1 and 2", () => {
    const r = safeUnchecked({ utterances: [{ text: "x" }], version: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("an unknown version string is invalid_shape", () => {
    const r = safeUnchecked({ utterances: [{ text: "x" }], version: "3" });
    expect(r.ok).toBe(false);
  });
});

describe("hume.tts per-utterance caps", () => {
  test("text over 5,000 characters is over_output_limit with the utterance index", () => {
    const r = tts.safe({
      utterances: [{ text: "ok" }, { text: "a".repeat(MAX_TEXT_CHARACTERS + 1) }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.errors[0]?.path).toEqual(["utterances", 1, "text"]);
      expect(r.errors[0]?.message).toContain("characters, not tokens");
      expect(r.errors[0]?.meta?.limitCharacters).toBe(5000);
      expect(r.errors[0]?.meta?.actualCharacters).toBe(5001);
    }
  });

  test("text at exactly the cap passes", () => {
    expect(tts.safe({ utterances: [{ text: "a".repeat(MAX_TEXT_CHARACTERS) }] }).ok).toBe(true);
  });

  test("description over 1,000 characters is invalid_shape", () => {
    const r = safeUnchecked({
      utterances: [{ text: "x", description: "d".repeat(MAX_DESCRIPTION_CHARACTERS + 1) }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["utterances", 0, "description"]);
  });

  test("an empty utterances array is invalid_shape", () => {
    const r = safeUnchecked({ utterances: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const unchecked = tts as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      unchecked({ utterances: [{ text: "a".repeat(5001) }] });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("hume.tts schema enforcement", () => {
  test("speed outside 0.5–2 is invalid_shape", () => {
    for (const speed of [0.4, 2.5]) {
      expect(safeUnchecked({ utterances: [{ text: "x", speed }] }).ok).toBe(false);
    }
    expect(tts.safe({ utterances: [{ text: "x", speed: 0.5 }] }).ok).toBe(true);
  });

  test("trailing_silence outside 0–5 is invalid_shape", () => {
    expect(safeUnchecked({ utterances: [{ text: "x", trailing_silence: 6 }] }).ok).toBe(false);
    expect(tts.safe({ utterances: [{ text: "x", trailing_silence: 5 }] }).ok).toBe(true);
  });

  test("num_generations outside 1–5 is invalid_shape", () => {
    expect(safeUnchecked({ utterances: [{ text: "x" }], num_generations: 0 }).ok).toBe(false);
    expect(
      safeUnchecked({ utterances: [{ text: "x" }], num_generations: MAX_GENERATIONS + 1 }).ok,
    ).toBe(false);
    expect(tts.safe({ utterances: [{ text: "x" }], num_generations: MAX_GENERATIONS }).ok).toBe(
      true,
    );
  });

  test("temperature outside 0.1–1 is invalid_shape", () => {
    expect(safeUnchecked({ utterances: [{ text: "x" }], temperature: 1.5 }).ok).toBe(false);
    expect(safeUnchecked({ utterances: [{ text: "x" }], temperature: 0 }).ok).toBe(false);
  });

  test("an unknown format type is invalid_shape", () => {
    expect(safeUnchecked({ utterances: [{ text: "x" }], format: { type: "opus" } }).ok).toBe(false);
    for (const type of ["mp3", "pcm", "wav"] as const) {
      expect(tts.safe({ utterances: [{ text: "x" }], format: { type } }).ok).toBe(true);
    }
  });

  test("an unknown voice provider is invalid_shape", () => {
    const r = safeUnchecked({
      utterances: [{ text: "x", voice: { id: "v", provider: "ELEVEN" } }],
    });
    expect(r.ok).toBe(false);
  });

  test("an unknown timestamp type is invalid_shape", () => {
    expect(
      safeUnchecked({ utterances: [{ text: "x" }], include_timestamp_types: ["sentence"] }).ok,
    ).toBe(false);
  });
});

describe("hume.tts documented rejections (doc audit 2026-08-13)", () => {
  test('version "2" without any voice is unsupported_capability', () => {
    const r = tts.safe({ utterances: [{ text: "x" }], version: "2" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.path).toEqual(["utterances", 0, "voice"]);
      expect(r.errors[0]?.message).toContain("requires a voice");
    }
  });

  test('version "2" passes when any utterance carries a voice', () => {
    expect(
      tts.safe({
        utterances: [{ text: "a", voice: { id: "v1" } }, { text: "b" }],
        version: "2",
      }).ok,
    ).toBe(true);
  });

  test("a voiceless request is fine without version 2 (dynamic voice design)", () => {
    expect(tts.safe({ utterances: [{ text: "x", description: "a wry narrator" }] }).ok).toBe(true);
  });

  test('include_timestamp_types on version "1" warns', () => {
    const r = tts.safe({
      utterances: [{ text: "x" }],
      version: "1",
      include_timestamp_types: ["word"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const issue = r.warnings.find((w) => w.code === "unsupported_param");
      expect(issue?.path).toEqual(["include_timestamp_types"]);
      expect(issue?.message).toContain("Octave 2");
    }
  });

  test('include_timestamp_types is silent on version "2" and when empty', () => {
    const two = tts.safe({
      utterances: [{ text: "x", voice: { id: "v" } }],
      version: "2",
      include_timestamp_types: ["word", "phoneme"],
    });
    expect(two.ok).toBe(true);
    if (two.ok) expect(two.warnings).toEqual([]);

    const empty = tts.safe({
      utterances: [{ text: "x" }],
      version: "1",
      include_timestamp_types: [],
    });
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.warnings).toEqual([]);
  });

  test("instant_mode on the non-streaming route warns", () => {
    for (const instant_mode of [true, false]) {
      const r = tts.safe({ utterances: [{ text: "x" }], instant_mode });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const issue = r.warnings.find((w) => w.code === "unsupported_param");
        expect(issue?.path).toEqual(["instant_mode"]);
        expect(issue?.message).toContain("streaming endpoints");
      }
    }
  });
});

describe("hume.tts cost estimation", () => {
  test("sums utterance text and excludes context utterances", () => {
    const r = tts.safe({
      utterances: [{ text: "a".repeat(600) }, { text: "b".repeat(400) }],
      context: { utterances: [{ text: "c".repeat(5000) }] },
    });
    expect(r.ok).toBe(true);
    // 1,000 billed characters at $150/1M.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.15, 10);
  });

  // Pins the documented worst-case ceiling, NOT a Hume-published rate: no Hume
  // source states that N generations bill N× the input text (see the `estimate`
  // JSDoc in tts.ts). The floor for this request is 0.15; unmodel reports the
  // ceiling.
  test("num_generations multiplies the worst-case estimate", () => {
    const r = tts.safe({ utterances: [{ text: "a".repeat(1000) }], num_generations: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.45, 10);
  });

  test("maxCostUSD enforces over_budget", () => {
    const r = tts.safe({ utterances: [{ text: "a".repeat(5000) }] }, { maxCostUSD: 0.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_budget");
      expect(r.errors[0]?.meta?.estimated).toBeCloseTo(0.75, 10);
    }
  });
});

describe("hume catalog", () => {
  test("both Octave versions are TTS-shaped with the 5,000-character cap", () => {
    for (const info of Object.values(models)) {
      expect(info.limit.context).toBe(0);
      expect(info.limit.characters).toBe(5000);
      expect(info.modalities.input).toEqual(["text"]);
      expect(info.modalities.output).toEqual(["audio"]);
      expect(info.cost?.perMillionCharacters).toBe(150);
    }
  });
});
