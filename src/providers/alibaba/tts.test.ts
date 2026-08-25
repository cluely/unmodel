import { describe, expect, test } from "bun:test";
import { tts, ttsUrl, TTS_URL, DEFAULT_BASE_URL, REALTIME_TTS_WSS_URL, LANGUAGE_TYPES } from "./tts";
import {
  ttsModels,
  realtimeTtsModels,
  TTS_MODEL_IDS,
  REALTIME_TTS_MODEL_IDS,
  TTS_MAX_CHARACTERS,
  QWEN3_TTS_FLASH_VOICES,
  QWEN3_TTS_FLASH_2025_09_18_VOICES,
  QWEN3_TTS_INSTRUCT_FLASH_VOICES,
} from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = tts.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("alibaba.tts happy path", () => {
  test("returns a wire-pure body addressed at the multimodal-generation route", () => {
    const params = {
      model: "qwen3-tts-flash" as const,
      input: { text: "Hello from Model Studio.", voice: "Cherry", language_type: "English" as const },
    };
    const v = tts(params);
    expect(Object.keys(v)).toEqual(["model", "input"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);
    expect(v.request.url).toBe(TTS_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    // No SSE header on a non-streaming request.
    expect(v.request.headers["x-dashscope-sse"]).toBeUndefined();
    // No first-party JS SDK; the body goes out verbatim.
    expect(v.toSdk("alibaba")).toEqual(params);
  });

  test("stream: true stays in the body and adds the required SSE header", () => {
    const v = tts({
      model: "qwen3-tts-flash",
      input: { text: "x", voice: "Cherry" },
      stream: true,
    });
    expect(v.stream).toBe(true);
    expect(v.request.headers["x-dashscope-sse"]).toBe("enable");
  });

  test("ttsUrl builds the same path on a workspace-scoped base", () => {
    expect(ttsUrl()).toBe(TTS_URL);
    expect(TTS_URL).toBe(
      `${DEFAULT_BASE_URL}/api/v1/services/aigc/multimodal-generation/generation`,
    );
    expect(ttsUrl("https://ws-1.ap-southeast-1.maas.aliyuncs.com/")).toBe(
      "https://ws-1.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    );
  });

  test("instructions pass on the Instruct-Flash pair", () => {
    const r = tts.safe({
      model: "qwen3-tts-instruct-flash",
      input: {
        text: "x",
        voice: "Serena",
        instructions: "Whisper, like telling a secret.",
        optimize_instructions: true,
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown top-level key warns", () => {
    const r = safeUnchecked({
      model: "qwen3-tts-flash",
      input: { text: "x", voice: "Cherry" },
      parameters: {},
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("unknown_param");
  });
});

describe("alibaba.tts model gate", () => {
  test("the enum is the catalogued unary id set", () => {
    expect([...TTS_MODEL_IDS].sort()).toEqual(Object.keys(ttsModels).sort());
    expect([...REALTIME_TTS_MODEL_IDS].sort()).toEqual(Object.keys(realtimeTtsModels).sort());
  });

  test("a realtime id is refused with the WebSocket pointer, without unknown_model noise", () => {
    for (const model of REALTIME_TTS_MODEL_IDS) {
      const r = tts.safe({ model, input: { text: "x", voice: "Cherry" } });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("invalid_enum_value");
        expect(r.errors[0]?.message).toContain(REALTIME_TTS_WSS_URL);
        expect(r.warnings.map((w) => w.code)).not.toContain("unknown_model");
      }
    }
  });

  test("a Beijing-only qwen-tts id is refused and the message says why", () => {
    const r = tts.safe({ model: "qwen-tts-latest", input: { text: "x", voice: "Cherry" } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.message).toContain("Beijing-only");
      expect(r.warnings.map((w) => w.code)).toContain("unknown_model");
    }
  });
});

describe("alibaba.tts text cap (600 characters)", () => {
  test("text over the cap is over_output_limit with character meta", () => {
    const r = tts.safe({
      model: "qwen3-tts-flash",
      input: { text: "a".repeat(TTS_MAX_CHARACTERS + 1), voice: "Cherry" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.errors[0]?.path).toEqual(["input", "text"]);
      expect(r.errors[0]?.meta?.limitCharacters).toBe(600);
      expect(r.errors[0]?.meta?.actualCharacters).toBe(601);
    }
  });

  test("text at exactly the cap passes; empty text is invalid_shape", () => {
    expect(
      tts.safe({
        model: "qwen3-tts-flash",
        input: { text: "a".repeat(TTS_MAX_CHARACTERS), voice: "Cherry" },
      }).ok,
    ).toBe(true);
    const r = safeUnchecked({ model: "qwen3-tts-flash", input: { text: "", voice: "Cherry" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });
});

describe("alibaba.tts enums (doc audit 2026-08-24)", () => {
  test("every documented language_type passes; an off-list one is refused", () => {
    for (const language_type of LANGUAGE_TYPES) {
      expect(
        tts.safe({ model: "qwen3-tts-flash", input: { text: "x", voice: "Cherry", language_type } })
          .ok,
      ).toBe(true);
    }
    const r = tts.safe({
      model: "qwen3-tts-flash",
      input: { text: "x", voice: "Cherry", language_type: "pt-BR" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.path).toEqual(["input", "language_type"]);
      // The wire wants English words, not tags — the message says so.
      expect(r.errors[0]?.message).toContain("not BCP-47");
    }
  });

  test("voices are a closed per-model list, multi-word names included", () => {
    expect(
      tts.safe({ model: "qwen3-tts-flash", input: { text: "x", voice: "Eldric Sage" } }).ok,
    ).toBe(true);
    expect(
      tts.safe({ model: "qwen3-tts-instruct-flash", input: { text: "x", voice: "Eldric Sage" } })
        .ok,
    ).toBe(true);
    // Jennifer exists on Flash but not on the Instruct pair.
    const r = tts.safe({
      model: "qwen3-tts-instruct-flash",
      input: { text: "x", voice: "Jennifer" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["input", "voice"]);
    }
    // Momo joined after the 2025-09-18 snapshot.
    expect(
      tts.safe({ model: "qwen3-tts-flash-2025-09-18", input: { text: "x", voice: "Momo" } }).ok,
    ).toBe(false);
    expect(
      tts.safe({ model: "qwen3-tts-flash", input: { text: "x", voice: "Momo" } }).ok,
    ).toBe(true);
  });

  test("instructions are Instruct-Flash-only", () => {
    const r = tts.safe({
      model: "qwen3-tts-flash",
      input: { text: "x", voice: "Cherry", instructions: "Sound cheerful." },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["input", "instructions"]);
    }
    const opt = tts.safe({
      model: "qwen3-tts-flash",
      input: { text: "x", voice: "Cherry", optimize_instructions: true },
    });
    expect(opt.ok).toBe(false);
  });
});

describe("alibaba.tts cost estimation", () => {
  test("qwen3-tts-flash prices at $10/1M characters ($0.10 per 10K)", () => {
    const r = tts.safe({
      model: "qwen3-tts-flash",
      input: { text: "a".repeat(200), voice: "Cherry" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.002, 10);
  });

  test("the Instruct pair prices at $11.50/1M characters", () => {
    const r = tts.safe({
      model: "qwen3-tts-instruct-flash",
      input: { text: "a".repeat(200), voice: "Cherry" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.0023, 10);
  });

  test("maxCostUSD enforces over_budget", () => {
    const r = tts.safe(
      { model: "qwen3-tts-flash", input: { text: "a".repeat(600), voice: "Cherry" } },
      { maxCostUSD: 0.000001 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const throwing = tts as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      throwing({ model: "qwen3-tts-flash", input: { text: "x", voice: "NotAVoice" } });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("alibaba.tts catalog", () => {
  test("unary rows are TTS-shaped with the 600-character cap; realtime rows carry rates", () => {
    for (const info of Object.values(ttsModels)) {
      expect(info.limit.context).toBe(0);
      expect(info.limit.characters).toBe(600);
      expect(info.modalities.input).toEqual(["text"]);
      expect(info.modalities.output).toEqual(["audio"]);
    }
    for (const info of Object.values(realtimeTtsModels)) {
      expect(info.limit.context).toBe(0);
      expect(info.cost?.perMillionCharacters).toBeGreaterThan(0);
    }
  });

  test("the transcribed voice lists keep their documented sizes", () => {
    expect(QWEN3_TTS_FLASH_VOICES.length).toBe(48);
    expect(QWEN3_TTS_FLASH_2025_09_18_VOICES.length).toBe(17);
    expect(QWEN3_TTS_INSTRUCT_FLASH_VOICES.length).toBe(24);
    // The snapshot subset is a subset of the current list.
    for (const voice of QWEN3_TTS_FLASH_2025_09_18_VOICES) {
      expect(QWEN3_TTS_FLASH_VOICES).toContain(voice);
    }
    for (const voice of QWEN3_TTS_INSTRUCT_FLASH_VOICES) {
      expect(QWEN3_TTS_FLASH_VOICES).toContain(voice);
    }
  });
});
