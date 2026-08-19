import { describe, expect, test } from "bun:test";
import {
  realtimeTranscribeConfig,
  realtimeVoiceContext,
  STT_STREAM_WS_URL,
  TTS_STREAM_WS_URL,
  TTS_STREAM_MAX_BUFFER_CHAR_THRESHOLD,
} from "./realtime";
import { INWORLD_STT_AUDIO_ENCODINGS, INWORLD_STT_STREAM_UNSUPPORTED_ENCODINGS } from "./stt";
import { INWORLD_SAMPLE_RATES_HERTZ } from "./tts";
import { STT_STREAM_MODEL_IDS, STT_SYNC_MODEL_IDS } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeTranscribe = realtimeTranscribeConfig.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const safeContext = realtimeVoiceContext.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// STT — the `transcribeConfig` first frame.
// ---------------------------------------------------------------------------

describe("inworld.realtimeTranscribeConfig happy path", () => {
  test("returns a wire-pure config with hidden toSdk/request", () => {
    const params = {
      modelId: "inworld/inworld-stt-1" as const,
      audioEncoding: "LINEAR16" as const,
      sampleRateHertz: 16000,
      language: "en",
      voiceProfileConfig: { enableVoiceProfile: true, topN: 5 },
    };
    const v = realtimeTranscribeConfig(params);

    expect(Object.keys(v)).toEqual([
      "modelId",
      "audioEncoding",
      "sampleRateHertz",
      "language",
      "voiceProfileConfig",
    ]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    // The socket to open: a WebSocket handshake is an HTTP GET upgrade with
    // no body, so there is no content-type to carry.
    expect(v.request.url).toBe(STT_STREAM_WS_URL);
    expect(v.request.method).toBe("GET");
    expect(v.request.headers).toEqual({});

    // toSdk is the protocol's client frame, not an SDK call shape.
    expect(v.toSdk("inworld")).toEqual({ transcribeConfig: params });
  });

  test("the streaming-only vendor config blocks pass on their own routes", () => {
    const assembly = realtimeTranscribeConfig.safe({
      modelId: "assemblyai/u3-rt-pro",
      audioEncoding: "LINEAR16",
      includeWordTimestamps: true,
      enableSpeakerDiarization: true,
      assemblyaiConfig: {
        minEndOfTurnSilenceWhenConfident: 400,
        maxTurnSilence: 1200,
        vadThreshold: 0.4,
        prompt: "Transcribe medical terminology precisely.",
      },
    });
    expect(assembly.ok).toBe(true);
    if (assembly.ok) expect(assembly.warnings).toEqual([]);

    const soniox = realtimeTranscribeConfig.safe({
      modelId: "soniox/stt-rt-v5",
      audioEncoding: "LINEAR16",
      sonioxConfig: {
        languageHints: ["en", "es"],
        languageHintsStrict: true,
        enableEndpointDetection: true,
        maxEndpointDelayMs: 2000,
        context: { general: { domain: "medicine" }, text: "clinic intake", terms: ["dyspnea"] },
      },
    });
    expect(soniox.ok).toBe(true);
    if (soniox.ok) expect(soniox.warnings).toEqual([]);
  });

  test("unknown model warns; unknown top-level key warns", () => {
    const unknown = realtimeTranscribeConfig.safe({
      modelId: "vendor/brand-new-stt",
      audioEncoding: "LINEAR16",
    });
    expect(unknown.ok).toBe(true);
    if (unknown.ok) expect(unknown.warnings.map((w) => w.code)).toEqual(["unknown_model"]);

    const extra = safeTranscribe({
      modelId: "inworld/inworld-stt-1",
      audioEncoding: "LINEAR16",
      punctuate: true,
    });
    expect(extra.ok).toBe(true);
    if (extra.ok) expect(extra.warnings.map((w) => w.code)).toContain("unknown_param");
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const unchecked = realtimeTranscribeConfig as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      unchecked({ modelId: "inworld/inworld-stt-1", audioEncoding: "FLAC" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("inworld.realtimeTranscribeConfig surface gates", () => {
  test("the compressed encodings are rejected with invalid_enum_value", () => {
    for (const audioEncoding of INWORLD_STT_STREAM_UNSUPPORTED_ENCODINGS) {
      const r = safeTranscribe({ modelId: "inworld/inworld-stt-1", audioEncoding });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("invalid_enum_value");
        expect(r.errors[0]?.path).toEqual(["audioEncoding"]);
        expect(r.errors[0]?.meta?.value).toBe(audioEncoding);
      }
    }
  });

  test("the encodings both doc pages agree on are accepted", () => {
    const supported = INWORLD_STT_AUDIO_ENCODINGS.filter(
      (e) => !(INWORLD_STT_STREAM_UNSUPPORTED_ENCODINGS as readonly string[]).includes(e),
    );
    expect(supported).toEqual(["AUDIO_ENCODING_UNSPECIFIED", "AUTO_DETECT", "LINEAR16"]);
    for (const audioEncoding of supported) {
      expect(safeTranscribe({ modelId: "inworld/inworld-stt-1", audioEncoding }).ok).toBe(true);
    }
  });

  test("a sync-only model is unsupported_capability on the socket", () => {
    const syncOnly = STT_SYNC_MODEL_IDS.filter(
      (id) => !(STT_STREAM_MODEL_IDS as readonly string[]).includes(id),
    );
    expect(syncOnly).toEqual(["groq/whisper-large-v3"]);
    for (const modelId of syncOnly) {
      const r = realtimeTranscribeConfig.safe({ modelId, audioEncoding: "LINEAR16" });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("unsupported_capability");
        expect(r.errors[0]?.path).toEqual(["modelId"]);
        expect(r.errors[0]?.message).toContain("sync endpoint");
      }
    }
  });

  test("every streaming model passes the availability gate", () => {
    for (const modelId of STT_STREAM_MODEL_IDS) {
      expect(realtimeTranscribeConfig.safe({ modelId, audioEncoding: "LINEAR16" }).ok).toBe(true);
    }
  });

  test("assemblyaiConfig.prompt is Universal-3 Pro only", () => {
    const r = realtimeTranscribeConfig.safe({
      modelId: "assemblyai/universal-streaming-english",
      audioEncoding: "LINEAR16",
      assemblyaiConfig: { prompt: "medical" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["assemblyaiConfig", "prompt"]);
      expect(r.errors[0]?.meta?.allowed).toEqual(["assemblyai/u3-rt-pro"]);
    }
  });

  test("a vendor config block on the wrong route is unsupported_param (paths are unprefixed here)", () => {
    const r = safeTranscribe({
      modelId: "soniox/stt-rt-v5",
      audioEncoding: "LINEAR16",
      assemblyaiConfig: { vadThreshold: 0.5 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["assemblyaiConfig"]);
    }
  });

  test("Voice Profile and word timestamps follow the same per-route rules as the sync endpoint", () => {
    const profile = safeTranscribe({
      modelId: "soniox/stt-rt-v5",
      audioEncoding: "LINEAR16",
      voiceProfileConfig: { enableVoiceProfile: true },
    });
    expect(profile.ok).toBe(false);
    if (!profile.ok) expect(profile.errors[0]?.code).toBe("unsupported_capability");

    const timestamps = safeTranscribe({
      modelId: "inworld/inworld-stt-1",
      audioEncoding: "LINEAR16",
      includeWordTimestamps: true,
    });
    expect(timestamps.ok).toBe(false);
    if (!timestamps.ok) expect(timestamps.errors[0]?.path).toEqual(["includeWordTimestamps"]);
  });

  test("sonioxConfig.maxEndpointDelayMs is bounded to [500, 5000]", () => {
    const at = (maxEndpointDelayMs: number): unknown => ({
      modelId: "soniox/stt-rt-v5",
      audioEncoding: "LINEAR16",
      sonioxConfig: { maxEndpointDelayMs },
    });
    expect(safeTranscribe(at(500)).ok).toBe(true);
    expect(safeTranscribe(at(5000)).ok).toBe(true);
    expect(safeTranscribe(at(499)).ok).toBe(false);
    expect(safeTranscribe(at(5001)).ok).toBe(false);
  });

  test("assemblyaiConfig.vadThreshold is bounded to [0.0, 1.0]", () => {
    const at = (vadThreshold: number): unknown => ({
      modelId: "assemblyai/u3-rt-pro",
      audioEncoding: "LINEAR16",
      assemblyaiConfig: { vadThreshold },
    });
    expect(safeTranscribe(at(0)).ok).toBe(true);
    expect(safeTranscribe(at(1)).ok).toBe(true);
    expect(safeTranscribe(at(1.5)).ok).toBe(false);
    expect(safeTranscribe(at(-0.5)).ok).toBe(false);
  });

  test("no cost is estimated: session length is unknowable up front", () => {
    const r = realtimeTranscribeConfig.safe({
      modelId: "inworld/inworld-stt-1",
      audioEncoding: "LINEAR16",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// TTS — the `create` context config.
// ---------------------------------------------------------------------------

describe("inworld.realtimeVoiceContext happy path", () => {
  test("returns a wire-pure config with the { create } frame on toSdk", () => {
    const params = {
      voiceId: "Dennis",
      modelId: "inworld-tts-2" as const,
      audioConfig: { audioEncoding: "LINEAR16" as const, sampleRateHertz: 48000 as const },
      autoMode: true,
      deliveryMode: "BALANCED" as const,
    };
    const v = realtimeVoiceContext(params);

    expect(Object.keys(v)).toEqual(["voiceId", "modelId", "audioConfig", "autoMode", "deliveryMode"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(TTS_STREAM_WS_URL);
    expect(v.request.method).toBe("GET");
    expect(v.request.headers).toEqual({});
    expect(v.toSdk("inworld")).toEqual({ create: params });
  });

  test("every documented create field passes", () => {
    const r = realtimeVoiceContext.safe({
      voiceId: "Sarah",
      modelId: "inworld-tts-2",
      audioConfig: {
        audioEncoding: "OGG_OPUS",
        sampleRateHertz: 24000,
        bitRate: 128000,
        speakingRate: 1.2,
      },
      timestampType: "WORD",
      maxBufferDelayMs: 250,
      bufferCharThreshold: 500,
      applyTextNormalization: "ON",
      autoMode: false,
      timestampTransportStrategy: "ASYNC",
      language: "en-US",
      deliveryMode: "CREATIVE",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown model warns; unknown top-level key warns", () => {
    const unknown = realtimeVoiceContext.safe({ voiceId: "v", modelId: "inworld-tts-9" });
    expect(unknown.ok).toBe(true);
    if (unknown.ok) expect(unknown.warnings.map((w) => w.code)).toEqual(["unknown_model"]);

    const extra = safeContext({ voiceId: "v", modelId: "inworld-tts-2", pitch: 2 });
    expect(extra.ok).toBe(true);
    if (extra.ok) expect(extra.warnings.map((w) => w.code)).toContain("unknown_param");
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const unchecked = realtimeVoiceContext as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      unchecked({ voiceId: "", modelId: "inworld-tts-2" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("inworld.realtimeVoiceContext enums and bounds", () => {
  const at = (extra: Record<string, unknown>): unknown => ({
    voiceId: "Dennis",
    modelId: "inworld-tts-2",
    ...extra,
  });

  test("voiceId and modelId are required and non-empty", () => {
    expect(safeContext({ modelId: "inworld-tts-2" }).ok).toBe(false);
    expect(safeContext({ voiceId: "Dennis" }).ok).toBe(false);
    expect(safeContext({ voiceId: "", modelId: "inworld-tts-2" }).ok).toBe(false);
    expect(safeContext({ voiceId: "Dennis", modelId: "" }).ok).toBe(false);
  });

  test("bufferCharThreshold is capped at 1000", () => {
    expect(safeContext(at({ bufferCharThreshold: 1 })).ok).toBe(true);
    expect(
      safeContext(at({ bufferCharThreshold: TTS_STREAM_MAX_BUFFER_CHAR_THRESHOLD })).ok,
    ).toBe(true);
    const over = safeContext(at({ bufferCharThreshold: TTS_STREAM_MAX_BUFFER_CHAR_THRESHOLD + 1 }));
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.errors[0]?.path).toEqual(["bufferCharThreshold"]);
      expect(over.errors[0]?.message).toContain("at most 1000");
    }
    expect(safeContext(at({ bufferCharThreshold: 0 })).ok).toBe(false);
    expect(safeContext(at({ bufferCharThreshold: 100.5 })).ok).toBe(false);
  });

  test("maxBufferDelayMs is a non-negative integer", () => {
    expect(safeContext(at({ maxBufferDelayMs: 0 })).ok).toBe(true);
    expect(safeContext(at({ maxBufferDelayMs: -1 })).ok).toBe(false);
    expect(safeContext(at({ maxBufferDelayMs: 12.5 })).ok).toBe(false);
  });

  test("temperature keeps the REST range (0, 2]", () => {
    // Reported (not rejected) on inworld-tts-2, where it is documented as
    // ignored — so the range itself is exercised on a 1.5 model.
    const on15 = (temperature: number): unknown => ({
      voiceId: "v",
      modelId: "inworld-tts-1.5-mini",
      temperature,
    });
    expect(safeContext(on15(0.01)).ok).toBe(true);
    expect(safeContext(on15(2)).ok).toBe(true);
    expect(safeContext(on15(0)).ok).toBe(false);
    expect(safeContext(on15(2.1)).ok).toBe(false);
  });

  test("audioConfig reuses the REST bounds: closed sample-rate list, [0.5, 1.5] speakingRate", () => {
    for (const sampleRateHertz of INWORLD_SAMPLE_RATES_HERTZ) {
      expect(safeContext(at({ audioConfig: { sampleRateHertz } })).ok).toBe(true);
    }
    // Inside the "8000-48000" range this page prints, but not a supported rate.
    const gap = safeContext(at({ audioConfig: { sampleRateHertz: 12345 } }));
    expect(gap.ok).toBe(false);
    if (!gap.ok) expect(gap.errors[0]?.path).toEqual(["audioConfig", "sampleRateHertz"]);

    expect(safeContext(at({ audioConfig: { speakingRate: 0.5 } })).ok).toBe(true);
    expect(safeContext(at({ audioConfig: { speakingRate: 1.5 } })).ok).toBe(true);
    expect(safeContext(at({ audioConfig: { speakingRate: 0.4 } })).ok).toBe(false);
    expect(safeContext(at({ audioConfig: { speakingRate: 1.6 } })).ok).toBe(false);
    expect(safeContext(at({ audioConfig: { audioEncoding: "AAC" } })).ok).toBe(false);
  });

  test("every documented enum member is accepted, and only those", () => {
    const presets = {
      timestampType: ["TIMESTAMP_TYPE_UNSPECIFIED", "WORD", "CHARACTER"],
      applyTextNormalization: ["APPLY_TEXT_NORMALIZATION_UNSPECIFIED", "ON", "OFF"],
      timestampTransportStrategy: ["TIMESTAMP_TRANSPORT_STRATEGY_UNSPECIFIED", "SYNC", "ASYNC"],
      deliveryMode: ["DELIVERY_MODE_UNSPECIFIED", "STABLE", "BALANCED", "CREATIVE"],
    } as const;

    for (const [field, values] of Object.entries(presets)) {
      for (const value of values) {
        expect(safeContext(at({ [field]: value })).ok).toBe(true);
      }
      const r = safeContext(at({ [field]: "NOPE" }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.path).toEqual([field]);
    }
  });
});

describe("inworld.realtimeVoiceContext per-model gates (shared with the REST table)", () => {
  test("deliveryMode on a 1.x model is unsupported_param, exactly as on REST", () => {
    for (const modelId of [
      "inworld-tts-1.5-max",
      "inworld-tts-1.5-mini",
      "inworld-tts-1",
      "inworld-tts-1-max",
    ]) {
      const r = realtimeVoiceContext.safe({ voiceId: "v", modelId, deliveryMode: "CREATIVE" });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("unsupported_param");
        expect(r.errors[0]?.path).toEqual(["deliveryMode"]);
      }
    }
  });

  test("temperature on inworld-tts-2 warns (accepted, silently ignored)", () => {
    const r = realtimeVoiceContext.safe({
      voiceId: "v",
      modelId: "inworld-tts-2",
      temperature: 0.8,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toContain("unsupported_param");
      expect(r.warnings.find((w) => w.code === "unsupported_param")?.path).toEqual(["temperature"]);
    }
  });

  test("a deprecated model id still validates, with the deprecation warning", () => {
    const r = realtimeVoiceContext.safe({ voiceId: "v", modelId: "inworld-tts-1.5-mini" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
  });

  test("constraintsFor is the REST table, not a copy", () => {
    expect(realtimeVoiceContext.constraintsFor("inworld-tts-2").at(0)?.deny?.temperature?.source)
      .toContain("docs.inworld.ai");
    expect(realtimeVoiceContext.constraintsFor("inworld-tts-1").at(0)?.deny?.deliveryMode?.reason)
      .toContain("inworld-tts-2");
  });

  test("no cost is estimated: the text arrives later, on send_text frames", () => {
    const r = realtimeVoiceContext.safe({ voiceId: "v", modelId: "inworld-tts-2" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate).toEqual({});
  });
});
