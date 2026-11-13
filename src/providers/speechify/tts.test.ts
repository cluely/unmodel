import { describe, expect, test } from "bun:test";
import {
  tts,
  ttsStream,
  AUDIO_SPEECH_URL,
  AUDIO_STREAM_URL,
  SPEECH_MAX_CHARACTERS,
  STREAM_MAX_CHARACTERS,
  SPEECH_OUTPUT_FORMATS,
  STREAM_OUTPUT_FORMATS,
  MAX_PRONUNCIATIONS,
  PRONUNCIATION_LANGUAGES,
  type SpeechifyPronunciation,
} from "./tts";
import { models, SPEECHIFY_MODEL_IDS } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const ttsUnchecked = tts.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;
const streamUnchecked = ttsStream.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("speechify.tts happy path", () => {
  test("returns a wire-pure body with hidden toSdk/request", () => {
    const params = {
      input: "Hello from Speechify.",
      voice_id: "geffen_32",
      model: "simba-3.2" as const,
      audio_format: "mp3" as const,
    };
    const v = tts(params);

    expect(Object.keys(v)).toEqual(["input", "voice_id", "model", "audio_format"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(AUDIO_SPEECH_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    // @speechify/api's GetSpeechRequest is snake_case — toSdk is the identity.
    expect(v.toSdk("speechify")).toEqual(params);
  });

  test("every documented optional field passes", () => {
    const r = tts.safe({
      input: "x",
      voice_id: "george",
      model: "simba-3.0",
      language: "es-MX",
      audio_format: "wav",
      output_format: "wav_48000",
      options: { loudness_normalization: true, text_normalization: false },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown model warns; the legacy Simba 1.6 ids warn as deprecated", () => {
    const unknown = tts.safe({ input: "x", voice_id: "v", model: "simba-9" });
    expect(unknown.ok).toBe(true);
    if (unknown.ok) expect(unknown.warnings.map((w) => w.code)).toEqual(["unknown_model"]);

    for (const id of ["simba-english", "simba-multilingual"] as const) {
      expect(models[id].status).toBe("deprecated");
      const r = tts.safe({ input: "x", voice_id: "v", model: id });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
    }
  });

  test("simba-3.5, the recommended model, validates with no warning on both routes", () => {
    const speech = tts.safe({ input: "x", voice_id: "v", model: "simba-3.5", language: "es-MX" });
    expect(speech.ok).toBe(true);
    if (speech.ok) expect(speech.warnings).toEqual([]);
    const stream = ttsStream.safe({ input: "x", voice_id: "v", model: "simba-3.5" });
    expect(stream.ok).toBe(true);
    if (stream.ok) expect(stream.warnings).toEqual([]);
  });

  test('simba-3.5 does not gate languages outside its 48 ("not rejected")', () => {
    const r = tts.safe({ input: "x", voice_id: "v", model: "simba-3.5", language: "et-EE" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("omitting model resolves to the documented simba-3.0 default", () => {
    const r = tts.safe({ input: "x", voice_id: "v" });
    expect(r.ok).toBe(true);
    // simba-3.0 is catalogued, so no unknown_model warning fires.
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown top-level key warns", () => {
    const r = ttsUnchecked({ input: "x", voice_id: "v", speed: 1.2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("unknown_param");
  });
});

describe("speechify character caps (2,000 speech / 20,000 stream)", () => {
  test("speech over 2,000 characters is over_output_limit with character meta", () => {
    const input = "a".repeat(SPEECH_MAX_CHARACTERS + 1);
    const r = tts.safe({ input, voice_id: "v", model: "simba-3.2" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.errors[0]?.path).toEqual(["input"]);
      expect(r.errors[0]?.message).toContain("characters, not tokens");
      expect(r.errors[0]?.meta?.limitCharacters).toBe(2000);
      expect(r.errors[0]?.meta?.actualCharacters).toBe(2001);
    }
  });

  test("speech at exactly 2,000 passes; the same text passes on stream", () => {
    const input = "a".repeat(SPEECH_MAX_CHARACTERS);
    expect(tts.safe({ input, voice_id: "v" }).ok).toBe(true);
    expect(ttsStream.safe({ input, voice_id: "v" }).ok).toBe(true);
  });

  test("stream over 20,000 characters is over_output_limit", () => {
    const input = "a".repeat(STREAM_MAX_CHARACTERS + 1);
    const r = ttsStream.safe({ input, voice_id: "v" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.errors[0]?.meta?.limitCharacters).toBe(20000);
    }
  });

  test("the endpoint cap applies even for models unknown to the catalog", () => {
    const r = tts.safe({
      input: "a".repeat(SPEECH_MAX_CHARACTERS + 5),
      voice_id: "v",
      model: "simba-9",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("over_output_limit");
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const unchecked = tts as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      unchecked({ input: "a".repeat(2001), voice_id: "v" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("speechify format rules (the two routes differ)", () => {
  test("wav_* output formats are speech-only", () => {
    expect(SPEECH_OUTPUT_FORMATS).toContain("wav_24000");
    expect(STREAM_OUTPUT_FORMATS).not.toContain("wav_24000" as never);

    const ok = tts.safe({ input: "x", voice_id: "v", output_format: "wav_24000" });
    expect(ok.ok).toBe(true);

    const bad = streamUnchecked({ input: "x", voice_id: "v", output_format: "wav_24000" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors[0]?.code).toBe("invalid_enum_value");
      expect(bad.errors[0]?.path).toEqual(["output_format"]);
      expect(bad.errors[0]?.message).toContain("only available on POST /v1/audio/speech");
    }
  });

  test("an unknown output_format is invalid_enum_value on both routes", () => {
    for (const run of [ttsUnchecked, streamUnchecked]) {
      const r = run({ input: "x", voice_id: "v", output_format: "flac_44100" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
    }
  });

  test("audio_format on the stream route is unsupported_param", () => {
    const r = streamUnchecked({ input: "x", voice_id: "v", audio_format: "mp3" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.path).toEqual(["audio_format"]);
      expect(issue?.message).toContain("only a field of POST /v1/audio/speech");
    }
  });

  test("an invalid audio_format on the speech route is invalid_shape", () => {
    const r = ttsUnchecked({ input: "x", voice_id: "v", audio_format: "flac" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("empty input is invalid_shape", () => {
    const r = ttsUnchecked({ input: "", voice_id: "v" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });
});

describe("speechify.ttsStream Accept header", () => {
  test("accept is stripped from the body onto request.headers and back for the SDK", () => {
    const v = ttsStream({
      input: "Hello",
      voice_id: "geffen_32",
      accept: "audio/mpeg",
    });

    expect(Object.keys(v)).toEqual(["input", "voice_id"]);
    expect((v as Record<string, unknown>).accept).toBeUndefined();
    expect(v.request.url).toBe(AUDIO_STREAM_URL);
    expect(v.request.headers.accept).toBe("audio/mpeg");
    expect(v.toSdk("speechify")).toEqual({ input: "Hello", voice_id: "geffen_32", Accept: "audio/mpeg" });
  });

  test("no accept means no accept header", () => {
    const v = ttsStream({ input: "Hello", voice_id: "v" });
    expect(v.request.headers.accept).toBeUndefined();
    expect(v.toSdk("speechify")).toEqual({ input: "Hello", voice_id: "v" });
  });

  test("an undocumented accept value is invalid_enum_value", () => {
    const r = streamUnchecked({ input: "x", voice_id: "v", accept: "audio/wav" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["accept"]);
    }
  });

  test("headers are not shared between two validations", () => {
    const a = ttsStream({ input: "a", voice_id: "v", accept: "audio/mpeg" });
    const b = ttsStream({ input: "b", voice_id: "v", accept: "audio/aac" });
    a.request.headers.authorization = "Bearer leak";
    expect(b.request.headers.authorization).toBeUndefined();
  });
});

describe("speechify per-model gates (doc audit 2026-08-13)", () => {
  test("a non-English language on simba-3.2 is unsupported_capability", () => {
    const r = tts.safe({ input: "x", voice_id: "v", model: "simba-3.2", language: "fr-FR" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.path).toEqual(["language"]);
      expect(r.errors[0]?.message).toContain("English only");
      expect(r.errors[0]?.message).toContain('"simba-3.5" (48 languages)');
    }
  });

  test("English locales pass on simba-3.2", () => {
    for (const language of ["en", "en-US", "en-GB"]) {
      expect(tts.safe({ input: "x", voice_id: "v", model: "simba-3.2", language }).ok).toBe(
        true,
      );
    }
  });

  test("simba-3.0 accepts non-English languages (documented as unvalidated, not rejected)", () => {
    const r = tts.safe({ input: "x", voice_id: "v", model: "simba-3.0", language: "fr-FR" });
    expect(r.ok).toBe(true);
  });

  test("the gate also applies on the stream route", () => {
    const r = ttsStream.safe({ input: "x", voice_id: "v", model: "simba-3.2", language: "ja-JP" });
    expect(r.ok).toBe(false);
  });
});

describe("speechify cost estimation (Starter list rate)", () => {
  test("simba-3.0, simba-3.2 and the legacy pair price at $10/1M characters", () => {
    for (const id of ["simba-3.2", "simba-3.0", "simba-multilingual", "simba-english"] as const) {
      const r = tts.safe({ input: "a".repeat(1000), voice_id: "v", model: id });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.01, 10);
    }
  });

  test("simba-3.5 prices at its $15/1M Starter list rate, not the launch price", () => {
    const r = ttsStream.safe({ input: "a".repeat(1000), voice_id: "v", model: "simba-3.5" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.015, 10);
  });

  test("maxCostUSD enforces over_budget", () => {
    const r = ttsStream.safe(
      { input: "a".repeat(20000), voice_id: "v", model: "simba-3.2" },
      { maxCostUSD: 0.05 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_budget");
      expect(r.errors[0]?.meta?.estimated).toBeCloseTo(0.2, 10);
    }
  });
});

describe("speechify catalog", () => {
  test("every synthesis model is TTS-shaped with the 20,000-character ceiling", () => {
    // The synthetic `voice-clone` id (POST /v1/voices) is deliberately not a
    // synthesis model, so the sweep runs over the synthesis allow-list.
    for (const id of SPEECHIFY_MODEL_IDS) {
      const info = models[id];
      expect(info.limit.context).toBe(0);
      expect(info.limit.characters).toBe(20000);
      expect(info.modalities.input).toEqual(["text"]);
      expect(info.modalities.output).toEqual(["audio"]);
      expect(info.cost?.perMillionCharacters).toBe(id === "simba-3.5" ? 15 : 10);
    }
  });

  test("the synthesis allow-list is the OpenAPI enum plus the legacy pair", () => {
    expect([...SPEECHIFY_MODEL_IDS].sort()).toEqual([
      "simba-3.0",
      "simba-3.2",
      "simba-3.5",
      "simba-english",
      "simba-multilingual",
    ]);
  });
});

describe("speechify pronunciations (simba-3.5)", () => {
  const spanish = {
    input: "Speechify en México.",
    voice_id: "v",
    model: "simba-3.5",
    language: "es-MX",
  } as const;

  function onSimba35(pronunciations: SpeechifyPronunciation[]) {
    return tts.safe({ ...spanish, pronunciations });
  }

  test("simba-3.5 applies them outside English, on both routes", () => {
    const pronunciations = [
      { text: "Speechify", ipa: "s p ˈiː tʃ ɪ f aɪ" },
      { text: "México", alias: "Méjico", case_sensitive: true },
    ];
    const speech = onSimba35(pronunciations);
    expect(speech.ok).toBe(true);
    if (speech.ok) expect(speech.warnings).toEqual([]);
    const stream = ttsStream.safe({ ...spanish, pronunciations });
    expect(stream.ok).toBe(true);
    if (stream.ok) expect(stream.warnings).toEqual([]);
  });

  test("an empty list is accepted by every model", () => {
    for (const model of [...SPEECHIFY_MODEL_IDS, undefined]) {
      const r = tts.safe({ input: "x", voice_id: "v", model, pronunciations: [] });
      expect(r.ok).toBe(true);
    }
  });

  test("simba-3.0, simba-3.2 and an omitted model refuse a non-empty list", () => {
    const pronunciations = [{ text: "SaaS", alias: "sass" }];
    for (const model of ["simba-3.0", "simba-3.2", undefined] as const) {
      const r = tts.safe({ input: "SaaS", voice_id: "v", model, pronunciations });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("unsupported_capability");
        expect(r.errors[0]?.path).toEqual(["pronunciations"]);
        expect(r.errors[0]?.message).toContain('Use "simba-3.5"');
      }
    }
    expect(PRONUNCIATION_LANGUAGES["simba-3.0"]).toEqual([]);
    expect(PRONUNCIATION_LANGUAGES["simba-3.2"]).toEqual([]);
  });

  test('English on simba-3.5 warns ("not supported yet"); an omitted language does not', () => {
    const pronunciations = [{ text: "SaaS", alias: "sass" }];
    const english = ttsStream.safe({ ...spanish, language: "en-US", pronunciations });
    expect(english.ok).toBe(true);
    if (english.ok) {
      expect(english.warnings.map((w) => `${w.code}@${w.path.join(".")}`)).toEqual([
        "unsupported_capability@pronunciations",
      ]);
      expect(english.warnings[0]?.message).toContain("pronunciations_unsupported");
    }
    expect(PRONUNCIATION_LANGUAGES["simba-3.5"]).toHaveLength(47);
    expect(PRONUNCIATION_LANGUAGES["simba-3.5"]).not.toContain("en" as never);

    const { language: _omitted, ...voiceDecides } = spanish;
    const r = tts.safe({ ...voiceDecides, pronunciations });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("the legacy Simba 1.6 ids publish no pronunciation languages and are not gated", () => {
    const r = tts.safe({
      input: "SaaS",
      voice_id: "v",
      model: "simba-english",
      pronunciations: [{ text: "SaaS", alias: "sass" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
  });

  test("more than 200 entries is invalid_shape", () => {
    const entries = Array.from({ length: MAX_PRONUNCIATIONS + 1 }, (_, i) => ({
      text: `word${i}`,
      alias: "x",
    }));
    const r = onSimba35(entries);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.meta?.max).toBe(200);
    }
    expect(onSimba35(entries.slice(1)).ok).toBe(true);
  });

  test("an entry needs exactly one of ipa and alias", () => {
    for (const entry of [{ text: "a" }, { text: "a", ipa: "a", alias: "b" }]) {
      const r = ttsUnchecked({ ...spanish, pronunciations: [entry] });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("invalid_shape");
        expect(r.errors[0]?.path).toEqual(["pronunciations", 0]);
      }
    }
  });

  test("an ipa entry's text is one word; an alias entry's may be a phrase", () => {
    const phrase = onSimba35([{ text: "Nueva York", ipa: "n w e β a" }]);
    expect(phrase.ok).toBe(false);
    if (!phrase.ok) expect(phrase.errors[0]?.path).toEqual(["pronunciations", 0, "text"]);

    expect(onSimba35([{ text: "Nueva York", alias: "Nueva Yor" }]).ok).toBe(true);
    expect(onSimba35([{ text: "  ", alias: "x" }]).ok).toBe(false);
  });

  test("text is capped at 64 code points, alias at 160, ipa at 64 phones", () => {
    // 128 UTF-16 units but 64 code points: inside the cap.
    expect(onSimba35([{ text: "😀".repeat(64), alias: "x" }]).ok).toBe(true);
    const sixtyFourPhones = Array.from({ length: 64 }, () => "a").join(" ");
    expect(onSimba35([{ text: "a", ipa: sixtyFourPhones }]).ok).toBe(true);

    const cases: Array<[SpeechifyPronunciation, string]> = [
      [{ text: "a".repeat(65), alias: "x" }, "text"],
      [{ text: "a", alias: "x".repeat(161) }, "alias"],
      [{ text: "a", alias: "line\nbreak" }, "alias"],
      [{ text: "a", ipa: Array.from({ length: 65 }, () => "a").join("|") }, "ipa"],
      [{ text: "a", ipa: " | " }, "ipa"],
    ];
    for (const [entry, field] of cases) {
      const r = onSimba35([entry]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.path).toEqual(["pronunciations", 0, field]);
    }
  });

  test("a repeated text is refused unless both entries are case_sensitive", () => {
    const repeated = onSimba35([
      { text: "SaaS", alias: "sass" },
      { text: "saas", alias: "sass" },
    ]);
    expect(repeated.ok).toBe(false);
    if (!repeated.ok) {
      expect(repeated.errors[0]?.path).toEqual(["pronunciations", 1, "text"]);
      expect(repeated.errors[0]?.meta?.duplicateOf).toBe(0);
    }

    const distinct = onSimba35([
      { text: "SaaS", alias: "sass", case_sensitive: true },
      { text: "saas", alias: "sahs", case_sensitive: true },
    ]);
    expect(distinct.ok).toBe(true);
  });
});
