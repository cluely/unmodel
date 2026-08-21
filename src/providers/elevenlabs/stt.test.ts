import { describe, expect, test } from "bun:test";
import {
  stt,
  toFormData,
  SPEECH_TO_TEXT_URL,
  STT_KEYTERMS_MAX,
  STT_KEYTERM_MAX_CHARACTERS,
  STT_KEYTERM_MAX_WORDS,
  STT_MAX_FILE_BYTES,
} from "./stt";
import { models, STT_MODEL_IDS } from "./models";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const audio = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/mpeg" });

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = stt.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("elevenlabs.stt happy path", () => {
  test("returns the validated params with hidden toSdk/request", () => {
    const v = stt({ model_id: "scribe_v2", file: audio, diarize: true });

    expect(Object.keys(v)).toEqual(["model_id", "file", "diarize"]);
    expect(v.request.url).toBe(SPEECH_TO_TEXT_URL);
    expect(v.request.method).toBe("POST");
    // Multipart endpoint: fetch must set the boundary from the FormData body,
    // so no content-type is pre-set.
    expect(v.request.headers).toEqual({});
  });

  test("toSdk camelCases keys and drops nulls", () => {
    const v = stt({
      model_id: "scribe_v2",
      file: audio,
      language_code: null,
      tag_audio_events: false,
      num_speakers: 4,
      timestamps_granularity: "word",
      diarize: true,
      no_verbatim: true,
    });
    expect(v.toSdk("elevenlabs")).toEqual({
      modelId: "scribe_v2",
      file: audio,
      tagAudioEvents: false,
      numSpeakers: 4,
      timestampsGranularity: "word",
      diarize: true,
      noVerbatim: true,
    });
  });

  test("a string file is treated as a URL and becomes sourceUrl in toSdk", () => {
    const v = stt({ model_id: "scribe_v2", file: "https://example.com/a.mp3" });
    expect(v.toSdk("elevenlabs")).toEqual({ modelId: "scribe_v2", sourceUrl: "https://example.com/a.mp3" });
  });

  test("unknown model warns but validates", () => {
    const r = stt.safe({ model_id: "scribe_v3", file: audio });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("deprecated scribe_v1 warns", () => {
    const r = stt.safe({ model_id: "scribe_v1", file: audio });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
  });
});

describe("elevenlabs.stt source exclusivity", () => {
  test("no source at all is invalid_shape", () => {
    const r = stt.safe({ model_id: "scribe_v2" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.message).toContain("exactly one of");
    }
  });

  test("file + source_url together is invalid_shape", () => {
    const r = stt.safe({
      model_id: "scribe_v2",
      file: audio,
      source_url: "https://example.com/a.mp3",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta?.provided).toEqual(["file", "source_url"]);
  });

  test("source_url alone passes", () => {
    const r = stt.safe({ model_id: "scribe_v2", source_url: "https://example.com/a.mp3" });
    expect(r.ok).toBe(true);
  });
});

describe("elevenlabs.stt pairing rules", () => {
  test("diarization_threshold without diarize is invalid_shape", () => {
    const r = stt.safe({ model_id: "scribe_v2", file: audio, diarization_threshold: 0.3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["diarization_threshold"]);
  });

  test("diarization_threshold with diarize but num_speakers set is invalid_shape", () => {
    const r = stt.safe({
      model_id: "scribe_v2",
      file: audio,
      diarize: true,
      num_speakers: 2,
      diarization_threshold: 0.3,
    });
    expect(r.ok).toBe(false);
  });

  test("detect_speaker_roles requires diarize", () => {
    const r = stt.safe({ model_id: "scribe_v2", file: audio, detect_speaker_roles: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["detect_speaker_roles"]);
  });

  test("detect_speaker_roles cannot combine with use_multi_channel", () => {
    const r = stt.safe({
      model_id: "scribe_v2",
      file: audio,
      diarize: true,
      use_multi_channel: true,
      detect_speaker_roles: true,
    });
    expect(r.ok).toBe(false);
  });

  test("webhook_id without webhook is invalid_shape", () => {
    const r = stt.safe({ model_id: "scribe_v2", file: audio, webhook_id: "wh_1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["webhook_id"]);
  });
});

describe("elevenlabs.stt enums and shape", () => {
  test("timestamps_granularity outside none/word/character is invalid_shape", () => {
    const r = safeUnchecked({ model_id: "scribe_v2", file: audio, timestamps_granularity: "sentence" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("num_speakers above 32 is invalid_shape", () => {
    const r = safeUnchecked({ model_id: "scribe_v2", file: audio, num_speakers: 33 });
    expect(r.ok).toBe(false);
  });

  test("no_verbatim on scribe_v1 is unsupported_param (scribe_v2 only)", () => {
    const r = stt.safe({ model_id: "scribe_v1", file: audio, no_verbatim: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["no_verbatim"]);
    }
  });

  test("unknown top-level params warn", () => {
    const r = safeUnchecked({ model_id: "scribe_v2", file: audio, brand_new_param: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const unknown = r.warnings.find((w) => w.code === "unknown_param");
      expect(unknown?.path).toEqual(["brand_new_param"]);
    }
  });
});

describe("elevenlabs.stt cost estimation (declared duration)", () => {
  test("declared durationSeconds prices at $0.22 per hour", () => {
    const r = stt.safe(
      { model_id: "scribe_v2", file: audio },
      { media: [{ path: ["file"], durationSeconds: 3600 }] },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.22, 10);
  });

  test("10 minutes of audio costs 0.22/6", () => {
    const r = stt.safe(
      { model_id: "scribe_v2", file: audio },
      { media: [{ path: ["file"], durationSeconds: 600 }] },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.22 / 6, 10);
  });

  test("no declaration means no estimate", () => {
    const r = stt.safe({ model_id: "scribe_v2", file: audio });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("maxCostUSD under the declared-duration estimate is over_budget", () => {
    const r = stt.safe(
      { model_id: "scribe_v2", file: audio },
      { media: [{ path: ["file"], durationSeconds: 7200 }], maxCostUSD: 0.3 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });
});

describe("elevenlabs.toFormData", () => {
  test("encodes scalars, booleans, and the file blob", () => {
    const form = toFormData({
      model_id: "scribe_v2",
      file: audio,
      diarize: true,
      num_speakers: 3,
      temperature: 0.5,
    });
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(form.get("diarize")).toBe("true");
    expect(form.get("num_speakers")).toBe("3");
    expect(form.get("temperature")).toBe("0.5");
  });

  test("a string file is appended as source_url", () => {
    const form = toFormData({ model_id: "scribe_v2", file: "https://example.com/a.mp3" });
    expect(form.get("file")).toBeNull();
    expect(form.get("source_url")).toBe("https://example.com/a.mp3");
  });

  test("keyterms and entity_detection arrays are appended item-by-item", () => {
    const form = toFormData({
      model_id: "scribe_v2",
      file: audio,
      keyterms: ["alpha", "beta"],
      entity_detection: ["pii", "phi"],
    });
    expect(form.getAll("keyterms")).toEqual(["alpha", "beta"]);
    expect(form.getAll("entity_detection")).toEqual(["pii", "phi"]);
  });

  test("a string entity_detection is appended once", () => {
    const form = toFormData({ model_id: "scribe_v2", file: audio, entity_detection: "all" });
    expect(form.getAll("entity_detection")).toEqual(["all"]);
  });

  test("additional_formats and object webhook_metadata are single JSON parts", () => {
    const form = toFormData({
      model_id: "scribe_v2",
      file: audio,
      additional_formats: [{ format: "srt" }],
      webhook_metadata: { job: "42" },
    });
    expect(form.get("additional_formats")).toBe('[{"format":"srt"}]');
    expect(form.get("webhook_metadata")).toBe('{"job":"42"}');
  });

  test("null and undefined fields are omitted", () => {
    const form = toFormData({
      model_id: "scribe_v2",
      file: audio,
      language_code: null,
      num_speakers: null,
    });
    expect(form.get("language_code")).toBeNull();
    expect(form.get("num_speakers")).toBeNull();
  });

  test("round-trips the validated output", () => {
    const v = stt({ model_id: "scribe_v2", file: audio, tag_audio_events: true });
    const form = toFormData(v);
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("tag_audio_events")).toBe("true");
    // Hidden props never leak into the form.
    expect(form.get("request")).toBeNull();
    expect(form.get("toSdk")).toBeNull();
  });
});

describe("elevenlabs.stt keyterm limits (doc audit 2026-08-13)", () => {
  test("a keyterm of 50+ characters is invalid_shape with the doc source", () => {
    const r = stt.safe({
      model_id: "scribe_v2",
      file: audio,
      keyterms: ["x".repeat(50)],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.path).toEqual(["keyterms", 0]);
      expect(r.errors[0]?.meta?.limit).toBe(STT_KEYTERM_MAX_CHARACTERS);
      expect(String(r.errors[0]?.meta?.source)).toContain("speech-to-text");
    }
  });

  test("49 characters is fine (the cap is exclusive: 'less than 50')", () => {
    const r = stt.safe({ model_id: "scribe_v2", file: audio, keyterms: ["x".repeat(49)] });
    expect(r.ok).toBe(true);
  });

  test("a keyterm with more than 5 words is invalid_shape", () => {
    const r = stt.safe({
      model_id: "scribe_v2",
      file: audio,
      keyterms: ["one two three four five six"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta?.limit).toBe(STT_KEYTERM_MAX_WORDS);
  });

  test("exactly 5 words passes", () => {
    const r = stt.safe({
      model_id: "scribe_v2",
      file: audio,
      keyterms: ["one two three four five"],
    });
    expect(r.ok).toBe(true);
  });

  test("more than 1000 keyterms is invalid_shape", () => {
    const r = stt.safe({
      model_id: "scribe_v2",
      file: audio,
      keyterms: Array.from({ length: STT_KEYTERMS_MAX + 1 }, () => "term"),
    });
    expect(r.ok).toBe(false);
  });
});

describe("elevenlabs.stt combined multichannel rules (doc audit 2026-08-13)", () => {
  test("combined output with timestamps_granularity none is invalid_shape", () => {
    const r = stt.safe({
      model_id: "scribe_v2",
      file: audio,
      use_multi_channel: true,
      multichannel_output_style: "combined",
      timestamps_granularity: "none",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["multichannel_output_style"]);
  });

  test("combined output rejects entity detection and redaction", () => {
    const r = stt.safe({
      model_id: "scribe_v2",
      file: audio,
      multichannel_output_style: "combined",
      entity_detection: "all",
      entity_redaction: "pii",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path[0])).toEqual(["entity_detection", "entity_redaction"]);
      expect(r.errors.every((e) => e.code === "unsupported_param")).toBe(true);
    }
  });

  test("combined output with word timestamps and no entity params passes", () => {
    const r = stt.safe({
      model_id: "scribe_v2",
      file: audio,
      multichannel_output_style: "combined",
      timestamps_granularity: "word",
    });
    expect(r.ok).toBe(true);
  });
});

describe("elevenlabs.stt model gating (doc audit 2026-08-13)", () => {
  test("scribe_v2_realtime is rejected by the batch endpoint", () => {
    const r = stt.safe({ model_id: "scribe_v2_realtime", file: audio });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.message).toContain("WebSocket");
    }
  });

  test("a TTS model id is rejected by the STT endpoint", () => {
    const r = stt.safe({ model_id: "eleven_v3", file: audio });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("unsupported_capability");
  });

  test("every batch STT id passes the gate", () => {
    for (const id of STT_MODEL_IDS) {
      const r = stt.safe({ model_id: id, file: audio });
      expect(r.ok).toBe(true);
    }
  });

  test("scribe_v2_realtime is catalogued with its published $0.39/hr rate", () => {
    expect(models.scribe_v2_realtime.cost.perAudioMinute).toBeCloseTo(0.39 / 60, 10);
  });
});

describe("elevenlabs.stt enable_logging (doc audit 2026-08-13)", () => {
  test("enable_logging is a query param, not a form field", () => {
    const v = stt({ model_id: "scribe_v2", file: audio, enable_logging: false });
    expect(Object.keys(v)).toEqual(["model_id", "file"]);
    expect(v.request.url).toBe(`${SPEECH_TO_TEXT_URL}?enable_logging=false`);
    expect(toFormData(v).get("enable_logging")).toBeNull();
    expect(v.toSdk("elevenlabs")).toEqual({ modelId: "scribe_v2", file: audio, enableLogging: false });
  });

  test("omitting enable_logging leaves the URL query-free", () => {
    const v = stt({ model_id: "scribe_v2", file: audio });
    expect(v.request.url).toBe(SPEECH_TO_TEXT_URL);
  });
});

describe("elevenlabs.stt upload size cap (doc audit 2026-08-13)", () => {
  test("a Blob over 5GB is media_too_large; the size is read from the Blob itself", () => {
    const huge = { size: STT_MAX_FILE_BYTES + 1, type: "audio/mpeg" };
    Object.setPrototypeOf(huge, Blob.prototype);
    const r = stt.safe({ model_id: "scribe_v2", file: huge as Blob });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("media_too_large");
      expect(r.errors[0]?.meta?.limit).toBe(STT_MAX_FILE_BYTES);
    }
  });

  test("a normal blob passes", () => {
    expect(stt.safe({ model_id: "scribe_v2", file: audio }).ok).toBe(true);
  });
});
