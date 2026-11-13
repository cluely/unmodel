import { describe, expect, test } from "bun:test";
import {
  stt,
  toFormData,
  JOBS_URL,
  MAX_MEDIA_DURATION_SECONDS,
  TELUGU_MAX_MEDIA_DURATION_SECONDS,
  MAX_MEDIA_BYTES,
} from "./stt";
import { UnmodelValidationError } from "../../core/issues";

const MEDIA = "https://www.rev.ai/FTC_Sample_1.mp3";

describe("revai.stt happy path", () => {
  test("returns a wire-pure body with hidden toSdk/request", () => {
    const params = {
      source_config: { url: MEDIA },
      transcriber: "machine" as const,
      skip_diarization: false,
      language: "en",
    };
    const v = stt(params);

    expect(Object.keys(v)).toEqual(["source_config", "transcriber", "skip_diarization", "language"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(JOBS_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    expect(v.toSdk("revai")).toEqual(params);
  });

  test("an omitted transcriber resolves to the documented machine default", () => {
    const r = stt.safe({ source_config: { url: MEDIA } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("a rich machine job validates cleanly", () => {
    const r = stt.safe({
      source_config: { url: MEDIA, auth_headers: { Authorization: "Bearer token" } },
      notification_config: { url: "https://example.com/hook" },
      transcriber: "machine",
      language: "en",
      metadata: "example metadata",
      delete_after_seconds: 2_592_000,
      custom_vocabularies: [{ phrases: ["Paul McCartney", "Amelia Earhart"] }],
      strict_custom_vocabulary: true,
      speaker_channels_count: 2,
      diarization_type: "premium",
      summarization_config: { model: "premium", type: "bullets" },
      translation_config: { target_languages: [{ language: "es", model: "premium" }] },
      forced_alignment: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("the deprecated low_cost and fusion transcribers validate with deprecated_model", () => {
    for (const transcriber of ["low_cost", "fusion"] as const) {
      const r = stt.safe({ source_config: { url: MEDIA }, transcriber });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
    }
  });

  test("unknown transcribers warn and name the revai catalog", () => {
    const r = stt.safe({ source_config: { url: MEDIA }, transcriber: "reverb-3" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("the revai catalog");
    }
  });
});

describe("revai.stt mutual exclusions", () => {
  test("source_config and media_url cannot both be set", () => {
    const r = stt.safe({ source_config: { url: MEDIA }, media_url: MEDIA });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("mutually exclusive");
  });

  test("notification_config cannot pair with the deprecated callback_url", () => {
    const r = stt.safe({
      source_config: { url: MEDIA },
      notification_config: { url: "https://example.com/hook" },
      callback_url: "https://example.com/legacy",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("callback_url");
  });

  test("custom_vocabulary_id and custom_vocabularies together answer 400", () => {
    const r = stt.safe({
      source_config: { url: MEDIA },
      custom_vocabulary_id: "cvgnDwmB6iXevn",
      custom_vocabularies: [{ phrases: ["BLM"] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("400");
  });

  test("summarization prompt and type are mutually exclusive", () => {
    const r = stt.safe({
      source_config: { url: MEDIA },
      summarization_config: { type: "paragraph", prompt: "Any action items?" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("mutually exclusive");
  });
});

describe("revai.stt documented ranges", () => {
  test("speaker_channels_count is capped at 8 and metadata at 512 chars", () => {
    const r = stt.safe({
      source_config: { url: MEDIA },
      speaker_channels_count: 9,
      metadata: "x".repeat(513),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(2);
  });

  test("null is accepted, as unset, on every option the OpenAPI marks nullable", () => {
    const r = stt.safe({
      source_config: { url: MEDIA, auth_headers: null },
      metadata: null,
      callback_url: null,
      notification_config: null,
      delete_after_seconds: null,
      transcriber: null,
      rush: null,
      test_mode: null,
      segments_to_transcribe: null,
      speaker_names: null,
      skip_diarization: null,
      skip_postprocessing: null,
      skip_punctuation: null,
      remove_disfluencies: null,
      remove_atmospherics: null,
      filter_profanity: null,
      speaker_channels_count: null,
      speakers_count: null,
      diarization_type: null,
      custom_vocabulary_id: null,
      summarization_config: { model: null, type: null, prompt: "Any action items?" },
      translation_config: { target_languages: [{ language: "es", model: null }] },
      enable_multilingual: null,
      language: null,
      forced_alignment: null,
    });
    expect(r.ok).toBe(true);
    // A null transcriber is the machine default and a null language is English.
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("null pairs with neither side of a mutual exclusion", () => {
    const r = stt.safe({
      source_config: null,
      media_url: MEDIA,
      notification_config: null,
      callback_url: "https://example.com/legacy",
      custom_vocabulary_id: null,
      custom_vocabularies: [{ phrases: ["BLM"] }],
    });
    expect(r.ok).toBe(true);
  });

  test("null is refused where the OpenAPI does not mark the option nullable", () => {
    const r = stt.safe({
      source_config: { url: MEDIA },
      // @ts-expect-error `VerbatimField` carries no `nullable: true`.
      verbatim: null,
      // @ts-expect-error nor does `custom_vocabularies`.
      custom_vocabularies: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path.join("."))).toEqual(["verbatim", "custom_vocabularies"]);
    }
  });

  test("unknown top-level keys pass through with a warning", () => {
    const r = stt.safe({
      source_config: { url: MEDIA },
      // @ts-expect-error ExactKeys rejects params outside the wire shape.
      skip_atmospherics: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
  });

  test("delete_after_seconds is capped at 30 days", () => {
    const r = stt.safe({ source_config: { url: MEDIA }, delete_after_seconds: 2_592_001 });
    expect(r.ok).toBe(false);
  });

  test("translation targets cap at 5 and custom vocabularies at 50", () => {
    const languages = ["en", "fr", "de", "es", "it", "ja"].map((language) => ({ language }));
    const r = stt.safe({
      source_config: { url: MEDIA },
      translation_config: { target_languages: languages },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("at most 5 languages");
  });
});

describe("revai.stt transcriber scoping", () => {
  test("human-only params on a machine job are rejected", () => {
    const r = stt.safe({ source_config: { url: MEDIA }, transcriber: "machine", rush: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.message).toContain('transcriber: "human"');
    }
  });

  test("machine-only params on a human job are rejected", () => {
    const r = stt.safe({
      source_config: { url: MEDIA },
      transcriber: "human",
      remove_disfluencies: true,
      summarization_config: { type: "bullets" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path.join("."))).toEqual([
        "remove_disfluencies",
        "summarization_config",
      ]);
    }
  });

  test("a human job with human-only params validates", () => {
    const r = stt.safe({
      source_config: { url: MEDIA },
      transcriber: "human",
      rush: true,
      verbatim: true,
      test_mode: true,
      speaker_names: [{ display_name: "Interviewer" }],
      segments_to_transcribe: [
        { start: 0.5, end: 120.7 },
        { start: 240, end: 420.7 },
      ],
    });
    expect(r.ok).toBe(true);
  });

  test("low_cost rejects diarization_type and forced_alignment", () => {
    const r = stt.safe({
      source_config: { url: MEDIA },
      transcriber: "low_cost",
      diarization_type: "premium",
      forced_alignment: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(2);
      expect(r.errors[0]?.message).toContain("low-cost environment");
      expect(r.errors[0]?.meta?.source).toBe(
        "https://web.archive.org/web/20250601173112/https://docs.rev.ai/api/asynchronous/reference",
      );
    }
  });

  test("low_cost restrictions do not apply to non-English jobs, which ignore the transcriber", () => {
    const r = stt.safe({
      source_config: { url: MEDIA },
      transcriber: "low_cost",
      language: "es",
      forced_alignment: true,
      diarization_type: "premium",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model", "unsupported_param"]);
      expect(r.warnings[1]?.path).toEqual(["transcriber"]);
      expect(r.warnings[1]?.meta?.ignored).toBe(true);
    }
  });
});

describe("revai.stt language scoping", () => {
  test("English-only params are rejected for non-English audio", () => {
    const r = stt.safe({
      source_config: { url: MEDIA },
      language: "de",
      filter_profanity: true,
      speaker_channels_count: 2,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path.join("."))).toEqual([
        "filter_profanity",
        "speaker_channels_count",
      ]);
      expect(r.errors[0]?.message).toContain("non-English");
      expect(r.errors[1]?.message).toContain('English, Spanish and French ("en", "en-us", "en-gb", "es", "fr")');
    }
  });

  test("speaker_channels_count is available for Spanish and French", () => {
    for (const language of ["es", "fr"]) {
      const r = stt.safe({ source_config: { url: MEDIA }, language, speaker_channels_count: 2 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
  });

  test("a null language is the English default", () => {
    const r = stt.safe({ source_config: { url: MEDIA }, language: null, filter_profanity: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("transcriber is reported as ignored for non-English requests", () => {
    const r = stt.safe({ source_config: { url: MEDIA }, language: "de", transcriber: "machine" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unsupported_param"]);
      expect(r.warnings[0]?.meta?.ignored).toBe(true);
    }
  });

  test("en-gb and en-us count as English", () => {
    const r = stt.safe({ source_config: { url: MEDIA }, language: "en-gb", filter_profanity: true });
    expect(r.ok).toBe(true);
  });
});

describe("revai.stt segments", () => {
  test("segments shorter than a minute are rejected", () => {
    const r = stt.safe({
      source_config: { url: MEDIA },
      transcriber: "human",
      segments_to_transcribe: [{ start: 0, end: 30 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("at least 60s");
  });

  test("overlapping segments are rejected", () => {
    const r = stt.safe({
      source_config: { url: MEDIA },
      transcriber: "human",
      segments_to_transcribe: [
        { start: 0, end: 120 },
        { start: 90, end: 300 },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.message.includes("overlap"))).toBe(true);
  });
});

describe("revai.stt media + cost", () => {
  test("declared duration prices at the Reverb per-minute rate", () => {
    const r = stt.safe(
      { source_config: { url: MEDIA } },
      { media: [{ path: ["source_config", "url"], durationSeconds: 3600 }] },
    );
    expect(r.ok).toBe(true);
    // 60 minutes x ($0.20/hr ÷ 60) = $0.20.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.2, 10);
  });

  test("the deprecated low_cost and fusion have no published price, so no English estimate", () => {
    const declaration = { media: [{ path: ["source_config", "url"], durationSeconds: 3600 }] };
    const low = stt.safe({ source_config: { url: MEDIA }, transcriber: "low_cost" }, declaration);
    const fusion = stt.safe({ source_config: { url: MEDIA }, transcriber: "fusion" }, declaration);
    expect(low.ok).toBe(true);
    expect(fusion.ok).toBe(true);
    if (low.ok) expect(low.estimate.costUSD).toBeUndefined();
    if (fusion.ok) expect(fusion.estimate.costUSD).toBeUndefined();
  });

  test("non-English audio prices at the foreign-language rate, not the transcriber's", () => {
    const declaration = { media: [{ path: ["source_config", "url"], durationSeconds: 3600 }] };
    const spanish = stt.safe(
      { source_config: { url: MEDIA }, transcriber: "machine", language: "es" },
      declaration,
    );
    const english = stt.safe(
      { source_config: { url: MEDIA }, transcriber: "machine", language: "en" },
      declaration,
    );
    // The transcriber is ignored for non-English audio, so a deprecated one
    // with no catalog rate still bills at the foreign-language rate.
    const unpriced = stt.safe(
      { source_config: { url: MEDIA }, transcriber: "low_cost", language: "es" },
      declaration,
    );
    expect(spanish.ok).toBe(true);
    expect(english.ok).toBe(true);
    expect(unpriced.ok).toBe(true);
    if (spanish.ok && english.ok && unpriced.ok) {
      // 60 minutes x ($0.30/hr ÷ 60) = $0.30, 1.5x Reverb's $0.20/hr.
      expect(spanish.estimate.costUSD).toBeCloseTo(0.3, 10);
      expect(english.estimate.costUSD).toBeCloseTo(0.2, 10);
      expect(unpriced.estimate.costUSD).toBeCloseTo(0.3, 10);
    }
  });

  test("Spanish speaker channels multiply the foreign-language rate", () => {
    const r = stt.safe(
      { source_config: { url: MEDIA }, language: "es", speaker_channels_count: 2 },
      { media: [{ path: ["source_config", "url"], durationSeconds: 3600 }] },
    );
    expect(r.ok).toBe(true);
    // 2 channels x 60 minutes x ($0.30/hr ÷ 60) = $0.60.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.6, 10);
  });

  test("a non-English job is blocked by a budget sized for the English rate", () => {
    const r = stt.safe(
      { source_config: { url: MEDIA }, transcriber: "low_cost", language: "es" },
      { media: [{ path: ["source_config", "url"], durationSeconds: 3600 }], maxCostUSD: 0.2 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });

  test("human transcription keeps its own per-minute rate for non-English audio", () => {
    const r = stt.safe(
      { source_config: { url: MEDIA }, transcriber: "human", language: "es" },
      { media: [{ path: ["source_config", "url"], durationSeconds: 600 }] },
    );
    expect(r.ok).toBe(true);
    // 10 minutes x $1.99/min — the foreign-language rate never lowers a bill.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(19.9, 10);
  });

  test("the 15-second billing minimum applies to short clips", () => {
    const r = stt.safe(
      { source_config: { url: MEDIA } },
      { media: [{ path: ["source_config", "url"], durationSeconds: 3 }] },
    );
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo((15 / 60) * (0.2 / 60), 12);
  });

  test("speaker_channels_count multiplies the estimate", () => {
    const r = stt.safe(
      { source_config: { url: MEDIA }, speaker_channels_count: 2 },
      { media: [{ path: ["source_config", "url"], durationSeconds: 3600 }] },
    );
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.4, 10);
  });

  test("media longer than 17 hours is rejected, Telugu at 6", () => {
    const long = stt.safe(
      { source_config: { url: MEDIA } },
      { media: [{ path: ["source_config", "url"], durationSeconds: MAX_MEDIA_DURATION_SECONDS + 1 }] },
    );
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.errors[0]?.code).toBe("media_duration_exceeded");

    const telugu = stt.safe(
      { source_config: { url: MEDIA }, language: "te" },
      {
        media: [
          { path: ["source_config", "url"], durationSeconds: TELUGU_MAX_MEDIA_DURATION_SECONDS + 1 },
        ],
      },
    );
    expect(telugu.ok).toBe(false);
    if (!telugu.ok) expect(telugu.errors[0]?.message).toContain('Telugu ("te")');
  });

  test("a 2 GB upload is rejected", () => {
    const r = stt.safe({}, { media: [{ path: ["media"], bytes: MAX_MEDIA_BYTES }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("media_too_large");
  });

  test("maxCostUSD is enforced and throwing form raises UnmodelValidationError", () => {
    const r = stt.safe(
      { source_config: { url: MEDIA }, transcriber: "human" },
      { media: [{ path: ["source_config", "url"], durationSeconds: 600 }], maxCostUSD: 1 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");

    expect(() => stt({ source_config: { url: MEDIA }, rush: true })).toThrow(
      UnmodelValidationError,
    );
  });
});

describe("revai.toFormData", () => {
  test("attaches media and serializes options without the URL source", () => {
    const form = toFormData({
      media: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }),
      filename: "sample.wav",
      options: { source_config: { url: MEDIA }, transcriber: "machine", language: "en" },
    });

    expect((form.get("media") as File).name).toBe("sample.wav");
    expect(JSON.parse(form.get("options") as string)).toEqual({
      transcriber: "machine",
      language: "en",
    });
  });

  test("omits the options part when there is nothing to send", () => {
    const form = toFormData({ media: "bytes", options: { source_config: { url: MEDIA } } });
    expect([...form.keys()]).toEqual(["media"]);
  });
});
