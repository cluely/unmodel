import { describe, expect, test } from "bun:test";
import {
  speechToTextRealtime,
  speechToTextRealtimeUrl,
  SPEECH_TO_TEXT_REALTIME_WS_URL,
  REALTIME_STT_AUDIO_FORMATS,
  REALTIME_STT_KEYTERMS_MAX,
  REALTIME_STT_KEYTERM_MAX_CHARACTERS,
} from "./speech-to-text-realtime";
import { models, REALTIME_STT_MODEL_IDS, STT_MODEL_IDS } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = speechToTextRealtime.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("elevenlabs.speechToTextRealtime happy path", () => {
  test("returns the validated session config and builds the socket url", () => {
    const params = {
      model_id: "scribe_v2_realtime" as const,
      audio_format: "pcm_16000" as const,
      commit_strategy: "vad" as const,
      vad_silence_threshold_secs: 0.8,
      include_timestamps: true,
      keyterms: ["Cartesia", "unmodel"],
    };
    const session = speechToTextRealtime(params);
    expect(session).toEqual(params);

    const url = speechToTextRealtimeUrl(session);
    expect(url.startsWith(`${SPEECH_TO_TEXT_REALTIME_WS_URL}?`)).toBe(true);
    const query = new URL(url.replace("wss://", "https://")).searchParams;
    expect(query.get("model_id")).toBe("scribe_v2_realtime");
    expect(query.get("audio_format")).toBe("pcm_16000");
    expect(query.get("commit_strategy")).toBe("vad");
    expect(query.get("include_timestamps")).toBe("true");
    // Repeated list params, one entry per element.
    expect(query.getAll("keyterms")).toEqual(["Cartesia", "unmodel"]);
    // Auth is never serialized by unmodel.
    expect(query.get("token")).toBeNull();
  });

  test("a list entity_detection is repeated; a scalar one is set once", () => {
    const list = speechToTextRealtimeUrl(
      speechToTextRealtime({
        model_id: "scribe_v2_realtime",
        entity_detection: ["pii", "offensive_language"],
      }),
    );
    expect(new URL(list.replace("wss://", "https://")).searchParams.getAll("entity_detection")).toEqual([
      "pii",
      "offensive_language",
    ]);
    const scalar = speechToTextRealtimeUrl(
      speechToTextRealtime({ model_id: "scribe_v2_realtime", entity_detection: "all" }),
    );
    expect(new URL(scalar.replace("wss://", "https://")).searchParams.getAll("entity_detection")).toEqual(
      ["all"],
    );
  });

  test("every realtime model id validates clean and carries realtime pricing", () => {
    expect(REALTIME_STT_MODEL_IDS).toEqual(["scribe_v2_realtime"]);
    for (const id of REALTIME_STT_MODEL_IDS) {
      const r = speechToTextRealtime.safe({ model_id: id });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
    // $0.39 per hour → per-minute rate, distinct from batch Scribe's $0.22/h.
    const realtime = models.scribe_v2_realtime.cost?.perAudioMinute;
    expect(realtime).toBeCloseTo(0.39 / 60, 10);
    expect(realtime).not.toBe(models.scribe_v2.cost?.perAudioMinute);
  });

  test("no cost is estimated — session length is unknowable at connect time", () => {
    const r = speechToTextRealtime.safe(
      { model_id: "scribe_v2_realtime" },
      { maxCostUSD: 0.000001 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("an unknown model warns; an unknown top-level key warns", () => {
    const r = safeUnchecked({ model_id: "scribe_v3_realtime", brand_new_param: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const codes = r.warnings.map((w) => w.code);
      expect(codes).toContain("unknown_model");
      expect(codes).toContain("unknown_param");
    }
  });
});

describe("elevenlabs.speechToTextRealtime schema enforcement", () => {
  test("audio_format is a closed enum", () => {
    for (const format of REALTIME_STT_AUDIO_FORMATS) {
      expect(speechToTextRealtime.safe({ model_id: "scribe_v2_realtime", audio_format: format }).ok).toBe(
        true,
      );
    }
    const r = safeUnchecked({ model_id: "scribe_v2_realtime", audio_format: "pcm_11025" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["audio_format"]);
    }
  });

  test("keyterms are capped at the documented 50", () => {
    const fifty = Array.from({ length: REALTIME_STT_KEYTERMS_MAX }, (_, i) => `term${i}`);
    expect(speechToTextRealtime.safe({ model_id: "scribe_v2_realtime", keyterms: fifty }).ok).toBe(true);
    const r = safeUnchecked({ model_id: "scribe_v2_realtime", keyterms: [...fifty, "one-too-many"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["keyterms"]);
  });

  // "Batch supports up to 1000 keyterms (50 characters each), while realtime
  // supports up to 50 keyterms (20 characters each)."
  // https://elevenlabs.io/docs/capabilities/speech-to-text
  test("each keyterm is capped at the documented 20 characters", () => {
    expect(REALTIME_STT_KEYTERM_MAX_CHARACTERS).toBe(20);

    const r = speechToTextRealtime.safe({
      model_id: "scribe_v2_realtime",
      keyterms: ["a".repeat(500)],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["keyterms", 0]);
      expect(issue?.meta?.limit).toBe(REALTIME_STT_KEYTERM_MAX_CHARACTERS);
      expect(issue?.meta?.actual).toBe(500);
      expect(issue?.meta?.source).toBe("https://elevenlabs.io/docs/capabilities/speech-to-text");
      // The offending term is named, not just its index.
      expect(issue?.message).toContain("500 characters");
    }
  });

  test("the boundary is inclusive: 20 passes, 21 does not", () => {
    expect(
      speechToTextRealtime.safe({
        model_id: "scribe_v2_realtime",
        keyterms: ["a".repeat(REALTIME_STT_KEYTERM_MAX_CHARACTERS)],
      }).ok,
    ).toBe(true);
    expect(
      speechToTextRealtime.safe({
        model_id: "scribe_v2_realtime",
        keyterms: ["a".repeat(REALTIME_STT_KEYTERM_MAX_CHARACTERS + 1)],
      }).ok,
    ).toBe(false);
  });

  test("every over-long keyterm is reported, at its own index", () => {
    const r = speechToTextRealtime.safe({
      model_id: "scribe_v2_realtime",
      keyterms: ["ok", "b".repeat(21), "also ok", "c".repeat(64)],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.filter((e) => e.code === "invalid_shape").map((e) => e.path)).toEqual([
        ["keyterms", 1],
        ["keyterms", 3],
      ]);
    }
  });

  test("commit_strategy is manual or vad; ms durations must be integers", () => {
    const bad = safeUnchecked({ model_id: "scribe_v2_realtime", commit_strategy: "auto" });
    expect(bad.ok).toBe(false);
    const fractional = safeUnchecked({
      model_id: "scribe_v2_realtime",
      min_speech_duration_ms: 120.5,
    });
    expect(fractional.ok).toBe(false);
    if (!fractional.ok) expect(fractional.errors[0]?.path).toEqual(["min_speech_duration_ms"]);
  });

  test("model_id is required", () => {
    const r = safeUnchecked({ audio_format: "pcm_16000" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["model_id"]);
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const unchecked = speechToTextRealtime as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      unchecked({ model_id: "scribe_v2_realtime", audio_format: "flac" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("elevenlabs.speechToTextRealtime checks", () => {
  test("the batch Scribe ids are rejected here (inverse of the batch gate)", () => {
    for (const id of STT_MODEL_IDS) {
      const r = safeUnchecked({ model_id: id });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("unsupported_capability");
        expect(r.errors[0]?.path).toEqual(["model_id"]);
        expect(String(r.errors[0]?.message)).toContain("POST /v1/speech-to-text");
      }
    }
  });

  test("a TTS id is rejected too", () => {
    const r = safeUnchecked({ model_id: "eleven_flash_v2_5" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("unsupported_capability");
  });

  test("filter_background_audio cannot be combined with include_timestamps", () => {
    const r = safeUnchecked({
      model_id: "scribe_v2_realtime",
      filter_background_audio: true,
      include_timestamps: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["filter_background_audio"]);
    }
    // Either one on its own is fine.
    expect(
      speechToTextRealtime.safe({ model_id: "scribe_v2_realtime", filter_background_audio: true }).ok,
    ).toBe(true);
  });

  test("vad_silence_threshold_secs warns under a manual commit strategy", () => {
    const r = speechToTextRealtime.safe({
      model_id: "scribe_v2_realtime",
      commit_strategy: "manual",
      vad_silence_threshold_secs: 0.5,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const issue = r.warnings.find((w) => w.code === "unsupported_param");
      expect(issue?.path).toEqual(["vad_silence_threshold_secs"]);
      expect(issue?.meta?.ignored).toBe(true);
    }
    const vad = speechToTextRealtime.safe({
      model_id: "scribe_v2_realtime",
      commit_strategy: "vad",
      vad_silence_threshold_secs: 0.5,
    });
    expect(vad.ok).toBe(true);
    if (vad.ok) expect(vad.warnings).toEqual([]);
  });
});
