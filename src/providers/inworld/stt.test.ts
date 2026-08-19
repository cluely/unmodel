import { describe, expect, test } from "bun:test";
import {
  transcribe,
  decodedBase64Bytes,
  sttVendorOf,
  INWORLD_STT_AUDIO_ENCODINGS,
  STT_MAX_AUDIO_BYTES,
  STT_TRANSCRIBE_URL,
} from "./stt";
import { sttModels, STT_1_USD_PER_MINUTE, STT_STREAM_MODEL_IDS, STT_SYNC_MODEL_IDS } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ModelInfo } from "../../core/catalog-types";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = transcribe.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

/**
 * An unpadded base64 payload that decodes to exactly `bytes` bytes: 4 chars
 * carry 3 bytes, and the validator reads `floor(len * 3 / 4)`, so the shortest
 * length that rounds to N is `ceil(N * 4 / 3)`.
 */
const base64OfBytes = (bytes: number): string => "A".repeat(Math.ceil((bytes * 4) / 3));

const AUDIO = { content: "AAAA" };

describe("inworld.transcribe happy path", () => {
  test("returns a wire-pure body with hidden toSdk/request", () => {
    const params = {
      transcribeConfig: {
        modelId: "inworld/inworld-stt-1" as const,
        audioEncoding: "LINEAR16" as const,
        language: "en-US",
        sampleRateHertz: 16000,
        numberOfChannels: 1,
      },
      audioData: { content: "AAAA" },
    };
    const v = transcribe(params);

    expect(Object.keys(v)).toEqual(["transcribeConfig", "audioData"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(STT_TRANSCRIBE_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    // No official JS SDK for the STT API — toSdk is the identity.
    expect(v.toSdk("inworld")).toEqual(params);
  });

  test("every documented optional field passes on the first-party model", () => {
    const r = transcribe.safe({
      transcribeConfig: {
        modelId: "inworld/inworld-stt-1",
        audioEncoding: "AUTO_DETECT",
        language: "en",
        sampleRateHertz: 24000,
        numberOfChannels: 2,
        inactivityTimeoutSeconds: 30,
        endOfTurnConfidenceThreshold: 0.7,
        prompts: ["Inworld", "Claude Code"],
        voiceProfileConfig: { enableVoiceProfile: true, topN: 5 },
        inworldSttV1Config: { minEndOfTurnSilenceWhenConfident: 400, vadThreshold: 0.4 },
      },
      audioData: AUDIO,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("the Groq route passes with its own config block", () => {
    const r = transcribe.safe({
      transcribeConfig: {
        modelId: "groq/whisper-large-v3",
        audioEncoding: "MP3",
        groqConfig: { temperature: 0.2 },
      },
      audioData: AUDIO,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("every documented audioEncoding is accepted", () => {
    for (const audioEncoding of INWORLD_STT_AUDIO_ENCODINGS) {
      const r = safeUnchecked({
        transcribeConfig: { modelId: "inworld/inworld-stt-1", audioEncoding },
        audioData: AUDIO,
      });
      expect(r.ok).toBe(true);
    }
  });

  test("unknown model warns and skips the model-dependent gates", () => {
    const r = transcribe.safe({
      transcribeConfig: { modelId: "inworld/inworld-stt-9", audioEncoding: "LINEAR16" },
      audioData: AUDIO,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("unknown top-level key warns", () => {
    const r = safeUnchecked({
      transcribeConfig: { modelId: "inworld/inworld-stt-1", audioEncoding: "LINEAR16" },
      audioData: AUDIO,
      diarize: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("unknown_param");
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const unchecked = transcribe as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      unchecked({
        transcribeConfig: { modelId: "inworld/inworld-stt-1", audioEncoding: "WAV" },
        audioData: AUDIO,
      });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("inworld.transcribe schema bounds (every documented min/max)", () => {
  const config = (extra: Record<string, unknown>): unknown => ({
    transcribeConfig: { modelId: "inworld/inworld-stt-1", audioEncoding: "LINEAR16", ...extra },
    audioData: AUDIO,
  });

  test("modelId must be {provider}/{model-name}", () => {
    const r = safeUnchecked({
      transcribeConfig: { modelId: "inworld-stt-1", audioEncoding: "LINEAR16" },
      audioData: AUDIO,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["transcribeConfig", "modelId"]);
    }
  });

  test("language must be ISO 639 or BCP-47", () => {
    for (const language of ["en", "ja", "en-US", "zh-Hans-CN"]) {
      expect(safeUnchecked(config({ language })).ok).toBe(true);
    }
    const r = safeUnchecked(config({ language: "english (US)" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["transcribeConfig", "language"]);
  });

  test("endOfTurnConfidenceThreshold is bounded to [0.0, 1.0]", () => {
    expect(safeUnchecked(config({ endOfTurnConfidenceThreshold: 0 })).ok).toBe(true);
    expect(safeUnchecked(config({ endOfTurnConfidenceThreshold: 1 })).ok).toBe(true);
    expect(safeUnchecked(config({ endOfTurnConfidenceThreshold: -0.1 })).ok).toBe(false);
    expect(safeUnchecked(config({ endOfTurnConfidenceThreshold: 1.1 })).ok).toBe(false);
  });

  test("inworldSttV1Config.vadThreshold is bounded to [0.0, 1.0] (0 disables)", () => {
    expect(safeUnchecked(config({ inworldSttV1Config: { vadThreshold: 0 } })).ok).toBe(true);
    expect(safeUnchecked(config({ inworldSttV1Config: { vadThreshold: 1 } })).ok).toBe(true);
    const r = safeUnchecked(config({ inworldSttV1Config: { vadThreshold: 1.01 } }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.path).toEqual(["transcribeConfig", "inworldSttV1Config", "vadThreshold"]);
    }
  });

  test("groqConfig.temperature is bounded to [0.0, 1.0]", () => {
    const groq = (temperature: number): unknown => ({
      transcribeConfig: {
        modelId: "groq/whisper-large-v3",
        audioEncoding: "MP3",
        groqConfig: { temperature },
      },
      audioData: AUDIO,
    });
    expect(safeUnchecked(groq(0)).ok).toBe(true);
    expect(safeUnchecked(groq(1)).ok).toBe(true);
    expect(safeUnchecked(groq(1.5)).ok).toBe(false);
    expect(safeUnchecked(groq(-1)).ok).toBe(false);
  });

  test("sampleRateHertz / numberOfChannels / inactivityTimeoutSeconds are positive integers", () => {
    expect(safeUnchecked(config({ sampleRateHertz: 0 })).ok).toBe(false);
    expect(safeUnchecked(config({ sampleRateHertz: 16000.5 })).ok).toBe(false);
    expect(safeUnchecked(config({ numberOfChannels: 0 })).ok).toBe(false);
    expect(safeUnchecked(config({ inactivityTimeoutSeconds: -1 })).ok).toBe(false);
    // No range is documented for STT sample rates, so 48 kHz is fine here even
    // though the TTS side publishes a closed list.
    expect(safeUnchecked(config({ sampleRateHertz: 48000 })).ok).toBe(true);
  });

  test("voiceProfileConfig requires enableVoiceProfile and a positive topN", () => {
    const missing = safeUnchecked(config({ voiceProfileConfig: { topN: 3 } }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.errors[0]?.path).toEqual([
        "transcribeConfig",
        "voiceProfileConfig",
        "enableVoiceProfile",
      ]);
    }
    expect(
      safeUnchecked(config({ voiceProfileConfig: { enableVoiceProfile: true, topN: 0 } })).ok,
    ).toBe(false);
  });

  test("audioData.content must not be empty", () => {
    const r = safeUnchecked({
      transcribeConfig: { modelId: "inworld/inworld-stt-1", audioEncoding: "LINEAR16" },
      audioData: { content: "" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["audioData", "content"]);
  });
});

describe("inworld.transcribe router gates (doc audit 2026-08-13)", () => {
  test("a WebSocket-only model is unsupported_capability on the sync endpoint", () => {
    for (const modelId of STT_STREAM_MODEL_IDS.filter((id) => !STT_SYNC_MODEL_IDS.includes(id as "groq/whisper-large-v3"))) {
      const r = transcribe.safe({
        transcribeConfig: { modelId, audioEncoding: "LINEAR16" },
        audioData: AUDIO,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("unsupported_capability");
        expect(r.errors[0]?.path).toEqual(["transcribeConfig", "modelId"]);
        expect(r.errors[0]?.meta?.allowed).toEqual([...STT_SYNC_MODEL_IDS]);
      }
    }
  });

  test("both sync models pass the availability gate", () => {
    for (const modelId of STT_SYNC_MODEL_IDS) {
      const r = transcribe.safe({
        transcribeConfig: { modelId, audioEncoding: "LINEAR16" },
        audioData: AUDIO,
      });
      expect(r.ok).toBe(true);
    }
  });

  test("a provider config block for another vendor is unsupported_param", () => {
    const r = safeUnchecked({
      transcribeConfig: {
        modelId: "inworld/inworld-stt-1",
        audioEncoding: "LINEAR16",
        groqConfig: { temperature: 0.5 },
      },
      audioData: AUDIO,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["transcribeConfig", "groqConfig"]);
      expect(r.errors[0]?.message).toContain("routed to inworld");
    }
  });

  test("two provider config blocks at once is invalid_shape (mutually exclusive)", () => {
    const r = safeUnchecked({
      transcribeConfig: {
        modelId: "inworld/inworld-stt-1",
        audioEncoding: "LINEAR16",
        inworldSttV1Config: { vadThreshold: 0.5 },
        groqConfig: { temperature: 0.5 },
      },
      audioData: AUDIO,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const codes = r.errors.map((e) => e.code);
      expect(codes).toContain("invalid_shape");
      expect(r.errors.find((e) => e.code === "invalid_shape")?.message).toContain(
        "mutually exclusive",
      );
    }
  });

  test("Voice Profile on a non-Inworld route is unsupported_capability", () => {
    const r = safeUnchecked({
      transcribeConfig: {
        modelId: "groq/whisper-large-v3",
        audioEncoding: "MP3",
        voiceProfileConfig: { enableVoiceProfile: true },
      },
      audioData: AUDIO,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.path).toEqual([
        "transcribeConfig",
        "voiceProfileConfig",
        "enableVoiceProfile",
      ]);
    }
  });

  test("enableVoiceProfile: false on another route is not reported", () => {
    const r = safeUnchecked({
      transcribeConfig: {
        modelId: "groq/whisper-large-v3",
        audioEncoding: "MP3",
        voiceProfileConfig: { enableVoiceProfile: false },
      },
      audioData: AUDIO,
    });
    expect(r.ok).toBe(true);
  });

  test("word timestamps / diarization are not implemented on the Inworld route", () => {
    for (const key of ["includeWordTimestamps", "enableSpeakerDiarization"]) {
      const r = safeUnchecked({
        transcribeConfig: {
          modelId: "inworld/inworld-stt-1",
          audioEncoding: "LINEAR16",
          [key]: true,
        },
        audioData: AUDIO,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("unsupported_capability");
        expect(r.errors[0]?.path).toEqual(["transcribeConfig", key]);
      }
    }
  });

  test("Groq is not named on either side of the timestamps sentence, so it stays permissive", () => {
    const r = safeUnchecked({
      transcribeConfig: {
        modelId: "groq/whisper-large-v3",
        audioEncoding: "MP3",
        includeWordTimestamps: true,
      },
      audioData: AUDIO,
    });
    expect(r.ok).toBe(true);
  });

  test("prompts reject the four characters the docs name", () => {
    for (const prompt of ["Inworld #1", "a/b", "me@example.com", "x|y"]) {
      const r = safeUnchecked({
        transcribeConfig: {
          modelId: "inworld/inworld-stt-1",
          audioEncoding: "LINEAR16",
          prompts: ["fine", prompt],
        },
        audioData: AUDIO,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("invalid_shape");
        expect(r.errors[0]?.path).toEqual(["transcribeConfig", "prompts", 1]);
      }
    }
  });

  test("prompts with letters, digits, spaces and basic punctuation pass", () => {
    const r = safeUnchecked({
      transcribeConfig: {
        modelId: "inworld/inworld-stt-1",
        audioEncoding: "LINEAR16",
        prompts: ["Dr. Grace Hopper", "COBOL, 1959!"],
      },
      audioData: AUDIO,
    });
    expect(r.ok).toBe(true);
  });
});

describe("inworld.transcribe audio size cap (~16 MB)", () => {
  test("decodedBase64Bytes measures the decoded payload, not the base64 text", () => {
    expect(decodedBase64Bytes("AAAA")).toBe(3);
    expect(decodedBase64Bytes("AAA=")).toBe(2);
    expect(decodedBase64Bytes("AA==")).toBe(1);
    expect(decodedBase64Bytes(base64OfBytes(3000))).toBe(3000);
    // Not base64 at all: unmeasurable rather than wrong.
    expect(decodedBase64Bytes("https://example.com/audio.wav")).toBeUndefined();
    expect(decodedBase64Bytes("   ")).toBeUndefined();
  });

  test("audio over the cap is media_too_large with byte meta", () => {
    const content = base64OfBytes(STT_MAX_AUDIO_BYTES + 3);
    const r = safeUnchecked({
      transcribeConfig: { modelId: "inworld/inworld-stt-1", audioEncoding: "LINEAR16" },
      audioData: { content },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "media_too_large");
      expect(issue?.path).toEqual(["audioData", "content"]);
      expect(issue?.meta?.bytes).toBe(STT_MAX_AUDIO_BYTES + 3);
      expect(issue?.meta?.limit).toBe(STT_MAX_AUDIO_BYTES);
    }
  });

  test("audio at exactly the cap passes the size gate", () => {
    const content = base64OfBytes(STT_MAX_AUDIO_BYTES);
    const r = safeUnchecked({
      transcribeConfig: { modelId: "inworld/inworld-stt-1", audioEncoding: "MP3" },
      audioData: { content },
    });
    expect(r.ok).toBe(true);
  });
});

describe("inworld.transcribe cost estimation ($0.15/hr On-Demand)", () => {
  test("LINEAR16 duration comes from the bytes themselves", () => {
    // 128,000 base64 chars = 96,000 bytes = 3s at 16 kHz / mono / 16-bit.
    const r = transcribe.safe({
      transcribeConfig: {
        modelId: "inworld/inworld-stt-1",
        audioEncoding: "LINEAR16",
        sampleRateHertz: 16000,
        numberOfChannels: 1,
      },
      audioData: { content: base64OfBytes(96000) },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo((3 / 60) * STT_1_USD_PER_MINUTE, 12);
  });

  test("the sample rate and channel count are honoured (defaults are 16 kHz mono)", () => {
    const stereo = transcribe.safe({
      transcribeConfig: {
        modelId: "inworld/inworld-stt-1",
        audioEncoding: "LINEAR16",
        numberOfChannels: 2,
      },
      audioData: { content: base64OfBytes(96000) },
    });
    // Twice the channels over the same bytes is half the duration.
    expect(stereo.ok).toBe(true);
    if (stereo.ok) expect(stereo.estimate.costUSD).toBeCloseTo((1.5 / 60) * STT_1_USD_PER_MINUTE, 12);
  });

  test("compressed encodings need a declared duration", () => {
    const params = {
      transcribeConfig: {
        modelId: "inworld/inworld-stt-1" as const,
        audioEncoding: "MP3" as const,
      },
      audioData: { content: base64OfBytes(96000) },
    };
    const undeclared = transcribe.safe(params);
    expect(undeclared.ok).toBe(true);
    if (undeclared.ok) expect(undeclared.estimate.costUSD).toBeUndefined();

    const declared = transcribe.safe(params, {
      media: [{ path: ["audioData", "content"], durationSeconds: 600 }],
    });
    expect(declared.ok).toBe(true);
    if (declared.ok) expect(declared.estimate.costUSD).toBeCloseTo(10 * STT_1_USD_PER_MINUTE, 12);
  });

  test("a declared duration wins over the byte-derived one", () => {
    const r = transcribe.safe(
      {
        transcribeConfig: { modelId: "inworld/inworld-stt-1", audioEncoding: "LINEAR16" },
        audioData: { content: base64OfBytes(96000) },
      },
      { media: [{ path: ["audioData", "content"], durationSeconds: 60 }] },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(STT_1_USD_PER_MINUTE, 12);
  });

  test("routed vendors publish no Inworld list rate — no costUSD", () => {
    const r = transcribe.safe({
      transcribeConfig: { modelId: "groq/whisper-large-v3", audioEncoding: "LINEAR16" },
      audioData: { content: base64OfBytes(96000) },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("maxCostUSD enforces over_budget", () => {
    const r = transcribe.safe(
      {
        transcribeConfig: { modelId: "inworld/inworld-stt-1", audioEncoding: "LINEAR16" },
        audioData: { content: base64OfBytes(96000) },
      },
      { media: [{ path: ["audioData", "content"], durationSeconds: 3600 }], maxCostUSD: 0.1 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_budget");
      // One hour at the published $0.15/hr.
      expect(r.errors[0]?.meta?.estimated).toBeCloseTo(0.15, 10);
    }
  });
});

describe("inworld STT catalog", () => {
  // Widened to ModelInfo: `as const satisfies` keeps each entry's literal
  // type, so a heterogeneous iteration otherwise sees `characters`/`cost` on
  // only some members of the union.
  const entries = Object.entries(sttModels) as Array<[string, ModelInfo]>;

  test("every STT entry is audio-in / text-out with no token window", () => {
    for (const [, info] of entries) {
      expect(info.limit.context).toBe(0);
      expect(info.limit.characters).toBeUndefined();
      expect(info.modalities.input).toEqual(["audio"]);
      expect(info.modalities.output).toEqual(["text"]);
    }
  });

  test("every id is {vendor}/{model} and `family` is that vendor", () => {
    for (const [id, info] of entries) {
      const vendor = sttVendorOf(id);
      expect(vendor).toBeDefined();
      expect(info.family).toBe(vendor);
    }
  });

  test("only STT 1 carries a published USD rate", () => {
    const priced = entries.filter(([, info]) => info.cost?.perAudioMinute !== undefined);
    expect(priced.map(([id]) => id)).toEqual(["inworld/inworld-stt-1"]);
    expect(STT_1_USD_PER_MINUTE).toBeCloseTo(0.15 / 60, 12);
  });

  test("the endpoint rosters only name catalog ids, and overlap on STT 1 alone", () => {
    for (const id of [...STT_SYNC_MODEL_IDS, ...STT_STREAM_MODEL_IDS]) {
      expect(Object.hasOwn(sttModels, id)).toBe(true);
    }
    const both = STT_SYNC_MODEL_IDS.filter((id) =>
      (STT_STREAM_MODEL_IDS as readonly string[]).includes(id),
    );
    expect(both).toEqual(["inworld/inworld-stt-1"]);
    // Together they cover the whole catalog: no id is served by nothing.
    expect(new Set([...STT_SYNC_MODEL_IDS, ...STT_STREAM_MODEL_IDS]).size).toBe(
      Object.keys(sttModels).length,
    );
  });
});
