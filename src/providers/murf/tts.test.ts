import { describe, expect, test } from "bun:test";
import {
  tts,
  ttsStream,
  SPEECH_GENERATE_URL,
  SPEECH_STREAM_URL,
  SPEECH_FORMATS,
  CHANNEL_TYPES,
  COMPANDED_SAMPLE_RATE,
  COMPANDED_CHANNEL_TYPE,
  DEFAULT_STREAM_MODEL,
  FALCON_STYLE,
  VOLUME_OFFSET_MIN,
  VOLUME_OFFSET_MAX,
} from "./tts";
import { checkTts } from "./check";
import { models, MURF_MAX_CHARACTERS, STREAM_MODEL_IDS, GENERATE_MODEL_VERSIONS } from "./models";
import { tts as murfAdapter } from "./unified";
import { createTts } from "../../unified/tts";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeGenerate = tts.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;
const safeStream = ttsStream.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("murf.tts happy path", () => {
  test("returns a wire-pure body and request meta", () => {
    const v = tts({
      text: "Hello world",
      voiceId: "en-US-natalie",
      format: "MP3",
      rate: 10,
      pitch: -5,
    });
    expect(Object.keys(v)).toEqual(["text", "voiceId", "format", "rate", "pitch"]);
    expect(v.request.url).toBe(SPEECH_GENERATE_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    expect(v.toSdk("murf")).toEqual({
      text: "Hello world",
      voiceId: "en-US-natalie",
      format: "MP3",
      rate: 10,
      pitch: -5,
    });
  });

  test("an omitted modelVersion resolves to the gen2 catalog entry", () => {
    const r = tts.safe({ text: "a".repeat(1000), voiceId: "en-US-natalie" });
    expect(r.ok).toBe(true);
    // gen2 is $30 / 1M characters.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo((1000 * 30) / 1_000_000, 12);
  });

  test("modelVersion GEN2 lower-cases to the same catalog entry, no unknown_model", () => {
    const r = tts.safe({ text: "hi", voiceId: "v", modelVersion: "GEN2" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
    expect(GENERATE_MODEL_VERSIONS).toEqual(["GEN2"]);
  });

  test("asking generate for Falcon 2 errors and points at the streaming route", () => {
    const r = tts.safe({ text: "hi", voiceId: "v", modelVersion: "FALCON2" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const err = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(err?.path).toEqual(["modelVersion"]);
      expect(err?.message).toContain("/v1/speech/stream");
      expect(err?.meta?.allowed).toEqual([...GENERATE_MODEL_VERSIONS]);
    }
  });

  test("multiNativeLocale warns as deprecated in favour of locale", () => {
    const r = tts.safe({ text: "hi", voiceId: "v", multiNativeLocale: "en-US" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const warn = r.warnings.find((w) => w.path[0] === "multiNativeLocale");
      expect(warn?.code).toBe("unsupported_param");
      expect(warn?.meta?.replacement).toBe("locale");
    }
  });

  test("pronunciationDictionary is a generate field too, with the same entry types", () => {
    const ok = tts.safe({
      text: "tomato",
      voiceId: "v",
      pronunciationDictionary: { tomato: { type: "IPA", pronunciation: "təˈmɑːtəʊ" } },
    });
    expect(ok.ok && ok.warnings).toEqual([]);
    const bad = safeGenerate({
      text: "hi",
      voiceId: "v",
      pronunciationDictionary: { hi: { type: "ARPABET" } },
    });
    expect(bad.ok).toBe(false);
  });

  test("unknown top-level params warn", () => {
    const r = safeGenerate({ text: "hi", voiceId: "v", model: "falcon-2" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.find((w) => w.code === "unknown_param")?.path).toEqual(["model"]);
  });
});

describe("murf.tts numeric bounds", () => {
  test("rate and pitch are integers in -50..50", () => {
    expect(tts.safe({ text: "hi", voiceId: "v", rate: -50 }).ok).toBe(true);
    expect(tts.safe({ text: "hi", voiceId: "v", pitch: 50 }).ok).toBe(true);
    expect(safeGenerate({ text: "hi", voiceId: "v", rate: -51 }).ok).toBe(false);
    expect(safeGenerate({ text: "hi", voiceId: "v", pitch: 51 }).ok).toBe(false);
    expect(safeGenerate({ text: "hi", voiceId: "v", rate: 1.5 }).ok).toBe(false);
  });

  test("variation is an integer in 0..5", () => {
    expect(tts.safe({ text: "hi", voiceId: "v", variation: 0 }).ok).toBe(true);
    expect(tts.safe({ text: "hi", voiceId: "v", variation: 5 }).ok).toBe(true);
    expect(safeGenerate({ text: "hi", voiceId: "v", variation: 6 }).ok).toBe(false);
    expect(safeGenerate({ text: "hi", voiceId: "v", variation: -1 }).ok).toBe(false);
  });

  test("sampleRate is a closed list — 16000 is streaming-only", () => {
    expect(tts.safe({ text: "hi", voiceId: "v", sampleRate: 44100 }).ok).toBe(true);
    expect(safeGenerate({ text: "hi", voiceId: "v", sampleRate: 16000 }).ok).toBe(false);
    expect(ttsStream.safe({ text: "hi", voiceId: "v", sampleRate: 16000 }).ok).toBe(true);
  });

  test("required fields are enforced", () => {
    expect(safeGenerate({ voiceId: "v" }).ok).toBe(false);
    expect(safeGenerate({ text: "hi" }).ok).toBe(false);
    expect(safeGenerate({ text: "", voiceId: "v" }).ok).toBe(false);
  });
});

describe("murf companded-codec rules", () => {
  // "If you specify a different channel type or sample rate, the API will
  // default to the supported values" — so these warn; they never fail.
  test("ULAW with a non-8000 sample rate warns that 8000 Hz is used", () => {
    const r = tts.safe({
      text: "hi",
      voiceId: "v",
      format: "ULAW",
      sampleRate: 44100,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const warn = r.warnings.find((w) => w.path[0] === "sampleRate");
      expect(warn?.code).toBe("invalid_enum_value");
      expect(warn?.severity).toBe("warning");
      expect(warn?.meta?.allowed).toEqual([COMPANDED_SAMPLE_RATE]);
    }
  });

  test("ALAW with STEREO warns that MONO is used", () => {
    const r = tts.safe({
      text: "hi",
      voiceId: "v",
      format: "ALAW",
      channelType: "STEREO",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.find((w) => w.path[0] === "channelType")?.meta?.allowed).toEqual([
        COMPANDED_CHANNEL_TYPE,
      ]);
    }
  });

  test("ULAW at 8000/MONO passes", () => {
    const r = tts.safe({
      text: "hi",
      voiceId: "v",
      format: "ULAW",
      sampleRate: 8000,
      channelType: "MONO",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("the rule also applies on the streaming route", () => {
    const r = ttsStream.safe({ text: "hi", voiceId: "v", format: "ULAW", sampleRate: 24000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.path[0])).toEqual(["sampleRate"]);
  });

  test("non-companded formats are unaffected", () => {
    expect(
      tts.safe({
        text: "hi",
        voiceId: "v",
        format: "WAV",
        sampleRate: 48000,
        channelType: "STEREO",
      }).ok,
    ).toBe(true);
  });
});

describe("murf enums", () => {
  test("every documented format passes", () => {
    for (const format of SPEECH_FORMATS) {
      const params = { text: "hi", voiceId: "v", format, sampleRate: 8000 } as const;
      expect(tts.safe({ ...params, channelType: "MONO" }).ok).toBe(true);
    }
  });

  test("an undocumented format is invalid_enum_value", () => {
    const r = safeGenerate({ text: "hi", voiceId: "v", format: "AAC" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "invalid_enum_value")?.meta?.allowed).toEqual([
        ...SPEECH_FORMATS,
      ]);
    }
  });

  test("an undocumented channelType is invalid_enum_value", () => {
    const r = safeGenerate({ text: "hi", voiceId: "v", channelType: "QUAD" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.path[0] === "channelType")?.meta?.allowed).toEqual([
        ...CHANNEL_TYPES,
      ]);
    }
  });
});

describe("murf.ttsStream", () => {
  test("targets the streaming URL and defaults to falcon-2.1 pricing", () => {
    expect(DEFAULT_STREAM_MODEL).toBe("falcon-2.1");
    const v = ttsStream({ text: "a".repeat(1000), voiceId: "en-US-natalie" });
    expect(Object.keys(v)).toEqual(["text", "voiceId"]);
    expect(v.request.url).toBe(SPEECH_STREAM_URL);
    expect(v.request.headers["content-type"]).toBe("application/json");
    const r = ttsStream.safe({ text: "a".repeat(1000), voiceId: "en-US-natalie" });
    expect(r.ok).toBe(true);
    // falcon-2.1 is $10 / 1M characters.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo((1000 * 10) / 1_000_000, 12);
  });

  test("every documented stream id resolves to a catalog row", () => {
    for (const model of STREAM_MODEL_IDS) {
      const r = ttsStream.safe({ text: "hi", voiceId: "v", model });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
  });

  test("falcon-2.1 validates and prices at $10 / 1M characters", () => {
    expect(models["falcon-2.1"].limit.characters).toBe(MURF_MAX_CHARACTERS);
    const r = ttsStream.safe({ text: "a".repeat(1000), voiceId: "v", model: "falcon-2.1" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(r.estimate.costUSD).toBeCloseTo((1000 * 10) / 1_000_000, 12);
    }
  });

  test("the falcon-2 row is Falcon 2.1 under its earlier id, at the same rate", () => {
    expect(models["falcon-2"].name).toBe("Falcon 2.1 (earlier id falcon-2)");
    expect(models["falcon-2"].cost).toEqual(models["falcon-2.1"].cost);
    expect(models["falcon-2"].limit).toEqual(models["falcon-2.1"].limit);
  });

  test("the earlier spellings falcon2 and FALCON price as falcon-2.1", () => {
    for (const model of ["falcon2", "FALCON"] as const) {
      const r = ttsStream.safe({ text: "a".repeat(1000), voiceId: "v", model });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.warnings).toEqual([]);
        expect(r.estimate.costUSD).toBeCloseTo((1000 * 10) / 1_000_000, 12);
      }
    }
    // Only the documented spellings: a lower-case `falcon` is not one on HTTP.
    const off = safeStream({ text: "hi", voiceId: "v", model: "falcon" });
    expect(off.ok && off.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("volumeOffset in -50..50 is clean; outside it warns that Murf clamps", () => {
    expect(ttsStream.safe({ text: "hi", voiceId: "v", volumeOffset: VOLUME_OFFSET_MIN }).ok).toBe(
      true,
    );
    const clean = ttsStream.safe({ text: "hi", voiceId: "v", volumeOffset: VOLUME_OFFSET_MAX });
    expect(clean.ok && clean.warnings).toEqual([]);
    for (const [value, applied] of [
      [80, 50],
      [-70, -50],
    ] as const) {
      const r = ttsStream.safe({ text: "hi", voiceId: "v", volumeOffset: value });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const warn = r.warnings.find((w) => w.path[0] === "volumeOffset");
        expect(warn?.severity).toBe("warning");
        expect(warn?.meta).toMatchObject({ value, applied });
      }
    }
  });

  test("volumeOffset must be an integer", () => {
    expect(safeStream({ text: "hi", voiceId: "v", volumeOffset: 1.5 }).ok).toBe(false);
  });

  test("pronunciationDictionary takes IPA / SAY_AS entries and refuses other types", () => {
    const ok = ttsStream.safe({
      text: "Murf reads tomato",
      voiceId: "v",
      pronunciationDictionary: {
        tomato: { type: "IPA", pronunciation: "təˈmeɪtoʊ" },
        Murf: { type: "SAY_AS", pronunciation: "murph" },
      },
    });
    expect(ok.ok && ok.warnings).toEqual([]);
    const bad = safeStream({
      text: "hi",
      voiceId: "v",
      pronunciationDictionary: { hi: { type: "XSAMPA", pronunciation: "haI" } },
    });
    expect(bad.ok).toBe(false);
  });

  test("multiNativeLocale on the stream route warns as deprecated in favour of locale", () => {
    const r = ttsStream.safe({ text: "hi", voiceId: "v", multiNativeLocale: "en-US" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const warn = r.warnings.find((w) => w.path[0] === "multiNativeLocale");
      expect(warn?.code).toBe("unsupported_param");
      expect(warn?.meta?.replacement).toBe("locale");
    }
  });

  test("Falcon 2.1 speaks one style: Conversational is clean, another warns", () => {
    const clean = ttsStream.safe({ text: "hi", voiceId: "v", style: FALCON_STYLE });
    expect(clean.ok && clean.warnings).toEqual([]);
    for (const model of ["falcon-2.1", "falcon-2", "FALCON"] as const) {
      const r = ttsStream.safe({ text: "hi", voiceId: "v", model, style: "Angry" });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const warn = r.warnings.find((w) => w.path[0] === "style");
        expect(warn?.code).toBe("invalid_enum_value");
        expect(warn?.severity).toBe("warning");
        expect(warn?.meta?.allowed).toEqual([FALCON_STYLE]);
      }
    }
  });

  test("gen2 is decommissioned on the streaming route and the error names murf.tts", () => {
    expect(STREAM_MODEL_IDS).not.toContain("gen2");
    const r = ttsStream.safe({ text: "hi", voiceId: "v", model: "gen2" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const err = r.errors.find((e) => e.path[0] === "model");
      expect(err?.code).toBe("invalid_enum_value");
      expect(err?.message).toContain("/v1/speech/generate");
      expect(err?.meta).toMatchObject({ allowed: [...STREAM_MODEL_IDS], replacement: "murf.tts" });
    }
    // The row itself stays, for the generate route.
    expect(tts.safe({ text: "hi", voiceId: "v", modelVersion: "GEN2" }).ok).toBe(true);
  });

  test("variation is a Synthesize (Gen 2) field, not a stream one", () => {
    for (const model of STREAM_MODEL_IDS) {
      const r = safeStream({ text: "hi", voiceId: "v", model, variation: 3 });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.warnings.map((w) => `${w.code} @ ${w.path.join(".")}`)).toEqual([
          "unknown_param @ variation",
        ]);
      }
    }
  });

  test("an unknown model warns rather than erroring", () => {
    const r = safeStream({ text: "hi", voiceId: "v", model: "falcon-3" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});

describe("murf unified tts", () => {
  const unified = createTts([murfAdapter]);

  test("murf/falcon-2.1 compiles to the stream route with its extras", () => {
    const r = unified.safe({
      model: "murf/falcon-2.1",
      text: "hi",
      voice: "en-US-natalie",
      volumeOffset: 10,
      pronunciationDictionary: { hi: { type: "IPA", pronunciation: "haɪ" } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    expect(r.params.request.url).toBe(SPEECH_STREAM_URL);
    expect(JSON.parse(JSON.stringify(r.params))).toEqual({
      text: "hi",
      voiceId: "en-US-natalie",
      model: "falcon-2.1",
      volumeOffset: 10,
      pronunciationDictionary: { hi: { type: "IPA", pronunciation: "haɪ" } },
    });
  });

  test("murf/falcon-2 takes the same stream extras", () => {
    const r = unified.safe({
      model: "murf/falcon-2",
      text: "hi",
      voice: "en-US-natalie",
      volumeOffset: -10,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.params.request.url).toBe(SPEECH_STREAM_URL);
  });

  test("murf/gen2 takes pronunciationDictionary on the generate route", () => {
    const r = unified.safe({
      model: "murf/gen2",
      text: "hi",
      voice: "en-US-natalie",
      pronunciationDictionary: { hi: { type: "SAY_AS", pronunciation: "high" } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    expect(r.params.request.url).toBe(SPEECH_GENERATE_URL);
    expect(JSON.parse(JSON.stringify(r.params))).toMatchObject({
      modelVersion: "GEN2",
      pronunciationDictionary: { hi: { type: "SAY_AS", pronunciation: "high" } },
    });
  });
});

describe("murf character limit", () => {
  test("text over 3000 characters is over_output_limit with character meta", () => {
    expect(models.gen2.limit.characters).toBe(MURF_MAX_CHARACTERS);
    const text = "a".repeat(MURF_MAX_CHARACTERS + 1);
    const r = tts.safe({ text, voiceId: "v" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const err = r.errors.find((e) => e.code === "over_output_limit");
      expect(err?.path).toEqual(["text"]);
      expect(err?.meta).toMatchObject({
        limitCharacters: MURF_MAX_CHARACTERS,
        actualCharacters: MURF_MAX_CHARACTERS + 1,
        // The FAQ states the cap; the TTS overview page does not.
        source: "https://murf.ai/api/docs/resources/faq",
      });
    }
  });

  test("the cap also applies on the streaming route", () => {
    const r = ttsStream.safe({ text: "a".repeat(MURF_MAX_CHARACTERS + 1), voiceId: "v" });
    expect(r.ok).toBe(false);
  });

  test("exactly at the cap passes", () => {
    expect(tts.safe({ text: "a".repeat(MURF_MAX_CHARACTERS), voiceId: "v" }).ok).toBe(
      true,
    );
  });

  test("maxCostUSD turns an over-budget request into an error", () => {
    expect(() =>
      tts({ text: "a".repeat(3000), voiceId: "v" }, { maxCostUSD: 0.00001 }),
    ).toThrow(UnmodelValidationError);
  });
});

describe("murf.checkTts", () => {
  test("a normal response is clean", () => {
    const report = checkTts({
      audioFile: "https://murf.ai/clip.wav",
      audioLengthInSeconds: 3.2,
      remainingCharacterCount: 99_000,
      wordDurations: [{ word: "Hello", startMs: 0, endMs: 400 }],
    });
    expect(report.warnings).toEqual([]);
    expect(report.costUSD).toBeUndefined();
  });

  test("no audio at all warns", () => {
    const report = checkTts({ audioLengthInSeconds: 0 });
    expect(report.warnings.map((w) => w.meta?.kind)).toEqual(["empty_audio", "zero_length_audio"]);
  });

  test("encodedAudio alone counts as audio", () => {
    const report = checkTts({ encodedAudio: "UklGRg==", audioLengthInSeconds: 1 });
    expect(report.warnings).toEqual([]);
  });

  test("a provider warning is surfaced", () => {
    const report = checkTts({
      audioFile: "https://murf.ai/clip.wav",
      audioLengthInSeconds: 1,
      warning: "style not supported for this voice",
    });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.meta?.kind).toBe("provider_warning");
  });

  test("never throws on a malformed response", () => {
    expect(() => checkTts({} as never)).not.toThrow();
  });
});
