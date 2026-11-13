import { describe, expect, test } from "bun:test";
import { tts, TTS_VOICE_URL, INWORLD_SAMPLE_RATES_HERTZ, INWORLD_TTS_MAX_CHARACTERS } from "./tts";
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

  test("sampleRateHertz is an integer in [8000, 48000]; the common rates are not a closed list", () => {
    // "Accepts values within the range [8000, 48000]. Common sample rates include: …"
    for (const rate of [...INWORLD_SAMPLE_RATES_HERTZ, 8000, 11025, 12345, 48000]) {
      const ok = tts.safe({ text: "x", voiceId: "v", modelId: "inworld-tts-2", audioConfig: { sampleRateHertz: rate } });
      expect(ok.ok).toBe(true);
    }
    for (const rate of [7999, 48001, 16000.5]) {
      const r = safeUnchecked({
        text: "x",
        voiceId: "v",
        modelId: "inworld-tts-2",
        audioConfig: { sampleRateHertz: rate },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("invalid_shape");
        expect(r.errors[0]?.path).toEqual(["audioConfig", "sampleRateHertz"]);
      }
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

  test("temperature takes [0, 2]: 0 selects the default, so it passes", () => {
    // "If 0 is provided, the default value will be used." — on a model that
    // honours temperature, so no ignored-param warning rides along.
    const zero = tts.safe({ text: "x", voiceId: "v", modelId: "inworld-tts-2-flash", temperature: 0 });
    expect(zero.ok).toBe(true);
    if (zero.ok) expect(zero.warnings).toEqual([]);
    expect(tts.safe({ text: "x", voiceId: "v", modelId: "inworld-tts-2-flash", temperature: 2 }).ok).toBe(true);
    for (const temperature of [-0.1, 2.1]) {
      const r = safeUnchecked({ text: "x", voiceId: "v", modelId: "inworld-tts-2-flash", temperature });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.path).toEqual(["temperature"]);
    }
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

  test("the deprecated 1.5 ids are no longer priced on inworld.ai/pricing — no costUSD", () => {
    for (const modelId of ["inworld-tts-1.5-max", "inworld-tts-1.5-mini"] as const) {
      expect("cost" in models[modelId]).toBe(false);
      const r = tts.safe({ text: "a".repeat(2000), voiceId: "v", modelId });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
    }
  });

  test("inworld-tts-2-flash prices at $15/1M characters", () => {
    const r = tts.safe({ text: "a".repeat(1000), voiceId: "v", modelId: "inworld-tts-2-flash" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.015, 10);
  });

  test("the discontinued 1.x ids are routed to an unnamed newer model — no costUSD", () => {
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

describe("inworld.tts per-model gates (doc audit 2026-11-12)", () => {
  test("deliveryMode on a 1.x model warns: the field is ignored there, the request is served", () => {
    for (const modelId of ["inworld-tts-1.5-max", "inworld-tts-1.5-mini", "inworld-tts-1", "inworld-tts-1-max"]) {
      const r = tts.safe({ text: "x", voiceId: "v", modelId, deliveryMode: "CREATIVE" });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const warning = r.warnings.find((w) => w.code === "unsupported_param");
        expect(warning?.path).toEqual(["deliveryMode"]);
        expect(warning?.meta?.ignored).toBe(true);
        expect(String(warning?.meta?.source)).toContain("synthesize-speech");
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

describe("inworld.tts request shapes: voiceId, voiceDesign, script", () => {
  const script = {
    utterances: [
      { text: "Welcome to the planetarium.", voiceConfig: { voiceId: "Dennis", speakingRate: 0.9 } },
      { text: "Look up.", voiceConfig: { voiceId: "Ashley", deliveryMode: "STABLE" as const } },
    ],
    voices: [{ voiceId: "Dennis", deliveryMode: "STABLE" as const }],
  };

  test("a script stands alone: no text, no voiceId; priced on the utterance texts", () => {
    const r = tts.safe({ script, modelId: "inworld-tts-2", outputMode: "PER_UTTERANCE" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      // "Usage counts the text across the script once": 27 + 8 characters at $25/1M.
      expect(r.estimate.costUSD).toBeCloseTo((35 * 25) / 1_000_000, 12);
    }
  });

  test("an inline voiceDesign replaces voiceId; its prompt is billed with the text", () => {
    const designPrompt = "A warm, low-pitched narrator.";
    const r = tts.safe({ text: "Hello.", voiceDesign: { designPrompt }, modelId: "inworld-tts-2" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(((6 + designPrompt.length) * 25) / 1_000_000, 12);
  });

  test("the shapes do not mix", () => {
    const both = safeUnchecked({
      text: "x",
      voiceId: "v",
      voiceDesign: { designPrompt: "A bright young voice." },
      modelId: "inworld-tts-2",
    });
    expect(both.ok).toBe(false);
    if (!both.ok) expect(both.errors[0]?.path).toEqual(["voiceDesign"]);

    const scripted = safeUnchecked({ script, text: "x", modelId: "inworld-tts-2" });
    expect(scripted.ok).toBe(false);
    if (!scripted.ok) expect(scripted.errors.map((e) => e.path)).toEqual([["text"]]);

    const voiceless = safeUnchecked({ text: "x", modelId: "inworld-tts-2" });
    expect(voiceless.ok).toBe(false);
    if (!voiceless.ok) expect(voiceless.errors[0]?.path).toEqual(["voiceId"]);

    const textless = safeUnchecked({ voiceId: "v", modelId: "inworld-tts-2" });
    expect(textless.ok).toBe(false);
    if (!textless.ok) expect(textless.errors[0]?.path).toEqual(["text"]);

    const perUtterance = safeUnchecked({
      text: "x",
      voiceId: "v",
      modelId: "inworld-tts-2",
      outputMode: "PER_UTTERANCE",
    });
    expect(perUtterance.ok).toBe(false);
    if (!perUtterance.ok) expect(perUtterance.errors[0]?.path).toEqual(["outputMode"]);
  });

  test("the type says the same", () => {
    // @ts-expect-error — "Set either `voiceId` or `voiceDesign`, not both."
    tts.safe({ text: "x", voiceId: "v", voiceDesign: { designPrompt: "A bright voice." }, modelId: "inworld-tts-2" });
    // @ts-expect-error — `script` "Replaces top-level `text`, `voiceId`, and `voiceDesign`".
    tts.safe({ script, text: "x", modelId: "inworld-tts-2" });
    // @ts-expect-error — "`PER_UTTERANCE` requires `script`."
    tts.safe({ text: "x", voiceId: "v", modelId: "inworld-tts-2", outputMode: "PER_UTTERANCE" });
  });

  test("designPrompt is 7–1,024 characters, whitespace not counted toward the minimum", () => {
    function at(designPrompt: string): ValidateResult<Record<string, unknown>> {
      return safeUnchecked({ text: "x", voiceDesign: { designPrompt }, modelId: "inworld-tts-2" });
    }
    expect(at("A calm.").ok).toBe(true);
    expect(at("a".repeat(1024)).ok).toBe(true);
    expect(at("   Calm.   ").ok).toBe(false);
    expect(at("a".repeat(1025)).ok).toBe(false);
  });

  test("a script holds 1–100 utterances and its texts share the 2,000-character cap", () => {
    const utterance = { text: "x", voiceConfig: { voiceId: "v" } };
    function scriptOf(count: number): ValidateResult<Record<string, unknown>> {
      return safeUnchecked({
        script: { utterances: Array.from({ length: count }, () => utterance) },
        modelId: "inworld-tts-2",
      });
    }
    expect(scriptOf(0).ok).toBe(false);
    expect(scriptOf(100).ok).toBe(true);
    expect(scriptOf(101).ok).toBe(false);

    const long = { text: "a".repeat(1001), voiceConfig: { voiceId: "v" } };
    const r = tts.safe({ script: { utterances: [long, long] }, modelId: "inworld-tts-2" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.errors[0]?.path).toEqual(["script"]);
      expect(r.errors[0]?.meta).toEqual({ limitCharacters: 2000, actualCharacters: 2002 });
    }
  });

  test("per-utterance speakingRate is bounded to [0.5, 1.5]", () => {
    function at(speakingRate: number): ValidateResult<Record<string, unknown>> {
      return safeUnchecked({
        script: { utterances: [{ text: "x", voiceConfig: { voiceId: "v", speakingRate } }] },
        modelId: "inworld-tts-2",
      });
    }
    expect(at(0.5).ok).toBe(true);
    expect(at(1.5).ok).toBe(true);
    expect(at(1.6).ok).toBe(false);
  });
});
