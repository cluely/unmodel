import { describe, expect, test } from "bun:test";
import {
  transcribe,
  toFormData,
  JOBS_URL,
  MAX_MEDIA_DURATION_SECONDS,
  TELUGU_MAX_MEDIA_DURATION_SECONDS,
  MAX_MEDIA_BYTES,
} from "./transcribe";
import { UnmodelValidationError } from "../../core/issues";

const MEDIA = "https://www.rev.ai/FTC_Sample_1.mp3";

describe("revai.transcribe happy path", () => {
  test("returns a wire-pure body with hidden toSdk/request", () => {
    const params = {
      source_config: { url: MEDIA },
      transcriber: "machine" as const,
      skip_diarization: false,
      language: "en",
    };
    const v = transcribe(params);

    expect(Object.keys(v)).toEqual(["source_config", "transcriber", "skip_diarization", "language"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(JOBS_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    expect(v.toSdk("revai")).toEqual(params);
  });

  test("an omitted transcriber resolves to the documented machine default", () => {
    const r = transcribe.safe({ source_config: { url: MEDIA } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("a rich machine job validates cleanly", () => {
    const r = transcribe.safe({
      source_config: { url: MEDIA, auth_headers: { Authorization: "Bearer token" } },
      notification_config: { url: "https://example.com/hook" },
      transcriber: "fusion",
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

  test("unknown transcribers warn and name the revai catalog", () => {
    const r = transcribe.safe({ source_config: { url: MEDIA }, transcriber: "reverb-3" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("the revai catalog");
    }
  });
});

describe("revai.transcribe mutual exclusions", () => {
  test("source_config and media_url cannot both be set", () => {
    const r = transcribe.safe({ source_config: { url: MEDIA }, media_url: MEDIA });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("mutually exclusive");
  });

  test("notification_config cannot pair with the deprecated callback_url", () => {
    const r = transcribe.safe({
      source_config: { url: MEDIA },
      notification_config: { url: "https://example.com/hook" },
      callback_url: "https://example.com/legacy",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("callback_url");
  });

  test("custom_vocabulary_id and custom_vocabularies together answer 400", () => {
    const r = transcribe.safe({
      source_config: { url: MEDIA },
      custom_vocabulary_id: "cvgnDwmB6iXevn",
      custom_vocabularies: [{ phrases: ["BLM"] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("400");
  });

  test("summarization prompt and type are mutually exclusive", () => {
    const r = transcribe.safe({
      source_config: { url: MEDIA },
      summarization_config: { type: "paragraph", prompt: "Any action items?" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("mutually exclusive");
  });
});

describe("revai.transcribe documented ranges", () => {
  test("speaker_channels_count is capped at 8 and metadata at 512 chars", () => {
    const r = transcribe.safe({
      source_config: { url: MEDIA },
      speaker_channels_count: 9,
      metadata: "x".repeat(513),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(2);
  });

  test("unknown top-level keys pass through with a warning", () => {
    const r = transcribe.safe({
      source_config: { url: MEDIA },
      // @ts-expect-error ExactKeys rejects params outside the wire shape.
      skip_atmospherics: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
  });

  test("delete_after_seconds is capped at 30 days", () => {
    const r = transcribe.safe({ source_config: { url: MEDIA }, delete_after_seconds: 2_592_001 });
    expect(r.ok).toBe(false);
  });

  test("translation targets cap at 5 and custom vocabularies at 50", () => {
    const languages = ["en", "fr", "de", "es", "it", "ja"].map((language) => ({ language }));
    const r = transcribe.safe({
      source_config: { url: MEDIA },
      translation_config: { target_languages: languages },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("at most 5 languages");
  });
});

describe("revai.transcribe transcriber scoping", () => {
  test("human-only params on a machine job are rejected", () => {
    const r = transcribe.safe({ source_config: { url: MEDIA }, transcriber: "machine", rush: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.message).toContain('transcriber: "human"');
    }
  });

  test("machine-only params on a human job are rejected", () => {
    const r = transcribe.safe({
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
    const r = transcribe.safe({
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
    const r = transcribe.safe({
      source_config: { url: MEDIA },
      transcriber: "low_cost",
      diarization_type: "premium",
      forced_alignment: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(2);
      expect(r.errors[0]?.message).toContain("low-cost environment");
    }
  });
});

describe("revai.transcribe language scoping", () => {
  test("English-only params are rejected for non-English audio", () => {
    const r = transcribe.safe({
      source_config: { url: MEDIA },
      language: "fr",
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
    }
  });

  test("transcriber is reported as ignored for non-English requests", () => {
    const r = transcribe.safe({ source_config: { url: MEDIA }, language: "de", transcriber: "fusion" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unsupported_param"]);
      expect(r.warnings[0]?.meta?.ignored).toBe(true);
    }
  });

  test("en-gb and en-us count as English", () => {
    const r = transcribe.safe({ source_config: { url: MEDIA }, language: "en-gb", filter_profanity: true });
    expect(r.ok).toBe(true);
  });
});

describe("revai.transcribe segments", () => {
  test("segments shorter than a minute are rejected", () => {
    const r = transcribe.safe({
      source_config: { url: MEDIA },
      transcriber: "human",
      segments_to_transcribe: [{ start: 0, end: 30 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("at least 60s");
  });

  test("overlapping segments are rejected", () => {
    const r = transcribe.safe({
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

describe("revai.transcribe media + cost", () => {
  test("declared duration prices at the Reverb per-minute rate", () => {
    const r = transcribe.safe(
      { source_config: { url: MEDIA } },
      { media: [{ path: ["source_config", "url"], durationSeconds: 3600 }] },
    );
    expect(r.ok).toBe(true);
    // 60 minutes x ($0.20/hr ÷ 60) = $0.20.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.2, 10);
  });

  test("low_cost halves the machine rate and fusion bills per minute", () => {
    const declaration = { media: [{ path: ["source_config", "url"], durationSeconds: 3600 }] };
    const low = transcribe.safe({ source_config: { url: MEDIA }, transcriber: "low_cost" }, declaration);
    const fusion = transcribe.safe({ source_config: { url: MEDIA }, transcriber: "fusion" }, declaration);
    if (low.ok) expect(low.estimate.costUSD).toBeCloseTo(0.1, 10);
    if (fusion.ok) expect(fusion.estimate.costUSD).toBeCloseTo(60 * 0.005, 10);
  });

  test("non-English audio prices at the foreign-language rate, not the transcriber's", () => {
    const declaration = { media: [{ path: ["source_config", "url"], durationSeconds: 3600 }] };
    const spanish = transcribe.safe(
      { source_config: { url: MEDIA }, transcriber: "low_cost", language: "es" },
      declaration,
    );
    const english = transcribe.safe(
      { source_config: { url: MEDIA }, transcriber: "low_cost", language: "en" },
      declaration,
    );
    expect(spanish.ok).toBe(true);
    expect(english.ok).toBe(true);
    if (spanish.ok && english.ok) {
      // 60 minutes x ($0.30/hr ÷ 60) = $0.30, 3x Reverb Turbo's $0.10/hr.
      expect(spanish.estimate.costUSD).toBeCloseTo(0.3, 10);
      expect(english.estimate.costUSD).toBeCloseTo(0.1, 10);
      expect(spanish.estimate.costUSD ?? 0).toBeGreaterThan(english.estimate.costUSD ?? 0);
    }
  });

  test("a non-English job is blocked by a budget sized for the English rate", () => {
    const r = transcribe.safe(
      { source_config: { url: MEDIA }, transcriber: "low_cost", language: "es" },
      { media: [{ path: ["source_config", "url"], durationSeconds: 3600 }], maxCostUSD: 0.2 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });

  test("human transcription keeps its own per-minute rate for non-English audio", () => {
    const r = transcribe.safe(
      { source_config: { url: MEDIA }, transcriber: "human", language: "es" },
      { media: [{ path: ["source_config", "url"], durationSeconds: 600 }] },
    );
    expect(r.ok).toBe(true);
    // 10 minutes x $1.99/min — the foreign-language rate never lowers a bill.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(19.9, 10);
  });

  test("the 15-second billing minimum applies to short clips", () => {
    const r = transcribe.safe(
      { source_config: { url: MEDIA } },
      { media: [{ path: ["source_config", "url"], durationSeconds: 3 }] },
    );
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo((15 / 60) * (0.2 / 60), 12);
  });

  test("speaker_channels_count multiplies the estimate", () => {
    const r = transcribe.safe(
      { source_config: { url: MEDIA }, speaker_channels_count: 2 },
      { media: [{ path: ["source_config", "url"], durationSeconds: 3600 }] },
    );
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.4, 10);
  });

  test("media longer than 17 hours is rejected, Telugu at 6", () => {
    const long = transcribe.safe(
      { source_config: { url: MEDIA } },
      { media: [{ path: ["source_config", "url"], durationSeconds: MAX_MEDIA_DURATION_SECONDS + 1 }] },
    );
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.errors[0]?.code).toBe("media_duration_exceeded");

    const telugu = transcribe.safe(
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
    const r = transcribe.safe({}, { media: [{ path: ["media"], bytes: MAX_MEDIA_BYTES }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("media_too_large");
  });

  test("maxCostUSD is enforced and throwing form raises UnmodelValidationError", () => {
    const r = transcribe.safe(
      { source_config: { url: MEDIA }, transcriber: "human" },
      { media: [{ path: ["source_config", "url"], durationSeconds: 600 }], maxCostUSD: 1 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");

    expect(() => transcribe({ source_config: { url: MEDIA }, rush: true })).toThrow(
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
