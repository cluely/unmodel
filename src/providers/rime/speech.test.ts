import { describe, expect, test } from "bun:test";
import { speech, RIME_TTS_URL, MAX_CHARACTERS, MIST_V2_ACCEPT_VALUES } from "./speech";
import { models, ARCANA_MODEL_IDS } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = speech.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("rime.speech happy path", () => {
  test("returns a wire-pure body with hidden toSdk/request", () => {
    const params = {
      text: "Hello from Rime!",
      speaker: "astra",
      modelId: "coda" as const,
      lang: "en" as const,
      samplingRate: 24000,
    };
    const v = speech(params);

    expect(Object.keys(v)).toEqual(["text", "speaker", "modelId", "lang", "samplingRate"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(RIME_TTS_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    // Rime publishes no SDK — toSdk is the identity.
    expect(v.toSdk("rime")).toEqual(params);
  });

  test("omitting modelId resolves to the documented mistv3 default", () => {
    const r = speech.safe({ text: "x", speaker: "cove" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown model warns; the Arcana ids and legacy Mist warn as deprecated", () => {
    const unknown = speech.safe({ text: "x", speaker: "v", modelId: "mistv9" });
    expect(unknown.ok).toBe(true);
    if (unknown.ok) expect(unknown.warnings.map((w) => w.code)).toEqual(["unknown_model"]);

    for (const modelId of [...ARCANA_MODEL_IDS, "mist"] as const) {
      expect(models[modelId].status).toBe("deprecated");
      const r = speech.safe({ text: "x", speaker: "v", modelId });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("deprecated_model");
    }
  });

  test("unknown top-level key warns", () => {
    const r = safeUnchecked({ text: "x", speaker: "v", audioFormat: "mp3" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("unknown_param");
  });
});

describe("rime.speech Accept header", () => {
  test("accept is stripped from the body onto request.headers", () => {
    const v = speech({ text: "x", speaker: "astra", modelId: "coda", accept: "audio/mpeg" });
    expect(Object.keys(v)).toEqual(["text", "speaker", "modelId"]);
    expect((v as Record<string, unknown>).accept).toBeUndefined();
    expect(v.request.headers.accept).toBe("audio/mpeg");
    expect(v.toSdk("rime")).toEqual({ text: "x", speaker: "astra", modelId: "coda" });
  });

  test("every documented RFC media type passes on Coda", () => {
    for (const accept of [
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
      "audio/mpeg",
      "audio/wav",
      "audio/L16",
      "audio/PCMU",
    ] as const) {
      const r = speech.safe({ text: "x", speaker: "astra", modelId: "coda", accept });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
  });

  test("deprecated aliases still pass but warn with their replacement", () => {
    const r = speech.safe({ text: "x", speaker: "astra", modelId: "coda", accept: "audio/mp3" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const issue = r.warnings.find((w) => w.path[0] === "accept");
      expect(issue?.message).toContain("deprecated alias");
      expect(issue?.meta?.replacement).toBe("audio/mpeg");
    }
  });

  test("an undocumented accept value is invalid_enum_value", () => {
    const r = safeUnchecked({ text: "x", speaker: "v", accept: "audio/flac" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["accept"]);
    }
  });

  test("Opus and WAV are rejected on the Mist v2 generation", () => {
    for (const modelId of ["mistv2", "mist"] as const) {
      for (const accept of ["audio/webm;codecs=opus", "audio/wav"] as const) {
        const r = speech.safe({ text: "x", speaker: "astra", modelId, accept });
        expect(r.ok).toBe(false);
        if (!r.ok) {
          const issue = r.errors.find((e) => e.code === "invalid_enum_value");
          expect(issue?.message).toContain("Mist v2 and Mist v1 publish only");
        }
      }
      for (const accept of MIST_V2_ACCEPT_VALUES) {
        expect(speech.safe({ text: "x", speaker: "astra", modelId, accept }).ok).toBe(true);
      }
    }
  });

  test("headers are not shared between two validations", () => {
    const a = speech({ text: "a", speaker: "v", accept: "audio/mpeg" });
    const b = speech({ text: "b", speaker: "v" });
    a.request.headers.authorization = "Bearer leak";
    expect(b.request.headers.authorization).toBeUndefined();
  });
});

describe("rime.speech character cap (1,000 characters)", () => {
  test("text over the cap is over_output_limit with character meta", () => {
    const r = speech.safe({ text: "a".repeat(MAX_CHARACTERS + 1), speaker: "astra" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.errors[0]?.path).toEqual(["text"]);
      expect(r.errors[0]?.message).toContain("characters, not tokens");
      expect(r.errors[0]?.meta?.limitCharacters).toBe(1000);
      expect(r.errors[0]?.meta?.actualCharacters).toBe(1001);
    }
  });

  test("text at exactly the cap passes", () => {
    expect(speech.safe({ text: "a".repeat(MAX_CHARACTERS), speaker: "astra" }).ok).toBe(true);
  });

  test("the endpoint-level cap applies even for unknown models", () => {
    const r = speech.safe({ text: "a".repeat(1200), speaker: "v", modelId: "mistv9" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("over_output_limit");
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const unchecked = speech as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      unchecked({ text: "a".repeat(1001), speaker: "v" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("rime.speech sampling rate ranges", () => {
  test("Mist v2 documents 4000–44100", () => {
    expect(speech.safe({ text: "x", speaker: "astra", modelId: "mistv2", samplingRate: 4000 }).ok)
      .toBe(true);
    expect(speech.safe({ text: "x", speaker: "astra", modelId: "mistv2", samplingRate: 44100 }).ok)
      .toBe(true);

    const tooHigh = speech.safe({
      text: "x",
      speaker: "astra",
      modelId: "mistv2",
      samplingRate: 48000,
    });
    expect(tooHigh.ok).toBe(false);
    if (!tooHigh.ok) {
      expect(tooHigh.errors[0]?.code).toBe("invalid_shape");
      expect(tooHigh.errors[0]?.path).toEqual(["samplingRate"]);
      expect(tooHigh.errors[0]?.meta?.max).toBe(44100);
    }
  });

  test("Coda and Mist v3 document 8000–96000", () => {
    for (const modelId of ["coda", "mistv3"] as const) {
      expect(speech.safe({ text: "x", speaker: "astra", modelId, samplingRate: 48000 }).ok).toBe(
        true,
      );
      const tooLow = speech.safe({ text: "x", speaker: "astra", modelId, samplingRate: 4000 });
      expect(tooLow.ok).toBe(false);
      if (!tooLow.ok) expect(tooLow.errors[0]?.meta?.min).toBe(8000);
    }
  });

  test("a rate outside every documented range is invalid_shape at the schema layer", () => {
    expect(safeUnchecked({ text: "x", speaker: "v", samplingRate: 200000 }).ok).toBe(false);
    expect(safeUnchecked({ text: "x", speaker: "v", samplingRate: 1000 }).ok).toBe(false);
  });
});

describe("rime.speech per-model gates (doc audit 2026-08-13)", () => {
  test("phonemizeBetweenBrackets is Mist v2 / Mist v1 only", () => {
    for (const modelId of ["coda", "mistv3", "arcanav3"] as const) {
      const r = speech.safe({
        text: "{h'El.o} World",
        speaker: "astra",
        modelId,
        phonemizeBetweenBrackets: true,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const issue = r.errors.find((e) => e.code === "unsupported_param");
        expect(issue?.path).toEqual(["phonemizeBetweenBrackets"]);
        expect(String(issue?.meta?.source)).toContain("docs.rime.ai");
      }
    }
    for (const modelId of ["mistv2", "mist"] as const) {
      expect(
        speech.safe({ text: "x", speaker: "astra", modelId, phonemizeBetweenBrackets: true }).ok,
      ).toBe(true);
    }
  });

  test("noTextNormalization is mist/mistv2 only", () => {
    const denied = speech.safe({
      text: "x",
      speaker: "astra",
      modelId: "coda",
      noTextNormalization: true,
    });
    expect(denied.ok).toBe(false);
    expect(
      speech.safe({ text: "x", speaker: "astra", modelId: "mistv2", noTextNormalization: true }).ok,
    ).toBe(true);
  });

  test("custom pauses and inline speed are denied on Coda but pass on the Mist family", () => {
    for (const param of ["pauseBetweenBrackets", "inlineSpeedAlpha"] as const) {
      const value = param === "pauseBetweenBrackets" ? true : "0.5, 3";
      const coda = safeUnchecked({
        text: "x",
        speaker: "astra",
        modelId: "coda",
        [param]: value,
      });
      expect(coda.ok).toBe(false);
      if (!coda.ok) expect(coda.errors[0]?.path).toEqual([param]);

      const mist = safeUnchecked({
        text: "x",
        speaker: "astra",
        modelId: "mistv3",
        [param]: value,
      });
      expect(mist.ok).toBe(true);
    }
  });

  test("timeScaleFactor is not gated — the docs never say the other models reject it", () => {
    for (const modelId of ["coda", "mistv3", "mistv2"] as const) {
      const r = speech.safe({ text: "x", speaker: "astra", modelId, timeScaleFactor: 0.85 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
  });

  test("a timeScaleFactor outside 0.4–2.5 warns that it is silently clamped", () => {
    for (const [value, clamped] of [
      [0.1, 0.4],
      [3, 2.5],
    ] as const) {
      const r = speech.safe({
        text: "x",
        speaker: "astra",
        modelId: "coda",
        timeScaleFactor: value,
      });
      // Clamped, not rejected — so this must stay a warning.
      expect(r.ok).toBe(true);
      if (r.ok) {
        const issue = r.warnings.find((w) => w.path[0] === "timeScaleFactor");
        expect(issue?.message).toContain("clamped without an error");
        expect(issue?.meta?.value).toBe(value);
        expect(issue?.message).toContain(String(clamped));
      }
    }
  });

  test("Mist models reject languages only Coda serves", () => {
    for (const modelId of ["mistv3", "mistv2", "mist"] as const) {
      for (const lang of ["ja", "hin", "ar", "pt"] as const) {
        const r = speech.safe({ text: "x", speaker: "astra", modelId, lang });
        expect(r.ok).toBe(false);
        if (!r.ok) {
          const issue = r.errors.find((e) => e.code === "invalid_enum_value");
          expect(issue?.path).toEqual(["lang"]);
          expect(issue?.message).toContain("coda");
        }
      }
      for (const lang of ["en", "eng", "fr", "de", "spa"] as const) {
        expect(speech.safe({ text: "x", speaker: "astra", modelId, lang }).ok).toBe(true);
      }
    }
  });

  test("Coda accepts all eight documented languages in both ISO spellings", () => {
    for (const lang of [
      "en",
      "eng",
      "es",
      "spa",
      "fr",
      "fra",
      "pt",
      "por",
      "de",
      "ger",
      "ja",
      "jpn",
      "ar",
      "ara",
      "hi",
      "hin",
    ] as const) {
      expect(speech.safe({ text: "x", speaker: "astra", modelId: "coda", lang }).ok).toBe(true);
    }
  });

  test("an undocumented lang is invalid_shape at the schema layer", () => {
    expect(safeUnchecked({ text: "x", speaker: "v", lang: "sin" }).ok).toBe(false);
  });

  test("constraintsFor exposes the Coda denies with their sources", () => {
    const coda = speech.constraintsFor("coda").at(0);
    expect(coda?.deny?.inlineSpeedAlpha?.source).toContain("docs.rime.ai/docs/speed");
    expect(coda?.deny?.phonemizeBetweenBrackets?.reason).toContain("Mist v2 and Mist v1 only");
  });
});

describe("rime cost estimation (Starter list rates)", () => {
  test("coda prices at $50/1M characters and the Mist family at $30/1M", () => {
    const coda = speech.safe({ text: "a".repeat(1000), speaker: "astra", modelId: "coda" });
    expect(coda.ok).toBe(true);
    if (coda.ok) expect(coda.estimate.costUSD).toBeCloseTo(0.05, 10);

    for (const modelId of ["mistv3", "mistv2", "mist"] as const) {
      const r = speech.safe({ text: "a".repeat(1000), speaker: "astra", modelId });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.03, 10);
    }
  });

  test("Arcana has no published rate of its own — no costUSD", () => {
    for (const modelId of ARCANA_MODEL_IDS) {
      const r = speech.safe({ text: "a".repeat(1000), speaker: "astra", modelId });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
    }
  });

  test("maxCostUSD enforces over_budget", () => {
    const r = speech.safe(
      { text: "a".repeat(1000), speaker: "astra", modelId: "coda" },
      { maxCostUSD: 0.01 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });
});

describe("rime catalog", () => {
  test("every model is TTS-shaped with the 1,000-character cap", () => {
    for (const info of Object.values(models)) {
      expect(info.limit.context).toBe(0);
      expect(info.limit.characters).toBe(1000);
      expect(info.modalities.input).toEqual(["text"]);
      expect(info.modalities.output).toEqual(["audio"]);
    }
  });
});
