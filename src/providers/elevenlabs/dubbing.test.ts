/**
 * `elevenlabs.dub` and `elevenlabs.dubLanguage` — one multipart POST, N JSON
 * POSTs, and the facts a caller would otherwise learn from a 422 or from a
 * `failed` project twenty minutes later.
 *
 * The rules under test are all documented and all invisible to the schema:
 * `file` XOR `source_url` (both fields are individually optional in the
 * OpenAPI), `transcript` ⇒ `source_language`, the per-model BCP-47 tables with
 * v1's no-dialects refusal, the keyterm battery ElevenLabs shares with Scribe,
 * and the two response-side traps — a project that failed on an HTTP 200 and a
 * language target that is `completed` and stale at the same time.
 */

import { describe, expect, test } from "bun:test";
import {
  dub,
  dubToFormData,
  DUBBING_PROJECT_URL,
  DUBBING_REFERENCE_MAX_CHARACTERS,
  DUBBING_WEBHOOK_IDS_MAX,
} from "./dubbing";
import { dubLanguage, dubbingLanguageUrl } from "./dubbing-language";
import {
  DUBBING_V1_LANGUAGES,
  DUBBING_V2_BASE_LANGUAGES,
  DUBBING_V2_DIALECTS,
  DUBBING_V2_LANGUAGES,
} from "./dubbing-languages";
import { checkDubbingLanguage, checkDubbingProject } from "./check";
import { models, DUBBING_MODEL_IDS, DUBBING_V2_PER_AUDIO_MINUTE } from "./models";

const SOURCE_URL = "https://example.com/promo.mp4";

describe("the project wire", () => {
  test("multipart, and the validated result IS the body", () => {
    const project = dub({ source_url: SOURCE_URL, model_id: "dubbing_v2" });
    expect(project.request.url).toBe(DUBBING_PROJECT_URL);
    expect(project.request.url).toBe("https://api.elevenlabs.io/v1/dubbing/project");
    expect(project.request.method).toBe("POST");
    // Deliberately empty: fetch must derive the multipart boundary itself.
    expect(project.request.headers).toEqual({});
    expect(project.request.body).toBe("form");
    expect(JSON.parse(JSON.stringify(project))).toEqual({
      source_url: SOURCE_URL,
      model_id: "dubbing_v2",
    });
  });

  test("dubToFormData round-trips every field, Blobs included", async () => {
    const file = new Blob(["fake-mp4-bytes"], { type: "video/mp4" });
    const transcript = new Blob(['{"segments":[]}'], { type: "application/json" });
    const project = dub({
      file,
      source_language: "en",
      transcript,
      model_id: "dubbing_v2",
      reference: "Q3 marketing video",
      keyterms: ["Unmodel", "ElevenLabs"],
      webhook_ids: ["wh_1", "wh_2"],
      target_language: "es-MX",
    });

    const form = dubToFormData(project);
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(form.get("transcript")).toBeInstanceOf(Blob);
    expect(await (form.get("file") as Blob).text()).toBe("fake-mp4-bytes");
    expect(form.get("source_language")).toBe("en");
    expect(form.get("model_id")).toBe("dubbing_v2");
    expect(form.get("reference")).toBe("Q3 marketing video");
    expect(form.get("target_language")).toBe("es-MX");
    // Arrays ride item-by-item under the same key, as the SDK serializes them.
    expect(form.getAll("keyterms")).toEqual(["Unmodel", "ElevenLabs"]);
    expect(form.getAll("webhook_ids")).toEqual(["wh_1", "wh_2"]);
  });

  test("dubToFormData omits null and undefined rather than sending \"null\"", () => {
    const form = dubToFormData({ source_url: SOURCE_URL, reference: null, source_language: null });
    expect([...form.keys()]).toEqual(["source_url"]);
  });

  test('.toSdk("elevenlabs") camelCases into the request object the SDK takes', () => {
    const project = dub({
      source_url: SOURCE_URL,
      source_language: "en",
      model_id: "dubbing_v2",
      webhook_ids: ["wh_1"],
      target_language: "fr",
    });
    expect(project.toSdk("elevenlabs")).toEqual({
      sourceUrl: SOURCE_URL,
      sourceLanguage: "en",
      modelId: "dubbing_v2",
      webhookIds: ["wh_1"],
      targetLanguage: "fr",
    });
  });

  test("auth is prose, never a header unmodel writes", () => {
    const project = dub({ source_url: SOURCE_URL });
    expect(Object.keys(project.request.headers)).toEqual([]);
  });
});

describe("the source is required, and it is an either/or", () => {
  test("neither file nor source_url is a refusal that names both", () => {
    const r = dub.safe({ model_id: "dubbing_v2" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((i) => i.code)).toContain("invalid_shape");
      expect(r.errors.some((i) => i.message.includes("`source_url`"))).toBe(true);
      expect(r.errors.some((i) => i.message.includes("`file`"))).toBe(true);
    }
  });

  test("both together is refused too — ElevenLabs documents them as alternatives", () => {
    const r = dub.safe({ file: new Blob(["x"]), source_url: SOURCE_URL });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["source_url"]);
  });

  test("either one alone is fine", () => {
    expect(dub.safe({ source_url: SOURCE_URL }).ok).toBe(true);
    expect(dub.safe({ file: new Blob(["x"]) }).ok).toBe(true);
  });
});

describe("the documented cross-field rules", () => {
  test("transcript requires source_language", () => {
    const r = dub.safe({ source_url: SOURCE_URL, transcript: new Blob(["{}"]) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((i) => i.path[0] === "source_language");
      expect(issue?.message).toContain("`source_language` is required");
    }
    expect(
      dub.safe({ source_url: SOURCE_URL, transcript: new Blob(["{}"]), source_language: "en" }).ok,
    ).toBe(true);
  });

  test("reference caps at 500 characters", () => {
    expect(DUBBING_REFERENCE_MAX_CHARACTERS).toBe(500);
    const ok = dub.safe({ source_url: SOURCE_URL, reference: "x".repeat(500) });
    expect(ok.ok).toBe(true);
    const over = dub.safe({ source_url: SOURCE_URL, reference: "x".repeat(501) });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors[0]?.meta?.limit).toBe(500);
  });

  test("webhook_ids caps at 3", () => {
    expect(DUBBING_WEBHOOK_IDS_MAX).toBe(3);
    expect(dub.safe({ source_url: SOURCE_URL, webhook_ids: ["a", "b", "c"] }).ok).toBe(true);
    expect(dub.safe({ source_url: SOURCE_URL, webhook_ids: ["a", "b", "c", "d"] }).ok).toBe(false);
  });

  test("the keyterm battery — the Scribe rules, plus the characters dubbing refuses", () => {
    const long = dub.safe({ source_url: SOURCE_URL, keyterms: ["x".repeat(50)] });
    expect(long.ok).toBe(false);

    const wordy = dub.safe({ source_url: SOURCE_URL, keyterms: ["a b c d e f"] });
    expect(wordy.ok).toBe(false);

    // Dubbing-only: "the characters `<>{}[]\` are not allowed".
    const bracketed = dub.safe({ source_url: SOURCE_URL, keyterms: ["<brand>"] });
    expect(bracketed.ok).toBe(false);
    if (!bracketed.ok) {
      expect(bracketed.errors[0]?.message).toContain("not allowed in a keyterm");
      expect(bracketed.errors[0]?.meta?.found).toEqual(["<", ">"]);
    }

    // …and Scribe does NOT get that rule, because ElevenLabs does not publish
    // it there. Verified by the stt suite staying green; asserted here as the
    // shape of the shared battery.
    expect(dub.safe({ source_url: SOURCE_URL, keyterms: ["Unmodel"] }).ok).toBe(true);
  });
});

describe("model gating and the undocumented default", () => {
  test("the two dubbing ids are in the catalog with their published rates", () => {
    expect([...DUBBING_MODEL_IDS].sort()).toEqual(["dubbing_v1", "dubbing_v2"]);
    expect(models.dubbing_v2.cost.perAudioMinute).toBe(2.2);
    expect(models.dubbing_v1.cost.perAudioMinute).toBe(0.5);
  });

  test("a tts model id on a dubbing request is refused, not silently accepted", () => {
    const r = dub.safe({ source_url: SOURCE_URL, model_id: "eleven_v3" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((i) => i.code === "unsupported_capability");
      expect(issue?.message).toContain("is not a dubbing model");
    }
  });

  test("an omitted model_id degrades rather than inventing the system default", () => {
    const r = dub.safe({ source_url: SOURCE_URL, target_language: "fr" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // No model → no unknown_model warning, and no estimate to give.
      expect(r.warnings).toEqual([]);
      expect(r.estimate).toEqual({});
    }
  });

  test("no request-time estimate, ever — the body carries no duration", () => {
    const r = dub.safe({ source_url: SOURCE_URL, model_id: "dubbing_v2" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate).toEqual({});
  });
});

describe("the BCP-47 tables", () => {
  test("the transcribed shapes are the ones the capabilities page publishes", () => {
    expect(DUBBING_V2_BASE_LANGUAGES.length).toBe(94);
    expect(DUBBING_V2_DIALECTS.length).toBe(14);
    expect(DUBBING_V2_LANGUAGES.length).toBe(108);
    expect(DUBBING_V1_LANGUAGES.length).toBe(86);
    // No duplicates in either table — a transcription slip's most likely shape.
    expect(new Set(DUBBING_V2_LANGUAGES).size).toBe(DUBBING_V2_LANGUAGES.length);
    expect(new Set(DUBBING_V1_LANGUAGES).size).toBe(DUBBING_V1_LANGUAGES.length);
    // Every dialect's base tag is itself a v2 language.
    for (const dialect of DUBBING_V2_DIALECTS) {
      expect(DUBBING_V2_BASE_LANGUAGES).toContain(dialect.split("-")[0] as never);
    }
    // v1 is NOT a subset of v2 — losing a language is possible in both
    // directions, which is why the tables are separate.
    expect(DUBBING_V1_LANGUAGES).toContain("ga");
    expect(DUBBING_V2_BASE_LANGUAGES).not.toContain("ga" as never);
  });

  test("a v2 dialect on dubbing_v1 is refused, naming the base tag", () => {
    const r = dub.safe({ source_url: SOURCE_URL, model_id: "dubbing_v1", target_language: "es-MX" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((i) => i.code === "invalid_enum_value");
      expect(issue?.message).toContain("Dubbing v1 does not support dialects");
      expect(issue?.meta?.suggestion).toBe("es");
    }
    // …and the base tag is accepted.
    expect(
      dub.safe({ source_url: SOURCE_URL, model_id: "dubbing_v1", target_language: "es" }).ok,
    ).toBe(true);
  });

  test("dubbing_v2 takes both base tags and documented dialects", () => {
    for (const tag of ["es", "es-MX", "en-GB", "pt-BR", "zh-TW", "yue"]) {
      expect(
        dub.safe({ source_url: SOURCE_URL, model_id: "dubbing_v2", target_language: tag }).ok,
      ).toBe(true);
    }
    // An undocumented region subtag is not a dialect v2 accepts.
    const r = dub.safe({ source_url: SOURCE_URL, model_id: "dubbing_v2", target_language: "es-PE" });
    expect(r.ok).toBe(false);
  });

  test("a language v1 has and v2 does not is refused per model", () => {
    expect(
      dub.safe({ source_url: SOURCE_URL, model_id: "dubbing_v1", target_language: "ga" }).ok,
    ).toBe(true);
    expect(
      dub.safe({ source_url: SOURCE_URL, model_id: "dubbing_v2", target_language: "ga" }).ok,
    ).toBe(false);
  });

  test("with no model named, the union applies — and nothing outside it does", () => {
    expect(dub.safe({ source_url: SOURCE_URL, target_language: "ga" }).ok).toBe(true);
    expect(dub.safe({ source_url: SOURCE_URL, target_language: "es-MX" }).ok).toBe(true);
    const r = dub.safe({ source_url: SOURCE_URL, target_language: "xx-YY" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("neither the Dubbing v2 table");
  });
});

describe("the language-target wire", () => {
  test("JSON, and project_id becomes the path rather than a body field", () => {
    const target = dubLanguage({ project_id: "proj_123", target_language: "es-MX" });
    expect(target.request.url).toBe(
      "https://api.elevenlabs.io/v1/dubbing/project/proj_123/language",
    );
    expect(target.request.url).toBe(dubbingLanguageUrl("proj_123"));
    expect(target.request.method).toBe("POST");
    expect(target.request.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(JSON.stringify(target))).toEqual({ target_language: "es-MX" });
    expect(Object.keys(target)).not.toContain("project_id");
  });

  test("the project id is encoded into the path", () => {
    expect(dubbingLanguageUrl("proj/1 2")).toBe(
      "https://api.elevenlabs.io/v1/dubbing/project/proj%2F1%202/language",
    );
  });

  test("cloning_strength is an integer 0-10", () => {
    expect(
      dubLanguage.safe({
        project_id: "p",
        target_language: "es",
        voice_settings: { cloning_strength: 0 },
      }).ok,
    ).toBe(true);
    expect(
      dubLanguage.safe({
        project_id: "p",
        target_language: "es",
        voice_settings: { cloning_strength: 10 },
      }).ok,
    ).toBe(true);
    expect(
      dubLanguage.safe({
        project_id: "p",
        target_language: "es",
        voice_settings: { cloning_strength: 11 },
      }).ok,
    ).toBe(false);
    expect(
      dubLanguage.safe({
        project_id: "p",
        target_language: "es",
        voice_settings: { cloning_strength: 7.5 },
      }).ok,
    ).toBe(false);
  });

  test("translations caps at 20000 entries", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 20001; i += 1) many[String(i)] = "x";
    const r = dubLanguage.safe({ project_id: "p", target_language: "es", translations: many });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta?.limit).toBe(20000);
  });

  test("translations caps at 4 MiB of text", () => {
    const big = { one: "x".repeat(4 * 1024 * 1024 + 1) };
    const r = dubLanguage.safe({ project_id: "p", target_language: "es", translations: big });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("media_too_large");
  });

  test("no model_id on this wire — the stale prose says otherwise and is wrong", () => {
    // `model_id` is not a declared param, so it rides as an unknown one: a
    // warning, sent as written, rather than a typed field pretending the
    // per-target override is reachable.
    const r = dubLanguage.safe({
      project_id: "p",
      target_language: "es",
      // @ts-expect-error `model_id` is not part of this body — the project owns the model.
      model_id: "dubbing_v2",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("unknown_param");
  });

  test('.toSdk("elevenlabs") drops the project id and camelCases the rest', () => {
    const target = dubLanguage({
      project_id: "proj_123",
      target_language: "es-MX",
      voice_settings: { cloning_strength: 9 },
    });
    expect(target.toSdk("elevenlabs")).toEqual({
      targetLanguage: "es-MX",
      voiceSettings: { cloningStrength: 9 },
    });
  });
});

describe("the response checkers", () => {
  test("a project that failed on an HTTP 200 is reported, with retryable", () => {
    const report = checkDubbingProject({
      project_id: "proj_1",
      status: "failed",
      error: { code: "unsupported_media", message: "The file has no audio track.", retryable: false },
    });
    expect(report.finishReason).toBe("failed");
    const issue = report.warnings.find((w) => w.meta?.kind === "dubbing_failed");
    expect(issue?.message).toContain("unsupported_media");
    expect(issue?.message).toContain("Retrying the same input will fail the same way.");
    expect(issue?.meta?.retryable).toBe(false);
  });

  test("cost is duration x languages x the per-minute rate", () => {
    const report = checkDubbingProject({
      status: "ready",
      model_id: "dubbing_v2",
      media: { duration_s: 600 },
      language_ids: ["lang_a", "lang_b", "lang_c"],
    });
    // 10 minutes, three languages, $2.20/min.
    expect(report.costUSD).toBeCloseTo(10 * 3 * DUBBING_V2_PER_AUDIO_MINUTE, 10);
  });

  test("no duration, no languages, or no model — no cost, and never a guess", () => {
    expect(checkDubbingProject({ status: "ready", model_id: "dubbing_v2" }).costUSD).toBeUndefined();
    expect(
      checkDubbingProject({ status: "ready", media: { duration_s: 60 }, language_ids: ["a"] })
        .costUSD,
    ).toBeUndefined();
    expect(
      checkDubbingProject({ status: "ready", model_id: "dubbing_v2", media: { duration_s: 60 } })
        .costUSD,
    ).toBeUndefined();
  });

  test("voices_not_permitted is surfaced — a silently swapped voice is the point", () => {
    const report = checkDubbingProject({
      status: "ready",
      warnings: [
        {
          type: "voices_not_permitted",
          speaker_ids: ["spk_1"],
          message: "One speaker's voice could not be cloned.",
        },
      ],
    });
    const issue = report.warnings.find((w) => w.meta?.kind === "dubbing_warning");
    expect(issue?.meta?.type).toBe("voices_not_permitted");
    expect(issue?.meta?.speakerIds).toEqual(["spk_1"]);
  });

  test("a language target that is `completed` and STALE is reported", () => {
    const report = checkDubbingLanguage({
      language_id: "lang_a",
      status: "completed",
      revision: 3,
      output_revision: 1,
      outputs: { lossless_audio: "https://signed.example/dub.wav" },
    });
    expect(report.finishReason).toBe("completed");
    const issue = report.warnings.find((w) => w.meta?.kind === "stale_output");
    expect(issue?.meta).toMatchObject({ revision: 3, outputRevision: 1 });
    expect(issue?.message).toContain("STALE");
  });

  test("an up-to-date target is silent", () => {
    const report = checkDubbingLanguage({
      status: "completed",
      revision: 2,
      output_revision: 2,
      outputs: { lossless_audio: "https://signed.example/dub.wav" },
    });
    expect(report.warnings).toEqual([]);
  });

  test("project_failed on a target points at the project", () => {
    const report = checkDubbingLanguage({
      status: "failed",
      error: { code: "project_failed", message: "The parent project failed.", retryable: false },
    });
    expect(report.warnings[0]?.message).toContain("read the project for the underlying cause");
  });

  test("neither checker throws on a response that is nothing like the documented shape", () => {
    expect(() => checkDubbingProject({})).not.toThrow();
    expect(() => checkDubbingLanguage({})).not.toThrow();
    expect(() => checkDubbingProject({ media: null, error: null, warnings: [] })).not.toThrow();
    expect(() => checkDubbingLanguage({ outputs: null, output_revision: null })).not.toThrow();
  });
});
