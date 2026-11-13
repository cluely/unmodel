import { describe, expect, test } from "bun:test";
import {
  stt,
  toFormData,
  jobsUrl,
  JOBS_URL,
  MAX_DATA_FILE_BYTES,
  MAX_ADDITIONAL_VOCAB_ITEMS,
  resolveModel,
  type JobConfig,
} from "./stt";
import { models, MELIA_REGIONS } from "./models";
import { UnmodelValidationError } from "../../core/issues";

describe("speechmatics.stt happy path", () => {
  test("returns a wire-pure config with hidden toSdk/request", () => {
    const config = {
      type: "transcription" as const,
      transcription_config: { language: "en", model: "enhanced" as const, diarization: "speaker" as const },
    };
    const v = stt(config);

    expect(Object.keys(v)).toEqual(["type", "transcription_config"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(config);

    expect(v.request.url).toBe(JOBS_URL);
    expect(v.request.method).toBe("POST");
    // Multipart: fetch must derive the boundary, so no content-type is set.
    expect(v.request.headers).toEqual({});
    expect(v.toSdk("speechmatics")).toEqual(config);
  });

  test("jobsUrl builds each documented regional endpoint", () => {
    expect(JOBS_URL).toBe("https://eu1.asr.api.speechmatics.com/v2/jobs");
    expect(jobsUrl("us1")).toBe("https://us1.asr.api.speechmatics.com/v2/jobs");
    expect(jobsUrl("au1")).toBe("https://au1.asr.api.speechmatics.com/v2/jobs");
  });

  test("Melia 1 and Oak 1 run on EU1, US1 and AU1", () => {
    expect(MELIA_REGIONS).toEqual(["eu1", "us1", "au1"]);
  });

  test("a full speech-intelligence config on enhanced validates cleanly", () => {
    const r = stt.safe({
      type: "transcription",
      transcription_config: {
        language: "en",
        model: "enhanced",
        domain: "medical",
        additional_vocab: [{ content: "Speechmatics", sounds_like: ["speech matics"] }],
        punctuation_overrides: { sensitivity: 0.4, permitted_marks: ["all"] },
        speaker_diarization_config: { speaker_sensitivity: 0.6, get_speakers: true },
        enable_entities: true,
      },
      fetch_data: { url: "https://example.com/audio.mp3" },
      translation_config: { target_languages: ["fr", "de"] },
      summarization_config: { content_type: "conversational", summary_length: "detailed" },
      notification_config: [{ url: "https://example.com/hook", contents: ["jobinfo"], method: "put" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("resolveModel falls back operating_point -> documented standard default", () => {
    expect(resolveModel({ type: "transcription", transcription_config: { language: "en" } })).toBe(
      "standard",
    );
    expect(
      resolveModel({
        type: "transcription",
        transcription_config: { language: "en", operating_point: "enhanced" },
      }),
    ).toBe("enhanced");
  });

  test("unknown model ids warn and name the speechmatics catalog", () => {
    const r = stt.safe({
      type: "transcription",
      transcription_config: { language: "en", model: "ultra-9" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("the speechmatics catalog");
    }
  });
});

describe("speechmatics.stt shape rules", () => {
  test("punctuation sensitivity, volume threshold and speaker sensitivity are range-checked", () => {
    const r = stt.safe({
      type: "transcription",
      transcription_config: {
        language: "en",
        punctuation_overrides: { sensitivity: 1.5 },
        audio_filtering_config: { volume_threshold: 120 },
        speaker_diarization_config: { speaker_sensitivity: -0.1 },
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(3);
      expect(r.errors.every((e) => e.code === "invalid_shape")).toBe(true);
    }
  });

  test("translation_config caps target_languages at 5", () => {
    const r = stt.safe({
      type: "transcription",
      transcription_config: { language: "en" },
      translation_config: { target_languages: ["fr", "de", "es", "it", "pt", "nl"] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("at most 5 languages");
  });

  test("channel diarization labels must match the documented pattern", () => {
    const r = stt.safe({
      type: "transcription",
      transcription_config: { language: "en", channel_diarization_labels: ["agent 1"] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("^[A-Za-z0-9._]+$");
  });

  test("output_locale takes one locale per language on the multilingual models", () => {
    for (const model of ["melia-1", "oak-1"] as const) {
      const r = stt.safe({
        type: "transcription",
        transcription_config: { language: "multi", model, output_locale: ["en-GB", "cmn-Hans"] },
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }

    const twice = stt.safe({
      type: "transcription",
      transcription_config: { language: "multi", model: "melia-1", output_locale: ["en-GB", "en-US"] },
    });
    expect(twice.ok).toBe(false);
    if (!twice.ok) {
      expect(twice.errors).toHaveLength(1);
      expect(twice.errors[0]?.code).toBe("invalid_shape");
      expect(twice.errors[0]?.path).toEqual(["transcription_config", "output_locale", 1]);
      expect(twice.errors[0]?.message).toContain('"en-GB" and "en-US"');
    }
  });

  test("advanced entities, redaction and strict hints are typed wire fields", () => {
    const r = stt.safe({
      type: "transcription",
      transcription_config: {
        language: "en",
        model: "enhanced",
        enable_entities: true,
        entities_config: { detect_advanced_entities: true },
        enable_redaction: true,
        redaction_config: { entity_classes: ["pii", "dob"] },
        language_hints_strict: true,
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);

    const empty = stt.safe({
      type: "transcription",
      transcription_config: {
        language: "en",
        enable_redaction: true,
        redaction_config: { entity_classes: [] },
      },
    });
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.errors[0]?.path).toEqual(["transcription_config", "redaction_config", "entity_classes"]);
    }
  });

  test("redaction needs entity classes, and advanced entities when entities are on", () => {
    const base = { language: "en", model: "enhanced" } as const;

    const bare = stt.safe({
      type: "transcription",
      transcription_config: { ...base, enable_redaction: true },
    });
    expect(bare.ok).toBe(false);
    if (!bare.ok) {
      expect(bare.errors).toHaveLength(1);
      expect(bare.errors[0]).toMatchObject({
        code: "invalid_shape",
        path: ["transcription_config", "redaction_config"],
      });
    }

    const alone = stt.safe({
      type: "transcription",
      transcription_config: { ...base, enable_redaction: true, redaction_config: { entity_classes: ["pii"] } },
    });
    expect(alone.ok).toBe(true);
    if (alone.ok) expect(alone.warnings).toEqual([]);

    const withEntities = stt.safe({
      type: "transcription",
      transcription_config: {
        ...base,
        enable_redaction: true,
        enable_entities: true,
        redaction_config: { entity_classes: ["pii"] },
      },
    });
    expect(withEntities.ok).toBe(false);
    if (!withEntities.ok) {
      expect(withEntities.errors).toHaveLength(1);
      expect(withEntities.errors[0]).toMatchObject({
        code: "invalid_shape",
        path: ["transcription_config", "entities_config", "detect_advanced_entities"],
      });
    }

    const withAdvanced = stt.safe({
      type: "transcription",
      transcription_config: {
        ...base,
        enable_redaction: true,
        enable_entities: true,
        entities_config: { detect_advanced_entities: true },
        redaction_config: { entity_classes: ["pii"] },
      },
    });
    expect(withAdvanced.ok).toBe(true);
    if (withAdvanced.ok) expect(withAdvanced.warnings).toEqual([]);
  });

  test("advanced entities without enable_entities warn rather than refuse", () => {
    const r = stt.safe({
      type: "transcription",
      transcription_config: {
        language: "en",
        model: "enhanced",
        entities_config: { detect_advanced_entities: true },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toMatchObject({
        code: "unsupported_param",
        severity: "warning",
        path: ["transcription_config", "entities_config", "detect_advanced_entities"],
        meta: { requires: "enable_entities" },
      });
    }
  });

  test("redaction entity classes must be unique", () => {
    const twice = stt.safe({
      type: "transcription",
      transcription_config: {
        language: "en",
        enable_redaction: true,
        redaction_config: { entity_classes: ["pii", "dob", "pii"] },
      },
    });
    expect(twice.ok).toBe(false);
    if (!twice.ok) {
      expect(twice.errors).toHaveLength(1);
      expect(twice.errors[0]).toMatchObject({
        code: "invalid_shape",
        path: ["transcription_config", "redaction_config", "entity_classes", 2],
        meta: { value: "pii" },
      });
    }

    const distinct = stt.safe({
      type: "transcription",
      transcription_config: {
        language: "en",
        enable_redaction: true,
        redaction_config: { entity_classes: ["pii", "dob"] },
      },
    });
    expect(distinct.ok).toBe(true);
  });

  test("output_locale is refused beside automatic language identification", () => {
    const pinned = stt.safe({
      type: "transcription",
      transcription_config: { language: "en", model: "enhanced", output_locale: "en-GB" },
    });
    expect(pinned.ok).toBe(true);
    if (pinned.ok) expect(pinned.warnings).toEqual([]);

    for (const output_locale of ["en-GB", ["en-GB"]]) {
      const auto = stt.safe({
        type: "transcription",
        transcription_config: { language: "auto", model: "enhanced", output_locale },
      });
      expect(auto.ok).toBe(false);
      if (!auto.ok) {
        expect(auto.errors).toHaveLength(1);
        expect(auto.errors[0]).toMatchObject({
          code: "invalid_shape",
          path: ["transcription_config", "output_locale"],
        });
        expect(auto.errors[0]?.message).toContain('`language: "auto"`');
      }
    }
  });

  test("additional_vocab holds at most 20,000 entries", () => {
    const vocab = (n: number) => Array.from({ length: n }, (_, i) => ({ content: `w${i}` }));
    expect(MAX_ADDITIONAL_VOCAB_ITEMS).toBe(20_000);

    const full = stt.safe({
      type: "transcription",
      transcription_config: { language: "en", model: "enhanced", additional_vocab: vocab(20_000) },
    });
    expect(full.ok).toBe(true);

    const over = stt.safe({
      type: "transcription",
      transcription_config: { language: "en", model: "enhanced", additional_vocab: vocab(20_001) },
    });
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.errors).toHaveLength(1);
      expect(over.errors[0]?.path).toEqual(["transcription_config", "additional_vocab"]);
      expect(over.errors[0]?.message).toContain("at most 20,000 items");
    }
  });

  test("standard takes the Spanish and English pack's domain", () => {
    const r = stt.safe({
      type: "transcription",
      transcription_config: { language: "es", model: "standard", domain: "bilingual-en" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown top-level keys pass through with a warning", () => {
    const r = stt.safe({
      type: "transcription",
      transcription_config: { language: "en" },
      // @ts-expect-error ExactKeys rejects params outside the wire shape.
      alignment_config: { language: "en" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
  });
});

describe("speechmatics.stt operating_point deprecation", () => {
  test("operating_point alone warns but still resolves the model", () => {
    const r = stt.safe({
      type: "transcription",
      transcription_config: { language: "en", operating_point: "enhanced" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unsupported_param"]);
      expect(r.warnings[0]?.message).toContain("deprecated");
      expect(r.warnings[0]?.model).toBe("enhanced");
    }
  });

  test("model and operating_point disagreeing is an error", () => {
    const r = stt.safe({
      type: "transcription",
      transcription_config: { language: "en", model: "enhanced", operating_point: "standard" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("set only one");
  });
});

describe("speechmatics.stt melia-1 feature gates", () => {
  test('melia-1 requires language "multi"', () => {
    const auto = stt.safe({
      type: "transcription",
      transcription_config: { language: "auto", model: "melia-1" },
    });
    expect(auto.ok).toBe(false);
    if (!auto.ok) {
      expect(auto.errors[0]?.code).toBe("invalid_enum_value");
      expect(auto.errors[0]?.message).toContain('"auto" returns an error');
    }

    const ok = stt.safe({
      type: "transcription",
      transcription_config: { language: "multi", model: "melia-1", language_hints: ["en", "ar"] },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.warnings).toEqual([]);
  });

  test("unsupported melia-1 features are reported per config key", () => {
    const r = stt.safe({
      type: "transcription",
      transcription_config: {
        language: "multi",
        model: "melia-1",
        additional_vocab: [{ content: "Melia" }],
        enable_entities: true,
      },
      summarization_config: { summary_type: "bullets" },
      translation_config: { target_languages: ["fr"] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const paths = r.errors.map((e) => e.path.join("."));
      expect(paths).toContain("transcription_config.additional_vocab");
      expect(paths).not.toContain("transcription_config.enable_entities");
      expect(paths).toContain("summarization_config");
      expect(paths).toContain("translation_config");
      expect(r.errors.every((e) => e.code === "unsupported_capability")).toBe(true);
      // Entity detection: the models page and the pricing page disagree.
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toMatchObject({
        code: "unsupported_capability",
        severity: "warning",
        path: ["transcription_config", "enable_entities"],
        meta: { contradictedBy: "https://www.speechmatics.com/pricing.md" },
      });
    }
  });

  test("entity detection on oak-1 is sent with one warning, advanced entities included", () => {
    const r = stt.safe({
      type: "transcription",
      transcription_config: {
        language: "multi",
        model: "oak-1",
        enable_entities: true,
        entities_config: { detect_advanced_entities: true },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toMatchObject({
        code: "unsupported_capability",
        path: ["transcription_config", "enable_entities"],
        model: "oak-1",
        meta: { contradictedBy: "https://www.speechmatics.com/pricing.md" },
      });
    }
  });

  test("a single language code on melia-1 / oak-1 warns, while auto and pack codes are refused", () => {
    for (const model of ["melia-1", "oak-1"] as const) {
      const single = stt.safe({
        type: "transcription",
        transcription_config: { language: "en", model },
      });
      expect(single.ok).toBe(true);
      if (single.ok) {
        expect(single.warnings).toHaveLength(1);
        expect(single.warnings[0]).toMatchObject({
          code: "invalid_enum_value",
          severity: "warning",
          path: ["transcription_config", "language"],
          model,
          meta: { allowed: ["multi"], value: "en" },
        });
        expect(single.warnings[0]?.message).toContain("language_hints");
      }

      const auto = stt.safe({
        type: "transcription",
        transcription_config: { language: "auto", model },
      });
      expect(auto.ok).toBe(false);
      if (!auto.ok) {
        expect(auto.errors).toHaveLength(1);
        expect(auto.errors[0]?.code).toBe("invalid_enum_value");
      }

      const pack = stt.safe({
        type: "transcription",
        transcription_config: { language: "cmn_en", model },
      });
      expect(pack.ok).toBe(false);
      if (!pack.ok) {
        expect(pack.errors).toHaveLength(1);
        expect(pack.errors[0]).toMatchObject({
          code: "invalid_enum_value",
          path: ["transcription_config", "language"],
          meta: { source: "https://docs.speechmatics.com/speech-to-text/languages" },
        });
      }
    }
  });

  test("melia-1 allows plain diarization but not speaker identification", () => {
    const plain = stt.safe({
      type: "transcription",
      transcription_config: {
        language: "multi",
        model: "melia-1",
        diarization: "speaker",
        speaker_diarization_config: { speaker_sensitivity: 0.7 },
      },
    });
    expect(plain.ok).toBe(true);

    const identified = stt.safe({
      type: "transcription",
      transcription_config: {
        language: "multi",
        model: "melia-1",
        speaker_diarization_config: { get_speakers: true },
      },
    });
    expect(identified.ok).toBe(false);
    if (!identified.ok) expect(identified.errors[0]?.message).toContain("speaker identification");
  });

  test("oak-1 shares melia-1's gates and names itself in every refusal", () => {
    const ok = stt.safe({
      type: "transcription",
      transcription_config: {
        language: "multi",
        model: "oak-1",
        diarization: "speaker",
        speaker_diarization_config: { speaker_sensitivity: 0.7 },
      },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.warnings).toEqual([]);

    const auto = stt.safe({
      type: "transcription",
      transcription_config: { language: "auto", model: "oak-1" },
    });
    expect(auto.ok).toBe(false);
    if (!auto.ok) {
      expect(auto.errors[0]?.code).toBe("invalid_enum_value");
      expect(auto.errors[0]?.model).toBe("oak-1");
      expect(auto.errors[0]?.message).toContain("oak-1 is a multilingual model");
    }

    const gated = stt.safe({
      type: "transcription",
      transcription_config: {
        language: "multi",
        model: "oak-1",
        additional_vocab: [{ content: "metformin" }],
        speaker_diarization_config: { get_speakers: true },
      },
      summarization_config: {},
    });
    expect(gated.ok).toBe(false);
    if (!gated.ok) {
      expect(gated.errors.map((e) => e.path.join("."))).toEqual([
        "transcription_config.additional_vocab",
        "summarization_config",
        "transcription_config.speaker_diarization_config",
      ]);
      expect(gated.errors.every((e) => e.code === "unsupported_capability")).toBe(true);
      expect(gated.errors.every((e) => e.message.includes("oak-1"))).toBe(true);
    }
  });

  test('oak-1 with domain "medical" is pointed at what it already is', () => {
    const r = stt.safe({
      type: "transcription",
      transcription_config: { language: "multi", model: "oak-1", domain: "medical" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.message).toContain("oak-1 is itself the multilingual medical model");
    }
  });

  test('domain "medical" outside enhanced is rejected', () => {
    const r = stt.safe({
      type: "transcription",
      transcription_config: { language: "en", model: "standard", domain: "medical" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain('requires `model: "enhanced"`');
  });
});

describe("speechmatics.stt media + cost", () => {
  const config: JobConfig = {
    type: "transcription",
    transcription_config: { language: "en", model: "enhanced" },
  };

  test("declared duration prices at the catalog per-minute rate", () => {
    const r = stt.safe(config, {
      media: [{ path: ["data_file"], durationSeconds: 3600 }],
    });
    expect(r.ok).toBe(true);
    // 60 minutes x ($0.75/hr ÷ 60) = $0.75.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.75, 10);
  });

  test("oak-1 is catalogued and prices at its $0.30/hr batch list rate", () => {
    const r = stt.safe(
      { type: "transcription", transcription_config: { language: "multi", model: "oak-1" } },
      { media: [{ path: ["data_file"], durationSeconds: 3600 }] },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(r.estimate.costUSD).toBeCloseTo(0.3, 10);
    }
  });

  test("melia-1 is the cheapest catalogued batch rate", () => {
    expect(models["melia-1"].cost.perAudioMinute).toBeLessThan(models.standard.cost.perAudioMinute);
    expect(models.standard.cost.perAudioMinute).toBeLessThan(models.enhanced.cost.perAudioMinute);
  });

  test("fetch_data.url declarations are honoured too", () => {
    const r = stt.safe(
      { ...config, fetch_data: { url: "https://example.com/a.mp3" } },
      { media: [{ path: ["fetch_data", "url"], durationSeconds: 600 }] },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo((600 / 60) * (0.75 / 60), 10);
  });

  test("no declaration means no estimate", () => {
    const r = stt.safe(config);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("maxCostUSD is enforced against the estimate", () => {
    const r = stt.safe(config, {
      media: [{ path: ["data_file"], durationSeconds: 36_000 }],
      maxCostUSD: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });

  test("a data_file at or above 1 GB is rejected", () => {
    const r = stt.safe(config, {
      media: [{ path: ["data_file"], bytes: MAX_DATA_FILE_BYTES }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("media_too_large");
      expect(r.errors[0]?.message).toContain("fetch_data.url");
    }
  });

  test("throwing form raises UnmodelValidationError", () => {
    expect(() =>
      stt({ type: "transcription", transcription_config: { language: "auto", model: "melia-1" } }),
    ).toThrow(UnmodelValidationError);
  });
});

describe("speechmatics.toFormData", () => {
  test("serializes the config and attaches the media part", () => {
    const config: JobConfig = {
      type: "transcription",
      transcription_config: { language: "en", model: "standard" },
    };
    const form = toFormData({
      config,
      data_file: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }),
      filename: "audio.wav",
    });

    expect(JSON.parse(form.get("config") as string)).toEqual(config);
    const file = form.get("data_file");
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe("audio.wav");
  });

  test("fetch_data jobs carry only the config part", () => {
    const form = toFormData({
      config: {
        type: "transcription",
        transcription_config: { language: "en" },
        fetch_data: { url: "https://example.com/a.mp3" },
      },
    });
    expect([...form.keys()]).toEqual(["config"]);
  });
});
