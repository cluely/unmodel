import { describe, expect, test } from "bun:test";
import { tts, RIME_TTS_URL, MAX_CHARACTERS, MIST_V2_ACCEPT_VALUES, MIST_V2_SSE_ACCEPT } from "./tts";
import { models, RIME_MODEL_IDS } from "./models";
import { MODELS, RIME_TTS_MODEL_PARAMS } from "./tts-params";
import { tts as unifiedTts } from "../../unified/tts";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = tts.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("rime.tts happy path", () => {
  test("returns a wire-pure body with hidden toSdk/request", () => {
    const params = {
      text: "Hello from Rime!",
      speaker: "astra",
      modelId: "coda" as const,
      lang: "en" as const,
      samplingRate: 24000,
    };
    const v = tts(params);

    expect(Object.keys(v)).toEqual(["text", "speaker", "modelId", "lang", "samplingRate"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(RIME_TTS_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    // Rime's SDK is gRPC and does not take the HTTP body — toSdk is the identity.
    expect(v.toSdk("rime")).toEqual(params);
  });

  test("omitting modelId resolves to the documented mistv3 default", () => {
    const r = tts.safe({ text: "x", speaker: "cove" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown model warns; Mist v2 and legacy Mist warn as deprecated", () => {
    const unknown = tts.safe({ text: "x", speaker: "v", modelId: "mistv9" });
    expect(unknown.ok).toBe(true);
    if (unknown.ok) expect(unknown.warnings.map((w) => w.code)).toEqual(["unknown_model"]);

    // "Both retire on December 3, 2026." — docs/models, 2026-11-12.
    for (const modelId of ["mistv2", "mist"] as const) {
      expect(models[modelId].status).toBe("deprecated");
      const r = tts.safe({ text: "x", speaker: "v", modelId });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
    }
    for (const modelId of ["coda", "mistv3"] as const) {
      const r = tts.safe({ text: "x", speaker: "v", modelId });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
  });

  test("unknown top-level key warns", () => {
    const r = safeUnchecked({ text: "x", speaker: "v", audioFormat: "mp3" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("unknown_param");
  });
});

describe("rime.tts Accept header", () => {
  test("accept is stripped from the body onto request.headers", () => {
    const v = tts({ text: "x", speaker: "astra", modelId: "coda", accept: "audio/mpeg" });
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
      const r = tts.safe({ text: "x", speaker: "astra", modelId: "coda", accept });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
  });

  test("deprecated aliases still pass but warn with their replacement", () => {
    const r = tts.safe({ text: "x", speaker: "astra", modelId: "coda", accept: "audio/mp3" });
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
        const r = tts.safe({ text: "x", speaker: "astra", modelId, accept });
        expect(r.ok).toBe(false);
        if (!r.ok) {
          const issue = r.errors.find((e) => e.code === "invalid_enum_value");
          expect(issue?.message).toContain("Mist v2 and Mist v1 were documented with only");
          // The legacy reference is gone; the source is the page that says so.
          expect(String(issue?.meta?.source)).toContain("docs.rime.ai/docs/migrate-legacy-mist");
        }
      }
      for (const accept of MIST_V2_ACCEPT_VALUES) {
        expect(tts.safe({ text: "x", speaker: "astra", modelId, accept }).ok).toBe(true);
      }
    }
  });

  test("text/event-stream passes on Mist v2 with a retirement warning (doc audit 2026-11-12)", () => {
    // "Server-sent events (`Accept: text/event-stream`) are Mist v2 only.
    // Before December 3, move them to HTTP streaming or the Mist v3 WebSocket."
    expect(MIST_V2_SSE_ACCEPT).toBe("text/event-stream");
    const r = tts.safe({ text: "x", speaker: "astra", modelId: "mistv2", accept: MIST_V2_SSE_ACCEPT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params.request.headers.accept).toBe("text/event-stream");
    const accept = r.warnings.filter((w) => w.path[0] === "accept");
    expect(accept).toHaveLength(1);
    expect(accept[0]?.code).toBe("invalid_enum_value");
    expect(accept[0]?.meta?.retires).toBe("2026-12-03");
    expect(String(accept[0]?.meta?.source)).toContain("docs.rime.ai/docs/migrate-legacy-mist");
  });

  test("text/event-stream is still refused on every id but Mist v2", () => {
    for (const modelId of ["mist", "mistv3", "coda", "mistv9", undefined] as const) {
      const r = tts.safe({
        text: "x",
        speaker: "astra",
        accept: MIST_V2_SSE_ACCEPT,
        ...(modelId !== undefined && { modelId }),
      });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      const issue = r.errors.find((e) => e.path[0] === "accept");
      expect(issue?.code).toBe("invalid_enum_value");
      expect(issue?.message).toContain('`modelId: "mistv2"` only');
    }
  });

  test("headers are not shared between two validations", () => {
    const a = tts({ text: "a", speaker: "v", accept: "audio/mpeg" });
    const b = tts({ text: "b", speaker: "v" });
    a.request.headers.authorization = "Bearer leak";
    expect(b.request.headers.authorization).toBeUndefined();
  });
});

describe("rime.tts character cap (1,000 characters)", () => {
  test("text over the cap is over_output_limit with character meta", () => {
    const r = tts.safe({ text: "a".repeat(MAX_CHARACTERS + 1), speaker: "astra" });
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
    expect(tts.safe({ text: "a".repeat(MAX_CHARACTERS), speaker: "astra" }).ok).toBe(true);
  });

  test("the endpoint-level cap applies even for unknown models", () => {
    const r = tts.safe({ text: "a".repeat(1200), speaker: "v", modelId: "mistv9" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("over_output_limit");
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const unchecked = tts as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      unchecked({ text: "a".repeat(1001), speaker: "v" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("rime.tts sampling rate ranges", () => {
  test("Mist v2 documents 4000–44100", () => {
    expect(tts.safe({ text: "x", speaker: "astra", modelId: "mistv2", samplingRate: 4000 }).ok)
      .toBe(true);
    expect(tts.safe({ text: "x", speaker: "astra", modelId: "mistv2", samplingRate: 44100 }).ok)
      .toBe(true);

    const tooHigh = tts.safe({
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
      // The legacy reference is gone; the source is the page that says so.
      expect(String(tooHigh.errors[0]?.meta?.source)).toContain(
        "docs.rime.ai/docs/migrate-legacy-mist",
      );
    }
  });

  test("Coda and Mist v3 document 8000–96000", () => {
    for (const modelId of ["coda", "mistv3"] as const) {
      expect(tts.safe({ text: "x", speaker: "astra", modelId, samplingRate: 48000 }).ok).toBe(
        true,
      );
      const tooLow = tts.safe({ text: "x", speaker: "astra", modelId, samplingRate: 4000 });
      expect(tooLow.ok).toBe(false);
      if (!tooLow.ok) expect(tooLow.errors[0]?.meta?.min).toBe(8000);
    }
  });

  test("a rate outside every documented range is invalid_shape at the schema layer", () => {
    expect(safeUnchecked({ text: "x", speaker: "v", samplingRate: 200000 }).ok).toBe(false);
    expect(safeUnchecked({ text: "x", speaker: "v", samplingRate: 1000 }).ok).toBe(false);
  });
});

describe("rime.tts per-model gates (doc audit 2026-08-13)", () => {
  test("phonemizeBetweenBrackets works on English Mist v3 (doc audit 2026-11-12)", () => {
    // "`phonemizeBetweenBrackets` works on English Mist v3 only." — the
    // custom-pronunciation page's own example sends it with `modelId: mistv3`.
    for (const lang of [undefined, "en", "eng"] as const) {
      const r = tts.safe({
        text: "{h'El.o} World",
        speaker: "peak",
        modelId: "mistv3",
        phonemizeBetweenBrackets: true,
        ...(lang !== undefined && { lang }),
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
    // Omitting `modelId` is Mist v3, and its `lang` defaults to English.
    const bare = tts.safe({ text: "x", speaker: "peak", phonemizeBetweenBrackets: true });
    expect(bare.ok).toBe(true);
    if (bare.ok) expect(bare.warnings).toEqual([]);
  });

  test("non-English Mist v3 and Coda ignore phonemizeBetweenBrackets, so it warns", () => {
    // "French, German, and Spanish requests ignore it."
    for (const lang of ["fr", "ger", "es"] as const) {
      const r = tts.safe({
        text: "x",
        speaker: "astra",
        modelId: "mistv3",
        lang,
        phonemizeBetweenBrackets: true,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const issue = r.warnings.find((w) => w.code === "unsupported_param");
      expect(issue?.path).toEqual(["phonemizeBetweenBrackets"]);
      expect(issue?.message).toContain("silently ignored");
      expect(issue?.meta?.ignored).toBe(true);
      expect(String(issue?.meta?.source)).toContain("docs.rime.ai/docs/migrate-legacy-mist");
    }
    // "Coda and non-English Mist v3 ignore it."
    const coda = tts.safe({
      text: "x",
      speaker: "astra",
      modelId: "coda",
      phonemizeBetweenBrackets: true,
    });
    expect(coda.ok).toBe(true);
    if (coda.ok) {
      const issue = coda.warnings.find((w) => w.code === "unsupported_param");
      expect(issue?.path).toEqual(["phonemizeBetweenBrackets"]);
      expect(issue?.meta?.ignored).toBe(true);
      expect(issue?.message).toContain("mistv3");
    }
  });

  test("phonemizeBetweenBrackets still validates on Mist v2 and Mist v1", () => {
    for (const modelId of ["mistv2", "mist"] as const) {
      const r = tts.safe({ text: "x", speaker: "astra", modelId, phonemizeBetweenBrackets: true });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
    }
  });

  test("noTextNormalization: refused on Coda, ignored on Mist v3, honoured on mist/mistv2", () => {
    const denied = tts.safe({
      text: "x",
      speaker: "astra",
      modelId: "coda",
      noTextNormalization: true,
    });
    expect(denied.ok).toBe(false);

    // "`noTextNormalization` has no effect on Mist v3, which always normalizes text."
    const mistv3 = tts.safe({
      text: "x",
      speaker: "astra",
      modelId: "mistv3",
      noTextNormalization: true,
    });
    expect(mistv3.ok).toBe(true);
    if (mistv3.ok) {
      const issue = mistv3.warnings.find((w) => w.code === "unsupported_param");
      expect(issue?.path).toEqual(["noTextNormalization"]);
      expect(issue?.meta?.ignored).toBe(true);
      expect(String(issue?.meta?.source)).toContain("docs.rime.ai/docs/migrate-legacy-mist");
    }

    expect(
      tts.safe({ text: "x", speaker: "astra", modelId: "mistv2", noTextNormalization: true }).ok,
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
      const r = tts.safe({ text: "x", speaker: "astra", modelId, timeScaleFactor: 0.85 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings.filter((w) => w.code !== "deprecated_model")).toEqual([]);
    }
  });

  test("a timeScaleFactor outside 0.4–2.5 warns that it is silently clamped", () => {
    for (const [value, clamped] of [
      [0.1, 0.4],
      [3, 2.5],
    ] as const) {
      const r = tts.safe({
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
      for (const lang of ["ja", "hin", "ar", "pt", "it", "nld"] as const) {
        const r = tts.safe({ text: "x", speaker: "astra", modelId, lang });
        expect(r.ok).toBe(false);
        if (!r.ok) {
          const issue = r.errors.find((e) => e.code === "invalid_enum_value");
          expect(issue?.path).toEqual(["lang"]);
          expect(issue?.message).toContain("coda");
        }
      }
      for (const lang of ["en", "eng", "fr", "de", "spa"] as const) {
        expect(tts.safe({ text: "x", speaker: "astra", modelId, lang }).ok).toBe(true);
      }
    }
  });

  test("Coda accepts all ten documented languages in both ISO spellings", () => {
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
      "it",
      "ita",
      "nl",
      "nld",
    ] as const) {
      const r = tts.safe({ text: "x", speaker: "astra", modelId: "coda", lang });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
  });

  test("an undocumented lang is invalid_shape at the schema layer", () => {
    expect(safeUnchecked({ text: "x", speaker: "v", lang: "sin" }).ok).toBe(false);
  });

  test("constraintsFor exposes the Coda denies with their sources", () => {
    const coda = tts.constraintsFor("coda").at(0);
    expect(coda?.deny?.inlineSpeedAlpha?.source).toContain("docs.rime.ai/docs/speed");
    expect(coda?.deny?.phonemizeBetweenBrackets?.reason).toContain("English Mist v3 only");
    expect(coda?.deny?.phonemizeBetweenBrackets?.ignored).toBe(true);
    expect(coda?.deny?.noTextNormalization?.source).toContain("docs.rime.ai/docs/models");
    const mistv3 = tts.constraintsFor("mistv3").at(0);
    expect(mistv3?.deny?.phonemizeBetweenBrackets).toBeUndefined();
    expect(mistv3?.deny?.noTextNormalization?.ignored).toBe(true);
  });
});

describe("rime unified tts (doc audit 2026-11-12)", () => {
  test("Italian and Dutch compile to Coda's own tags", () => {
    for (const [language, lang] of [
      ["it-IT", "it"],
      ["nl", "nl"],
    ] as const) {
      const r = unifiedTts.safe({ model: "rime/coda", text: "x", voice: "astra", language });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect((r.params as unknown as Record<string, unknown>)["lang"]).toBe(lang);
      expect(r.warnings).toEqual([]);
    }
  });

  test("phonemizeBetweenBrackets is a Mist v3 extra, and Coda's row still refuses it", () => {
    const mistv3 = unifiedTts.safe({
      model: "rime/mistv3",
      text: "{h'El.o} World",
      voice: "peak",
      phonemizeBetweenBrackets: true,
    });
    expect(mistv3.ok).toBe(true);
    if (mistv3.ok) {
      expect((mistv3.params as unknown as Record<string, unknown>)["phonemizeBetweenBrackets"]).toBe(true);
      expect(mistv3.warnings).toEqual([]);
    }
    const coda = unifiedTts.safe({
      model: "rime/coda",
      text: "x",
      voice: "astra",
      phonemizeBetweenBrackets: true,
    } as never);
    expect(coda.ok).toBe(false);
  });

  test("speed on Mist v2 compiles to the reciprocal in speedAlpha", () => {
    const r = unifiedTts.safe({ model: "rime/mistv2", text: "x", voice: "astra", speed: 1.25 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.params as unknown as Record<string, unknown>)["speedAlpha"]).toBe(0.8);
    expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
  });
});

describe("rime cost estimation (Flex per-minute rates at ~1,000 characters a minute)", () => {
  test("coda prices at $50/1M characters and mistv3 at $30/1M", () => {
    const coda = tts.safe({ text: "a".repeat(1000), speaker: "astra", modelId: "coda" });
    expect(coda.ok).toBe(true);
    if (coda.ok) expect(coda.estimate.costUSD).toBeCloseTo(0.05, 10);

    const mistv3 = tts.safe({ text: "a".repeat(1000), speaker: "astra", modelId: "mistv3" });
    expect(mistv3.ok).toBe(true);
    if (mistv3.ok) expect(mistv3.estimate.costUSD).toBeCloseTo(0.03, 10);
  });

  test("Mist v2 and Mist v1 have no published rate, so no estimate and no budget refusal", () => {
    // rime.ai/pricing (2026-11-13) lists only Mist v3 and Coda v2 for TTS.
    for (const modelId of ["mistv2", "mist"] as const) {
      const r = tts.safe({ text: "a".repeat(1000), speaker: "astra", modelId });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.estimate.costUSD).toBeUndefined();

      const budgeted = tts.safe(
        { text: "a".repeat(1000), speaker: "astra", modelId },
        { maxCostUSD: 0.01 },
      );
      expect(budgeted.ok).toBe(true);
    }
  });

  test("maxCostUSD enforces over_budget", () => {
    const r = tts.safe(
      { text: "a".repeat(1000), speaker: "astra", modelId: "coda" },
      { maxCostUSD: 0.01 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });
});

describe("rime catalog", () => {
  test("the catalog, the id list, MODELS and the params table name the same four ids", () => {
    const ids = ["coda", "mistv3", "mistv2", "mist"] as const;
    expect(Object.keys(models)).toEqual([...ids]);
    expect([...RIME_MODEL_IDS]).toEqual([...ids]);
    expect([...MODELS]).toEqual([...ids]);
    expect(Object.keys(RIME_TTS_MODEL_PARAMS)).toEqual([...ids]);
  });

  test("every model is TTS-shaped with the 1,000-character cap", () => {
    for (const info of Object.values(models)) {
      expect(info.limit.context).toBe(0);
      expect(info.limit.characters).toBe(1000);
      expect(info.modalities.input).toEqual(["text"]);
      expect(info.modalities.output).toEqual(["audio"]);
    }
  });
});
