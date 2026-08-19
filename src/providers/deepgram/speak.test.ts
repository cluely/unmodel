import { describe, expect, test } from "bun:test";
import {
  speak,
  speakUrl,
  SPEAK_URL,
  SPEAK_ENCODINGS,
  SPEAK_CONTAINERS,
  DEEPGRAM_SPEAK_SAMPLE_RATES,
  DEFAULT_SPEAK_MODEL_ID,
} from "./speak";
import {
  models,
  AURA_1_USD_PER_MILLION_CHARACTERS,
  AURA_2_USD_PER_MILLION_CHARACTERS,
  SPEAK_MAX_CHARACTERS,
  TTS_MODEL_IDS,
} from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = speak.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("deepgram.speak wire split (body vs query string)", () => {
  test("body is exactly {text}; options ride in .request.url", () => {
    const v = speak({
      text: "Hello, welcome to Deepgram!",
      model: "aura-2-thalia-en",
      encoding: "linear16",
      container: "wav",
      sample_rate: 24000,
    });

    expect(Object.keys(v)).toEqual(["text"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual({ text: "Hello, welcome to Deepgram!" });

    const url = new URL(v.request.url);
    expect(`${url.origin}${url.pathname}`).toBe(SPEAK_URL);
    expect(url.searchParams.get("model")).toBe("aura-2-thalia-en");
    expect(url.searchParams.get("encoding")).toBe("linear16");
    expect(url.searchParams.get("container")).toBe("wav");
    expect(url.searchParams.get("sample_rate")).toBe("24000");
    expect(url.searchParams.get("text")).toBeNull();
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("toSdk returns the options object (query params without text)", () => {
    const v = speak({ text: "hi", model: "aura-2-thalia-en", speed: 0.9 });
    expect(v.toSdk("deepgram")).toEqual({ model: "aura-2-thalia-en", speed: 0.9 });
  });

  test("array tag repeats the key; no params → bare endpoint URL", () => {
    expect(speakUrl({ model: "aura-2-thalia-en", tag: ["a", "b"] })).toBe(
      `${SPEAK_URL}?model=aura-2-thalia-en&tag=a&tag=b`,
    );
    expect(speakUrl({})).toBe(SPEAK_URL);
  });
});

describe("deepgram.speak model gate", () => {
  test("every catalogued TTS voice passes", () => {
    for (const model of TTS_MODEL_IDS) {
      const r = speak.safe({ text: "hi", model });
      expect(r.ok).toBe(true);
    }
  });

  test("an STT model id is rejected as unsupported_capability", () => {
    const r = speak.safe({ text: "hi", model: "nova-3" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.path).toEqual(["model"]);
    }
  });

  test("an id absent from the catalog only warns (it may be a new voice)", () => {
    const r = speak.safe({ text: "hi", model: "aura-3-thalia-en" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("omitted model falls back to the documented server default", () => {
    expect(models[DEFAULT_SPEAK_MODEL_ID].family).toBe("aura");
    const r = speak.safe({ text: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });
});

describe("deepgram.speak audio format combinations", () => {
  test("every documented encoding is accepted on its own", () => {
    // Keep in sync with DeepgramSpeakEncoding — the union is closed (no
    // `(string & {})` tail) and is literally the key type of AUDIO_FORMATS,
    // so every value it advertises must clear checkAudioFormat on its own.
    expect(SPEAK_ENCODINGS.length).toBe(7);
    for (const encoding of SPEAK_ENCODINGS) {
      const r = speak.safe({ text: "hi", model: "aura-2-thalia-en", encoding });
      expect(r.ok, `encoding ${encoding} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `encoding ${encoding} should be warning-free`).toEqual([]);
    }
  });

  test("an undocumented encoding is invalid_enum_value", () => {
    // `encoding` is a closed union (SPEAK_ENCODINGS is the whole documented
    // set and the key type of AUDIO_FORMATS), so "vorbis" only reaches the
    // runtime check through the unchecked cast.
    const r = safeUnchecked({ text: "hi", encoding: "vorbis" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["encoding"]);
    }
  });

  test("every SPEAK_CONTAINERS preset validates against an encoding that allows it", () => {
    // Keep in sync with DeepgramSpeakContainer — the union is exactly the
    // containers AUDIO_FORMATS names, so each must be legal for at least one
    // encoding or autocomplete would offer a wrapper no request can use.
    // linear16 covers wav/none; opus is the only ogg encoding.
    const pairs = [
      { encoding: "linear16", container: "wav" },
      { encoding: "linear16", container: "none" },
      { encoding: "opus", container: "ogg" },
    ] as const;
    expect(new Set(pairs.map((p) => p.container))).toEqual(new Set(SPEAK_CONTAINERS));
    for (const { encoding, container } of pairs) {
      const r = speak.safe({ text: "hi", model: "aura-2-thalia-en", encoding, container });
      expect(r.ok, `${encoding}/${container} should validate`).toBe(true);
      if (r.ok) {
        expect(r.warnings, `${encoding}/${container} should be warning-free`).toEqual([]);
      }
    }
  });

  test("every DEEPGRAM_SPEAK_SAMPLE_RATES preset validates against an encoding that allows it", () => {
    // Keep in sync with DeepgramSpeakSampleRate — the union is the union of
    // every `sampleRates` entry in AUDIO_FORMATS, so each rate must be legal
    // for at least one encoding. The pairings follow the documented table:
    // linear16 lists 8000/16000/24000/32000/48000 and flac is the only
    // encoding that lists 22050 — asserting a forbidden pair would be testing
    // a combination the table rejects.
    const pairs = [
      { encoding: "linear16", sample_rate: 8000 },
      { encoding: "linear16", sample_rate: 16000 },
      { encoding: "flac", sample_rate: 22050 },
      { encoding: "linear16", sample_rate: 24000 },
      { encoding: "linear16", sample_rate: 32000 },
      { encoding: "linear16", sample_rate: 48000 },
    ] as const;
    expect(new Set(pairs.map((p) => p.sample_rate))).toEqual(new Set(DEEPGRAM_SPEAK_SAMPLE_RATES));
    for (const { encoding, sample_rate } of pairs) {
      const r = speak.safe({ text: "hi", model: "aura-2-thalia-en", encoding, sample_rate });
      expect(r.ok, `${encoding}@${sample_rate} should validate`).toBe(true);
      if (r.ok) {
        expect(r.warnings, `${encoding}@${sample_rate} should be warning-free`).toEqual([]);
      }
    }
  });

  test("linear16 accepts wav/none containers and rejects ogg", () => {
    expect(speak.safe({ text: "hi", encoding: "linear16", container: "none" }).ok).toBe(true);
    const r = speak.safe({ text: "hi", encoding: "linear16", container: "ogg" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["container"]);
  });

  test("mp3 has no configurable container or sample rate", () => {
    // 44100 is absent from every AUDIO_FORMATS row, so the closed
    // DeepgramSpeakSampleRate union excludes it — the unchecked cast keeps the
    // original "realistic but undocumented" value reaching the runtime rule.
    const r = safeUnchecked({ text: "hi", encoding: "mp3", container: "wav", sample_rate: 44100 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path[0]).sort()).toEqual(["container", "sample_rate"]);
      expect(r.errors.every((e) => e.code === "unsupported_param")).toBe(true);
    }
  });

  test("combinations are only judged when encoding is explicit", () => {
    // Deepgram's API reference (default mp3) and its media-output-settings page
    // (REST defaults linear16/wav/24000) disagree, so an omitted `encoding`
    // leaves container/sample_rate/bit_rate unjudged rather than risking a
    // false error.
    expect(speak.safe({ text: "hi", sample_rate: 24000 }).ok).toBe(true);
    expect(speak.safe({ text: "hi", bit_rate: 12000 }).ok).toBe(true);
    // With an explicit encoding the table is enforced.
    const r = speak.safe({ text: "hi", encoding: "mp3", bit_rate: 12000 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.path).toEqual(["bit_rate"]);
      expect(r.errors[0]?.meta?.encoding).toBe("mp3");
    }
  });

  test("opus bit_rate is range-checked (4000–650000)", () => {
    expect(speak.safe({ text: "hi", encoding: "opus", bit_rate: 12000 }).ok).toBe(true);
    const r = speak.safe({ text: "hi", encoding: "opus", bit_rate: 3000 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["bit_rate"]);
    }
  });

  test("linear16 has no bit rate at all", () => {
    const r = speak.safe({ text: "hi", encoding: "linear16", bit_rate: 48000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("unsupported_param");
  });

  test("flac sample rates are enumerated", () => {
    expect(speak.safe({ text: "hi", encoding: "flac", sample_rate: 22050 }).ok).toBe(true);
    const r = speak.safe({ text: "hi", encoding: "flac", sample_rate: 24000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta?.allowed).toContain(48000);
  });
});

describe("deepgram.speak voice controls", () => {
  test("speed outside 0.7–1.5 is invalid_shape", () => {
    const r = speak.safe({ text: "hi", model: "aura-2-thalia-en", speed: 1.6 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["speed"]);
    expect(speak.safe({ text: "hi", model: "aura-2-thalia-en", speed: 0.7 }).ok).toBe(true);
  });

  test("speed on an Aura-1 voice warns but passes", () => {
    const r = speak.safe({ text: "hi", model: "aura-asteria-en", speed: 0.9 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unsupported_param"]);
      expect(r.warnings[0]?.path).toEqual(["speed"]);
    }
  });

  test("callback_method is case-insensitive and enum-checked", () => {
    expect(
      speak.safe({ text: "hi", callback: "https://cb.example", callback_method: "PUT" }).ok,
    ).toBe(true);
    const r = safeUnchecked({ text: "hi", callback_method: "PATCH" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["callback_method"]);
  });
});

describe("deepgram.speak limits and cost", () => {
  test("text over 2000 characters is over_output_limit", () => {
    const r = speak.safe({ text: "x".repeat(SPEAK_MAX_CHARACTERS + 1), model: "aura-2-thalia-en" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.errors[0]?.meta).toMatchObject({
        limitCharacters: SPEAK_MAX_CHARACTERS,
        actualCharacters: SPEAK_MAX_CHARACTERS + 1,
      });
    }
    expect(speak.safe({ text: "x".repeat(SPEAK_MAX_CHARACTERS) }).ok).toBe(true);
  });

  test("Aura-2 bills $0.030/1k characters, Aura-1 $0.0150/1k", () => {
    expect(models["aura-2-thalia-en"].cost?.perMillionCharacters).toBe(
      AURA_2_USD_PER_MILLION_CHARACTERS,
    );
    expect(models["aura-asteria-en"].cost?.perMillionCharacters).toBe(
      AURA_1_USD_PER_MILLION_CHARACTERS,
    );
    const text = "x".repeat(1000);
    const two = speak.safe({ text, model: "aura-2-thalia-en" });
    expect(two.ok).toBe(true);
    if (two.ok) expect(two.estimate.costUSD).toBeCloseTo(0.03, 10);
    const one = speak.safe({ text, model: "aura-asteria-en" });
    expect(one.ok).toBe(true);
    if (one.ok) expect(one.estimate.costUSD).toBeCloseTo(0.015, 10);
  });

  test("maxCostUSD turns an expensive request into over_budget", () => {
    const r = speak.safe(
      { text: "x".repeat(2000), model: "aura-2-thalia-en" },
      { maxCostUSD: 0.01 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "over_budget")).toBe(true);
  });

  test("unknown query param warns but passes through", () => {
    const r = safeUnchecked({ text: "hi", brand_new_param: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const throwing = speak as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      throwing({ text: "hi", model: "nova-3" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});
