import { describe, expect, test } from "bun:test";
import {
  speech,
  speechDetailed,
  SPEECH_BYTES_URL,
  SPEECH_URL,
  LMNT_VERSION,
  SPEECH_FORMATS,
  SPEECH_LANGUAGES,
  STREAMABLE_FORMATS,
  NON_STREAMABLE_FORMATS,
} from "./speech";
import { models, LMNT_MAX_CHARACTERS } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = speech.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("lmnt.speech happy path", () => {
  test("returns a wire-pure body and request meta with the version header", () => {
    const v = speech({ text: "Hello world", voice: "leah", model: "blizzard", format: "mp3" });

    expect(Object.keys(v)).toEqual(["text", "voice", "model", "format"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual({
      text: "Hello world",
      voice: "leah",
      model: "blizzard",
      format: "mp3",
    });

    expect(v.request.url).toBe(SPEECH_BYTES_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    expect(v.request.headers["lmnt-version"]).toBe(LMNT_VERSION);
  });

  test("speechDetailed targets /v1/ai/speech and accepts return_timestamps", () => {
    const v = speechDetailed({ text: "hi", voice: "leah", return_timestamps: true });
    expect(v.request.url).toBe(SPEECH_URL);
    expect(v.request.headers["lmnt-version"]).toBe(LMNT_VERSION);
    expect(JSON.parse(JSON.stringify(v))).toEqual({
      text: "hi",
      voice: "leah",
      return_timestamps: true,
    });
  });

  test("toSdk returns the wire body unchanged", () => {
    const v = speech({ text: "hi", voice: "leah" });
    expect(v.toSdk("lmnt")).toEqual({ text: "hi", voice: "leah" });
  });

  test("headers are not shared between validations", () => {
    const a = speech({ text: "hi", voice: "leah" });
    const b = speech({ text: "hi", voice: "leah" });
    a.request.headers["X-API-Key"] = "secret";
    expect(b.request.headers["X-API-Key"]).toBeUndefined();
  });

  test("unknown model warns but validates", () => {
    const r = speech.safe({ text: "hi", voice: "leah", model: "avalanche" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("unknown top-level params warn", () => {
    const r = safeUnchecked({ text: "hi", voice: "leah", speed: 1.5 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.find((w) => w.code === "unknown_param")?.path).toEqual(["speed"]);
  });

  test("required fields are enforced", () => {
    expect(safeUnchecked({ voice: "leah" }).ok).toBe(false);
    expect(safeUnchecked({ text: "hi" }).ok).toBe(false);
    expect(safeUnchecked({ text: "", voice: "leah" }).ok).toBe(false);
    expect(safeUnchecked({ text: "hi", voice: "" }).ok).toBe(false);
  });
});

describe("lmnt.speech enums", () => {
  test("every documented format passes", () => {
    for (const format of SPEECH_FORMATS) {
      expect(speech.safe({ text: "hi", voice: "leah", format }).ok).toBe(true);
    }
    expect([...STREAMABLE_FORMATS, ...NON_STREAMABLE_FORMATS]).toEqual([...SPEECH_FORMATS]);
  });

  test("an undocumented format is invalid_enum_value", () => {
    const r = safeUnchecked({ text: "hi", voice: "leah", format: "flac" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const err = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(err?.path).toEqual(["format"]);
      expect(err?.meta?.allowed).toEqual([...SPEECH_FORMATS]);
    }
  });

  test("an undocumented language is invalid_enum_value", () => {
    const r = safeUnchecked({ text: "hi", voice: "leah", language: "xx" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.find((e) => e.code === "invalid_enum_value")?.path).toEqual(["language"]);
    }
  });

  test("auto and a documented code pass", () => {
    expect(speech.safe({ text: "hi", voice: "leah", language: "auto" }).ok).toBe(true);
    expect(speech.safe({ text: "hi", voice: "leah", language: "ja" }).ok).toBe(true);
    expect(SPEECH_LANGUAGES).toContain("auto");
  });

  test("sample_rate is a closed list, not a range", () => {
    expect(speech.safe({ text: "hi", voice: "leah", sample_rate: 24000 }).ok).toBe(true);
    expect(safeUnchecked({ text: "hi", voice: "leah", sample_rate: 22050 }).ok).toBe(false);
    expect(safeUnchecked({ text: "hi", voice: "leah", sample_rate: 48000 }).ok).toBe(false);
  });

  test("temperature and top_p are unbounded — LMNT documents no hard range", () => {
    const r = speech.safe({ text: "hi", voice: "leah", temperature: 2.5, top_p: 0.1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });
});

describe("lmnt.speech character limit", () => {
  test("text over 5000 characters is over_output_limit with character meta", () => {
    expect(models.blizzard.limit.characters).toBe(LMNT_MAX_CHARACTERS);
    const text = "a".repeat(LMNT_MAX_CHARACTERS + 1);
    const r = speech.safe({ text, voice: "leah", model: "blizzard" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const err = r.errors.find((e) => e.code === "over_output_limit");
      expect(err?.path).toEqual(["text"]);
      expect(err?.meta).toMatchObject({
        limitCharacters: LMNT_MAX_CHARACTERS,
        actualCharacters: LMNT_MAX_CHARACTERS + 1,
      });
    }
  });

  test("the cap applies even when model is omitted", () => {
    const r = speech.safe({ text: "a".repeat(LMNT_MAX_CHARACTERS + 1), voice: "leah" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "over_output_limit")).toBe(true);
  });

  test("exactly at the cap passes", () => {
    const r = speech.safe({ text: "a".repeat(LMNT_MAX_CHARACTERS), voice: "leah" });
    expect(r.ok).toBe(true);
  });

  test("speechDetailed enforces the same cap", () => {
    const r = speechDetailed.safe({ text: "a".repeat(LMNT_MAX_CHARACTERS + 1), voice: "leah" });
    expect(r.ok).toBe(false);
  });
});

describe("lmnt.speech cost estimation", () => {
  test("prices per input character at the catalog rate", () => {
    const r = speech.safe({ text: "a".repeat(1000), voice: "leah", model: "blizzard" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo((1000 * 50) / 1_000_000, 12);
  });

  test("maxCostUSD turns an over-budget request into an error", () => {
    expect(() =>
      speech({ text: "a".repeat(5000), voice: "leah", model: "blizzard" }, { maxCostUSD: 0.0001 }),
    ).toThrow(UnmodelValidationError);
  });

  test("no estimate when the model is unknown to the catalog", () => {
    const r = speech.safe({ text: "hi", voice: "leah", model: "avalanche" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});
