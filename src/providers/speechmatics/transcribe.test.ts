import { describe, expect, test } from "bun:test";
import {
  transcribe,
  toFormData,
  jobsUrl,
  JOBS_URL,
  MAX_DATA_FILE_BYTES,
  resolveModel,
  type JobConfig,
} from "./transcribe";
import { models } from "./models";
import { UnmodelValidationError } from "../../core/issues";

describe("speechmatics.transcribe happy path", () => {
  test("returns a wire-pure config with hidden toSdk/request", () => {
    const config = {
      type: "transcription" as const,
      transcription_config: { language: "en", model: "enhanced" as const, diarization: "speaker" as const },
    };
    const v = transcribe(config);

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

  test("a full speech-intelligence config on enhanced validates cleanly", () => {
    const r = transcribe.safe({
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
    const r = transcribe.safe({
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

describe("speechmatics.transcribe shape rules", () => {
  test("punctuation sensitivity, volume threshold and speaker sensitivity are range-checked", () => {
    const r = transcribe.safe({
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
    const r = transcribe.safe({
      type: "transcription",
      transcription_config: { language: "en" },
      translation_config: { target_languages: ["fr", "de", "es", "it", "pt", "nl"] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("at most 5 languages");
  });

  test("channel diarization labels must match the documented pattern", () => {
    const r = transcribe.safe({
      type: "transcription",
      transcription_config: { language: "en", channel_diarization_labels: ["agent 1"] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("^[A-Za-z0-9._]+$");
  });

  test("unknown top-level keys pass through with a warning", () => {
    const r = transcribe.safe({
      type: "transcription",
      transcription_config: { language: "en" },
      // @ts-expect-error ExactKeys rejects params outside the wire shape.
      alignment_config: { language: "en" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
  });
});

describe("speechmatics.transcribe operating_point deprecation", () => {
  test("operating_point alone warns but still resolves the model", () => {
    const r = transcribe.safe({
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
    const r = transcribe.safe({
      type: "transcription",
      transcription_config: { language: "en", model: "enhanced", operating_point: "standard" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("set only one");
  });
});

describe("speechmatics.transcribe melia-1 feature gates", () => {
  test('melia-1 requires language "multi"', () => {
    const auto = transcribe.safe({
      type: "transcription",
      transcription_config: { language: "auto", model: "melia-1" },
    });
    expect(auto.ok).toBe(false);
    if (!auto.ok) {
      expect(auto.errors[0]?.code).toBe("invalid_enum_value");
      expect(auto.errors[0]?.message).toContain('"auto" returns an error');
    }

    const ok = transcribe.safe({
      type: "transcription",
      transcription_config: { language: "multi", model: "melia-1", language_hints: ["en", "ar"] },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.warnings).toEqual([]);
  });

  test("unsupported melia-1 features are reported per config key", () => {
    const r = transcribe.safe({
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
      expect(paths).toContain("transcription_config.enable_entities");
      expect(paths).toContain("summarization_config");
      expect(paths).toContain("translation_config");
      expect(r.errors.every((e) => e.code === "unsupported_capability")).toBe(true);
    }
  });

  test("melia-1 allows plain diarization but not speaker identification", () => {
    const plain = transcribe.safe({
      type: "transcription",
      transcription_config: {
        language: "multi",
        model: "melia-1",
        diarization: "speaker",
        speaker_diarization_config: { speaker_sensitivity: 0.7 },
      },
    });
    expect(plain.ok).toBe(true);

    const identified = transcribe.safe({
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

  test('domain "medical" outside enhanced is rejected', () => {
    const r = transcribe.safe({
      type: "transcription",
      transcription_config: { language: "en", model: "standard", domain: "medical" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain('requires `model: "enhanced"`');
  });
});

describe("speechmatics.transcribe media + cost", () => {
  const config: JobConfig = {
    type: "transcription",
    transcription_config: { language: "en", model: "enhanced" },
  };

  test("declared duration prices at the catalog per-minute rate", () => {
    const r = transcribe.safe(config, {
      media: [{ path: ["data_file"], durationSeconds: 3600 }],
    });
    expect(r.ok).toBe(true);
    // 60 minutes x ($0.40/hr ÷ 60) = $0.40.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.4, 10);
  });

  test("melia-1 is the cheapest catalogued batch rate", () => {
    expect(models["melia-1"].cost.perAudioMinute).toBeLessThan(models.standard.cost.perAudioMinute);
    expect(models.standard.cost.perAudioMinute).toBeLessThan(models.enhanced.cost.perAudioMinute);
  });

  test("fetch_data.url declarations are honoured too", () => {
    const r = transcribe.safe(
      { ...config, fetch_data: { url: "https://example.com/a.mp3" } },
      { media: [{ path: ["fetch_data", "url"], durationSeconds: 600 }] },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo((600 / 60) * (0.4 / 60), 10);
  });

  test("no declaration means no estimate", () => {
    const r = transcribe.safe(config);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("maxCostUSD is enforced against the estimate", () => {
    const r = transcribe.safe(config, {
      media: [{ path: ["data_file"], durationSeconds: 36_000 }],
      maxCostUSD: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });

  test("a data_file at or above 1 GB is rejected", () => {
    const r = transcribe.safe(config, {
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
      transcribe({ type: "transcription", transcription_config: { language: "auto", model: "melia-1" } }),
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
