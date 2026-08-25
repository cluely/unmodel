/**
 * `unmodel/stt`, end to end through the ready-made pack.
 *
 * The golden matrix next door pins *what* each provider compiles to; this pins
 * what a caller gets back — that the result is the provider's own `Validated`
 * with its `.request`, its `.toSdk(...)` and its estimate intact, that the two
 * escape hatches behave, and that the refusals this category invented say
 * something a caller can act on.
 *
 * The refusals are the part worth reading. `audio` is the only canonical field
 * in the library whose legal *shapes* depend on the route, so the runtime half
 * of that promise gets its own section here: the compile-time half lives in
 * `test/types/unified-stt.test-d.ts`, and neither is sufficient alone —
 * one answers for TypeScript with a literal ref, the other for everyone else.
 */
import { describe, expect, test } from "bun:test";
import { UnmodelValidationError } from "../../src/core/issues";
import { TranslationUnavailableError } from "../../src/core/translate/errors";
import { stt } from "../../src/unified/stt";

const URL_ = "https://example.com/interview.wav";
const audio = (): Blob => new Blob([new Uint8Array(1024)], { type: "audio/wav" });
/** A real base64 payload — an empty WAV — for the `{ data }` routes. */
const BASE64_AUDIO = "UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";

describe("the pack", () => {
  test("registers exactly the thirteen transcribe providers, sorted", () => {
    expect([...stt.providers]).toEqual([
      "assemblyai",
      "cartesia",
      "deepgram",
      "elevenlabs",
      // fal is an aggregator: one provider id, six transcription endpoints —
      // Wizper, fal's own ASR and its turbo arm, both ElevenLabs Scribe
      // generations, and Cohere.
      "fal",
      "gladia",
      "google",
      "inworld",
      "mistral",
      "openai",
      "revai",
      "soniox",
      "speechmatics",
    ]);
  });

  test("a provider outside the pack is structural, not a validation error", () => {
    expect(() =>
      stt({ model: "sarvam/saarika-v2", audio: { url: URL_ } } as never),
    ).toThrow(TranslationUnavailableError);
    const result = stt.safe({ model: "sarvam/saarika-v2", audio: { url: URL_ } } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.meta).toMatchObject({ structural: true, provider: "sarvam" });
  });

  test("a model the adapter does not list warns but still compiles", () => {
    const result = stt.safe({
      model: "assemblyai/universal-4",
      audio: { url: URL_ },
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Twice, and correctly so: the kernel checks the ref against the adapter's
    // `models` list, and the provider's own catalog layer checks it again.
    expect(result.warnings.map((issue) => issue.code)).toEqual([
      "unknown_model",
      "unknown_model",
    ]);
    expect((result.params as unknown as { speech_models: string[] }).speech_models).toEqual([
      "universal-4",
    ]);
  });
});

describe("the result is the provider's own Validated", () => {
  test("assemblyai: JSON body, request line and toSdk", () => {
    const params = stt({
      model: "assemblyai/universal-3-5-pro",
      audio: { url: URL_ },
      diarization: { enabled: true, minSpeakers: 2, maxSpeakers: 4 },
    });
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      audio_url: URL_,
      speech_models: ["universal-3-5-pro"],
      speaker_labels: true,
      speaker_options: { min_speakers_expected: 2, max_speakers_expected: 4 },
    });
    expect(params.request).toMatchObject({
      url: "https://api.assemblyai.com/v2/transcript",
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(params.toSdk("assemblyai")).toMatchObject({ audio_url: URL_ });
  });

  test("deepgram: the body is `{url}` and everything else is the query string", () => {
    const params = stt({
      model: "deepgram/nova-3",
      audio: { url: URL_ },
      language: "pt-BR",
      diarization: { enabled: true },
      timestamps: "segment",
    });
    expect(JSON.parse(JSON.stringify(params))).toEqual({ url: URL_ });
    const url = new URL(params.request.url);
    expect(url.pathname).toBe("/v1/listen");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      model: "nova-3",
      language: "pt-BR",
      diarize: "true",
      utterances: "true",
    });
    // The SDK view is the options object without `url` — exactly what
    // `listen.prerecorded.transcribeUrl({url}, options)` takes.
    expect(params.toSdk("deepgram")).toMatchObject({ model: "nova-3", diarize: true });
  });

  test("openai: a multipart body whose Blob survives the compile step", () => {
    const file = audio();
    const params = stt({
      model: "openai/whisper-1",
      audio: { file },
      timestamps: "word",
      prompt: "Acme Corp",
    });
    // Not JSON: the enumerable props ARE the form fields, Blob included.
    expect(params.file).toBe(file);
    expect(params.model).toBe("whisper-1");
    expect(params.timestamp_granularities).toEqual(["word"]);
    // …and the pairing the API requires was supplied with it.
    expect(params.response_format).toBe("verbose_json");
    expect(params.request.headers).toEqual({});
  });

  test("an estimate rides through, from the provider's own cost model", () => {
    const result = stt.safe(
      { model: "assemblyai/universal-2", audio: { url: URL_ } },
      { media: [{ path: ["audio_url"], durationSeconds: 600 }] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 10 minutes at universal-2's $0.15/hour.
    expect(result.estimate?.costUSD).toBeCloseTo((0.15 / 60) * 10, 6);
  });
});

describe("`audio` is narrowed at runtime as well as at compile time", () => {
  test("a Blob at a URL-only route names the shapes that route takes", () => {
    const result = stt.safe({
      model: "assemblyai/universal-2",
      audio: { file: audio() },
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe("unsupported_param");
    expect(result.errors[0]!.path).toEqual(["audio"]);
    expect(result.errors[0]!.message).toContain("{ url }");
    expect(result.errors[0]!.message).toContain("POST /v2/upload");
  });

  test("a URL at a multipart-only route says where the bytes go instead", () => {
    const result = stt.safe({
      model: "cartesia/ink-whisper",
      audio: { url: URL_ },
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toEqual(["audio"]);
    expect(result.errors[0]!.message).toContain("{ file }");
    expect(result.errors[0]!.message).toContain("multipart");
  });

  test("two shapes at once is a request that has not decided", () => {
    const result = stt.safe({
      model: "mistral/voxtral-mini-latest",
      audio: { url: URL_, fileId: "file-abc" },
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe("invalid_shape");
    expect(result.errors[0]!.path).toEqual(["audio"]);
    expect(result.errors[0]!.message).toContain("exactly one");
  });

  test("no shape at all names all three", () => {
    const result = stt.safe({
      model: "mistral/voxtral-mini-latest",
      audio: {},
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.message).toContain("`file`, `url` or `fileId`");
  });

  test("a Blob at inworld's base64-only route says where the bytes go instead", () => {
    const result = stt.safe({
      model: "inworld/inworld/inworld-stt-1",
      audio: { file: audio() },
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe("unsupported_param");
    expect(result.errors[0]!.path).toEqual(["audio"]);
    expect(result.errors[0]!.message).toContain("{ data }");
    expect(result.errors[0]!.message).toContain("audioData.content");
  });

  test("base64 bytes reach the one route whose audio field is a string", () => {
    const params = stt({
      model: "inworld/inworld/inworld-stt-1",
      audio: { data: BASE64_AUDIO, mimeType: "audio/wav" },
    });
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      transcribeConfig: { modelId: "inworld/inworld-stt-1", audioEncoding: "AUTO_DETECT" },
      audioData: { content: BASE64_AUDIO },
    });
  });

  test("a `data:` URI is unwrapped to its payload — the field is documented base64", () => {
    const params = stt({
      model: "inworld/inworld/inworld-stt-1",
      audio: { data: `data:audio/wav;base64,${BASE64_AUDIO}` },
    });
    expect((params as unknown as { audioData: { content: string } }).audioData.content).toBe(
      BASE64_AUDIO,
    );
  });
});

describe("providerOptions", () => {
  test("deep-merges over the compiled body before validation", () => {
    const params = stt({
      model: "gladia/solaria-1",
      audio: { url: URL_ },
      diarization: { enabled: true, speakers: 2 },
      providerOptions: {
        // A nested override merges key-by-key: `number_of_speakers` survives.
        gladia: { diarization_config: { min_speakers: 2 }, sentiment_analysis: true },
      },
    });
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      audio_url: URL_,
      model: "solaria-1",
      diarization: true,
      diarization_config: { number_of_speakers: 2, min_speakers: 2 },
      sentiment_analysis: true,
    });
  });

  test("an override wins over the compiled value, and is validated like it", () => {
    const params = stt({
      model: "assemblyai/universal-2",
      audio: { url: URL_ },
      language: "pt",
      providerOptions: { assemblyai: { language_code: "es", auto_highlights: true } },
    });
    expect(JSON.parse(JSON.stringify(params))).toMatchObject({
      language_code: "es",
      auto_highlights: true,
    });
  });

  test("an explicit undefined unsets what the adapter emitted", () => {
    const params = stt({
      model: "speechmatics/standard",
      audio: { url: URL_ },
      providerOptions: { speechmatics: { transcription_config: { model: undefined } } },
    });
    const config = (params as unknown as { transcription_config: Record<string, unknown> })
      .transcription_config;
    expect(Object.hasOwn(config, "model")).toBe(false);
    expect(config["language"]).toBe("auto");
  });

  test("a block for another provider is ignored", () => {
    const params = stt({
      model: "assemblyai/universal-2",
      audio: { url: URL_ },
      providerOptions: { deepgram: { diarize: true } },
    });
    expect(Object.hasOwn(params, "diarize")).toBe(false);
  });

  test("an override the provider rejects says where it came from", () => {
    const result = stt.safe({
      model: "elevenlabs/scribe_v2",
      audio: { url: URL_ },
      providerOptions: { elevenlabs: { num_speakers: 99 } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toEqual(["num_speakers"]);
    expect(result.errors[0]!.message).toEndWith("(supplied via `providerOptions`)");
  });
});

describe("bounds and rules the adapter did not copy surface as the provider's own", () => {
  /**
   * The point of these: a rule that exists in a provider's validator is NOT
   * restated in its adapter, so there is exactly one copy of it. What the
   * adapter owes the caller is the *path* — the finding has to arrive at the
   * canonical field, not at a wire param they never wrote.
   */
  test("elevenlabs' 1–32 speaker range, reported at `diarization.speakers`", () => {
    const result = stt.safe({
      model: "elevenlabs/scribe_v2",
      audio: { url: URL_ },
      diarization: { enabled: true, speakers: 99 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toEqual(["diarization.speakers"]);
    expect(result.errors[0]!.message).toContain("compiled from `num_speakers`");
  });

  test("assemblyai's \"language_codes must include en\", reported at `languages`", () => {
    const result = stt.safe({
      model: "assemblyai/universal-2",
      audio: { url: URL_ },
      languages: ["pt", "es"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toEqual(["languages"]);
    expect(result.errors[0]!.message).toContain("compiled from `language_codes`");
  });

  test("mistral's timestamps-versus-language rule, reported at `timestamps`", () => {
    const result = stt.safe({
      model: "mistral/voxtral-mini-latest",
      audio: { url: URL_ },
      language: "pt",
      timestamps: "word",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toEqual(["timestamps"]);
    expect(result.errors[0]!.message).toContain("compiled from `timestamp_granularities`");
  });

  test("openai's whisper-only granularities, reported at `timestamps`", () => {
    // The cast is the point of the test: `gpt-4o-transcribe`'s row now types
    // `timestamps` as `"none"`, so a TypeScript caller cannot write this at
    // all. What is under test is the run-time half of the same rule — the one
    // that has to hold for JavaScript callers and run-time-built refs.
    const result = stt.safe({
      model: "openai/gpt-4o-transcribe",
      audio: { file: audio() },
      timestamps: "word" as "none",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toEqual(["timestamps"]);
    expect(result.errors[0]!.message).toContain("whisper-1");
  });

  test("cartesia's closed language list, reported at `language`", () => {
    const result = stt.safe({
      model: "cartesia/ink-whisper",
      audio: { file: audio() },
      language: "tlh",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe("invalid_enum_value");
    expect(result.errors[0]!.path).toEqual(["language"]);
  });

  test("a speaker count with diarization off has not decided", () => {
    const result = stt.safe({
      model: "assemblyai/universal-2",
      audio: { url: URL_ },
      diarization: { enabled: false, speakers: 2 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe("invalid_shape");
    expect(result.errors[0]!.path).toEqual(["diarization", "speakers"]);
  });

  test("a language pinned alongside a candidate set is refused where they collide", () => {
    for (const model of ["gladia/solaria-1", "soniox/stt-async-v5", "speechmatics/standard"]) {
      const result = stt.safe({
        model,
        audio: { url: URL_ },
        language: "pt",
        languages: ["pt", "es"],
      } as never);
      expect(result.ok, model).toBe(false);
      if (result.ok) continue;
      expect(result.errors[0]!.code).toBe("invalid_shape");
      expect(result.errors[0]!.path).toEqual(["languages"]);
    }
  });
});

describe("the throwing form", () => {
  test("throws UnmodelValidationError naming the category", () => {
    try {
      stt({ model: "cartesia/ink-whisper", audio: { file: audio() }, prompt: "x" } as never);
      throw new Error("expected a throw");
    } catch (error) {
      expect(UnmodelValidationError.isInstance(error)).toBe(true);
      if (!UnmodelValidationError.isInstance(error)) return;
      expect(error.message).toContain("unmodel/stt");
      expect(error.issues[0]!.path).toEqual(["prompt"]);
    }
  });
});

// ---------------------------------------------------------------------------
// Gemini — the provider whose transcription surface is a generateContent call
// ---------------------------------------------------------------------------

describe("google", () => {
  const REF = "google/gemini-2.5-flash";
  const AUDIO = { data: BASE64_AUDIO, mimeType: "audio/wav" } as const;

  test("audio becomes a PART, and the prompt becomes the part beside it", () => {
    const params = stt({ model: REF, audio: AUDIO, prompt: "Transcribe this." });
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      contents: [
        {
          parts: [
            { text: "Transcribe this." },
            { inlineData: { mimeType: "audio/wav", data: BASE64_AUDIO } },
          ],
        },
      ],
    });
  });

  /**
   * The probe-backed mappings, in one body. `audioTranscriptionConfig` is
   * documented under the Live API's setup message; its acceptance on the unary
   * route was verified against the live API, which is what makes these four
   * cells `derived` rather than `unsupported`.
   */
  test("language, timestamps and diarization reach audioTranscriptionConfig", () => {
    const params = stt({
      model: REF,
      audio: AUDIO,
      language: "pt-BR",
      timestamps: "word",
      diarization: { enabled: true },
    }) as unknown as { generationConfig: { audioTranscriptionConfig: unknown } };
    expect(params.generationConfig.audioTranscriptionConfig).toEqual({
      // The FULL tag — unlike `google.tts`'s primary-subtag `languageCode`.
      languageCodes: ["pt-BR"],
      wordTimestamp: true,
      diarization: true,
    });
  });

  test("`languages` is the same array, and setting both has not decided", () => {
    const many = stt({ model: REF, audio: AUDIO, languages: ["en", "pt-BR"] }) as unknown as {
      generationConfig: { audioTranscriptionConfig: { languageCodes: string[] } };
    };
    expect(many.generationConfig.audioTranscriptionConfig.languageCodes).toEqual(["en", "pt-BR"]);

    const both = stt.safe({ model: REF, audio: AUDIO, language: "en", languages: ["en", "pt"] });
    expect(both.ok).toBe(false);
    if (both.ok) return;
    expect(both.errors[0]).toMatchObject({ code: "invalid_shape", path: ["languages"] });
    expect(both.errors[0]!.message).toContain("languageCodes");
  });

  test('timestamps: "none" omits the field rather than writing `false`', () => {
    const params = stt({ model: REF, audio: AUDIO, timestamps: "none" });
    expect(JSON.parse(JSON.stringify(params))).not.toHaveProperty("generationConfig");
  });

  test("a speaker count is refused at its own path — there is no wire field", () => {
    const result = stt.safe({
      model: REF,
      audio: AUDIO,
      diarization: { enabled: true, maxSpeakers: 4 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({
      code: "unsupported_param",
      path: ["diarization", "maxSpeakers"],
    });
  });

  test("a bare file id becomes the full Files API URI", () => {
    const bare = stt({ model: REF, audio: { fileId: "abc123" } }) as unknown as {
      contents: Array<{ parts: Array<{ fileData: { fileUri: string } }> }>;
    };
    expect(bare.contents[0]!.parts[0]!.fileData.fileUri).toBe(
      "https://generativelanguage.googleapis.com/v1beta/files/abc123",
    );
    // …and one that is already absolute is not prefixed twice.
    const full = stt({
      model: REF,
      audio: { fileId: "https://generativelanguage.googleapis.com/v1beta/files/abc123" },
    }) as unknown as { contents: Array<{ parts: Array<{ fileData: { fileUri: string } }> }> };
    expect(full.contents[0]!.parts[0]!.fileData.fileUri).toBe(
      "https://generativelanguage.googleapis.com/v1beta/files/abc123",
    );
  });

  test("`{ url }` is refused with the Files API pointer", () => {
    const result = stt.safe({ model: REF, audio: { url: URL_ } } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ code: "unsupported_param", path: ["audio"] });
    // `fileUri` LOOKS like a URL field and is not one; the message has to say
    // so, or the caller reads the refusal as a gap in unmodel.
    expect(result.errors[0]!.message).toContain("Files API");
    expect(result.errors[0]!.message).toContain("files.upload");
  });

  test("`{ data }` without a mimeType names the seven spellings", () => {
    const result = stt.safe({ model: REF, audio: { data: BASE64_AUDIO } } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({
      code: "invalid_shape",
      path: ["audio", "mimeType"],
    });
    expect(result.errors[0]!.meta?.["allowed"]).toHaveLength(7);
    expect(result.errors[0]!.message).toContain("audio/wav");
  });

  test("an excluded model is refused by name, with the reason", () => {
    const result = stt.safe({ model: "google/gemini-embedding-2", audio: AUDIO } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const message = result.errors.map((issue) => String(issue.message)).join(" ");
    expect(message).toContain("embedding model");
  });

  test("a declared duration prices the audio at 32 tokens per second", () => {
    const result = stt.safe(
      { model: REF, audio: AUDIO },
      { media: [{ path: ["contents", 0, "parts", 0], durationSeconds: 600 }] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // "32 tokens per second of audio (1 minute = 1,920 tokens)" — ten minutes
    // is 19,200, plus the per-message overhead the text side adds.
    expect(result.estimate?.inputTokens).toBeGreaterThanOrEqual(19_200);

    // Undeclared, the undercount is silent — until a budget is riding on it.
    const budgeted = stt.safe({ model: REF, audio: AUDIO }, { maxCostUSD: 1 });
    expect(budgeted.ok).toBe(true);
    if (!budgeted.ok) return;
    expect(
      budgeted.warnings.map((issue) => String(issue.code)),
    ).toContain("media_duration_undeclared");
  });
});
