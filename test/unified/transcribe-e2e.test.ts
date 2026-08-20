/**
 * `unmodel/transcribe`, end to end through the ready-made pack.
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
 * `test/types/unified-transcribe.test-d.ts`, and neither is sufficient alone —
 * one answers for TypeScript with a literal ref, the other for everyone else.
 */
import { describe, expect, test } from "bun:test";
import { UnmodelValidationError } from "../../src/core/issues";
import { TranslationUnavailableError } from "../../src/core/translate/errors";
import { transcribe } from "../../src/unified/transcribe";

const URL_ = "https://example.com/interview.wav";
const audio = (): Blob => new Blob([new Uint8Array(1024)], { type: "audio/wav" });

describe("the pack", () => {
  test("registers exactly the eleven transcribe providers, sorted", () => {
    expect([...transcribe.providers]).toEqual([
      "assemblyai",
      "cartesia",
      "deepgram",
      "elevenlabs",
      "gladia",
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
      transcribe({ model: "sarvam/saarika-v2", audio: { url: URL_ } } as never),
    ).toThrow(TranslationUnavailableError);
    const result = transcribe.safe({ model: "sarvam/saarika-v2", audio: { url: URL_ } } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.meta).toMatchObject({ structural: true, provider: "sarvam" });
  });

  test("a model the adapter does not list warns but still compiles", () => {
    const result = transcribe.safe({
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
    const params = transcribe({
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
    const params = transcribe({
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
    const params = transcribe({
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
    const result = transcribe.safe(
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
    const result = transcribe.safe({
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
    const result = transcribe.safe({
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
    const result = transcribe.safe({
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
    const result = transcribe.safe({
      model: "mistral/voxtral-mini-latest",
      audio: {},
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.message).toContain("`file`, `url` or `fileId`");
  });

  test("inworld refuses every shape, and says why the vocabulary cannot reach it", () => {
    const result = transcribe.safe({
      model: "inworld/inworld/inworld-stt-1",
      audio: { file: audio() },
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe("unsupported_param");
    expect(result.errors[0]!.path).toEqual(["audio"]);
    expect(result.errors[0]!.message).toContain("audioData.content");
    expect(result.errors[0]!.message).toContain("unmodel/inworld");
  });
});

describe("providerOptions", () => {
  test("deep-merges over the compiled body before validation", () => {
    const params = transcribe({
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
    const params = transcribe({
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
    const params = transcribe({
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
    const params = transcribe({
      model: "assemblyai/universal-2",
      audio: { url: URL_ },
      providerOptions: { deepgram: { diarize: true } },
    });
    expect(Object.hasOwn(params, "diarize")).toBe(false);
  });

  test("an override the provider rejects says where it came from", () => {
    const result = transcribe.safe({
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
    const result = transcribe.safe({
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
    const result = transcribe.safe({
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
    const result = transcribe.safe({
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
    const result = transcribe.safe({
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
    const result = transcribe.safe({
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
    const result = transcribe.safe({
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
      const result = transcribe.safe({
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
      transcribe({ model: "cartesia/ink-whisper", audio: { file: audio() }, prompt: "x" } as never);
      throw new Error("expected a throw");
    } catch (error) {
      expect(UnmodelValidationError.isInstance(error)).toBe(true);
      if (!UnmodelValidationError.isInstance(error)) return;
      expect(error.message).toContain("unmodel/transcribe");
      expect(error.issues[0]!.path).toEqual(["prompt"]);
    }
  });
});
