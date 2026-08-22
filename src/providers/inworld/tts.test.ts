import { describe, expect, test } from "bun:test";
import { tts, TTS_VOICE_URL, INWORLD_TTS_MAX_CHARACTERS } from "./tts";
import { models, sttModels, ttsModels, voiceModels } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = tts.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("inworld.tts happy path", () => {
  test("returns a wire-pure body with hidden toSdk/request", () => {
    const params = {
      text: "Hello from Inworld.",
      voiceId: "Dennis",
      modelId: "inworld-tts-2" as const,
      audioConfig: { audioEncoding: "LINEAR16" as const, sampleRateHertz: 24000 as const },
      deliveryMode: "BALANCED" as const,
    };
    const v = tts(params);

    expect(Object.keys(v)).toEqual(["text", "voiceId", "modelId", "audioConfig", "deliveryMode"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(TTS_VOICE_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    // No official JS SDK for the TTS API — toSdk is the identity.
    expect(v.toSdk("inworld")).toEqual(params);
  });

  test("all documented optional fields pass", () => {
    const r = tts.safe({
      text: "x",
      voiceId: "Sarah",
      modelId: "inworld-tts-2",
      language: "en-US",
      deliveryMode: "BALANCED",
      timestampType: "WORD",
      applyTextNormalization: "ON",
      enhanceGeneration: true,
      synthesisContext: { previousRequests: [{ text: "earlier turn" }] },
      audioConfig: { audioEncoding: "OGG_OPUS", sampleRateHertz: 48000, bitRate: 128000, speakingRate: 1.2 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("sampleRateHertz is a closed list, not a range", () => {
    for (const rate of [8000, 16000, 22050, 24000, 32000, 44100, 48000]) {
      const ok = safeUnchecked({
        text: "x",
        voiceId: "v",
        modelId: "inworld-tts-2",
        audioConfig: { sampleRateHertz: rate },
      });
      expect(ok.ok).toBe(true);
    }
    // In the documented [8000, 48000] range, but not a supported rate.
    const r = safeUnchecked({
      text: "x",
      voiceId: "v",
      modelId: "inworld-tts-2",
      audioConfig: { sampleRateHertz: 12345 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["audioConfig", "sampleRateHertz"]);
    }
  });

  test("unknown model warns; deprecated 1.5 models warn", () => {
    const unknown = tts.safe({ text: "x", voiceId: "v", modelId: "inworld-tts-9" });
    expect(unknown.ok).toBe(true);
    if (unknown.ok) expect(unknown.warnings.map((w) => w.code)).toEqual(["unknown_model"]);

    expect(models["inworld-tts-1.5-max"].status).toBe("deprecated");
    const deprecated = tts.safe({ text: "x", voiceId: "v", modelId: "inworld-tts-1.5-max" });
    expect(deprecated.ok).toBe(true);
    if (deprecated.ok) {
      expect(deprecated.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
    }
  });

  test("unknown top-level key warns", () => {
    const r = safeUnchecked({ text: "x", voiceId: "v", modelId: "inworld-tts-2", pitch: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("unknown_param");
  });
});

describe("inworld.tts character cap (2,000 characters)", () => {
  test("text over the cap is over_output_limit with character meta", () => {
    const text = "a".repeat(INWORLD_TTS_MAX_CHARACTERS + 1);
    const r = tts.safe({ text, voiceId: "Dennis", modelId: "inworld-tts-2" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.errors[0]?.path).toEqual(["text"]);
      expect(r.errors[0]?.message).toContain("characters, not tokens");
      expect(r.errors[0]?.meta).toEqual({
        limitCharacters: 2000,
        actualCharacters: 2001,
      });
    }
  });

  test("text at exactly the cap passes", () => {
    const text = "a".repeat(INWORLD_TTS_MAX_CHARACTERS);
    const r = tts.safe({ text, voiceId: "Dennis", modelId: "inworld-tts-2" });
    expect(r.ok).toBe(true);
  });

  test("the endpoint-level cap applies even for unknown models", () => {
    const text = "a".repeat(INWORLD_TTS_MAX_CHARACTERS + 5);
    const r = tts.safe({ text, voiceId: "v", modelId: "inworld-tts-9" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_output_limit");
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const ttsUnchecked = tts as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      ttsUnchecked({ text: "a".repeat(2001), voiceId: "v", modelId: "inworld-tts-2" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("inworld.tts schema enforcement", () => {
  test("invalid audioEncoding is invalid_shape", () => {
    const r = safeUnchecked({
      text: "x",
      voiceId: "v",
      modelId: "inworld-tts-2",
      audioConfig: { audioEncoding: "AAC" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("sampleRateHertz outside [8000, 48000] is invalid_shape", () => {
    const r = safeUnchecked({
      text: "x",
      voiceId: "v",
      modelId: "inworld-tts-2",
      audioConfig: { sampleRateHertz: 96000 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["audioConfig", "sampleRateHertz"]);
  });

  test("temperature 0 is invalid_shape (documented range (0, 2])", () => {
    const r = safeUnchecked({ text: "x", voiceId: "v", modelId: "inworld-tts-2", temperature: 0 });
    expect(r.ok).toBe(false);
  });

  test("speakingRate outside [0.5, 1.5] is invalid_shape", () => {
    const r = safeUnchecked({
      text: "x",
      voiceId: "v",
      modelId: "inworld-tts-2",
      audioConfig: { speakingRate: 2 },
    });
    expect(r.ok).toBe(false);
  });

  test("invalid deliveryMode is invalid_shape", () => {
    const r = safeUnchecked({
      text: "x",
      voiceId: "v",
      modelId: "inworld-tts-2",
      deliveryMode: "FAST",
    });
    expect(r.ok).toBe(false);
  });

  test("empty text is invalid_shape", () => {
    const r = safeUnchecked({ text: "", voiceId: "v", modelId: "inworld-tts-2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });
});

describe("inworld.tts cost estimation (On-Demand list rates)", () => {
  test("inworld-tts-2 prices at $25/1M characters", () => {
    const r = tts.safe({ text: "a".repeat(1000), voiceId: "v", modelId: "inworld-tts-2" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.025, 10);
  });

  test("inworld-tts-1.5-max prices at $35/1M and mini at $15/1M", () => {
    const max = tts.safe({ text: "a".repeat(2000), voiceId: "v", modelId: "inworld-tts-1.5-max" });
    expect(max.ok).toBe(true);
    if (max.ok) expect(max.estimate.costUSD).toBeCloseTo(0.07, 10);

    const mini = tts.safe({ text: "a".repeat(2000), voiceId: "v", modelId: "inworld-tts-1.5-mini" });
    expect(mini.ok).toBe(true);
    if (mini.ok) expect(mini.estimate.costUSD).toBeCloseTo(0.03, 10);
  });

  test("inworld-tts-2-flash prices at $15/1M characters", () => {
    const r = tts.safe({ text: "a".repeat(1000), voiceId: "v", modelId: "inworld-tts-2-flash" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.015, 10);
  });

  test("the discontinued 1.x ids are billed at their successor's rate — no costUSD", () => {
    for (const modelId of ["inworld-tts-1", "inworld-tts-1-max"]) {
      const r = tts.safe({ text: "a".repeat(1000), voiceId: "v", modelId });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
    }
  });

  test("maxCostUSD enforces over_budget", () => {
    const r = tts.safe(
      { text: "a".repeat(2000), voiceId: "v", modelId: "inworld-tts-2" },
      { maxCostUSD: 0.01 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_budget");
      expect(r.errors[0]?.meta?.estimated).toBeCloseTo(0.05, 10);
    }
  });
});

describe("inworld catalog", () => {
  test("every TTS model is TTS-shaped with the 2,000-character cap", () => {
    for (const info of Object.values(ttsModels)) {
      expect(info.limit.context).toBe(0);
      expect(info.limit.characters).toBe(2000);
      expect(info.modalities.input).toEqual(["text"]);
      expect(info.modalities.output).toEqual(["audio"]);
    }
  });

  test("the provider catalog is the route-scoped catalogs, merged", () => {
    expect(Object.keys(models)).toEqual([
      ...Object.keys(ttsModels),
      ...Object.keys(sttModels),
      ...Object.keys(voiceModels),
    ]);
  });
});

describe("inworld.tts per-model gates (doc audit 2026-08-13)", () => {
  test("deliveryMode on a 1.x model is unsupported_param with the doc source", () => {
    for (const modelId of ["inworld-tts-1.5-max", "inworld-tts-1.5-mini", "inworld-tts-1", "inworld-tts-1-max"]) {
      const r = tts.safe({ text: "x", voiceId: "v", modelId, deliveryMode: "CREATIVE" });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("unsupported_param");
        expect(r.errors[0]?.path).toEqual(["deliveryMode"]);
        expect(String(r.errors[0]?.meta?.source)).toContain("synthesize-speech");
      }
    }
  });

  test("deliveryMode passes on the tts-2 generation", () => {
    for (const modelId of ["inworld-tts-2", "inworld-tts-2-flash"]) {
      const r = tts.safe({ text: "x", voiceId: "v", modelId, deliveryMode: "STABLE" });
      expect(r.ok).toBe(true);
    }
  });

  test("temperature on inworld-tts-2 warns (silently ignored upstream, request still valid)", () => {
    const r = tts.safe({ text: "x", voiceId: "v", modelId: "inworld-tts-2", temperature: 0.8 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings[0]?.code).toBe("unsupported_param");
      expect(r.warnings[0]?.path).toEqual(["temperature"]);
      expect(r.warnings[0]?.message).toContain("silently ignored by the API");
    }
  });

  test("temperature still passes on the models that honour it", () => {
    const r = tts.safe({ text: "x", voiceId: "v", modelId: "inworld-tts-1.5-mini", temperature: 0.8 });
    expect(r.ok).toBe(true);
  });

  test("constraintsFor exposes both rules with sources", () => {
    expect(tts.constraintsFor("inworld-tts-2").at(0)?.deny?.temperature?.source).toContain(
      "docs.inworld.ai",
    );
    expect(tts.constraintsFor("inworld-tts-1.5-max").at(0)?.deny?.deliveryMode?.reason).toContain(
      "inworld-tts-2",
    );
  });
});
