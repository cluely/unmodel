import { describe, expect, test } from "bun:test";
import {
  tts,
  textToSpeechUrl,
  textToSpeechStreamUrl,
  TEXT_TO_SPEECH_BASE_URL,
  OUTPUT_FORMATS,
} from "./tts";
import { models, TTS_COST_PER_MILLION_CHARACTERS_USD } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = tts.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("breezeblue.tts happy path", () => {
  test("body is wire-pure; voice_id and query params live in the URL", () => {
    const v = tts({
      voice_id: "voc_xeh3w54cqvnp",
      text: "Hello from Breeze.",
      model_id: "breeze-tts-2",
      output_format: "mp3",
      delivery: "sync",
    });

    // The enumerable props are exactly the OpenAPI TtsRequest body.
    expect(Object.keys(v)).toEqual(["text", "model_id"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual({
      text: "Hello from Breeze.",
      model_id: "breeze-tts-2",
    });

    expect(v.request.url).toBe(
      `${TEXT_TO_SPEECH_BASE_URL}/voc_xeh3w54cqvnp?output_format=mp3&delivery=sync`,
    );
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    // Auth (`xi-api-key`, not Bearer) is the caller's job — never pre-set.
    expect(v.request.headers["xi-api-key"]).toBeUndefined();
  });

  test("all documented body fields pass", () => {
    const r = tts.safe({
      voice_id: "voc_8rsb3nhb7645",
      text: "I can't believe you brought him here!",
      model_id: "breeze-tts-2",
      language_code: "en",
      instructions: "Say it softly and emotionally, with a hurt, disappointed tone.",
      voice_settings: { guidance_scale: 4.0 },
      output_format: "wav",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("explicit nulls are legal wire values and stay in the body", () => {
    const r = tts.safe({
      voice_id: "voc_x",
      text: "x",
      model_id: null,
      language_code: null,
      instructions: null,
      voice_settings: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.params.model_id).toBeNull();
      expect(r.params.voice_settings).toBeNull();
    }
  });

  test("the minimal request — voice_id + text — passes with no warnings", () => {
    // No default model_id is documented, so omitting it must not warn.
    const r = tts.safe({ voice_id: "voc_x", text: "Hello." });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("voice_id is URL-encoded into the path", () => {
    const v = tts({ voice_id: "voc/α", text: "x" });
    expect(v.request.url).toBe(`${TEXT_TO_SPEECH_BASE_URL}/${encodeURIComponent("voc/α")}`);
  });

  test("unknown model_id warns unknown_model (may be newer than the catalog)", () => {
    const r = tts.safe({ voice_id: "voc_x", text: "x", model_id: "breeze-tts-3" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("headers are not shared between two validations", () => {
    const a = tts({ voice_id: "voc_a", text: "a" });
    const b = tts({ voice_id: "voc_b", text: "b" });
    a.request.headers["xi-api-key"] = "leak";
    expect(b.request.headers["xi-api-key"]).toBeUndefined();
  });
});

describe("breezeblue.tts strict body (additionalProperties: false)", () => {
  test("an unknown top-level key is an ERROR, not a warning — the API 422s", () => {
    const r = safeUnchecked({ voice_id: "voc_x", text: "x", speed: 1.2 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.message).toContain("`speed`");
      expect(r.errors[0]?.message).toContain("422");
    }
  });

  test("an unknown voice_settings key is an ERROR too (the payload is closed)", () => {
    const r = safeUnchecked({
      voice_id: "voc_x",
      text: "x",
      voice_settings: { guidance_scale: 2, stability: 0.5 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("`stability`");
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const unchecked = tts as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      unchecked({ voice_id: "voc_x", text: "x", pitch: 2 });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("breezeblue.tts schema enforcement (OpenAPI bounds)", () => {
  test("empty text is invalid_shape (minLength 1)", () => {
    const r = safeUnchecked({ voice_id: "voc_x", text: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("empty voice_id is refused", () => {
    expect(safeUnchecked({ voice_id: "", text: "x" }).ok).toBe(false);
  });

  test("model_id over 120 characters is refused; 120 passes", () => {
    expect(safeUnchecked({ voice_id: "voc_x", text: "x", model_id: "m".repeat(121) }).ok).toBe(
      false,
    );
    const r = tts.safe({ voice_id: "voc_x", text: "x", model_id: "m".repeat(120) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("language_code must match ^[A-Za-z]{2}$", () => {
    for (const bad of ["eng", "e", "pt-BR", "12"]) {
      expect(safeUnchecked({ voice_id: "voc_x", text: "x", language_code: bad }).ok).toBe(false);
    }
    // Any two ASCII letters pass — which codes a model serves is runtime data
    // (GET /v1/models `languages`), so unmodel enforces the pattern only.
    expect(tts.safe({ voice_id: "voc_x", text: "x", language_code: "zh" }).ok).toBe(true);
    expect(tts.safe({ voice_id: "voc_x", text: "x", language_code: "xx" }).ok).toBe(true);
  });

  test("guidance_scale outside 1.0–10.0 is refused; the bounds pass", () => {
    for (const guidance_scale of [0.9, 10.1]) {
      const r = safeUnchecked({ voice_id: "voc_x", text: "x", voice_settings: { guidance_scale } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.path).toEqual(["voice_settings", "guidance_scale"]);
    }
    for (const guidance_scale of [1, 10]) {
      expect(
        tts.safe({ voice_id: "voc_x", text: "x", voice_settings: { guidance_scale } }).ok,
      ).toBe(true);
    }
  });

  test("delivery accepts only sync|async (wire pattern ^(sync|async)$)", () => {
    expect(safeUnchecked({ voice_id: "voc_x", text: "x", delivery: "batch" }).ok).toBe(false);
    expect(tts.safe({ voice_id: "voc_x", text: "x", delivery: "async" }).ok).toBe(true);
  });

  test("an undocumented output_format is invalid_enum_value naming the six", () => {
    const r = safeUnchecked({ voice_id: "voc_x", text: "x", output_format: "ogg" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.meta?.allowed).toEqual([...OUTPUT_FORMATS]);
    }
  });

  test("all six documented output formats pass", () => {
    for (const output_format of OUTPUT_FORMATS) {
      expect(tts.safe({ voice_id: "voc_x", text: "x", output_format }).ok).toBe(true);
    }
  });
});

describe("breezeblue.tts URLs", () => {
  test("textToSpeechUrl appends only the query params that are set", () => {
    expect(textToSpeechUrl("voc_x")).toBe(`${TEXT_TO_SPEECH_BASE_URL}/voc_x`);
    expect(textToSpeechUrl("voc_x", { delivery: "async" })).toBe(
      `${TEXT_TO_SPEECH_BASE_URL}/voc_x?delivery=async`,
    );
  });

  test("textToSpeechStreamUrl targets the /stream route (not validated)", () => {
    expect(textToSpeechStreamUrl("voc_x", { output_format: "pcm" })).toBe(
      `${TEXT_TO_SPEECH_BASE_URL}/voc_x/stream?output_format=pcm`,
    );
  });
});

describe("breezeblue.tts SDK view (@breeze.blue/sdk)", () => {
  test("toSdk camelCases, drops nulls, and routes sync to convert", () => {
    const v = tts({
      voice_id: "voc_xeh3w54cqvnp",
      text: "Hello.",
      model_id: "breeze-tts-2",
      language_code: null,
      instructions: "Warmly.",
      voice_settings: { guidance_scale: 4 },
      output_format: "mp3",
    });
    expect(v.toSdk("breezeblue")).toEqual({
      voiceId: "voc_xeh3w54cqvnp",
      request: {
        text: "Hello.",
        modelId: "breeze-tts-2",
        instructions: "Warmly.",
        voiceSettings: { guidanceScale: 4 },
      },
      options: { outputFormat: "mp3" },
      method: "convert",
    });
  });

  test("delivery async routes to createJob (the SDK sets delivery itself)", () => {
    const v = tts({ voice_id: "voc_x", text: "x", delivery: "async" });
    const sdk = v.toSdk("breezeblue");
    expect(sdk.method).toBe("createJob");
    expect(sdk.options).toEqual({});
  });
});

describe("breezeblue cost estimation (list-price ceiling)", () => {
  test("prices at the published Free-plan $40 / 1M characters", () => {
    const r = tts.safe({ voice_id: "voc_x", text: "a".repeat(1000), model_id: "breeze-tts-2" });
    expect(r.ok).toBe(true);
    // 1000 chars × $40 / 1_000_000 chars = $0.04.
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.04, 10);
  });

  test("an omitted model_id still gets an estimate — the meter is per character, not per model", () => {
    const r = tts.safe({ voice_id: "voc_x", text: "a".repeat(500) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.02, 10);
  });

  test("maxCostUSD enforces over_budget", () => {
    const r = tts.safe(
      { voice_id: "voc_x", text: "a".repeat(10_000) },
      { maxCostUSD: 0.001 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });
});

describe("breezeblue catalog", () => {
  test("breeze-tts-2 is TTS-shaped, with no invented character cap", () => {
    const info = models["breeze-tts-2"];
    expect(info.limit.context).toBe(0);
    // No per-request text cap is published anywhere — omitted, not guessed.
    expect("characters" in info.limit).toBe(false);
    expect(info.modalities.input).toEqual(["text"]);
    expect(info.modalities.output).toEqual(["audio"]);
    expect(info.cost?.perMillionCharacters).toBe(TTS_COST_PER_MILLION_CHARACTERS_USD);
  });
});
