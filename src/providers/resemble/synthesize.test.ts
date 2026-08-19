import { describe, expect, test } from "bun:test";
import {
  synthesize,
  synthesizeStream,
  SYNTHESIZE_URL,
  SYNTHESIZE_STREAM_URL,
  OUTPUT_FORMATS,
  SAMPLE_RATES,
  PRECISIONS,
} from "./synthesize";
import { checkSynthesis } from "./check";
import { models, RESEMBLE_MAX_CHARACTERS, TTS_MODEL_IDS, STS_MODEL_IDS } from "./models";
import type { ModelInfo } from "../../core/catalog-types";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// No Resemble entry declares `cost`, so the inferred literal types have no
// such key — read them through ModelInfo to assert the absence.
const catalog: Record<string, ModelInfo> = models;

const safeSync = synthesize.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;
const safeStream = synthesizeStream.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("resemble.synthesize happy path", () => {
  test("returns a wire-pure body and targets the synthesis cluster", () => {
    const v = synthesize({
      voice_uuid: "55592656",
      data: "Hello world",
      output_format: "mp3",
      sample_rate: 44100,
    });
    expect(Object.keys(v)).toEqual(["voice_uuid", "data", "output_format", "sample_rate"]);
    expect(v.request.url).toBe(SYNTHESIZE_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    expect(v.toSdk("resemble")).toEqual({
      voice_uuid: "55592656",
      data: "Hello world",
      output_format: "mp3",
      sample_rate: 44100,
    });
  });

  test("the streaming route has its own URL", () => {
    const v = synthesizeStream({
      voice_uuid: "55592656",
      data: "Hello",
      sample_rate: 44100,
      precision: "PCM_16",
    });
    expect(Object.keys(v)).toEqual(["voice_uuid", "data", "sample_rate", "precision"]);
    expect(v.request.url).toBe(SYNTHESIZE_STREAM_URL);
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("a plain request produces no warnings", () => {
    const r = synthesize.safe({ voice_uuid: "55592656", data: "Hello" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("required fields are enforced", () => {
    expect(safeSync({ data: "hi" }).ok).toBe(false);
    expect(safeSync({ voice_uuid: "v" }).ok).toBe(false);
    expect(safeSync({ voice_uuid: "v", data: "" }).ok).toBe(false);
    expect(safeSync({ voice_uuid: "", data: "hi" }).ok).toBe(false);
  });

  test("unknown top-level params warn", () => {
    const r = safeSync({ voice_uuid: "v", data: "hi", model: "chatterbox" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.find((w) => w.code === "unknown_param")?.path).toEqual(["model"]);
  });

  test("no model id is resolved, so nothing is priced or gated", () => {
    const r = synthesize.safe({ voice_uuid: "v", data: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.estimate.costUSD).toBeUndefined();
      expect(r.warnings.map((w) => w.code)).not.toContain("unknown_model");
    }
    // The catalog carries no rate either — Resemble publishes none.
    expect(catalog["resemble-ultra"]?.cost).toBeUndefined();
  });

  test("streaming rejects sync-only fields at the type and shape level", () => {
    // `output_format` and `title` are undocumented on /stream; they still
    // pass through as unknown params with a warning rather than silently.
    const r = safeStream({ voice_uuid: "v", data: "hi", output_format: "mp3" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.find((w) => w.code === "unknown_param")?.path).toEqual(["output_format"]);
    }
  });
});

describe("resemble.synthesize enums", () => {
  test("every documented output_format, sample_rate and precision passes", () => {
    for (const output_format of OUTPUT_FORMATS) {
      expect(synthesize.safe({ voice_uuid: "v", data: "hi", output_format }).ok).toBe(true);
    }
    for (const sample_rate of SAMPLE_RATES) {
      expect(synthesize.safe({ voice_uuid: "v", data: "hi", sample_rate }).ok).toBe(true);
    }
    for (const precision of PRECISIONS) {
      expect(synthesize.safe({ voice_uuid: "v", data: "hi", precision }).ok).toBe(true);
    }
  });

  test("undocumented enum values are rejected", () => {
    expect(safeSync({ voice_uuid: "v", data: "hi", output_format: "flac" }).ok).toBe(false);
    expect(safeSync({ voice_uuid: "v", data: "hi", sample_rate: 24000 }).ok).toBe(false);
    expect(safeSync({ voice_uuid: "v", data: "hi", precision: "PCM_8" }).ok).toBe(false);
  });

  test("the streaming route shares the sample_rate and precision lists", () => {
    expect(synthesizeStream.safe({ voice_uuid: "v", data: "hi", sample_rate: 22050 }).ok).toBe(true);
    expect(safeStream({ voice_uuid: "v", data: "hi", precision: "PCM_8" }).ok).toBe(false);
  });
});

describe("resemble precision/format pairing", () => {
  test("precision with mp3 output warns as ignored", () => {
    const r = synthesize.safe({
      voice_uuid: "v",
      data: "hi",
      output_format: "mp3",
      precision: "PCM_16",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const warn = r.warnings.find((w) => w.path[0] === "precision");
      expect(warn?.code).toBe("unsupported_param");
      expect(warn?.meta?.ignored).toBe(true);
    }
  });

  test("precision with the default (wav) output is clean", () => {
    const r = synthesize.safe({ voice_uuid: "v", data: "hi", precision: "PCM_16" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("precision with explicit wav output is clean", () => {
    const r = synthesize.safe({
      voice_uuid: "v",
      data: "hi",
      output_format: "wav",
      precision: "MULAW",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });
});

describe("resemble character limit", () => {
  test("data over 2000 characters is over_output_limit with character meta", () => {
    expect(models["resemble-ultra"].limit.characters).toBe(RESEMBLE_MAX_CHARACTERS);
    const data = "a".repeat(RESEMBLE_MAX_CHARACTERS + 1);
    const r = synthesize.safe({ voice_uuid: "v", data });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const err = r.errors.find((e) => e.code === "over_output_limit");
      expect(err?.path).toEqual(["data"]);
      expect(err?.meta).toMatchObject({
        limitCharacters: RESEMBLE_MAX_CHARACTERS,
        actualCharacters: RESEMBLE_MAX_CHARACTERS + 1,
      });
    }
  });

  test("the streaming route enforces the same cap", () => {
    const r = synthesizeStream.safe({
      voice_uuid: "v",
      data: "a".repeat(RESEMBLE_MAX_CHARACTERS + 1),
    });
    expect(r.ok).toBe(false);
  });

  test("exactly at the cap passes", () => {
    expect(synthesize.safe({ voice_uuid: "v", data: "a".repeat(RESEMBLE_MAX_CHARACTERS) }).ok).toBe(
      true,
    );
  });
});

describe("resemble catalog", () => {
  test("the TTS group is resemble-ultra and the STS group is separate", () => {
    expect(TTS_MODEL_IDS).toEqual(["resemble-ultra"]);
    expect([...STS_MODEL_IDS].sort()).toEqual(["sts-legacy", "sts-v1", "sts-v2"]);
  });

  test("no catalog entry carries an invented price", () => {
    for (const info of Object.values(catalog)) expect(info.cost).toBeUndefined();
  });

  test("the retired Chatterbox ids are absent", () => {
    for (const id of ["chatterbox", "chatterbox-hd", "chatterbox-turbo", "tts-v4"]) {
      expect(Object.hasOwn(models, id)).toBe(false);
    }
  });
});

describe("resemble.checkSynthesis", () => {
  test("a normal response is clean", () => {
    const report = checkSynthesis({
      success: true,
      audio_content: "UklGRg==",
      duration: 1.4,
      output_format: "wav",
      sample_rate: 48000,
    });
    expect(report.warnings).toEqual([]);
    expect(report.costUSD).toBeUndefined();
  });

  test("success: false and empty audio both warn", () => {
    const report = checkSynthesis({ success: false, audio_content: "", duration: 0 });
    expect(report.warnings.map((w) => w.meta?.kind)).toEqual([
      "not_successful",
      "empty_audio",
      "zero_length_audio",
    ]);
  });

  test("provider issues are surfaced one per entry", () => {
    const report = checkSynthesis({
      success: true,
      audio_content: "UklGRg==",
      duration: 1,
      issues: ["ssml tag ignored", { code: 42 }],
    });
    expect(report.warnings).toHaveLength(2);
    expect(report.warnings[0]?.path).toEqual(["issues", 0]);
    expect(report.warnings[1]?.message).toContain('{"code":42}');
  });

  test("never throws on a malformed response", () => {
    expect(() => checkSynthesis({} as never)).not.toThrow();
    expect(() => checkSynthesis({ issues: null } as never)).not.toThrow();
  });
});
