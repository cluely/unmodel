import { describe, expect, test } from "bun:test";
import {
  stt,
  toUploadFormData,
  PRE_RECORDED_URL,
  UPLOAD_URL,
  MAX_AUDIO_DURATION_SECONDS,
  MAX_AUDIO_BYTES,
} from "./stt";
import { stt as gladiaAdapter } from "./unified";
import { createStt } from "../../unified/stt";
import { UnmodelValidationError } from "../../core/issues";

const AUDIO = "https://api.gladia.io/file/6c09400e-23d2-4bd2-be55-96a5ececfa3b";

describe("gladia.stt happy path", () => {
  test("returns a wire-pure body with hidden toSdk/request", () => {
    const params = {
      audio_url: AUDIO,
      model: "solaria-1" as const,
      diarization: true,
      diarization_config: { number_of_speakers: 3 },
    };
    const v = stt(params);

    expect(Object.keys(v)).toEqual(["audio_url", "model", "diarization", "diarization_config"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(PRE_RECORDED_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    expect(v.toSdk("gladia")).toEqual(params);
  });

  test("an omitted model resolves to the documented solaria-1 default", () => {
    const r = stt.safe({ audio_url: AUDIO });
    expect(r.ok).toBe(true);
    // No unknown_model warning: the default is catalogued.
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("a full audio-intelligence config validates cleanly", () => {
    const r = stt.safe({
      audio_url: AUDIO,
      model: "solaria-1",
      language_config: { languages: ["en", "fr"], code_switching: true },
      custom_vocabulary: true,
      custom_vocabulary_config: {
        vocabulary: ["Gladia", { value: "Solaria", intensity: 0.4, pronunciations: ["solar ia"] }],
        default_intensity: 0.5,
      },
      diarization: true,
      diarization_config: { min_speakers: 1, max_speakers: 4 },
      translation: true,
      translation_config: { target_languages: ["es"], model: "enhanced" },
      summarization: true,
      summarization_config: { type: "bullet_points" },
      subtitles: true,
      subtitles_config: { formats: ["srt", "vtt"], maximum_rows_per_caption: 2 },
      callback: true,
      callback_config: { url: "https://example.com/hook", method: "PUT" },
      pii_redaction: true,
      pii_redaction_config: { entity_types: ["GDPR"], processed_text_type: "MASK" },
      sentences: true,
      sentiment_analysis: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown models warn and name the gladia catalog", () => {
    const r = stt.safe({ audio_url: AUDIO, model: "solaria-9" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("the gladia catalog");
    }
  });
});

describe("gladia.stt shape rules", () => {
  test("audio_url must be an http(s) URL", () => {
    const r = stt.safe({ audio_url: "file:///tmp/a.wav" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("http(s) URL");
  });

  test("documented numeric ranges are enforced", () => {
    const r = stt.safe({
      audio_url: AUDIO,
      subtitles: true,
      subtitles_config: { maximum_duration: 45, maximum_rows_per_caption: 9 },
      custom_vocabulary: true,
      custom_vocabulary_config: { vocabulary: ["x"], default_intensity: 2 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(3);
  });

  test("translation_config needs at least one target language", () => {
    const r = stt.safe({
      audio_url: AUDIO,
      translation: true,
      translation_config: { target_languages: [] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("at least one language");
  });

  test("unknown top-level keys pass through with a warning", () => {
    const r = stt.safe({
      audio_url: AUDIO,
      // @ts-expect-error ExactKeys rejects params outside the wire shape.
      chapterization: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
  });

  test("min_speakers above max_speakers is an error", () => {
    const r = stt.safe({
      audio_url: AUDIO,
      diarization: true,
      diarization_config: { min_speakers: 5, max_speakers: 2 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("greater than");
  });
});

describe("gladia.stt toggle pairing", () => {
  test("a config without its toggle warns as silently ignored", () => {
    const r = stt.safe({
      audio_url: AUDIO,
      diarization_config: { number_of_speakers: 2 },
      summarization_config: { type: "concise" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.path.join("."))).toEqual([
        "diarization_config",
        "summarization_config",
      ]);
      expect(r.warnings[0]?.message).toContain("`diarization: true`");
      expect(r.warnings[0]?.severity).toBe("warning");
    }
  });

  test("diarization: false with a config also warns", () => {
    const r = stt.safe({
      audio_url: AUDIO,
      diarization: false,
      diarization_config: { number_of_speakers: 2 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toHaveLength(1);
  });

  test("callback_url is deprecated", () => {
    const r = stt.safe({ audio_url: AUDIO, callback_url: "https://example.com/hook" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unsupported_param"]);
      expect(r.warnings[0]?.message).toContain("deprecated");
    }
  });
});

describe("gladia.stt solaria-3 gates", () => {
  test("one language validates cleanly", () => {
    const r = stt.safe({
      audio_url: AUDIO,
      model: "solaria-3",
      language_config: { languages: ["fr"] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("no language or several warn, citing the page that disagrees", () => {
    // The endpoint page says "pass exactly one language"; the Models page lets
    // solaria-3 "pick among" several, and the OpenAPI auto-detects when none
    // is set — so neither is refused.
    const none = stt.safe({ audio_url: AUDIO, model: "solaria-3" });
    expect(none.ok).toBe(true);
    if (none.ok) {
      expect(none.warnings.map((w) => [w.code, w.path.join(".")])).toEqual([
        ["unsupported_capability", "language_config.languages"],
      ]);
      expect(none.warnings[0]?.message).toContain("no language");
      expect(none.warnings[0]?.meta?.contradictedBy).toBe(
        "https://docs.gladia.io/chapters/introduction/models",
      );
    }

    const two = stt.safe({
      audio_url: AUDIO,
      model: "solaria-3",
      language_config: { languages: ["en", "fr"] },
    });
    expect(two.ok).toBe(true);
    if (two.ok) {
      expect(two.warnings).toHaveLength(1);
      expect(two.warnings[0]?.message).toContain("2 languages");
    }
  });

  test("solaria-3 rejects languages outside its five, at every entry", () => {
    const one = stt.safe({
      audio_url: AUDIO,
      model: "solaria-3",
      language_config: { languages: ["ja"] },
    });
    expect(one.ok).toBe(false);
    if (!one.ok) {
      expect(one.errors[0]?.code).toBe("invalid_enum_value");
      expect(one.errors[0]?.message).toContain("solaria-1");
    }

    const later = stt.safe({
      audio_url: AUDIO,
      model: "solaria-3",
      language_config: { languages: ["en", "ja"] },
    });
    expect(later.ok).toBe(false);
    if (!later.ok) {
      expect(later.errors.map((e) => [e.code, e.path.join(".")])).toEqual([
        ["invalid_enum_value", "language_config.languages.1"],
      ]);
      expect(later.errors[0]?.message).toContain('"ja"');
    }
  });

  test("code switching beside one language is ignored, so it warns", () => {
    // OpenAPI: "If one language is set, this option will be ignored."
    const r = stt.safe({
      audio_url: AUDIO,
      model: "solaria-3",
      language_config: { languages: ["en"], code_switching: true },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => [w.code, w.path.join(".")])).toEqual([
        ["unsupported_param", "language_config.code_switching"],
      ]);
      expect(r.warnings[0]?.message).toContain("ignored");
    }
  });

  test("code switching across several languages is refused", () => {
    const r = stt.safe({
      audio_url: AUDIO,
      model: "solaria-3",
      language_config: { languages: ["en", "fr"], code_switching: true },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("code switching");
  });

  test("through unmodel/stt, each solaria-3 finding names the canonical word", () => {
    const unified = createStt([gladiaAdapter]);
    const audio = { url: AUDIO };

    const none = unified.safe({ model: "gladia/solaria-3", audio });
    expect(none.ok).toBe(true);
    if (none.ok) {
      expect(none.warnings.map((w) => [w.code, w.path.join(".")])).toEqual([
        ["unsupported_capability", "language"],
      ]);
      expect(none.warnings[0]?.message).toContain("(compiled from `language_config.languages`)");
    }

    const several = unified.safe({ model: "gladia/solaria-3", audio, languages: ["en", "fr"] });
    expect(several.ok).toBe(true);
    if (several.ok) {
      expect(several.warnings.map((w) => [w.code, w.path.join(".")])).toEqual([
        ["unsupported_capability", "languages"],
      ]);
    }

    const offList = unified.safe({ model: "gladia/solaria-3", audio, languages: ["en", "ja"] });
    expect(offList.ok).toBe(false);
    if (!offList.ok) {
      expect(offList.errors.map((e) => [e.code, e.path.join(".")])).toEqual([
        ["invalid_enum_value", "languages"],
      ]);
      expect(offList.errors[0]?.message).toContain("language_config.languages.1");
    }
  });

  test("solaria-1 keeps code switching and multi-language configs", () => {
    const r = stt.safe({
      audio_url: AUDIO,
      model: "solaria-1",
      language_config: { languages: ["en", "ja"], code_switching: true },
    });
    expect(r.ok).toBe(true);
  });
});

describe("gladia.stt media + cost", () => {
  test("a declared duration yields no costUSD: Gladia prices in EUR only", () => {
    for (const model of ["solaria-1", "solaria-3"] as const) {
      const r = stt.safe(
        { audio_url: AUDIO, model, language_config: { languages: ["en"] } },
        { media: [{ path: ["audio_url"], durationSeconds: 3600 }] },
      );
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
    }
  });

  test("audio longer than 135 minutes is rejected", () => {
    const r = stt.safe(
      { audio_url: AUDIO },
      { media: [{ path: ["audio_url"], durationSeconds: MAX_AUDIO_DURATION_SECONDS + 1 }] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("media_duration_exceeded");
      expect(r.errors[0]?.message).toContain("135 minutes");
    }
  });

  test("files above 1000 MB are rejected", () => {
    const r = stt.safe(
      { audio_url: AUDIO },
      { media: [{ path: ["audio_url"], bytes: MAX_AUDIO_BYTES + 1 }] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("media_too_large");
  });

  test("maxCostUSD has no USD estimate to compare against", () => {
    const capped = stt.safe(
      { audio_url: AUDIO },
      { media: [{ path: ["audio_url"], durationSeconds: 3600 }], maxCostUSD: 0.1 },
    );
    expect(capped.ok).toBe(true);
    if (capped.ok) expect(capped.estimate.costUSD).toBeUndefined();
  });

  test("throwing form raises UnmodelValidationError", () => {
    expect(() =>
      stt({ audio_url: AUDIO, model: "solaria-3", language_config: { languages: ["ja"] } }),
    ).toThrow(UnmodelValidationError);
  });
});

describe("gladia.toUploadFormData", () => {
  test("builds a single-part audio upload", () => {
    const form = toUploadFormData({
      audio: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }),
      filename: "clip.wav",
    });
    expect(UPLOAD_URL).toBe("https://api.gladia.io/v2/upload");
    expect([...form.keys()]).toEqual(["audio"]);
    expect((form.get("audio") as File).name).toBe("clip.wav");
  });
});
