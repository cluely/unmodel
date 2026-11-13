import { describe, expect, test } from "bun:test";
import {
  stt,
  TRANSCRIPT_URL,
  DEFAULT_SPEECH_MODELS,
  ASSEMBLYAI_DOMAINS,
  PROMPT_MAX_WORDS,
  KEYTERM_MAX_WORDS,
  CUSTOM_SPELLING_FROM_MAX_WORDS,
  STATIC_ENTITY_MAX_LABELS,
  STATIC_ENTITY_MAX_TERMS_PER_LABEL,
  STATIC_ENTITY_MAX_TERM_CHARACTERS,
} from "./stt";
import { models } from "./models";
import { ASSEMBLYAI_STT_MODEL_PARAMS, MODELS } from "./stt-params";
import { stt as unifiedStt } from "../../unified/stt";

const AUDIO = "https://cdn.assemblyai.com/upload/abc123";

describe("assemblyai.stt happy path", () => {
  test("returns a wire-pure body with hidden toSdk/request", () => {
    const params = {
      audio_url: AUDIO,
      speech_models: ["universal-3-5-pro"],
      speaker_labels: true,
      punctuate: true,
    };
    const v = stt(params);

    expect(Object.keys(v)).toEqual(["audio_url", "speech_models", "speaker_labels", "punctuate"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(TRANSCRIPT_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    // The official SDK's transcripts.submit accepts wire-shaped params.
    expect(v.toSdk("assemblyai")).toEqual(params);
  });

  test("missing audio_url is an error", () => {
    const bad = stt.safe as unknown as (p: unknown) => ReturnType<typeof stt.safe>;
    const r = bad({ speech_models: ["universal-2"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("speech_models routing list validates; head drives model checks", () => {
    const r = stt.safe({ audio_url: AUDIO, speech_models: ["universal-3-5-pro", "universal-2"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
    expect([...DEFAULT_SPEECH_MODELS]).toEqual(["universal-3-5-pro", "universal-2"]);
  });

  test("deprecated slam-1 warns; unknown model warns", () => {
    expect(models["slam-1"].status).toBe("deprecated");
    const slam = stt.safe({ audio_url: AUDIO, speech_model: "slam-1" });
    expect(slam.ok).toBe(true);
    if (slam.ok) expect(slam.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);

    const unknown = stt.safe({ audio_url: AUDIO, speech_model: "best" });
    expect(unknown.ok).toBe(true);
    if (unknown.ok) expect(unknown.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("a current model name in the singular speech_model is refused (errors page, 2026-11-12)", () => {
    // "Passing a current model name ( universal-2 , universal-3-5-pro ) to the
    // async speech_model field now returns a 400."
    for (const model of ["universal-3-5-pro", "universal-2"] as const) {
      const r = stt.safe({ audio_url: AUDIO, speech_model: model });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.errors[0]).toMatchObject({
        code: "invalid_enum_value",
        path: ["speech_model"],
        meta: { value: model, source: "https://www.assemblyai.com/docs/errors" },
      });
      expect(r.errors[0]?.message).toContain(`speech_models: ["${model}"]`);
    }
    // "Passing a legacy name ( best , nano , universal ) returns 200", and the
    // SDK types slam-1 as a legacy speech_model value.
    expect(stt.safe({ audio_url: AUDIO, speech_model: "best" }).ok).toBe(true);
    expect(stt.safe({ audio_url: AUDIO, speech_model: "slam-1" }).ok).toBe(true);
  });
});

describe("assemblyai.stt pairing + gating rules", () => {
  test("speakers_expected conflicts with speaker_options", () => {
    const r = stt.safe({
      audio_url: AUDIO,
      speaker_labels: true,
      speakers_expected: 2,
      speaker_options: { min_speakers_expected: 1, max_speakers_expected: 4 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("conflicts with `speaker_options`");
  });

  test("content_safety_confidence requires content_safety: true", () => {
    const r = stt.safe({ audio_url: AUDIO, content_safety_confidence: 80 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["content_safety_confidence"]);
  });

  test("audio_end_at must exceed audio_start_from", () => {
    const r = stt.safe({ audio_url: AUDIO, audio_start_from: 5000, audio_end_at: 5000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["audio_end_at"]);
  });

  test("sentiment_analysis with punctuate: false is rejected", () => {
    const r = stt.safe({ audio_url: AUDIO, sentiment_analysis: true, punctuate: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["sentiment_analysis"]);
  });

  test("prompt is rejected when routing cannot reach universal-3-5-pro", () => {
    const r = stt.safe({
      audio_url: AUDIO,
      speech_models: ["universal-2"],
      prompt: "Names: Guilherme, Soniox, Deepgram.",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["prompt"]);
    }
  });

  test("prompt passes on the default routing (includes universal-3-5-pro)", () => {
    const r = stt.safe({ audio_url: AUDIO, prompt: "medical terms ahead" });
    expect(r.ok).toBe(true);
  });

  test("keyterms_prompt over 200 terms is rejected for universal-2", () => {
    const terms = Array.from({ length: 201 }, (_, i) => `term-${i}`);
    const r = stt.safe({ audio_url: AUDIO, speech_models: ["universal-2"], keyterms_prompt: terms });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta?.limit).toBe(200);

    const pro = stt.safe({
      audio_url: AUDIO,
      speech_models: ["universal-3-5-pro"],
      keyterms_prompt: terms,
    });
    expect(pro.ok).toBe(true);
  });

  test("enum fields reject undocumented values via the schema", () => {
    const bad = stt.safe as unknown as (p: unknown) => ReturnType<typeof stt.safe>;
    const r = bad({ audio_url: AUDIO, redact_pii_sub: "stars" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });
});

describe("assemblyai.stt cost estimation", () => {
  // `as const`: a hoisted path infers `string[]`, and the media coordinate is
  // a tuple whose first segment is a key of the params — see `MediaPathFor`.
  const oneHour = { media: [{ path: ["audio_url"] as const, durationSeconds: 3600 }] };

  test("universal-3-5-pro: 1 hour ≈ $0.21 (pricing page rate)", () => {
    const r = stt.safe({ audio_url: AUDIO, speech_models: ["universal-3-5-pro"] }, oneHour);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.21, 10);
  });

  test("universal-2: 1 hour ≈ $0.15", () => {
    const r = stt.safe({ audio_url: AUDIO, speech_models: ["universal-2"] }, oneHour);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.15, 10);
  });

  test("default routing (no model fields) is priced at the universal-3-5-pro rate", () => {
    const r = stt.safe({ audio_url: AUDIO }, oneHour);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.21, 10);
  });

  test("over_budget fires against the estimated cost", () => {
    const r = stt.safe({ audio_url: AUDIO }, { ...oneHour, maxCostUSD: 0.2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });
});

describe("assemblyai.stt documented pairing rules (doc audit 2026-08-13)", () => {
  const base = { audio_url: AUDIO } as const;

  test("redaction sub-options require redact_pii", () => {
    for (const key of [
      "redact_pii_audio",
      "redact_pii_return_unredacted",
      "redact_static_entities",
    ] as const) {
      const value = key === "redact_static_entities" ? { INTERNAL_TOOL: ["Bearclaw"] } : true;
      const r = stt.safe({ ...base, [key]: value } as never);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.path).toEqual([key]);
    }
    const ok = stt.safe({ ...base, redact_pii: true, redact_pii_audio: true });
    expect(ok.ok).toBe(true);
  });

  test("redact_pii requires text formatting", () => {
    const noFormat = stt.safe({ ...base, redact_pii: true, format_text: false });
    expect(noFormat.ok).toBe(false);
    if (!noFormat.ok) expect(noFormat.errors[0]?.path).toEqual(["redact_pii"]);
  });

  test("speaker_labels requires punctuation and speaker_options requires speaker_labels", () => {
    const labels = stt.safe({ ...base, speaker_labels: true, punctuate: false });
    expect(labels.ok).toBe(false);

    const options = stt.safe({ ...base, speaker_options: { max_speakers_expected: 3 } });
    expect(options.ok).toBe(false);
    if (!options.ok) expect(options.errors[0]?.path).toEqual(["speaker_options"]);

    const ok = stt.safe({
      ...base,
      speaker_labels: true,
      speaker_options: { max_speakers_expected: 3 },
    });
    expect(ok.ok).toBe(true);
  });

  test("language_code conflicts with language_detection: true", () => {
    const r = stt.safe({ ...base, language_code: "de", language_detection: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["language_code"]);

    // language_code alone (detection implicitly off) is the documented shape.
    expect(stt.safe({ ...base, language_code: "de" }).ok).toBe(true);
  });

  test('language_codes must include "en" on a Universal-2-only routing (code-switching guide, 2026-11-12)', () => {
    const u2 = stt.safe({ ...base, speech_models: ["universal-2"], language_codes: ["de", "fr"] });
    expect(u2.ok).toBe(false);
    if (!u2.ok) {
      expect(u2.errors[0]?.path).toEqual(["language_codes"]);
      expect(u2.errors[0]?.message).toContain('"universal-3-5-pro" takes any set of languages');
    }
    expect(
      stt.safe({ ...base, speech_models: ["universal-2"], language_codes: ["en", "es"] }).ok,
    ).toBe(true);
    // "On Universal-3.5 Pro, `language_codes` accepts any number of languages,
    // and English is **not** required" — the default routing heads with it.
    expect(stt.safe({ ...base, language_codes: ["es", "fr"] }).ok).toBe(true);
    expect(
      stt.safe({ ...base, speech_models: ["universal-3-5-pro"], language_codes: ["es", "fr", "de"] })
        .ok,
    ).toBe(true);
    // …and the unified `languages` reaches it.
    const unified = unifiedStt({
      model: "assemblyai/universal-3-5-pro",
      audio: { url: AUDIO },
      languages: ["es", "fr"],
    });
    expect(JSON.parse(JSON.stringify(unified))).toMatchObject({ language_codes: ["es", "fr"] });
  });
});

describe("assemblyai.stt documented size limits (doc audit 2026-08-13)", () => {
  const base = { audio_url: AUDIO } as const;

  test("prompt over 1500 words is invalid_shape", () => {
    const words = Array.from({ length: PROMPT_MAX_WORDS + 1 }, () => "word").join(" ");
    const r = stt.safe({ ...base, prompt: words });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["prompt"]);
    expect(stt.safe({ ...base, prompt: "short context" }).ok).toBe(true);
  });

  test("a keyterms_prompt phrase over 6 words is invalid_shape", () => {
    const r = stt.safe({
      ...base,
      keyterms_prompt: ["one two three four five six seven"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["keyterms_prompt", 0]);
    expect(
      stt.safe({ ...base, keyterms_prompt: ["one two three four five six"] }).ok,
    ).toBe(true);
    expect(KEYTERM_MAX_WORDS).toBe(6);
  });

  test("custom_spelling: `to` is one word and `from` phrases cap at 5 words", () => {
    const multiWordTo = stt.safe({
      ...base,
      custom_spelling: [{ from: ["cts"], to: "CT scan" }],
    });
    expect(multiWordTo.ok).toBe(false);
    if (!multiWordTo.ok) expect(multiWordTo.errors[0]?.path).toEqual(["custom_spelling", 0, "to"]);

    const longFrom = stt.safe({
      ...base,
      custom_spelling: [{ from: ["a b c d e f"], to: "abcdef" }],
    });
    expect(longFrom.ok).toBe(false);
    expect(CUSTOM_SPELLING_FROM_MAX_WORDS).toBe(5);

    expect(
      stt.safe({ ...base, custom_spelling: [{ from: ["a b c d e"], to: "abcde" }] }).ok,
    ).toBe(true);
  });

  test("code_switching_confidence_threshold is bounded to 0..1", () => {
    const r = stt.safe({
      ...base,
      language_detection_options: { code_switching: true, code_switching_confidence_threshold: 1.5 },
    });
    expect(r.ok).toBe(false);
  });
});

describe("assemblyai.stt model-gated params (doc audit 2026-08-13)", () => {
  const base = { audio_url: AUDIO } as const;

  test("remove_audio_tags joins prompt/temperature as Universal-3.5 Pro only", () => {
    const r = stt.safe({
      ...base,
      speech_models: ["universal-2"],
      remove_audio_tags: "all",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["remove_audio_tags"]);
    }
    expect(
      stt.safe({ ...base, speech_models: ["universal-3-5-pro"], remove_audio_tags: "all" })
        .ok,
    ).toBe(true);
  });

  test("legacy summarization/auto_chapters/summary_model are refused on every routing (retired 2026-10-20)", () => {
    // llms/models.md (2026-11-10): "the top-level `summarization` and
    // `auto_chapters` options return errors since October 20, 2026".
    const retired = [
      ["summarization", true],
      ["auto_chapters", true],
      ["summary_model", "informative"],
    ] as const;
    const routings = [undefined, ["universal-2"], ["universal-3-5-pro"]] as const;
    for (const [param, value] of retired) {
      for (const routing of routings) {
        const r = stt.safe({
          ...base,
          ...(routing !== undefined && { speech_models: [...routing] }),
          [param]: value,
        } as never);
        expect(r.ok).toBe(false);
        if (r.ok) continue;
        expect(r.errors[0]).toMatchObject({
          code: "unsupported_param",
          path: [param],
          meta: { source: "https://www.assemblyai.com/llms/models.md" },
        });
        expect(r.errors[0]?.message).toContain("speech_understanding.request.summarization");
      }
    }
    // The retirement is reported itself, not hidden behind the old pairing
    // advice ("requires punctuation", "enable one or the other").
    const both = stt.safe({ ...base, summarization: true, auto_chapters: true, punctuate: false });
    expect(both.ok).toBe(false);
    if (!both.ok) {
      expect(both.errors.map((e) => [e.code, e.path[0]])).toEqual([
        ["unsupported_param", "summarization"],
        ["unsupported_param", "auto_chapters"],
      ]);
    }
  });

  test("the vendor's own falsy legacy fields, summary_type and speech_understanding still validate", () => {
    // The submit reference's TranscriptParams example sends exactly these.
    const falsy = stt.safe({
      ...base,
      summarization: false,
      auto_chapters: false,
      summary_type: null,
      summary_model: null,
    });
    expect(falsy.ok).toBe(true);
    if (falsy.ok) expect(falsy.warnings).toEqual([]);
    // Neither source names `summary_type` as erroring on its own.
    expect(stt.safe({ ...base, summary_type: "bullets" }).ok).toBe(true);
    expect(
      stt.safe({
        ...base,
        speech_understanding: { request: { summarization: { summary_type: "paragraph" } } },
      }).ok,
    ).toBe(true);
  });

  test("the unified layer offers no legacy summary extra, and providerOptions reaches the refusal", () => {
    const extra = unifiedStt.safe({
      model: "assemblyai/universal-2",
      audio: { url: AUDIO },
      summarization: true,
    } as never);
    expect(extra.ok).toBe(false);
    if (!extra.ok) expect(extra.errors[0]).toMatchObject({ code: "unsupported_param", path: ["summarization"] });

    const escaped = unifiedStt.safe({
      model: "assemblyai/universal-2",
      audio: { url: AUDIO },
      providerOptions: { assemblyai: { summarization: true } },
    });
    expect(escaped.ok).toBe(false);
    if (!escaped.ok) expect(escaped.errors[0]?.message).toContain("since October 20, 2026");
  });

  test("domain accepts the documented medical-v1 and veterinary-v1", () => {
    const bad = stt.safe as unknown as (p: unknown) => ReturnType<typeof stt.safe>;
    const r = bad({ ...base, domain: "legal-v1" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.meta?.allowed).toEqual(["medical-v1", "veterinary-v1"]);
    }
    expect(stt.safe({ ...base, domain: "medical-v1" }).ok).toBe(true);
    // Veterinary Mode (beta): "setting the `domain` parameter to `"veterinary-v1"`".
    expect(stt.safe({ ...base, domain: "veterinary-v1" }).ok).toBe(true);
    expect([...ASSEMBLYAI_DOMAINS]).toEqual(["medical-v1", "veterinary-v1"]);
  });
});

describe("assemblyai.stt redact_static_entities + webhook headers (doc audit 2026-08-13)", () => {
  const base = { audio_url: AUDIO, redact_pii: true } as const;

  test("label charset and length are enforced", () => {
    const r = stt.safe({
      ...base,
      redact_static_entities: { "bad!label": ["x"] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["redact_static_entities", "bad!label"]);

    expect(
      stt.safe({ ...base, redact_static_entities: { INTERNAL_TOOL: ["Bearclaw"] } }).ok,
    ).toBe(true);
  });

  test("term count and term length caps fire with the doc source", () => {
    const tooManyTerms = stt.safe({
      ...base,
      redact_static_entities: {
        TOOLS: Array.from({ length: STATIC_ENTITY_MAX_TERMS_PER_LABEL + 1 }, () => "t"),
      },
    });
    expect(tooManyTerms.ok).toBe(false);
    if (!tooManyTerms.ok) {
      expect(String(tooManyTerms.errors[0]?.meta?.source)).toContain("assemblyai.com/docs");
    }

    const longTerm = stt.safe({
      ...base,
      redact_static_entities: { TOOLS: ["x".repeat(STATIC_ENTITY_MAX_TERM_CHARACTERS + 1)] },
    });
    expect(longTerm.ok).toBe(false);
  });

  test("too many labels is an error", () => {
    const entities: Record<string, string[]> = {};
    for (let i = 0; i <= STATIC_ENTITY_MAX_LABELS; i += 1) entities[`LABEL_${i}`] = ["x"];
    const r = stt.safe({ ...base, redact_static_entities: entities });
    expect(r.ok).toBe(false);
  });

  test("webhook auth header charset rules are enforced", () => {
    expect(
      stt.safe({
        audio_url: AUDIO,
        webhook_url: "https://cb.example",
        webhook_auth_header_name: "X-Auth Token",
        webhook_auth_header_value: "secret",
      }).ok,
    ).toBe(false);

    expect(
      stt.safe({
        audio_url: AUDIO,
        webhook_url: "https://cb.example",
        webhook_auth_header_name: "X-Auth-Token",
        webhook_auth_header_value: "sec\nret",
      }).ok,
    ).toBe(false);

    expect(
      stt.safe({
        audio_url: AUDIO,
        webhook_url: "https://cb.example",
        webhook_auth_header_name: "X-Auth-Token",
        webhook_auth_header_value: "secret",
      }).ok,
    ).toBe(true);
  });
});

describe("assemblyai.stt universal-3-6-pro-preview (model refresh 2026-11-12)", () => {
  const PREVIEW = "universal-3-6-pro-preview";
  const oneHour = { media: [{ path: ["audio_url"] as const, durationSeconds: 3600 }] };

  test("validates as a catalogued beta model, and is never priced from a guess", () => {
    expect(models[PREVIEW].status).toBe("beta");
    expect(MODELS).toContain(PREVIEW);
    const r = stt.safe({ audio_url: AUDIO, speech_models: [PREVIEW] }, oneHour);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    // assemblyai.com/pricing publishes no pre-recorded rate for the preview.
    expect(r.estimate.costUSD).toBeUndefined();
  });

  test("Universal-3.5-Pro-only params are refused on a preview-only routing", () => {
    const r = stt.safe({ audio_url: AUDIO, speech_models: [PREVIEW], prompt: "Acme Corp earnings" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]).toMatchObject({ code: "unsupported_param", path: ["prompt"], model: PREVIEW });
      expect(r.errors[0]?.message).toContain('"universal-3-5-pro"');
    }
    // …and accepted once the routing can fall through to universal-3-5-pro.
    expect(
      stt.safe({
        audio_url: AUDIO,
        speech_models: [PREVIEW, "universal-3-5-pro"],
        prompt: "Acme Corp earnings",
      }).ok,
    ).toBe(true);
  });

  test("the unified ref compiles to a one-element routing list", () => {
    const params = unifiedStt({ model: `assemblyai/${PREVIEW}`, audio: { url: AUDIO } });
    expect(JSON.parse(JSON.stringify(params))).toEqual({ audio_url: AUDIO, speech_models: [PREVIEW] });
    expect(params.warnings).toEqual([]);
  });
});

describe("assemblyai catalog roster (model refresh 2026-11-12)", () => {
  test("the catalog, the unified model list and the params table name the same ids", () => {
    const roster: string[] = ["slam-1", "universal-2", "universal-3-5-pro", "universal-3-6-pro-preview"];
    expect(Object.keys(models).sort()).toEqual(roster);
    expect([...MODELS].sort() as string[]).toEqual(roster);
    expect(Object.keys(ASSEMBLYAI_STT_MODEL_PARAMS).sort()).toEqual(roster);
  });
});

describe("assemblyai.stt request-schema corrections (submit reference, 2026-11-12)", () => {
  const base = { audio_url: AUDIO } as const;

  test("speech_threshold is nullable, and still bounded to 0..1", () => {
    expect(stt.safe({ ...base, speech_threshold: null }).ok).toBe(true);
    expect(stt.safe({ ...base, speech_threshold: 0.5 }).ok).toBe(true);
    const r = stt.safe({ ...base, speech_threshold: 1.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["speech_threshold"]);
  });

  test("speaker_options.include_speaker_confidence is a typed field", () => {
    const r = stt.safe({
      ...base,
      speaker_labels: true,
      speaker_options: { include_speaker_confidence: true },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("language_detection_options.on_no_speech_detected takes error | fallback", () => {
    expect(
      stt.safe({
        ...base,
        language_detection_options: { on_no_speech_detected: "fallback", fallback_language: "en" },
      }).ok,
    ).toBe(true);
    const bad = stt.safe as unknown as (p: unknown) => ReturnType<typeof stt.safe>;
    const r = bad({ ...base, language_detection_options: { on_no_speech_detected: "skip" } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["language_detection_options", "on_no_speech_detected"]);
    }
  });

  test('on_no_speech_detected: "fallback" needs a specific fallback_language (language-detection guide, 2026-11-12)', () => {
    // "`fallback` can't be combined with `auto`, which returns a `400`." and
    // "When `fallback_language` is unspecified, it is set to `"auto"` by default."
    for (const fallback of [{}, { fallback_language: "auto" }, { fallback_language: null }] as const) {
      const r = stt.safe({
        ...base,
        language_detection_options: { on_no_speech_detected: "fallback", ...fallback },
      });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.errors[0]?.path).toEqual(["language_detection_options", "fallback_language"]);
      expect(r.errors[0]?.message).toContain("specific language code");
    }
    expect(
      stt.safe({ ...base, language_detection_options: { on_no_speech_detected: "error" } }).ok,
    ).toBe(true);
  });

  test("model-gate refusals cite the canonical submit reference", () => {
    const r = stt.safe({ ...base, speech_models: ["universal-2"], temperature: 0.2 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.meta?.source).toBe(
        "https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/transcripts/submit",
      );
    }
  });
});
