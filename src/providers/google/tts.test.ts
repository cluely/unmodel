import { describe, expect, test } from "bun:test";
import {
  GENERATE_TTS_BASE_URL,
  generateTtsUrl,
  tts,
  ttsStreamUrl,
  ttsSupportsStreaming,
  type GenerateTtsBody,
} from "./tts";
import { checkTts } from "./tts-check";
import { ttsModels } from "./tts-models";
import {
  GEMINI_AUDIO_OUTPUT_MIME_TYPES,
  GEMINI_SPEECH_NATIVE_SAMPLE_RATE,
  GEMINI_TTS_CONTEXT_TOKENS,
  GEMINI_TTS_LANGUAGE_CODES,
  GEMINI_TTS_VOICE_INFO,
} from "./tts-constraints";
import { GEMINI_TTS_VOICES } from "./wire";
import type { Issue } from "../../core/issues";
import type { ValidateResult } from "../../core/result";

const MODEL = "gemini-2.5-flash-preview-tts";
const PRO = "gemini-2.5-pro-preview-tts";
const FLASH_31 = "gemini-3.1-flash-tts-preview";

const HELLO: GenerateTtsBody["contents"] = [
  { parts: [{ text: "Say cheerfully: Have a wonderful day!" }] },
];

const KORE = { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } as const;

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
  return (result.ok ? result.warnings : result.warnings).find((w) => w.code === code);
}

// ---------------------------------------------------------------------------
// Happy path + request shape
// ---------------------------------------------------------------------------

describe("the happy path", () => {
  test("a single-speaker request validates and strips the model into the URL", () => {
    const params = tts({
      model: MODEL,
      contents: HELLO,
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: KORE },
    });
    expect(Object.keys(params).sort()).toEqual(["contents", "generationConfig"]);
    expect(params.request.url).toBe(
      `${GENERATE_TTS_BASE_URL}/${MODEL}:generateContent`,
    );
    expect(params.request.method).toBe("POST");
    expect(params.request.headers).toEqual({ "content-type": "application/json" });
  });

  test("`models/`-prefixed ids resolve to the same URL and the same catalog row", () => {
    expect(generateTtsUrl(`models/${MODEL}`)).toBe(generateTtsUrl(MODEL));
    expectOk(
      tts.safe({
        model: `models/${MODEL}`,
        contents: HELLO,
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: KORE },
      }),
    );
  });

  test("the SDK view is @google/genai's { model, contents, config }", () => {
    const sdk = tts({
      model: FLASH_31,
      contents: HELLO,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: KORE,
        temperature: 0.7,
      },
      safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }],
    }).toSdk("google");
    expect(sdk.model).toBe(FLASH_31);
    expect(sdk.contents).toEqual(HELLO);
    expect(sdk.config).toMatchObject({
      responseModalities: ["AUDIO"],
      temperature: 0.7,
      safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }],
    });
  });

  test("multi-speaker with two speakers validates", () => {
    expectOk(
      tts.safe({
        model: FLASH_31,
        contents: [{ parts: [{ text: "Joe: hi\nJane: hello" }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [
                { speaker: "Joe", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
                { speaker: "Jane", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
              ],
            },
          },
        },
      }),
    );
  });

  test("the mixed-case `Audio` spelling the guides use is accepted", () => {
    expectOk(
      tts.safe({
        model: MODEL,
        contents: HELLO,
        generationConfig: { responseModalities: ["Audio"], speechConfig: KORE },
      }),
    );
  });

  test("ttsStreamUrl builds the SSE route, and the 3.1 gate is exposed", () => {
    expect(ttsStreamUrl(FLASH_31)).toBe(
      `${GENERATE_TTS_BASE_URL}/${FLASH_31}:streamGenerateContent?alt=sse`,
    );
    expect(ttsSupportsStreaming(FLASH_31)).toBe(true);
    expect(ttsSupportsStreaming(`models/${FLASH_31}`)).toBe(true);
    expect(ttsSupportsStreaming(MODEL)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// S1 / S12 — responseModalities
// ---------------------------------------------------------------------------

describe("S1 + S12: responseModalities", () => {
  test("S1 — a request that does not ask for AUDIO fails and names both surfaces", () => {
    const issue = expectError(
      // @ts-expect-error — ["TEXT"] is not a GoogleTtsResponseModalities.
      tts.safe({ model: MODEL, contents: HELLO, generationConfig: { responseModalities: ["TEXT"] } }),
      "unsupported_capability",
    );
    expect(issue.path).toEqual(["generationConfig", "responseModalities"]);
    expect(issue.message).toContain("google.tts");
    expect(issue.message).toContain("unmodel/tts");
    expect(issue.meta?.surface).toBe("google.tts");
  });

  test("S12 — an extra modality alongside AUDIO fails", () => {
    const issue = expectError(
      tts.safe({
        model: MODEL,
        contents: HELLO,
        // @ts-expect-error — the tuple is ["AUDIO"], not ["AUDIO", "TEXT"].
        generationConfig: { responseModalities: ["AUDIO", "TEXT"], speechConfig: KORE },
      }),
      "invalid_enum_value",
    );
    expect(issue.path).toEqual(["generationConfig", "responseModalities", 1]);
  });

  test("generationConfig is required, not optional", () => {
    // @ts-expect-error — `generationConfig` is required on every TTS arm.
    const result = tts.safe({ model: MODEL, contents: HELLO });
    expectError(result, "invalid_shape");
  });
});

// ---------------------------------------------------------------------------
// S2–S5 — voices and speakers
// ---------------------------------------------------------------------------

describe("S2–S5: voices and speakers", () => {
  test("S2 — an unknown voice name fails and lists all 30", () => {
    const issue = expectError(
      tts.safe({
        model: MODEL,
        contents: HELLO,
        generationConfig: {
          responseModalities: ["AUDIO"],
          // @ts-expect-error — voiceName is closed to the 30 presets.
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyrr" } } },
        },
      }),
      "invalid_enum_value",
    );
    expect(issue.path).toEqual([
      "generationConfig",
      "speechConfig",
      "voiceConfig",
      "prebuiltVoiceConfig",
      "voiceName",
    ]);
    expect(issue.meta?.allowed).toEqual([...GEMINI_TTS_VOICES]);
    expect(GEMINI_TTS_VOICES).toHaveLength(30);
    // The descriptor table is display data, but it must cover the same 30
    // names in the same order — completions.test.ts asserts entries[0].
    expect(Object.keys(GEMINI_TTS_VOICE_INFO)).toEqual([...GEMINI_TTS_VOICES]);
  });

  test("every one of the 30 preset voices validates", () => {
    for (const voiceName of GEMINI_TTS_VOICES) {
      expectOk(
        tts.safe({
          model: MODEL,
          contents: HELLO,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
        }),
      );
    }
  });

  test("S3 — the two speech arms are mutually exclusive", () => {
    const issue = expectError(
      tts.safe({
        model: MODEL,
        contents: HELLO,
        generationConfig: {
          responseModalities: ["AUDIO"],
          // @ts-expect-error — the two voice arms are an XOR; a body with both
          // matches neither.
          speechConfig: {
            ...KORE,
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [
                { speaker: "Joe", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
              ],
            },
          },
        },
      }),
      "invalid_shape",
    );
    expect(issue.path).toEqual(["generationConfig", "speechConfig"]);
  });

  test("S4 — three speakers fails with the documented limit of 2", () => {
    const issue = expectError(
      tts.safe({
        model: MODEL,
        contents: HELLO,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              // @ts-expect-error — the tuple is bounded at two speakers.
              speakerVoiceConfigs: [
                { speaker: "Joe", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
                { speaker: "Jane", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
                { speaker: "Jim", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Leda" } } },
              ],
            },
          },
        },
      }),
      "invalid_shape",
    );
    expect(issue.meta?.limit).toBe(2);
  });

  test("S5 — a bad voice on the SECOND speaker is reported at its own index", () => {
    const issue = expectError(
      tts.safe({
        model: MODEL,
        contents: HELLO,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [
                { speaker: "Joe", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
                // @ts-expect-error — voiceName is closed to the 30 presets.
                { speaker: "Jane", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Nope" } } },
              ],
            },
          },
        },
      }),
      "invalid_enum_value",
    );
    expect(issue.path).toEqual([
      "generationConfig",
      "speechConfig",
      "multiSpeakerVoiceConfig",
      "speakerVoiceConfigs",
      1,
      "voiceConfig",
      "prebuiltVoiceConfig",
      "voiceName",
    ]);
  });

  test("one speaker is accepted — the guide says 'up to 2', not 'exactly two'", () => {
    expectOk(
      tts.safe({
        model: MODEL,
        contents: HELLO,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [
                { speaker: "Joe", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
              ],
            },
          },
        },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// S6 — the model gate
// ---------------------------------------------------------------------------

describe("S6: the model-on-the-list gate", () => {
  test("a chat model is refused and pointed at google.chat", () => {
    const issue = expectError(
      tts.safe({
        model: "gemini-2.5-flash",
        contents: HELLO,
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: KORE },
      }),
      "unsupported_capability",
    );
    expect(issue.path).toEqual(["model"]);
    expect(issue.message).toContain("google.chat");
    expect(issue.meta?.surface).toBe("google.chat");
  });

  test("an unknown but TTS-named model reaches the loose arm with unknown_model", () => {
    const result = tts.safe({
      model: "gemini-9-flash-tts-preview",
      contents: HELLO,
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: KORE },
    });
    expectOk(result);
    expect(warningOf(result, "unknown_model")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// S7–S10 — responseFormat.audio
// ---------------------------------------------------------------------------

describe("S7–S10: responseFormat.audio", () => {
  test("every one of the 12 documented spellings validates", () => {
    expect(GEMINI_AUDIO_OUTPUT_MIME_TYPES).toHaveLength(12);
    for (const mimeType of GEMINI_AUDIO_OUTPUT_MIME_TYPES) {
      expectOk(
        tts.safe({
          model: MODEL,
          contents: HELLO,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: KORE,
            responseFormat: { audio: { mimeType } },
          },
        }),
      );
    }
  });

  test("S7 — an off-list mimeType fails", () => {
    const issue = expectError(
      tts.safe({
        model: MODEL,
        contents: HELLO,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: KORE,
          // @ts-expect-error — "audio/flac" is an INPUT format, not an output one.
          responseFormat: { audio: { mimeType: "audio/flac" } },
        },
      }),
      "invalid_enum_value",
    );
    expect(issue.path).toEqual(["generationConfig", "responseFormat", "audio", "mimeType"]);
  });

  test("S8 — bitRate on an uncompressed format fails, on a compressed one passes", () => {
    const issue = expectError(
      tts.safe({
        model: MODEL,
        contents: HELLO,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: KORE,
          // @ts-expect-error — bitRate is `never` on the uncompressed arm.
          responseFormat: { audio: { mimeType: "AUDIO_L16", bitRate: 128000 } },
        },
      }),
      "unsupported_param",
    );
    expect(issue.path).toEqual(["generationConfig", "responseFormat", "audio", "bitRate"]);

    expectOk(
      tts.safe({
        model: MODEL,
        contents: HELLO,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: KORE,
          responseFormat: { audio: { mimeType: "AUDIO_MP3", bitRate: 128000 } },
        },
      }),
    );
  });

  test("S9 — a non-integer sample rate fails", () => {
    const issue = expectError(
      tts.safe({
        model: MODEL,
        contents: HELLO,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: KORE,
          responseFormat: { audio: { mimeType: "AUDIO_WAV", sampleRate: 24000.5 } },
        },
      }),
      "invalid_shape",
    );
    expect(issue.path).toEqual(["generationConfig", "responseFormat", "audio", "sampleRate"]);
  });

  test("S10 — an out-of-band sample rate WARNS and says the doc basis is thin", () => {
    const result = tts.safe({
      model: MODEL,
      contents: HELLO,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: KORE,
        responseFormat: { audio: { mimeType: "AUDIO_WAV", sampleRate: 24 } },
      },
    });
    expectOk(result);
    const warning = warningOf(result, "invalid_enum_value");
    expect(warning?.path).toEqual(["generationConfig", "responseFormat", "audio", "sampleRate"]);
    expect(warning?.meta?.nativeSampleRate).toBe(GEMINI_SPEECH_NATIVE_SAMPLE_RATE);
    expect(warning?.message).toContain("no allowed range");

    // The native rate itself is silent.
    const native = expectOk(
      tts.safe({
        model: MODEL,
        contents: HELLO,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: KORE,
          responseFormat: {
            audio: { mimeType: "AUDIO_WAV", sampleRate: GEMINI_SPEECH_NATIVE_SAMPLE_RATE },
          },
        },
      }),
    );
    expect(warningOf(native, "invalid_enum_value")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// S11 — languageCode
// ---------------------------------------------------------------------------

describe("S11: languageCode", () => {
  test("the table has 78 rows, deduped and sorted", () => {
    expect(GEMINI_TTS_LANGUAGE_CODES).toHaveLength(78);
    expect(new Set(GEMINI_TTS_LANGUAGE_CODES).size).toBe(78);
    expect([...GEMINI_TTS_LANGUAGE_CODES].sort()).toEqual([...GEMINI_TTS_LANGUAGE_CODES]);
  });

  test("a tabulated subtag is silent, and a full BCP-47 tag reads its primary subtag", () => {
    for (const languageCode of ["en", "cmn", "en-US", "pt-BR"]) {
      const result = expectOk(
        tts.safe({
          model: MODEL,
          contents: HELLO,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { ...KORE, languageCode },
          },
        }),
      );
      expect(warningOf(result, "invalid_enum_value")).toBeUndefined();
    }
  });

  test("an off-table subtag WARNS rather than failing", () => {
    const result = tts.safe({
      model: MODEL,
      contents: HELLO,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { ...KORE, languageCode: "xx-YY" },
      },
    });
    expectOk(result);
    const warning = warningOf(result, "invalid_enum_value");
    expect(warning?.path).toEqual(["generationConfig", "speechConfig", "languageCode"]);
    expect(warning?.meta?.primarySubtag).toBe("xx");
  });
});

// ---------------------------------------------------------------------------
// S13 — text-only inputs
// ---------------------------------------------------------------------------

describe("S13: text-only inputs", () => {
  test("an audio part is refused and pointed at google.stt", () => {
    const issue = expectError(
      tts.safe({
        model: MODEL,
        contents: [
          // @ts-expect-error — inlineData is `never` on a TTS part.
          { parts: [{ inlineData: { mimeType: "audio/wav", data: "AAA" } }] },
        ],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: KORE },
      }),
      "unsupported_capability",
    );
    expect(issue.path).toEqual(["contents", 0, "parts", 0]);
    expect(issue.meta?.surface).toBe("google.stt");
  });

  test("an empty part is refused", () => {
    const issue = expectError(
      tts.safe({
        model: MODEL,
        // @ts-expect-error — `text` is required on a TTS part.
        contents: [{ parts: [{}] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: KORE },
      }),
      "invalid_shape",
    );
    expect(issue.path).toEqual(["contents", 0, "parts", 0]);
  });
});

// ---------------------------------------------------------------------------
// Capabilities + estimation
// ---------------------------------------------------------------------------

describe("capabilities and estimation", () => {
  // Written out per model rather than looped: `for (const model of [A, B])`
  // widens the id to a UNION, and a union `M` resolves `GoogleTtsArm<M>` to a
  // union of arms that a single object literal can satisfy through either one
  // — so the `@ts-expect-error` below would go unused and the type half of
  // this assertion would silently stop asserting anything.
  test("thinkingConfig is refused on 2.5 Flash TTS (not a reasoning model)", () => {
    const issue = expectError(
      tts.safe({
        model: MODEL,
        contents: HELLO,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: KORE,
          // @ts-expect-error — thinkingConfig is `never` on the 2.5 arms.
          thinkingConfig: { thinkingBudget: 128 },
        },
      }),
      "unsupported_capability",
    );
    expect(issue.path).toEqual(["generationConfig", "thinkingConfig"]);
  });

  test("thinkingConfig is refused on 2.5 Pro TTS, and accepted on 3.1", () => {
    const issue = expectError(
      tts.safe({
        model: PRO,
        contents: HELLO,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: KORE,
          // @ts-expect-error — thinkingConfig is `never` on the 2.5 arms.
          thinkingConfig: { thinkingBudget: 128 },
        },
      }),
      "unsupported_capability",
    );
    expect(issue.path).toEqual(["generationConfig", "thinkingConfig"]);

    // …and accepted on 3.1, the one reasoning TTS model.
    expectOk(
      tts.safe({
        model: FLASH_31,
        contents: HELLO,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: KORE,
          thinkingConfig: { thinkingBudget: 128 },
        },
      }),
    );
  });

  test("maxOutputTokens over the row's output limit fails", () => {
    const issue = expectError(
      tts.safe({
        model: MODEL,
        contents: HELLO,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: KORE,
          maxOutputTokens: 999_999,
        },
      }),
      "over_output_limit",
    );
    expect(issue.meta?.limit).toBe(ttsModels[MODEL].limit.output);
  });

  test("the estimate bills the transcript in and maxOutputTokens out", () => {
    // "aaaa" → 1 token on the heuristic tokenizer (4 chars/token), plus the
    // per-message overhead, so the arithmetic below is exact rather than
    // approximate.
    const result = expectOk(
      tts.safe({
        model: MODEL,
        contents: [{ parts: [{ text: "aaaa" }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: KORE,
          maxOutputTokens: 1000,
        },
      }),
    );
    const inputTokens = result.estimate?.inputTokens as number;
    const cost = ttsModels[MODEL].cost;
    expect(result.estimate?.costUSD).toBeCloseTo(
      (inputTokens * cost.input) / 1_000_000 + (1000 * cost.output) / 1_000_000,
      12,
    );
  });

  test("the doc-corrected 32k context beats models.dev's 8192", () => {
    expect(ttsModels[MODEL].limit.context).toBe(GEMINI_TTS_CONTEXT_TOKENS);
    // ~20k tokens: over the generated 8192, inside the documented 32k.
    expectOk(
      tts.safe({
        model: MODEL,
        contents: [{ parts: [{ text: "word ".repeat(20000) }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: KORE },
      }),
    );
    // …and 40k is over even the corrected window.
    expectError(
      tts.safe({
        model: MODEL,
        contents: [{ parts: [{ text: "word ".repeat(40000) }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: KORE },
      }),
      "over_context",
    );
  });

  test("over_context is reported at `contents`, not at the root", () => {
    const result = tts.safe({
      model: MODEL,
      contents: [{ parts: [{ text: "word ".repeat(40000) }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: KORE },
    });
    expect(expectError(result, "over_context").path).toEqual(["contents"]);
  });
});

// ---------------------------------------------------------------------------
// ExactKeys + refusals
// ---------------------------------------------------------------------------

describe("refusals", () => {
  test("a typo'd top-level key is a compile error and a runtime warning", () => {
    const result = tts.safe({
      model: MODEL,
      contents: HELLO,
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: KORE },
      // @ts-expect-error — `generationConfigg` is not a param of this endpoint.
      generationConfigg: {},
    });
    expectOk(result);
    expect(warningOf(result, "unknown_param")?.path).toEqual(["generationConfigg"]);
  });

  test("chat-only top-level knobs are refused by the type", () => {
    expectOk(
      tts.safe({
        model: MODEL,
        contents: HELLO,
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: KORE },
        // @ts-expect-error — `tools` is `never` on a TTS body.
        tools: [{ googleSearch: {} }],
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// checkTts — the response side
// ---------------------------------------------------------------------------

describe("checkTts", () => {
  const audioPart = { inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: "AAAA" } };

  test("a clean synthesis reports usage, cost and no warnings", () => {
    const report = checkTts({
      candidates: [{ finishReason: "STOP", content: { parts: [audioPart] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 480, totalTokenCount: 492 },
      modelVersion: MODEL,
    });
    expect(report.warnings).toEqual([]);
    expect(report.finishReason).toBe("STOP");
    expect(report.usage).toEqual({ inputTokens: 12, outputTokens: 480, totalTokens: 492 });
    const cost = ttsModels[MODEL].cost;
    expect(report.costUSD).toBeCloseTo(
      (12 * cost.input) / 1_000_000 + (480 * cost.output) / 1_000_000,
      12,
    );
  });

  test("MAX_TOKENS is a truncation warning", () => {
    const report = checkTts({
      candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [audioPart] } }],
      modelVersion: MODEL,
    });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.meta?.kind).toBe("truncated");
  });

  test("PROHIBITED_CONTENT is a filtering warning naming the classifier remedy", () => {
    const report = checkTts({
      candidates: [{ finishReason: "PROHIBITED_CONTENT" }],
      modelVersion: MODEL,
    });
    expect(report.warnings[0]?.meta?.kind).toBe("content_filtered");
    expect(report.warnings[0]?.message).toContain("classifier");
  });

  test("a blocked prompt is reported from promptFeedback", () => {
    const report = checkTts({ promptFeedback: { blockReason: "SAFETY" }, modelVersion: MODEL });
    expect(report.warnings[0]?.path).toEqual(["promptFeedback", "blockReason"]);
    expect(report.warnings[0]?.meta?.kind).toBe("content_filtered");
  });

  test("a clean STOP with no audio part earns the empty-audio warning", () => {
    const report = checkTts({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Have a wonderful day!" }] } }],
      modelVersion: MODEL,
    });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.meta?.kind).toBe("empty_audio");
    expect(report.warnings[0]?.path).toEqual(["candidates", 0, "content", "parts"]);
  });

  test("a URI-delivery response carries audio: a fileData part is not empty", () => {
    const report = checkTts({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              { fileData: { fileUri: "https://generativelanguage.googleapis.com/v1beta/files/abc", mimeType: "audio/mpeg" } },
            ],
          },
        },
      ],
      modelVersion: MODEL,
    });
    expect(report.warnings).toEqual([]);
  });

  test("a non-audio fileData part still earns the empty-audio warning", () => {
    const report = checkTts({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              { fileData: { fileUri: "https://generativelanguage.googleapis.com/v1beta/files/abc", mimeType: "text/plain" } },
            ],
          },
        },
      ],
      modelVersion: MODEL,
    });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.meta?.kind).toBe("empty_audio");
  });

  test("a truncated response does not ALSO get the empty-audio warning", () => {
    const report = checkTts({
      candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }],
      modelVersion: MODEL,
    });
    expect(report.warnings.map((w) => w.meta?.kind)).toEqual(["truncated"]);
  });

  test("an unknown modelVersion prices nothing and still reports usage", () => {
    const report = checkTts({
      candidates: [{ finishReason: "STOP", content: { parts: [audioPart] } }],
      usageMetadata: { promptTokenCount: 5 },
      modelVersion: "some-future-tts",
    });
    expect(report.costUSD).toBeUndefined();
    expect(report.usage.inputTokens).toBe(5);
  });

  test("an empty response object never throws", () => {
    expect(checkTts({}).warnings).toEqual([]);
  });
});
