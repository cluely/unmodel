import { describe, expect, test } from "bun:test";
import {
  transcribe,
  TRANSCRIPT_URL,
  DEFAULT_SPEECH_MODELS,
  ASSEMBLYAI_DOMAINS,
  PROMPT_MAX_WORDS,
  KEYTERM_MAX_WORDS,
  CUSTOM_SPELLING_FROM_MAX_WORDS,
  STATIC_ENTITY_MAX_LABELS,
  STATIC_ENTITY_MAX_TERMS_PER_LABEL,
  STATIC_ENTITY_MAX_TERM_CHARACTERS,
} from "./transcribe";
import { models } from "./models";

const AUDIO = "https://cdn.assemblyai.com/upload/abc123";

describe("assemblyai.transcribe happy path", () => {
  test("returns a wire-pure body with hidden toSdk/request", () => {
    const params = {
      audio_url: AUDIO,
      speech_model: "universal-3-5-pro" as const,
      speaker_labels: true,
      punctuate: true,
    };
    const v = transcribe(params);

    expect(Object.keys(v)).toEqual(["audio_url", "speech_model", "speaker_labels", "punctuate"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(TRANSCRIPT_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    // The official SDK's transcripts.submit accepts wire-shaped params.
    expect(v.toSdk("assemblyai")).toEqual(params);
  });

  test("missing audio_url is an error", () => {
    const bad = transcribe.safe as unknown as (p: unknown) => ReturnType<typeof transcribe.safe>;
    const r = bad({ speech_model: "universal-2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("speech_models routing list validates; head drives model checks", () => {
    const r = transcribe.safe({ audio_url: AUDIO, speech_models: ["universal-3-5-pro", "universal-2"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
    expect([...DEFAULT_SPEECH_MODELS]).toEqual(["universal-3-5-pro", "universal-2"]);
  });

  test("deprecated slam-1 warns; unknown model warns", () => {
    expect(models["slam-1"].status).toBe("deprecated");
    const slam = transcribe.safe({ audio_url: AUDIO, speech_model: "slam-1" });
    expect(slam.ok).toBe(true);
    if (slam.ok) expect(slam.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);

    const unknown = transcribe.safe({ audio_url: AUDIO, speech_model: "best" });
    expect(unknown.ok).toBe(true);
    if (unknown.ok) expect(unknown.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});

describe("assemblyai.transcribe pairing + gating rules", () => {
  test("speakers_expected conflicts with speaker_options", () => {
    const r = transcribe.safe({
      audio_url: AUDIO,
      speaker_labels: true,
      speakers_expected: 2,
      speaker_options: { min_speakers_expected: 1, max_speakers_expected: 4 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("conflicts with `speaker_options`");
  });

  test("content_safety_confidence requires content_safety: true", () => {
    const r = transcribe.safe({ audio_url: AUDIO, content_safety_confidence: 80 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["content_safety_confidence"]);
  });

  test("audio_end_at must exceed audio_start_from", () => {
    const r = transcribe.safe({ audio_url: AUDIO, audio_start_from: 5000, audio_end_at: 5000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["audio_end_at"]);
  });

  test("sentiment_analysis with punctuate: false is rejected", () => {
    const r = transcribe.safe({ audio_url: AUDIO, sentiment_analysis: true, punctuate: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["sentiment_analysis"]);
  });

  test("prompt is rejected when routing cannot reach universal-3-5-pro", () => {
    const r = transcribe.safe({
      audio_url: AUDIO,
      speech_model: "universal-2",
      prompt: "Names: Guilherme, Soniox, Deepgram.",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["prompt"]);
    }
  });

  test("prompt passes on the default routing (includes universal-3-5-pro)", () => {
    const r = transcribe.safe({ audio_url: AUDIO, prompt: "medical terms ahead" });
    expect(r.ok).toBe(true);
  });

  test("keyterms_prompt over 200 terms is rejected for universal-2", () => {
    const terms = Array.from({ length: 201 }, (_, i) => `term-${i}`);
    const r = transcribe.safe({ audio_url: AUDIO, speech_model: "universal-2", keyterms_prompt: terms });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta?.limit).toBe(200);

    const pro = transcribe.safe({
      audio_url: AUDIO,
      speech_model: "universal-3-5-pro",
      keyterms_prompt: terms,
    });
    expect(pro.ok).toBe(true);
  });

  test("enum fields reject undocumented values via the schema", () => {
    const bad = transcribe.safe as unknown as (p: unknown) => ReturnType<typeof transcribe.safe>;
    const r = bad({ audio_url: AUDIO, redact_pii_sub: "stars" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });
});

describe("assemblyai.transcribe cost estimation", () => {
  // `as const`: a hoisted path infers `string[]`, and the media coordinate is
  // a tuple whose first segment is a key of the params — see `MediaPathFor`.
  const oneHour = { media: [{ path: ["audio_url"] as const, durationSeconds: 3600 }] };

  test("universal-3-5-pro: 1 hour ≈ $0.21 (pricing page rate)", () => {
    const r = transcribe.safe({ audio_url: AUDIO, speech_model: "universal-3-5-pro" }, oneHour);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.21, 10);
  });

  test("universal-2: 1 hour ≈ $0.15", () => {
    const r = transcribe.safe({ audio_url: AUDIO, speech_model: "universal-2" }, oneHour);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.15, 10);
  });

  test("default routing (no model fields) is priced at the universal-3-5-pro rate", () => {
    const r = transcribe.safe({ audio_url: AUDIO }, oneHour);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.21, 10);
  });

  test("over_budget fires against the estimated cost", () => {
    const r = transcribe.safe({ audio_url: AUDIO }, { ...oneHour, maxCostUSD: 0.2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });
});

describe("assemblyai.transcribe documented pairing rules (doc audit 2026-08-13)", () => {
  const base = { audio_url: AUDIO } as const;

  test("redaction sub-options require redact_pii", () => {
    for (const key of [
      "redact_pii_audio",
      "redact_pii_return_unredacted",
      "redact_static_entities",
    ] as const) {
      const value = key === "redact_static_entities" ? { INTERNAL_TOOL: ["Bearclaw"] } : true;
      const r = transcribe.safe({ ...base, [key]: value } as never);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.path).toEqual([key]);
    }
    const ok = transcribe.safe({ ...base, redact_pii: true, redact_pii_audio: true });
    expect(ok.ok).toBe(true);
  });

  test("redact_pii requires text formatting; summarization requires both", () => {
    const noFormat = transcribe.safe({ ...base, redact_pii: true, format_text: false });
    expect(noFormat.ok).toBe(false);

    const summary = transcribe.safe({
      ...base,
      speech_models: ["universal-2"],
      summarization: true,
      punctuate: false,
    });
    expect(summary.ok).toBe(false);
  });

  test("speaker_labels requires punctuation and speaker_options requires speaker_labels", () => {
    const labels = transcribe.safe({ ...base, speaker_labels: true, punctuate: false });
    expect(labels.ok).toBe(false);

    const options = transcribe.safe({ ...base, speaker_options: { max_speakers_expected: 3 } });
    expect(options.ok).toBe(false);
    if (!options.ok) expect(options.errors[0]?.path).toEqual(["speaker_options"]);

    const ok = transcribe.safe({
      ...base,
      speaker_labels: true,
      speaker_options: { max_speakers_expected: 3 },
    });
    expect(ok.ok).toBe(true);
  });

  test("auto_chapters and summarization cannot be combined", () => {
    const r = transcribe.safe({
      ...base,
      speech_models: ["universal-2"],
      auto_chapters: true,
      summarization: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.path[0] === "auto_chapters")).toBe(true);
  });

  test("language_code conflicts with language_detection: true", () => {
    const r = transcribe.safe({ ...base, language_code: "de", language_detection: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["language_code"]);

    // language_code alone (detection implicitly off) is the documented shape.
    expect(transcribe.safe({ ...base, language_code: "de" }).ok).toBe(true);
  });

  test('language_codes must include "en"', () => {
    expect(transcribe.safe({ ...base, language_codes: ["de", "fr"] }).ok).toBe(false);
    expect(transcribe.safe({ ...base, language_codes: ["en", "es"] }).ok).toBe(true);
  });
});

describe("assemblyai.transcribe documented size limits (doc audit 2026-08-13)", () => {
  const base = { audio_url: AUDIO } as const;

  test("prompt over 1500 words is invalid_shape", () => {
    const words = Array.from({ length: PROMPT_MAX_WORDS + 1 }, () => "word").join(" ");
    const r = transcribe.safe({ ...base, prompt: words });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["prompt"]);
    expect(transcribe.safe({ ...base, prompt: "short context" }).ok).toBe(true);
  });

  test("a keyterms_prompt phrase over 6 words is invalid_shape", () => {
    const r = transcribe.safe({
      ...base,
      keyterms_prompt: ["one two three four five six seven"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["keyterms_prompt", 0]);
    expect(
      transcribe.safe({ ...base, keyterms_prompt: ["one two three four five six"] }).ok,
    ).toBe(true);
    expect(KEYTERM_MAX_WORDS).toBe(6);
  });

  test("custom_spelling: `to` is one word and `from` phrases cap at 5 words", () => {
    const multiWordTo = transcribe.safe({
      ...base,
      custom_spelling: [{ from: ["cts"], to: "CT scan" }],
    });
    expect(multiWordTo.ok).toBe(false);
    if (!multiWordTo.ok) expect(multiWordTo.errors[0]?.path).toEqual(["custom_spelling", 0, "to"]);

    const longFrom = transcribe.safe({
      ...base,
      custom_spelling: [{ from: ["a b c d e f"], to: "abcdef" }],
    });
    expect(longFrom.ok).toBe(false);
    expect(CUSTOM_SPELLING_FROM_MAX_WORDS).toBe(5);

    expect(
      transcribe.safe({ ...base, custom_spelling: [{ from: ["a b c d e"], to: "abcde" }] }).ok,
    ).toBe(true);
  });

  test("code_switching_confidence_threshold is bounded to 0..1", () => {
    const r = transcribe.safe({
      ...base,
      language_detection_options: { code_switching: true, code_switching_confidence_threshold: 1.5 },
    });
    expect(r.ok).toBe(false);
  });
});

describe("assemblyai.transcribe model-gated params (doc audit 2026-08-13)", () => {
  const base = { audio_url: AUDIO } as const;

  test("remove_audio_tags joins prompt/temperature as Universal-3.5 Pro only", () => {
    const r = transcribe.safe({
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
      transcribe.safe({ ...base, speech_models: ["universal-3-5-pro"], remove_audio_tags: "all" })
        .ok,
    ).toBe(true);
  });

  test("summarization/auto_chapters are rejected off Universal-2", () => {
    for (const param of ["summarization", "auto_chapters"] as const) {
      const r = transcribe.safe({
        ...base,
        speech_models: ["universal-3-5-pro"],
        [param]: true,
      } as never);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("unsupported_param");
        expect(String(r.errors[0]?.meta?.source)).toContain("assemblyai.com/docs");
      }
    }
    // The default routing list still contains universal-2, so it is allowed.
    expect(transcribe.safe({ ...base, auto_chapters: true }).ok).toBe(true);
  });

  test("domain accepts only the documented medical-v1", () => {
    const bad = transcribe.safe as unknown as (p: unknown) => ReturnType<typeof transcribe.safe>;
    const r = bad({ ...base, domain: "legal-v1" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.meta?.allowed).toEqual([...ASSEMBLYAI_DOMAINS]);
    }
    expect(transcribe.safe({ ...base, domain: "medical-v1" }).ok).toBe(true);
  });
});

describe("assemblyai.transcribe redact_static_entities + webhook headers (doc audit 2026-08-13)", () => {
  const base = { audio_url: AUDIO, redact_pii: true } as const;

  test("label charset and length are enforced", () => {
    const r = transcribe.safe({
      ...base,
      redact_static_entities: { "bad!label": ["x"] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["redact_static_entities", "bad!label"]);

    expect(
      transcribe.safe({ ...base, redact_static_entities: { INTERNAL_TOOL: ["Bearclaw"] } }).ok,
    ).toBe(true);
  });

  test("term count and term length caps fire with the doc source", () => {
    const tooManyTerms = transcribe.safe({
      ...base,
      redact_static_entities: {
        TOOLS: Array.from({ length: STATIC_ENTITY_MAX_TERMS_PER_LABEL + 1 }, () => "t"),
      },
    });
    expect(tooManyTerms.ok).toBe(false);
    if (!tooManyTerms.ok) {
      expect(String(tooManyTerms.errors[0]?.meta?.source)).toContain("assemblyai.com/docs");
    }

    const longTerm = transcribe.safe({
      ...base,
      redact_static_entities: { TOOLS: ["x".repeat(STATIC_ENTITY_MAX_TERM_CHARACTERS + 1)] },
    });
    expect(longTerm.ok).toBe(false);
  });

  test("too many labels is an error", () => {
    const entities: Record<string, string[]> = {};
    for (let i = 0; i <= STATIC_ENTITY_MAX_LABELS; i += 1) entities[`LABEL_${i}`] = ["x"];
    const r = transcribe.safe({ ...base, redact_static_entities: entities });
    expect(r.ok).toBe(false);
  });

  test("webhook auth header charset rules are enforced", () => {
    expect(
      transcribe.safe({
        audio_url: AUDIO,
        webhook_url: "https://cb.example",
        webhook_auth_header_name: "X-Auth Token",
        webhook_auth_header_value: "secret",
      }).ok,
    ).toBe(false);

    expect(
      transcribe.safe({
        audio_url: AUDIO,
        webhook_url: "https://cb.example",
        webhook_auth_header_name: "X-Auth-Token",
        webhook_auth_header_value: "sec\nret",
      }).ok,
    ).toBe(false);

    expect(
      transcribe.safe({
        audio_url: AUDIO,
        webhook_url: "https://cb.example",
        webhook_auth_header_name: "X-Auth-Token",
        webhook_auth_header_value: "secret",
      }).ok,
    ).toBe(true);
  });
});
