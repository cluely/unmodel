import { describe, expect, test } from "bun:test";
import {
  GENERATE_STT_BASE_URL,
  generateSttUrl,
  stt,
  type GenerateSttBody,
} from "./stt";
import { checkStt } from "./check";
import {
  GEMINI_AUDIO_FORMATS,
  GEMINI_AUDIO_MAX_DURATION_SECONDS,
  GEMINI_AUDIO_MIME_TYPES,
  GEMINI_AUDIO_TOKENS_PER_SECOND,
  GEMINI_STT_EXCLUDED_IDS,
  GEMINI_STT_MODEL_IDS,
  INLINE_MEDIA_MAX_BYTES,
} from "./audio-constraints";
import { models } from "../../catalog/google.gen";
import type { ModelInfo } from "../../core/catalog-types";
import type { Issue } from "../../core/issues";
import type { ValidateResult } from "../../core/result";

const MODEL = "gemini-2.5-flash";
// `as const`: `options.media` paths are typed against the body's own shape
// (MediaPathFor), so a widened `(string | number)[]` does not address anything.
const AUDIO_PATH = ["contents", 0, "parts", 1] as const;

/**
 * The generated catalog with its literals widened, for the drift sweeps below.
 * `models` is `as const satisfies`, which is what makes the per-model arms in
 * ./stt derivable — and what stops a `string` id from indexing it.
 */
const catalog: Record<string, ModelInfo> = models;

const WAV = { mimeType: "audio/wav", data: "UklGRiQAAABXQVZF" } as const;

const BODY: Omit<GenerateSttBody, "model"> = {
  contents: [
    {
      parts: [{ text: "Transcribe this recording." }, { inlineData: WAV }],
    },
  ],
};

function expectError(result: ValidateResult<unknown>, code: Issue["code"]): Issue {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected validation failure");
  const issue = result.errors.find((e) => e.code === code);
  expect(issue, `no ${code} error in ${JSON.stringify(result.errors)}`).toBeDefined();
  return issue as Issue;
}

function expectOk(result: ValidateResult<unknown>): Extract<ValidateResult<unknown>, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.errors)}`);
  return result;
}

function warningOf(result: ValidateResult<unknown>, code: Issue["code"]): Issue | undefined {
  return result.warnings.find((w) => w.code === code);
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("the happy path", () => {
  test("inline audio validates and strips the model into the URL", () => {
    const params = stt({ model: MODEL, ...BODY });
    expect(Object.keys(params)).toEqual(["contents"]);
    expect(params.request.url).toBe(`${GENERATE_STT_BASE_URL}/${MODEL}:generateContent`);
    expect(generateSttUrl(`models/${MODEL}`)).toBe(generateSttUrl(MODEL));
  });

  test("a Files API pointer validates without a mimeType", () => {
    expectOk(
      stt.safe({
        model: MODEL,
        contents: [
          {
            parts: [
              { text: "Transcribe." },
              {
                fileData: {
                  fileUri: "https://generativelanguage.googleapis.com/v1beta/files/abc123",
                },
              },
            ],
          },
        ],
      }),
    );
  });

  test("audioTranscriptionConfig is typed and rides in the body", () => {
    const params = stt({
      model: MODEL,
      ...BODY,
      generationConfig: {
        audioTranscriptionConfig: {
          languageCodes: ["en-US"],
          customVocabulary: ["unmodel", "Gemini"],
          wordTimestamp: true,
          diarization: true,
        },
      },
    });
    expect(JSON.parse(JSON.stringify(params))).toMatchObject({
      generationConfig: {
        audioTranscriptionConfig: { wordTimestamp: true, diarization: true },
      },
    });
  });

  test("the SDK view folds generationConfig into config", () => {
    const sdk = stt({
      model: MODEL,
      ...BODY,
      generationConfig: { audioTranscriptionConfig: { diarization: true }, temperature: 0 },
      systemInstruction: { parts: [{ text: "Verbatim, no summary." }] },
    }).toSdk("google");
    expect(sdk.model).toBe(MODEL);
    expect(sdk.config).toMatchObject({
      audioTranscriptionConfig: { diarization: true },
      temperature: 0,
      systemInstruction: { parts: [{ text: "Verbatim, no summary." }] },
    });
  });

  test("every documented audio MIME type validates", () => {
    expect(GEMINI_AUDIO_MIME_TYPES).toHaveLength(7);
    for (const mimeType of GEMINI_AUDIO_MIME_TYPES) {
      expectOk(
        stt.safe({
          model: MODEL,
          contents: [{ parts: [{ inlineData: { mimeType, data: "AAAA" } }] }],
        }),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// T1 + T2 — the model gates
// ---------------------------------------------------------------------------

describe("T1 + T2: the model gates", () => {
  test("T1 — a text-only model is refused", () => {
    const issue = expectError(
      stt.safe({ model: "gemini-2.5-flash-preview-tts", ...BODY }),
      "unsupported_capability",
    );
    expect(issue.path).toEqual(["model"]);
    expect(issue.message).toContain("does not accept audio input");
  });

  test("T2 — an excluded model names its reason and the curated list", () => {
    const issue = expectError(
      stt.safe({ model: "gemini-embedding-2", ...BODY }),
      "unsupported_capability",
    );
    expect(issue.message).toContain("embedContent");
    expect(issue.meta?.reason).toBe(GEMINI_STT_EXCLUDED_IDS["gemini-embedding-2"]);
    expect(issue.meta?.allowed).toEqual([...GEMINI_STT_MODEL_IDS]);
  });

  test("T2 — the Live API models are refused with the WebSocket reason", () => {
    for (const model of ["gemini-3.1-flash-live-preview", "gemini-3.5-live-translate-preview"]) {
      const issue = expectError(stt.safe({ model, ...BODY }), "unsupported_capability");
      expect(issue.message).toContain("bidiGenerateContent");
    }
  });

  test("all thirteen curated ids validate", () => {
    for (const model of GEMINI_STT_MODEL_IDS) {
      expectOk(stt.safe({ model, ...BODY }));
    }
  });

  test("an unknown model reaches the loose arm with unknown_model", () => {
    const result = stt.safe({ model: "gemini-9-flash", ...BODY });
    expectOk(result);
    expect(warningOf(result, "unknown_model")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Curation drift — the two halves that force a codegen refresh to classify
// ---------------------------------------------------------------------------

describe("curation drift", () => {
  test("every curated id is still audio-in / text-out in the generated catalog", () => {
    for (const id of GEMINI_STT_MODEL_IDS) {
      const info = catalog[id];
      expect(info, `${id} vanished from the generated catalog`).toBeDefined();
      expect(info?.modalities.input as string[], id).toContain("audio");
      expect(info?.modalities.output as string[], id).toContain("text");
    }
  });

  test("every audio-input model in the catalog is curated OR excluded", () => {
    const audioInput = Object.entries(catalog)
      .filter(([, info]) => info.modalities.input.includes("audio"))
      .map(([id]) => id);
    // A vacuous sweep would be worse than no sweep.
    expect(audioInput.length).toBeGreaterThan(10);
    const unclassified = audioInput.filter(
      (id) =>
        !GEMINI_STT_MODEL_IDS.includes(id as (typeof GEMINI_STT_MODEL_IDS)[number]) &&
        !Object.hasOwn(GEMINI_STT_EXCLUDED_IDS, id),
    );
    expect(
      unclassified,
      "a codegen refresh added an audio-input model nobody classified — add it to " +
        "GEMINI_STT_MODEL_IDS or to GEMINI_STT_EXCLUDED_IDS with a reason",
    ).toEqual([]);
  });

  test("no id is on both lists, and every excluded id is real", () => {
    for (const id of Object.keys(GEMINI_STT_EXCLUDED_IDS)) {
      expect(GEMINI_STT_MODEL_IDS).not.toContain(id as (typeof GEMINI_STT_MODEL_IDS)[number]);
      expect(catalog[id], `${id} is excluded but no longer exists`).toBeDefined();
      expect(GEMINI_STT_EXCLUDED_IDS[id]?.length ?? 0).toBeGreaterThan(20);
    }
  });
});

// ---------------------------------------------------------------------------
// T3 + T4 — the audio parts themselves
// ---------------------------------------------------------------------------

describe("T3 + T4: audio parts", () => {
  test("T3 — a body with no audio is refused and pointed at google.chat", () => {
    const issue = expectError(
      stt.safe({ model: MODEL, contents: [{ parts: [{ text: "Transcribe what?" }] }] }),
      "invalid_shape",
    );
    expect(issue.path).toEqual(["contents"]);
    expect(issue.meta?.surface).toBe("google.chat");
  });

  test("T4 — more than one audio part WARNS but still validates", () => {
    const result = stt.safe({
      model: MODEL,
      contents: [{ parts: [{ inlineData: WAV }, { inlineData: WAV }] }],
    });
    expectOk(result);
    const warning = warningOf(result, "invalid_shape");
    expect(warning?.meta?.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// T5–T7 — media
// ---------------------------------------------------------------------------

describe("T5–T7: media", () => {
  test("T5 — an off-list audio format fails and names the seven", () => {
    const issue = expectError(
      stt.safe({
        model: MODEL,
        // @ts-expect-error — mimeType is the closed seven-value set.
        contents: [{ parts: [{ inlineData: { mimeType: "audio/webm", data: "AAAA" } }] }],
      }),
      "media_unsupported_format",
    );
    expect(issue.meta?.allowed).toEqual([...GEMINI_AUDIO_FORMATS]);
  });

  test("T6 — an oversized inline part fails; the same size via fileData does not", () => {
    const huge = "A".repeat(1024);
    const issue = expectError(
      stt.safe(
        { model: MODEL, contents: [{ parts: [{ inlineData: { mimeType: "audio/wav", data: huge } }] }] },
        { media: [{ path: ["contents", 0, "parts", 0], bytes: INLINE_MEDIA_MAX_BYTES + 1 }] },
      ),
      "media_too_large",
    );
    expect(issue.meta?.limit).toBe(INLINE_MEDIA_MAX_BYTES);

    // The inline cap does not apply to a Files API pointer (2 GB there).
    expectOk(
      stt.safe(
        {
          model: MODEL,
          contents: [
            {
              parts: [
                {
                  fileData: {
                    fileUri: "https://generativelanguage.googleapis.com/v1beta/files/abc",
                    mimeType: "audio/wav",
                  },
                },
              ],
            },
          ],
        },
        { media: [{ path: ["contents", 0, "parts", 0], bytes: INLINE_MEDIA_MAX_BYTES + 1 }] },
      ),
    );
  });

  test("T7 — a declared duration over 9.5 hours fails", () => {
    const issue = expectError(
      stt.safe({ model: MODEL, ...BODY }, {
        media: [{ path: AUDIO_PATH, durationSeconds: GEMINI_AUDIO_MAX_DURATION_SECONDS + 1 }],
      }),
      "media_duration_exceeded",
    );
    expect(issue.meta?.limit).toBe(GEMINI_AUDIO_MAX_DURATION_SECONDS);
  });

  test("an UNdeclared duration is silent — unlike google.chat, where audio is the exception", () => {
    const result = expectOk(stt.safe({ model: MODEL, ...BODY }));
    expect(warningOf(result, "media_duration_undeclared")).toBeUndefined();
  });

  test("T8 — a Vertex-only displayName earns an unknown_param warning", () => {
    const result = stt.safe({
      model: MODEL,
      contents: [
        // @ts-expect-error — displayName is `never`: generativelanguage 400s on it.
        { parts: [{ inlineData: { ...WAV, displayName: "clip.wav" } }] },
      ],
    });
    expectOk(result);
    expect(warningOf(result, "unknown_param")?.path).toEqual([
      "contents",
      0,
      "parts",
      0,
      "inlineData",
      "displayName",
    ]);
  });
});

// ---------------------------------------------------------------------------
// T9 + estimation
// ---------------------------------------------------------------------------

describe("T9 + estimation", () => {
  test("maxOutputTokens over the row's limit fails", () => {
    const issue = expectError(
      stt.safe({ model: MODEL, ...BODY, generationConfig: { maxOutputTokens: 10_000_000 } }),
      "over_output_limit",
    );
    expect(issue.meta?.limit).toBe(models[MODEL].limit.output);
  });

  test("a declared duration becomes audio tokens at 32/second, billed at inputAudio", () => {
    const durationSeconds = 600;
    const result = expectOk(
      stt.safe({ model: MODEL, ...BODY }, { media: [{ path: AUDIO_PATH, durationSeconds }] }),
    );
    const audioTokens = durationSeconds * GEMINI_AUDIO_TOKENS_PER_SECOND;
    expect(audioTokens).toBe(19_200);
    const inputTokens = result.estimate?.inputTokens as number;
    expect(inputTokens).toBeGreaterThan(audioTokens);

    const cost = models[MODEL].cost!;
    const textTokens = inputTokens - audioTokens;
    const outputTokens = models[MODEL].limit.output!;
    expect(result.estimate?.costUSD).toBeCloseTo(
      (textTokens * cost.input!) / 1_000_000 +
        (audioTokens * cost.inputAudio!) / 1_000_000 +
        (outputTokens * cost.output!) / 1_000_000,
      12,
    );
  });

  test("audio tokens are re-rated, not merely added — the audio rate is higher", () => {
    const withDuration = expectOk(
      stt.safe({ model: MODEL, ...BODY }, { media: [{ path: AUDIO_PATH, durationSeconds: 600 }] }),
    );
    const withoutDuration = expectOk(stt.safe({ model: MODEL, ...BODY }));
    // gemini-2.5-flash: $1.00/M audio against $0.30/M text.
    expect(models[MODEL].cost?.inputAudio).toBeGreaterThan(models[MODEL].cost!.input!);
    expect(withDuration.estimate!.costUSD!).toBeGreaterThan(withoutDuration.estimate!.costUSD!);
  });

  test("maxCostUSD + an undeclared duration is the ONE time silence would be wrong", () => {
    const result = stt.safe({ model: MODEL, ...BODY }, { maxCostUSD: 100 });
    expectOk(result);
    const warning = warningOf(result, "media_duration_undeclared");
    expect(warning?.meta?.undeclared).toBe(1);
    expect(warning?.meta?.tokensPerSecond).toBe(GEMINI_AUDIO_TOKENS_PER_SECOND);
    expect(warning?.message).toContain("undercount");

    // …and it stays silent once the duration IS declared.
    const declared = expectOk(
      stt.safe(
        { model: MODEL, ...BODY },
        { maxCostUSD: 100, media: [{ path: AUDIO_PATH, durationSeconds: 60 }] },
      ),
    );
    expect(warningOf(declared, "media_duration_undeclared")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

describe("refusals", () => {
  test("a typo'd top-level key is a compile error and a runtime warning", () => {
    const result = stt.safe({
      model: MODEL,
      ...BODY,
      // @ts-expect-error — `generationConfigg` is not a param of this endpoint.
      generationConfigg: {},
    });
    expectOk(result);
    expect(warningOf(result, "unknown_param")?.path).toEqual(["generationConfigg"]);
  });

  test("a functionCall part is refused by the type", () => {
    expectOk(
      stt.safe({
        model: MODEL,
        contents: [
          {
            parts: [
              { inlineData: WAV },
              // @ts-expect-error — function calling is a `google.chat` feature.
              { functionCall: { name: "save", args: {} } },
            ],
          },
        ],
      }),
    );
  });

  test("speechConfig is refused by the type — that direction is google.tts", () => {
    expectOk(
      stt.safe({
        model: MODEL,
        ...BODY,
        // @ts-expect-error — `speechConfig` is `never`: use google.tts.
        generationConfig: { speechConfig: { voiceConfig: {} } },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// checkStt — the response side
// ---------------------------------------------------------------------------

describe("checkStt", () => {
  test("a transcript reports usage, cost and no warnings", () => {
    const report = checkStt({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Hello there." }] } }],
      usageMetadata: {
        promptTokenCount: 1925,
        candidatesTokenCount: 12,
        promptTokensDetails: [
          { modality: "TEXT", tokenCount: 5 },
          { modality: "AUDIO", tokenCount: 1920 },
        ],
      },
      modelVersion: MODEL,
    });
    expect(report.warnings).toEqual([]);
    const cost = models[MODEL].cost!;
    expect(report.costUSD).toBeCloseTo(
      (5 * cost.input!) / 1_000_000 +
        (1920 * cost.inputAudio!) / 1_000_000 +
        (12 * cost.output!) / 1_000_000,
      15,
    );
  });

  test("a clean STOP with no transcript earns the empty-transcript warning", () => {
    const report = checkStt({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "   " }] } }],
      modelVersion: MODEL,
    });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.meta?.kind).toBe("empty_transcript");
  });

  test("a truncated response does not ALSO get the empty-transcript warning", () => {
    const report = checkStt({
      candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }],
      modelVersion: MODEL,
    });
    expect(report.warnings.map((w) => w.meta?.kind)).toEqual(["truncated"]);
  });

  test("an empty response object never throws", () => {
    expect(checkStt({}).warnings).toEqual([]);
  });
});
