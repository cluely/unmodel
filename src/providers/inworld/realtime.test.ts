import { describe, expect, test } from "bun:test";
import {
  realtimeTranscribeConfig,
  realtimeVoiceContext,
  STT_STREAM_WS_URL,
  STT_WEBSOCKET_DOCS,
  TTS_STREAM_WS_URL,
  TTS_STREAM_MAX_BUFFER_CHAR_THRESHOLD,
  TTS_STREAM_MAX_TEXT_CHARACTERS,
} from "./realtime";
import { stt, INWORLD_STT_AUDIO_ENCODINGS, INWORLD_STT_STREAM_UNSUPPORTED_ENCODINGS } from "./stt";
import { INWORLD_SAMPLE_RATES_HERTZ } from "./tts";
import { sttModels, STT_STREAM_MODEL_IDS, STT_SYNC_MODEL_IDS } from "./models";
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
      (e) =>
        e !== "AUDIO_ENCODING_UNSPECIFIED" &&
        !(INWORLD_STT_STREAM_UNSUPPORTED_ENCODINGS as readonly string[]).includes(e),
    );
    expect(supported).toEqual(["AUTO_DETECT", "LINEAR16"]);
    for (const audioEncoding of supported) {
      expect(safeTranscribe({ modelId: "inworld/inworld-stt-1", audioEncoding }).ok).toBe(true);
    }
  });

  test("the zero-value encoding is refused (\"Will return an error\"), naming the socket's encodings", () => {
    for (const modelId of ["inworld/inworld-stt-1", "assemblyai/u3-rt-pro", "soniox/stt-rt-v5"]) {
      const r = safeTranscribe({ modelId, audioEncoding: "AUDIO_ENCODING_UNSPECIFIED" });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0]?.code).toBe("invalid_enum_value");
        expect(r.errors[0]?.path).toEqual(["audioEncoding"]);
        expect(r.errors[0]?.meta?.allowed).toEqual(["AUTO_DETECT", "LINEAR16"]);
        expect(r.errors[0]?.meta?.source).toBe(STT_WEBSOCKET_DOCS);
        // The LINEAR16-only vendor warning does not stack on top.
        expect(r.warnings).toEqual([]);
      }
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

  test("assemblyai/universal-3-5-pro is a catalogued, WebSocket-only, unpriced route", () => {
    const r = realtimeTranscribeConfig.safe({
      modelId: "assemblyai/universal-3-5-pro",
      audioEncoding: "LINEAR16",
      includeWordTimestamps: true,
      enableSpeakerDiarization: true,
      assemblyaiConfig: { maxTurnSilence: 1200, vadThreshold: 0.4 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
    expect(sttModels["assemblyai/universal-3-5-pro"].family).toBe("assemblyai");
    // The third-party per-hour column's tier is unstated — no cost, no estimate.
    expect("cost" in sttModels["assemblyai/universal-3-5-pro"]).toBe(false);

    const sync = stt.safe({
      transcribeConfig: { modelId: "assemblyai/universal-3-5-pro", audioEncoding: "LINEAR16" },
      audioData: { content: "AAAA" },
    });
    expect(sync.ok).toBe(false);
    if (!sync.ok) expect(sync.errors[0]?.code).toBe("unsupported_capability");
  });

  test("a non-LINEAR16 encoding on the AssemblyAI / Soniox routes warns", () => {
    for (const modelId of ["assemblyai/universal-3-5-pro", "soniox/stt-rt-v4"]) {
      const r = realtimeTranscribeConfig.safe({ modelId, audioEncoding: "AUTO_DETECT" });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const warning = r.warnings.find((w) => w.path.join(".") === "audioEncoding");
        expect(warning?.code).toBe("invalid_enum_value");
        expect(warning?.meta?.expected).toBe("LINEAR16");
      }
    }
    // inworld-stt-1 is not under that vendor note.
    const own = realtimeTranscribeConfig.safe({ modelId: "inworld/inworld-stt-1", audioEncoding: "AUTO_DETECT" });
    expect(own.ok).toBe(true);
    if (own.ok) expect(own.warnings).toEqual([]);
  });

  test("every streaming model passes the availability gate", () => {
    for (const modelId of STT_STREAM_MODEL_IDS) {
      expect(realtimeTranscribeConfig.safe({ modelId, audioEncoding: "LINEAR16" }).ok).toBe(true);
    }
  });

  test("assemblyaiConfig.prompt is refused off the Universal-3 Pro streaming line", () => {
    const r = realtimeTranscribeConfig.safe({
      modelId: "assemblyai/universal-streaming-english",
      audioEncoding: "LINEAR16",
      assemblyaiConfig: { prompt: "medical" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["assemblyaiConfig", "prompt"]);
      expect(r.errors[0]?.meta?.allowed).toEqual(["assemblyai/u3-rt-pro", "assemblyai/universal-3-5-pro"]);
    }
  });

  test("assemblyaiConfig.prompt is clean on u3-rt-pro", () => {
    const r = realtimeTranscribeConfig.safe({
      modelId: "assemblyai/u3-rt-pro",
      audioEncoding: "LINEAR16",
      assemblyaiConfig: { prompt: "Names: Guilherme" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("assemblyaiConfig.prompt on universal-3-5-pro passes with one warning (the doc pages disagree)", () => {
    // Inworld's table says "Universal-3 Pro Streaming only"; its own Realtime
    // AssemblyAI example sends a prompt to this model.
    const r = realtimeTranscribeConfig.safe({
      modelId: "assemblyai/universal-3-5-pro",
      audioEncoding: "LINEAR16",
      assemblyaiConfig: { prompt: "Names: Guilherme" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]?.code).toBe("unsupported_param");
      expect(r.warnings[0]?.path).toEqual(["assemblyaiConfig", "prompt"]);
      expect(r.warnings[0]?.meta?.allowed).toEqual(["assemblyai/u3-rt-pro", "assemblyai/universal-3-5-pro"]);
      expect(r.warnings[0]?.meta?.source).toContain("docs.inworld.ai/stt/third-party");
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

  test("Voice Profile, word timestamps and diarization pass on every streaming route", () => {
    const profile = realtimeTranscribeConfig.safe({
      modelId: "soniox/stt-rt-v5",
      audioEncoding: "LINEAR16",
      voiceProfileConfig: { enableVoiceProfile: true },
    });
    expect(profile.ok).toBe(true);
    if (profile.ok) expect(profile.warnings).toEqual([]);

    // Diarization is "Experimental for `inworld/inworld-stt-1`" on the socket — served, not refused.
    const timestamps = realtimeTranscribeConfig.safe({
      modelId: "inworld/inworld-stt-1",
      audioEncoding: "LINEAR16",
      includeWordTimestamps: true,
      enableSpeakerDiarization: true,
    });
    expect(timestamps.ok).toBe(true);
    if (timestamps.ok) expect(timestamps.warnings).toEqual([]);
  });

  test("inworldSttV1Config.maxTurnSilence is 20–5000 ms", () => {
    function at(maxTurnSilence: number): ValidateResult<Record<string, unknown>> {
      return safeTranscribe({
        modelId: "inworld/inworld-stt-1",
        audioEncoding: "LINEAR16",
        inworldSttV1Config: { minEndOfTurnSilenceWhenConfident: 200, maxTurnSilence },
      });
    }
    expect(at(20).ok).toBe(true);
    expect(at(5000).ok).toBe(true);
    expect(at(19).ok).toBe(false);
    expect(at(5001).ok).toBe(false);
  });

  test("the sync-only container encodings are refused on the socket", () => {
    for (const audioEncoding of ["MP4", "MXF", "WEBM"]) {
      const r = safeTranscribe({ modelId: "inworld/inworld-stt-1", audioEncoding });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
    }
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

  test("bufferCharThreshold takes 0–2000 (0 or omission selects 1000)", () => {
    expect(TTS_STREAM_MAX_BUFFER_CHAR_THRESHOLD).toBe(2000);
    expect(safeContext(at({ bufferCharThreshold: 0 })).ok).toBe(true);
    expect(safeContext(at({ bufferCharThreshold: 1500 })).ok).toBe(true);
    expect(
      safeContext(at({ bufferCharThreshold: TTS_STREAM_MAX_BUFFER_CHAR_THRESHOLD })).ok,
    ).toBe(true);
    const over = safeContext(at({ bufferCharThreshold: TTS_STREAM_MAX_BUFFER_CHAR_THRESHOLD + 1 }));
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.errors[0]?.path).toEqual(["bufferCharThreshold"]);
      expect(over.errors[0]?.message).toContain("at most 2000");
    }
    expect(safeContext(at({ bufferCharThreshold: -1 })).ok).toBe(false);
    expect(safeContext(at({ bufferCharThreshold: 100.5 })).ok).toBe(false);
  });

  test("send_text frames carry up to 2,000 UTF-16 code units", () => {
    expect(TTS_STREAM_MAX_TEXT_CHARACTERS).toBe(2000);
  });

  test("maxBufferDelayMs is a non-negative integer", () => {
    expect(safeContext(at({ maxBufferDelayMs: 0 })).ok).toBe(true);
    expect(safeContext(at({ maxBufferDelayMs: -1 })).ok).toBe(false);
    expect(safeContext(at({ maxBufferDelayMs: 12.5 })).ok).toBe(false);
  });

  test("temperature keeps the REST range [0, 2] (0 selects the default)", () => {
    // Reported (not rejected) on inworld-tts-2, where it is documented as
    // ignored — so the range itself is exercised on a 1.5 model.
    const on15 = (temperature: number): unknown => ({
      voiceId: "v",
      modelId: "inworld-tts-1.5-mini",
      temperature,
    });
    // "If 0 is provided, the default value will be used."
    expect(safeContext(on15(0)).ok).toBe(true);
    expect(safeContext(on15(0.01)).ok).toBe(true);
    expect(safeContext(on15(2)).ok).toBe(true);
    expect(safeContext(on15(-0.1)).ok).toBe(false);
    expect(safeContext(on15(2.1)).ok).toBe(false);
  });

  test("audioConfig reuses the REST bounds: [8000, 48000] sample rate, [0.5, 1.5] speakingRate", () => {
    for (const sampleRateHertz of [...INWORLD_SAMPLE_RATES_HERTZ, 12345]) {
      expect(safeContext(at({ audioConfig: { sampleRateHertz } })).ok).toBe(true);
    }
    const over = safeContext(at({ audioConfig: { sampleRateHertz: 96000 } }));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors[0]?.path).toEqual(["audioConfig", "sampleRateHertz"]);

    expect(safeContext(at({ audioConfig: { speakingRate: 0.5 } })).ok).toBe(true);
    expect(safeContext(at({ audioConfig: { speakingRate: 1.5 } })).ok).toBe(true);
    expect(safeContext(at({ audioConfig: { speakingRate: 0.4 } })).ok).toBe(false);
    expect(safeContext(at({ audioConfig: { speakingRate: 1.6 } })).ok).toBe(false);
    expect(safeContext(at({ audioConfig: { audioEncoding: "AAC" } })).ok).toBe(false);
  });

  test("the socket's encoding enum also takes the zero value", () => {
    const r = realtimeVoiceContext.safe({
      voiceId: "v",
      modelId: "inworld-tts-2",
      audioConfig: { audioEncoding: "AUDIO_ENCODING_UNSPECIFIED" },
    });
    expect(r.ok).toBe(true);
  });

  test("FLAC is refused on the socket: its enum, unlike REST's, does not list it", () => {
    const r = safeContext(at({ audioConfig: { audioEncoding: "FLAC" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["audioConfig", "audioEncoding"]);
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

    // `audioConfig.audioEncoding`, nested: the socket page's eight members.
    const encodings = [
      "AUDIO_ENCODING_UNSPECIFIED",
      "LINEAR16",
      "MP3",
      "OGG_OPUS",
      "ALAW",
      "MULAW",
      "PCM",
      "WAV",
    ] as const;
    for (const audioEncoding of encodings) {
      expect(safeContext(at({ audioConfig: { audioEncoding } })).ok).toBe(true);
    }
    const r = safeContext(at({ audioConfig: { audioEncoding: "NOPE" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["audioConfig", "audioEncoding"]);
  });
});

describe("inworld.realtimeVoiceContext per-model gates (shared with the REST table)", () => {
  test("deliveryMode on a 1.x model warns (ignored there), exactly as on REST", () => {
    for (const modelId of [
      "inworld-tts-1.5-max",
      "inworld-tts-1.5-mini",
      "inworld-tts-1",
      "inworld-tts-1-max",
    ]) {
      const r = realtimeVoiceContext.safe({ voiceId: "v", modelId, deliveryMode: "CREATIVE" });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const warning = r.warnings.find((w) => w.code === "unsupported_param");
        expect(warning?.path).toEqual(["deliveryMode"]);
        expect(warning?.meta?.ignored).toBe(true);
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
