import { describe, expect, test } from "bun:test";
import {
  GENERATE_CONTENT_BASE_URL,
  chat,
  generateContentUrl,
  type GenerateContentBody,
  type GoogleGenerationConfig,
  type GoogleModality,
} from "./chat";
import {
  GEMINI_IMAGE_ASPECT_RATIOS,
  GEMINI_IMAGE_ASPECT_RATIO_ENUM_NAMES,
  GEMINI_IMAGE_SIZES,
  GEMINI_IMAGE_SIZE_ENUM_NAMES,
  INLINE_MEDIA_MAX_BYTES,
  INLINE_PDF_MAX_BYTES,
} from "./constraints";
// The enum-name unions and the 30-voice preset list live on the wire leaf and
// are not re-exported through chat.ts; a test may reach the leaf directly.
import type {
  GeminiTtsVoiceName,
  GoogleImageAspectRatioEnumName,
  GoogleImageSizeEnumName,
} from "./wire";
import { chatModels } from "./chat-tts-overlay";
import { models } from "../../catalog/google.gen";
import type { Issue } from "../../core/issues";
import type { ValidateResult } from "../../core/result";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const GIF_1X1 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const HELLO: GenerateContentBody["contents"] = [{ role: "user", parts: [{ text: "Hello" }] }];

function expectError(result: ValidateResult<unknown>, code: Issue["code"]): Issue {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected validation failure");
  const issue = result.errors.find((e) => e.code === code);
  expect(issue).toBeDefined();
  return issue!;
}

function expectOk<V>(result: ValidateResult<V>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected ok, got: ${JSON.stringify(result.errors)}`);
  return result;
}

describe("wire purity", () => {
  test("model is stripped from the body and JSON output; URL carries it", () => {
    const validated = chat({ model: "gemini-2.5-flash", contents: HELLO });
    expect(Object.keys(validated)).toEqual(["contents"]);
    const json = JSON.parse(JSON.stringify(validated));
    expect("model" in json).toBe(false);
    expect(json).toEqual({ contents: HELLO });
    expect(validated.request.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    expect(validated.request.method).toBe("POST");
    expect(validated.request.headers["content-type"]).toBe("application/json");
  });

  test("toSdk and request are non-enumerable but callable", () => {
    const validated = chat({ model: "gemini-2.5-flash", contents: HELLO });
    expect(Object.getOwnPropertyDescriptor(validated, "toSdk")?.enumerable).toBe(false);
    expect(Object.getOwnPropertyDescriptor(validated, "request")?.enumerable).toBe(false);
    expect(typeof validated.toSdk).toBe("function");
  });

  test('a leading "models/" is stripped: both forms yield the same URL and catalog hit', () => {
    const bare = chat.safe({ model: "gemini-2.5-flash", contents: HELLO });
    const prefixed = chat.safe({ model: "models/gemini-2.5-flash", contents: HELLO });
    if (!bare.ok || !prefixed.ok) throw new Error("expected both forms to validate");
    expect(prefixed.params.request.url).toBe(bare.params.request.url);
    expect(prefixed.params.request.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    // The prefixed form resolves in the catalog too — no unknown_model noise.
    expect(prefixed.warnings.some((w) => w.code === "unknown_model")).toBe(false);
  });

  test("generateContentUrl helper accepts both id forms", () => {
    expect(generateContentUrl("gemini-2.5-flash")).toBe(
      `${GENERATE_CONTENT_BASE_URL}/gemini-2.5-flash:generateContent`,
    );
    expect(generateContentUrl("models/gemini-2.5-flash")).toBe(
      generateContentUrl("gemini-2.5-flash"),
    );
  });
});

describe("toSdk mapping", () => {
  test("generationConfig flattens into config; siblings move under config", () => {
    const validated = chat({
      model: "gemini-2.5-flash",
      contents: HELLO,
      systemInstruction: { parts: [{ text: "Be brief." }] },
      tools: [{ functionDeclarations: [{ name: "get_weather" }] }],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 128, topP: 0.9 },
      cachedContent: "cachedContents/abc123",
    });
    expect(validated.toSdk("google")).toEqual({
      model: "gemini-2.5-flash",
      contents: HELLO,
      config: {
        temperature: 0.7,
        maxOutputTokens: 128,
        topP: 0.9,
        systemInstruction: { parts: [{ text: "Be brief." }] },
        tools: [{ functionDeclarations: [{ name: "get_weather" }] }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }],
        cachedContent: "cachedContents/abc123",
      },
    } as unknown as ReturnType<typeof validated.toSdk<"google">>);
  });

  test("config is omitted when nothing feeds it", () => {
    const validated = chat({ model: "gemini-2.5-flash", contents: HELLO });
    expect(validated.toSdk("google")).toEqual({ model: "gemini-2.5-flash", contents: HELLO });
  });

  test("serviceTier moves under config; store stays wire-only", () => {
    const validated = chat({
      model: "gemini-2.5-flash",
      contents: HELLO,
      serviceTier: "flex",
      store: false,
    });
    // Both are wire body fields…
    expect(JSON.parse(JSON.stringify(validated))).toEqual({
      contents: HELLO,
      serviceTier: "flex",
      store: false,
    });
    // …but only serviceTier has an SDK config equivalent.
    expect(validated.toSdk("google")).toEqual({
      model: "gemini-2.5-flash",
      contents: HELLO,
      config: { serviceTier: "flex" },
    } as unknown as ReturnType<typeof validated.toSdk<"google">>);
  });

  test("toSdk names the available targets when handed an unknown one", () => {
    const validated = chat({ model: "gemini-2.5-flash", contents: HELLO });
    expect(() => (validated.toSdk as (t: string) => unknown)("google-vertex")).toThrow(
      /"google-vertex" is not an SDK target for this endpoint\. Available: google, ai-sdk\./,
    );
  });
});

describe("google.chat toApi", () => {
  const gemini = () => chat({ model: "gemini-2.5-flash", contents: HELLO });

  test("toApi/toApiSafe are attached and non-enumerable", () => {
    const validated = gemini();
    expect(Object.keys(validated)).toEqual(["contents"]);
    expect(Object.getOwnPropertyDescriptor(validated, "toApi")?.enumerable).toBe(false);
    expect(Object.getOwnPropertyDescriptor(validated, "toApiSafe")?.enumerable).toBe(false);
  });

  test("the model id is read from the URL-bound closure, not the stripped body", () => {
    // `model` is not on the wire body here, so a naive availability lookup
    // would find nothing and report every target as unavailable.
    const validated = gemini() as unknown as { toApiSafe(t: string): ValidateResult<object> };
    const result = validated.toApiSafe("groq");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.message).toContain('"gemini-2.5-flash" is not served by groq');
      // Proof the lookup resolved the source row rather than falling through
      // to the "unknown model" arm.
      expect(result.errors[0]?.message).toContain("openrouter");
    }
  });

  test("the cross-dialect hop to openrouter produces a chat-completions body", () => {
    // google-vertex is the only same-dialect target in the generated data and
    // it is factory-configured, so every reachable v1 edge is cross-dialect.
    const routed = gemini().toApi("openrouter");
    expect(JSON.parse(JSON.stringify(routed))).toEqual({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(routed.request.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(routed.warnings.map((w) => w.code)).toEqual(["id_respelled"]);
  });

  test("factory-configured targets are rejected with the reason, not a bad URL", () => {
    expect(() => (gemini().toApi as (t: string) => unknown)("google-vertex")).toThrow(
      /google-vertex has no provider-wide URL; it needs project \+ location/,
    );
  });
});

describe("shape checks", () => {
  test("empty contents fails", () => {
    const result = chat.safe({ model: "gemini-2.5-flash", contents: [] });
    expectError(result, "invalid_shape");
  });

  test("wrong role fails", () => {
    const result = chat.safe({
      model: "gemini-2.5-flash",
      contents: [{ role: "assistant", parts: [{ text: "hi" }] }],
    } as unknown as GenerateContentBody);
    expectError(result, "invalid_shape");
  });

  test("a part with two kinds fails; the path names the part", () => {
    const result = chat.safe({
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: "hi", inlineData: { mimeType: "image/png", data: PNG_1X1 } }] },
      ],
    });
    const issue = expectError(result, "invalid_shape");
    expect(issue.path).toEqual(["contents", 0, "parts", 0]);
  });

  test("a part with no kind fails", () => {
    const result = chat.safe({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ thought: true }] }],
    });
    expectError(result, "invalid_shape");
  });

  test("unknown top-level keys warn as unknown_param", () => {
    const result = expectOk(
      chat.safe({ model: "gemini-2.5-flash", contents: HELLO, foo: 1 } as GenerateContentBody),
    );
    expect(result.warnings.some((w) => w.code === "unknown_param" && w.path[0] === "foo")).toBe(true);
  });

  test("serviceTier and store are known wire fields (no unknown_param)", () => {
    const result = expectOk(
      chat.safe({
        model: "gemini-2.5-flash",
        contents: HELLO,
        serviceTier: "priority",
        store: true,
      }),
    );
    expect(result.warnings.some((w) => w.code === "unknown_param")).toBe(false);
  });

  test("a part with only toolCall or toolResponse is a valid oneof member", () => {
    expectOk(
      chat.safe({
        model: "gemini-2.5-flash",
        contents: [
          { role: "model", parts: [{ toolCall: { id: "tc-1", toolType: "GOOGLE_SEARCH_WEB", args: { q: "x" } } }] },
          { role: "user", parts: [{ toolResponse: { id: "tc-1", toolType: "GOOGLE_SEARCH_WEB", response: {} } }] },
        ],
      }),
    );
  });

  test("unknown model warns but validates", () => {
    const result = expectOk(chat.safe({ model: "gemini-99-ultra", contents: HELLO }));
    expect(result.warnings.some((w) => w.code === "unknown_model")).toBe(true);
  });
});

describe("capability checks (real catalog ids)", () => {
  test("tools on a model without toolCall", () => {
    expect(models["gemini-2.5-flash-image"].toolCall).toBe(false);
    const result = chat.safe({
      model: "gemini-2.5-flash-image",
      contents: HELLO,
      // @ts-expect-error — `tools` is `never` on a `toolCall: false` model.
      // Kept as a runtime test: the compile error is the type layer's answer,
      // this is the validator's, and a JS caller only ever gets the second.
      tools: [{ functionDeclarations: [{ name: "f" }] }],
    });
    const issue = expectError(result, "unsupported_capability");
    expect(issue.path).toEqual(["tools"]);
  });

  test("responseSchema on a model without structuredOutput", () => {
    expect(models["gemini-3.1-flash-lite-image"].structuredOutput).toBe(false);
    const result = chat.safe({
      model: "gemini-3.1-flash-lite-image",
      contents: HELLO,
      generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT" } },
    });
    const issue = expectError(result, "unsupported_capability");
    expect(issue.path).toEqual(["generationConfig", "responseSchema"]);
  });

  test("responseSchema on a structuredOutput model passes", () => {
    expect(models["gemini-2.5-flash"].structuredOutput).toBe(true);
    expectOk(
      chat.safe({
        model: "gemini-2.5-flash",
        contents: HELLO,
        generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT" } },
      }),
    );
  });

  test("temperature on a temperature:false model", () => {
    expect(models["gemini-embedding-001"].temperature).toBe(false);
    const result = chat.safe({
      model: "gemini-embedding-001",
      contents: HELLO,
      // @ts-expect-error — `temperature` is `never` on a `temperature: false` model.
      generationConfig: { temperature: 0.5 },
    });
    const issue = expectError(result, "unsupported_param");
    expect(issue.path).toEqual(["generationConfig", "temperature"]);
  });

  test("thinkingConfig on a non-reasoning model", () => {
    expect(models["gemini-2.5-flash-preview-tts"].reasoning).toBe(false);
    const result = chat.safe({
      model: "gemini-2.5-flash-preview-tts",
      contents: HELLO,
      // @ts-expect-error — `thinkingConfig` is `never` on a non-reasoning model.
      generationConfig: { thinkingConfig: { thinkingBudget: 1024 } },
    });
    const issue = expectError(result, "unsupported_capability");
    expect(issue.path).toEqual(["generationConfig", "thinkingConfig"]);
  });

  test("maxOutputTokens above the model's output limit", () => {
    const limit = models["gemini-2.5-flash"].limit.output!;
    const result = chat.safe({
      model: "gemini-2.5-flash",
      contents: HELLO,
      generationConfig: { maxOutputTokens: limit + 1 },
    });
    const issue = expectError(result, "over_output_limit");
    expect(issue.meta?.limit).toBe(limit);
  });
});

describe("media checks", () => {
  test("video sent to a model without video input modality", () => {
    expect(models["gemini-2.5-computer-use-preview-10-2025"].modalities.input).toEqual(["text", "image"]);
    const result = chat.safe({
      model: "gemini-2.5-computer-use-preview-10-2025",
      contents: [
        {
          role: "user",
          parts: [{ text: "describe" }, { inlineData: { mimeType: "video/mp4", data: "AAAAAAAAAAAA" } }],
        },
      ],
    });
    const issue = expectError(result, "unsupported_capability");
    expect(issue.path).toEqual(["contents", 0, "parts", 1]);
  });

  test("undocumented image mime subtype is rejected", () => {
    const result = chat.safe({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/bmp", data: "AAAAAAAAAAAA" } }] }],
    });
    const issue = expectError(result, "media_unsupported_format");
    expect(issue.meta?.format).toBe("bmp");
  });

  test("sniffed bytes override the declared mime (png labeled as bmp passes)", () => {
    // The mime label says bmp (disallowed) but the bytes sniff as png
    // (allowed): the sniffed truth wins, so no format issue fires.
    const result = expectOk(
      chat.safe({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/bmp", data: PNG_1X1 } }] }],
      }),
    );
    expect(result.warnings.some((w) => w.code === "media_unsupported_format")).toBe(false);
  });

  test("gif is an accepted image format (Blob.mimeType reference)", () => {
    expectOk(
      chat.safe({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/gif", data: GIF_1X1 } }] }],
      }),
    );
  });

  test("avif is accepted via the declared mime (not sniffable)", () => {
    expectOk(
      chat.safe({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/avif", data: "AAAAAAAAAAAA" } }] }],
      }),
    );
  });

  test("displayName on inlineData/fileData warns as a Vertex-only field", () => {
    const result = expectOk(
      chat.safe({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "image/png", data: PNG_1X1, displayName: "cat.png" } },
            ],
          },
        ],
      } as unknown as GenerateContentBody),
    );
    const warning = result.warnings.find((w) => w.code === "unknown_param");
    expect(warning).toBeDefined();
    expect(warning!.path).toEqual(["contents", 0, "parts", 0, "inlineData", "displayName"]);
    expect(warning!.message).toContain("Vertex");
  });

  test("a valid inline png passes", () => {
    expectOk(
      chat.safe({
        model: "gemini-2.5-flash",
        contents: [
          { role: "user", parts: [{ text: "what is this?" }, { inlineData: { mimeType: "image/png", data: PNG_1X1 } }] },
        ],
      }),
    );
  });

  test("inline cap is 100MB (50MB for PDFs) per the current files docs", () => {
    expect(INLINE_MEDIA_MAX_BYTES).toBe(100 * 1024 * 1024);
    expect(INLINE_PDF_MAX_BYTES).toBe(50 * 1024 * 1024);
    const rules = chat.constraintsFor("gemini-2.5-flash");
    expect(rules.some((r) => r.media?.image?.maxBytes === INLINE_MEDIA_MAX_BYTES)).toBe(true);
    expect(rules.some((r) => r.media?.video?.maxBytes === INLINE_MEDIA_MAX_BYTES)).toBe(true);
  });

  test("declared bytes over the inline cap on an inlineData part -> media_too_large", () => {
    const result = chat.safe(
      {
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: "video/mp4", data: "AAAAAAAAAAAA" } }] }],
      },
      {
        media: [
          {
            path: ["contents", 0, "parts", 0],
            bytes: INLINE_MEDIA_MAX_BYTES + 1,
            durationSeconds: 60,
          },
        ],
      },
    );
    const issue = expectError(result, "media_too_large");
    expect(issue.meta?.limit).toBe(INLINE_MEDIA_MAX_BYTES);
  });

  test("the inline cap does not apply to Files-API (fileData) parts", () => {
    // Files API media may be up to 2GB; declared bytes must not trip the
    // inline cap when the part is a fileData reference.
    const result = expectOk(
      chat.safe(
        {
          model: "gemini-2.5-flash",
          contents: [
            {
              role: "user",
              parts: [
                {
                  fileData: {
                    fileUri: "https://generativelanguage.googleapis.com/v1beta/files/abc",
                    mimeType: "video/mp4",
                  },
                },
              ],
            },
          ],
        },
        {
          media: [
            {
              path: ["contents", 0, "parts", 0],
              bytes: 2_000_000_000,
              durationSeconds: 60,
            },
          ],
        },
      ),
    );
    expect(result.warnings.some((w) => w.code === "media_too_large")).toBe(false);
  });

  test("an inline PDF over 50MB encoded -> media_too_large", () => {
    expect(models["gemini-2.5-flash"].modalities.input).toContain("pdf");
    const result = chat.safe({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType: "application/pdf", data: "A".repeat(INLINE_PDF_MAX_BYTES + 4) } }],
        },
      ],
    });
    const issue = expectError(result, "media_too_large");
    expect(issue.meta?.limit).toBe(INLINE_PDF_MAX_BYTES);
  });
});

describe("video duration declarations", () => {
  const videoParams: GenerateContentBody = {
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { text: "summarize this video" },
          { fileData: { fileUri: "https://generativelanguage.googleapis.com/v1beta/files/abc", mimeType: "video/mp4" } },
        ],
      },
    ],
  };

  test("catalog gate: gemini-2.5-flash is a 1M-context video model", () => {
    expect(models["gemini-2.5-flash"].limit.context).toBeGreaterThanOrEqual(1_000_000);
    expect(models["gemini-2.5-flash"].modalities.input).toContain("video");
    const rules = chat.constraintsFor("gemini-2.5-flash");
    expect(rules.some((r) => r.media?.video?.maxDurationSeconds === 3600)).toBe(true);
  });

  test("no declaration -> media_duration_undeclared warning", () => {
    const result = expectOk(chat.safe(videoParams));
    const warning = result.warnings.find((w) => w.code === "media_duration_undeclared");
    expect(warning).toBeDefined();
    expect(warning!.path).toEqual(["contents", 0, "parts", 1]);
  });

  test("declared duration over the limit -> media_duration_exceeded error", () => {
    const result = chat.safe(videoParams, {
      media: [{ path: ["contents", 0, "parts", 1], durationSeconds: 7200 }],
    });
    const issue = expectError(result, "media_duration_exceeded");
    expect(issue.meta).toEqual(expect.objectContaining({ durationSeconds: 7200, limit: 3600 }));
  });

  test("MEDIA_RESOLUTION_LOW triples the video duration cap (1h -> 3h)", () => {
    const lowRes = {
      ...videoParams,
      generationConfig: { mediaResolution: "MEDIA_RESOLUTION_LOW" as const },
    };
    // 2h video: over the default 1h cap, but fine at low media resolution.
    expectOk(
      chat.safe(lowRes, {
        media: [{ path: ["contents", 0, "parts", 1], durationSeconds: 7200 }],
      }),
    );
    // 3h30m is over even the low-resolution cap.
    const over = chat.safe(lowRes, {
      media: [{ path: ["contents", 0, "parts", 1], durationSeconds: 12600 }],
    });
    const issue = expectError(over, "media_duration_exceeded");
    expect(issue.meta).toEqual(expect.objectContaining({ durationSeconds: 12600, limit: 10800 }));
  });

  test("declared duration within the limit -> no duration issues", () => {
    const result = expectOk(
      chat.safe(videoParams, {
        media: [{ path: ["contents", 0, "parts", 1], durationSeconds: 1800 }],
      }),
    );
    expect(result.warnings.some((w) => w.code.startsWith("media_duration"))).toBe(false);
  });

  test("declaration for a different path does not match", () => {
    const result = expectOk(
      chat.safe(videoParams, {
        media: [{ path: ["contents", 0, "parts", 0], durationSeconds: 7200 }],
      }),
    );
    expect(result.warnings.some((w) => w.code === "media_duration_undeclared")).toBe(true);
  });
});

describe("estimate and budget", () => {
  test("text + image tokens: per-content overhead, ~4 chars/token, 258/image", () => {
    const result = expectOk(
      chat.safe({
        model: "gemini-2.5-flash",
        contents: [
          { role: "user", parts: [{ text: "aaaa" }, { inlineData: { mimeType: "image/png", data: PNG_1X1 } }] },
        ],
      }),
    );
    expect(result.estimate.inputTokens).toBe(4 + 1 + 258);
    expect(result.estimate.costUSD).toBeGreaterThan(0);
  });

  test("worst-case cost uses maxOutputTokens; maxCostUSD enforces budget", () => {
    const result = chat.safe(
      {
        model: "gemini-2.5-flash",
        contents: HELLO,
        generationConfig: { maxOutputTokens: 60000 },
      },
      { maxCostUSD: 0.0001 },
    );
    const issue = expectError(result, "over_budget");
    // ~60000 output tokens at $2.5/1M dominates: >= $0.15
    expect(issue.meta?.estimated as number).toBeGreaterThan(0.1);
  });

  test("over_context fires from the estimate", () => {
    const context = models["gemini-2.5-flash-image"].limit.context;
    const result = chat.safe({
      model: "gemini-2.5-flash-image",
      contents: [{ role: "user", parts: [{ text: "x".repeat(context * 5) }] }],
    });
    expectError(result, "over_context");
  });
});

describe("throwing form", () => {
  test("invalid params throw UnmodelValidationError", () => {
    expect(() =>
      chat({
        model: "gemini-2.5-flash-image",
        contents: HELLO,
        // @ts-expect-error — `tools` is `never` on a `toolCall: false` model;
        // the throwing form still has to throw for a JS caller.
        tools: [{ functionDeclarations: [{ name: "f" }] }],
      }),
    ).toThrow(/unsupported/);
  });
});

// ---------------------------------------------------------------------------
// generationConfig: documented ranges/enums (REST reference GenerationConfig).
// ---------------------------------------------------------------------------

describe("generationConfig ranges and enums", () => {
  test("temperature outside the documented [0, 2] range fails", () => {
    for (const temperature of [-0.1, 2.5]) {
      const issue = expectError(
        chat.safe({
          model: "gemini-2.5-flash",
          contents: HELLO,
          generationConfig: { temperature },
        }),
        "invalid_enum_value",
      );
      expect(issue.path).toEqual(["generationConfig", "temperature"]);
      expect(issue.meta?.max).toBe(2);
    }
  });

  test("the range boundaries themselves pass", () => {
    for (const temperature of [0, 2]) {
      expectOk(
        chat.safe({
          model: "gemini-2.5-flash",
          contents: HELLO,
          generationConfig: { temperature },
        }),
      );
    }
  });

  test("topP and topK stay permissive (no documented range)", () => {
    expectOk(
      chat.safe({
        model: "gemini-2.5-flash",
        contents: HELLO,
        generationConfig: { topP: 0.95, topK: 512 },
      }),
    );
  });

  test("logprobs above 20 fails, and logprobs without responseLogprobs fails", () => {
    expectError(
      chat.safe({
        model: "gemini-2.5-flash",
        contents: HELLO,
        generationConfig: { logprobs: 21, responseLogprobs: true },
      }),
      "invalid_enum_value",
    );
    const issue = expectError(
      chat.safe({
        model: "gemini-2.5-flash",
        contents: HELLO,
        generationConfig: { logprobs: 5 },
      }),
      "unsupported_param",
    );
    expect(issue.path).toEqual(["generationConfig", "logprobs"]);
  });

  test("more than 5 stopSequences fails", () => {
    const issue = expectError(
      chat.safe({
        model: "gemini-2.5-flash",
        contents: HELLO,
        generationConfig: { stopSequences: ["a", "b", "c", "d", "e", "f"] },
      }),
      "invalid_shape",
    );
    expect(issue.meta?.limit).toBe(5);
  });

  test("an unknown responseModalities value fails; documented ones (any case) pass", () => {
    expectError(
      chat.safe({
        model: "gemini-2.5-flash",
        contents: HELLO,
        generationConfig: { responseModalities: ["VIDEO" as never] },
      }),
      "invalid_enum_value",
    );
    expectOk(
      chat.safe({
        model: "gemini-2.5-flash-image",
        contents: HELLO,
        generationConfig: { responseModalities: ["Text", "Image"] },
      }),
    );
  });

  test("an unknown thinkingLevel or mediaResolution fails", () => {
    expectError(
      chat.safe({
        model: "gemini-2.5-flash",
        contents: HELLO,
        generationConfig: { thinkingConfig: { thinkingLevel: "EXTREME" } },
      }),
      "invalid_enum_value",
    );
    expectError(
      chat.safe({
        model: "gemini-2.5-flash",
        contents: HELLO,
        generationConfig: { mediaResolution: "MEDIA_RESOLUTION_ULTRA" as never },
      }),
      "invalid_enum_value",
    );
    expectOk(
      chat.safe({
        model: "gemini-2.5-flash",
        contents: HELLO,
        generationConfig: { thinkingConfig: { thinkingLevel: "HIGH" } },
      }),
    );
  });

  test("a model that cannot return the requested modality fails", () => {
    const issue = expectError(
      chat.safe({
        model: "gemini-2.5-flash",
        contents: HELLO,
        // @ts-expect-error — a text-only model's `responseModalities` arm has
        // no IMAGE member. This is the largest of the four google arms.
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
      "unsupported_capability",
    );
    expect(issue.path).toEqual(["generationConfig", "responseModalities", 0]);
  });
});

// ---------------------------------------------------------------------------
// Nano Banana image generation through generateContent.
// ---------------------------------------------------------------------------

describe("image generation config", () => {
  // Narrowed from `GoogleModality[]`: the per-model arms type
  // `responseModalities` as that model's own output modalities, and a hoisted
  // wide annotation is exactly the class-D bite the arms exist to fix. These
  // are all image models, so this is what a real caller would write too.
  const TEXT_IMAGE: Array<"TEXT" | "IMAGE"> = ["TEXT", "IMAGE"];

  test("imageConfig and responseFormat.image are validated identically", () => {
    // Annotated: `aspectRatio` is a closed union, so the array literal needs a
    // contextual type or "1:8" widens to `string` and stops being assignable.
    const configs: GoogleGenerationConfig[] = [
      { responseModalities: TEXT_IMAGE, imageConfig: { aspectRatio: "1:8" } },
      {
        responseModalities: TEXT_IMAGE,
        responseFormat: { image: { aspectRatio: "1:8" } },
      },
    ];
    for (const generationConfig of configs) {
      // The honest ceiling of Tier A, exercised on purpose: a HOISTED
      // `GoogleGenerationConfig` variable is the wide type, and the per-model
      // arms narrow the call SITE, not the world. That is also why this loop
      // is the right shape for the test — one value, deliberately fed to a
      // model whose table allows it and one whose table does not, which no
      // literal call site could express.
      const wide = generationConfig as never;
      // 1:8 is documented for 3.1 Flash Image …
      expectOk(
        chat.safe({
          model: "gemini-3.1-flash-image",
          contents: HELLO,
          generationConfig: wide,
        }),
      );
      // … but not for Nano Banana Pro, whose table lists 10 ratios.
      expectError(
        chat.safe({ model: "gemini-3-pro-image", contents: HELLO, generationConfig: wide }),
        "invalid_enum_value",
      );
    }
  });

  test("the proto enum spelling of an allowed ratio passes too", () => {
    expectOk(
      chat.safe({
        model: "gemini-3-pro-image",
        contents: HELLO,
        generationConfig: {
          responseFormat: { image: { aspectRatio: "ASPECT_RATIO_SIXTEEN_BY_NINE" } },
        },
      }),
    );
  });

  test("every aspectRatio / imageSize preset validates in both spellings", () => {
    // Keep in sync with GoogleImageAspectRatio + GoogleImageAspectRatioEnumName
    // and GoogleImageSize + GoogleImageSizeEnumName in ./wire: those unions are
    // closed, so every value they advertise has to pass the runtime check that
    // backs them. gemini-3.1-flash-image is the model whose table lists all 14
    // ratios and all 4 sizes.
    const model = "gemini-3.1-flash-image";
    for (const ratio of GEMINI_IMAGE_ASPECT_RATIOS) {
      const enumName = GEMINI_IMAGE_ASPECT_RATIO_ENUM_NAMES[ratio] as GoogleImageAspectRatioEnumName;
      for (const aspectRatio of [ratio, enumName]) {
        const result = expectOk(
          chat.safe({
            model,
            contents: HELLO,
            generationConfig: { responseModalities: TEXT_IMAGE, imageConfig: { aspectRatio } },
          }),
        );
        expect(result.warnings, `aspectRatio ${aspectRatio} should be warning-free`).toEqual([]);
      }
    }
    for (const size of GEMINI_IMAGE_SIZES) {
      const enumName = GEMINI_IMAGE_SIZE_ENUM_NAMES[size] as GoogleImageSizeEnumName;
      for (const imageSize of [size, enumName]) {
        const result = expectOk(
          chat.safe({
            model,
            contents: HELLO,
            generationConfig: { responseModalities: TEXT_IMAGE, imageConfig: { imageSize } },
          }),
        );
        expect(result.warnings, `imageSize ${imageSize} should be warning-free`).toEqual([]);
      }
    }

    // Both directions of the drift the hand-written unions in wire.ts risk: the
    // literal arrays are typed as the unions (a name constraints.ts adds that
    // wire.ts lacks is a compile error) and compared to the maps' own values (a
    // name wire.ts has that constraints.ts spells differently fails here).
    const ratioNames: GoogleImageAspectRatioEnumName[] = [
      "ASPECT_RATIO_ONE_BY_ONE",
      "ASPECT_RATIO_ONE_BY_FOUR",
      "ASPECT_RATIO_FOUR_BY_ONE",
      "ASPECT_RATIO_ONE_BY_EIGHT",
      "ASPECT_RATIO_EIGHT_BY_ONE",
      "ASPECT_RATIO_TWO_BY_THREE",
      "ASPECT_RATIO_THREE_BY_TWO",
      "ASPECT_RATIO_THREE_BY_FOUR",
      "ASPECT_RATIO_FOUR_BY_THREE",
      "ASPECT_RATIO_FOUR_BY_FIVE",
      "ASPECT_RATIO_FIVE_BY_FOUR",
      "ASPECT_RATIO_NINE_BY_SIXTEEN",
      "ASPECT_RATIO_SIXTEEN_BY_NINE",
      "ASPECT_RATIO_TWENTY_ONE_BY_NINE",
    ];
    expect(Object.values(GEMINI_IMAGE_ASPECT_RATIO_ENUM_NAMES).sort()).toEqual(ratioNames.sort());
    const sizeNames: GoogleImageSizeEnumName[] = [
      "IMAGE_SIZE_FIVE_TWELVE",
      "IMAGE_SIZE_ONE_K",
      "IMAGE_SIZE_TWO_K",
      "IMAGE_SIZE_FOUR_K",
    ];
    expect(Object.values(GEMINI_IMAGE_SIZE_ENUM_NAMES).sort()).toEqual(sizeNames.sort());
  });

  test("imageSize is per-model: Lite stops at 1K, Pro has no 512, 2.5 Flash takes none", () => {
    expectOk(
      chat.safe({
        model: "gemini-3.1-flash-image",
        contents: HELLO,
        generationConfig: { imageConfig: { imageSize: "4K" } },
      }),
    );
    expectError(
      chat.safe({
        model: "gemini-3.1-flash-lite-image",
        contents: HELLO,
        // @ts-expect-error — this model's table lists 512 and 1K only.
        generationConfig: { imageConfig: { imageSize: "4K" } },
      }),
      "invalid_enum_value",
    );
    expectError(
      chat.safe({
        model: "gemini-3-pro-image",
        contents: HELLO,
        // @ts-expect-error — the Pro table has no 512 column.
        generationConfig: { imageConfig: { imageSize: "512" } },
      }),
      "invalid_enum_value",
    );
    const issue = expectError(
      chat.safe({
        model: "gemini-2.5-flash-image",
        contents: HELLO,
        // @ts-expect-error — this model has one fixed resolution and takes no
        // `imageSize` at all, which the arm spells `never`.
        generationConfig: { imageConfig: { imageSize: "2K" } },
      }),
      "unsupported_param",
    );
    expect(issue.path).toEqual(["generationConfig", "imageConfig", "imageSize"]);
  });

  test("imageConfig on a text-only model is rejected", () => {
    const issue = expectError(
      chat.safe({
        model: "gemini-2.5-flash",
        contents: HELLO,
        generationConfig: { imageConfig: { aspectRatio: "16:9" } },
      }),
      "unsupported_capability",
    );
    expect(issue.path).toEqual(["generationConfig", "imageConfig"]);
  });

  test("Vertex-only imageConfig keys are rejected", () => {
    const issue = expectError(
      chat.safe({
        model: "gemini-3.1-flash-image",
        contents: HELLO,
        generationConfig: { imageConfig: { outputMimeType: "image/png" as never } },
      }),
      "unsupported_param",
    );
    expect(issue.path).toEqual(["generationConfig", "imageConfig", "outputMimeType"]);
  });

  test("an uncataloged image model keeps unknown_model semantics (no ratio enforcement)", () => {
    const result = expectOk(
      chat.safe({
        model: "gemini-9.9-flash-image",
        contents: HELLO,
        // `as never`: 13:7 is not a documented ratio in either spelling, so it
        // has to bypass the closed union to reach the runtime path under test.
        generationConfig: { imageConfig: { aspectRatio: "13:7" as never } },
      }),
    );
    expect(result.warnings.some((w) => w.code === "unknown_model")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Gemini TTS through generateContent.
// ---------------------------------------------------------------------------

describe("speech generation config", () => {
  const TTS_MODEL = "gemini-3.1-flash-tts-preview";
  // `Array<"AUDIO">`, not `GoogleModality[]`: this model produces audio only,
  // which is precisely what the arm says.
  const AUDIO_ONLY = { responseModalities: ["AUDIO"] as Array<"AUDIO"> };

  test("single-speaker TTS validates", () => {
    expectOk(
      chat.safe({
        model: TTS_MODEL,
        contents: HELLO,
        generationConfig: {
          ...AUDIO_ONLY,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
        },
      }),
    );
  });

  test("an unlisted voice name fails", () => {
    const issue = expectError(
      chat.safe({
        model: TTS_MODEL,
        contents: HELLO,
        generationConfig: {
          ...AUDIO_ONLY,
          // @ts-expect-error `voiceName` is the closed 30-voice union, so this
          // no longer type-checks — which is the point. The runtime path under
          // test is the one a JS caller (or a parsed JSON body) still takes.
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Bartholomew" } } },
        },
      }),
      "invalid_enum_value",
    );
    expect((issue.meta?.allowed as string[]).length).toBe(30);
  });

  test("voiceConfig and multiSpeakerVoiceConfig are mutually exclusive", () => {
    expectError(
      chat.safe({
        model: TTS_MODEL,
        contents: HELLO,
        generationConfig: {
          ...AUDIO_ONLY,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
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
  });

  test("multi-speaker caps at 2 speakers", () => {
    // `voiceName` is narrowed to the 30-voice union rather than `string`: this
    // helper builds a VALID speaker, and the cap under test is the speaker
    // count, not the voice.
    const speaker = (name: string, voiceName: GeminiTtsVoiceName) => ({
      speaker: name,
      voiceConfig: { prebuiltVoiceConfig: { voiceName } },
    });
    expectOk(
      chat.safe({
        model: TTS_MODEL,
        contents: HELLO,
        generationConfig: {
          ...AUDIO_ONLY,
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [speaker("Joe", "Kore"), speaker("Jane", "Puck")],
            },
          },
        },
      }),
    );
    const issue = expectError(
      chat.safe({
        model: TTS_MODEL,
        contents: HELLO,
        generationConfig: {
          ...AUDIO_ONLY,
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [
                speaker("Joe", "Kore"),
                speaker("Jane", "Puck"),
                speaker("Jim", "Leda"),
              ],
            },
          },
        },
      }),
      "invalid_shape",
    );
    expect(issue.meta?.limit).toBe(2);
  });

  test("a TTS model that does not request AUDIO fails", () => {
    const issue = expectError(
      chat.safe({ model: TTS_MODEL, contents: HELLO }),
      "unsupported_capability",
    );
    expect(issue.path).toEqual(["generationConfig", "responseModalities"]);
  });

  test("speechConfig on a non-audio model is rejected", () => {
    const issue = expectError(
      chat.safe({
        model: "gemini-2.5-flash",
        contents: HELLO,
        generationConfig: {
          // @ts-expect-error — `speechConfig` is `never` on a model that does
          // not generate audio.
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
        },
      }),
      "unsupported_capability",
    );
    expect(issue.path).toEqual(["generationConfig", "speechConfig"]);
  });

  test("the documented 32k TTS context window beats models.dev's 8192", () => {
    expect(chatModels[TTS_MODEL]?.limit.context).toBe(32768);
    expect(models[TTS_MODEL].limit.context).toBe(8192);
    // ~20k tokens: over the generated 8192, inside the documented 32k.
    expectOk(
      chat.safe({
        model: TTS_MODEL,
        contents: [{ role: "user", parts: [{ text: "word ".repeat(20000) }] }],
        generationConfig: {
          ...AUDIO_ONLY,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
        },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// The shared TTS battery, reached from the WIDE surface.
//
// `google.chat` and `google.tts` call one implementation (./tts-checks.ts), so
// these assertions exist to prove the wiring rather than to re-test the rules:
// the S7–S11 checks arrived with the dedicated surface, and a chat body can
// reach every one of them.
// ---------------------------------------------------------------------------

describe("the shared TTS check battery on google.chat", () => {
  const AUDIO = { responseModalities: ["AUDIO"] as Array<"AUDIO"> };
  const KORE = { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" as const } } };

  test("the TTS-without-AUDIO message now names the dedicated surface", () => {
    const issue = expectError(
      chat.safe({ model: "gemini-2.5-flash-preview-tts", contents: HELLO }),
      "unsupported_capability",
    );
    expect(issue.message).toContain("google.tts");
    expect(issue.message).toContain("unmodel/tts");
    expect(issue.meta?.surface).toBe("google.tts");
  });

  test("S7 — responseFormat.audio.mimeType is enforced here too", () => {
    const issue = expectError(
      chat.safe({
        model: "gemini-2.5-flash-preview-tts",
        contents: HELLO,
        generationConfig: {
          ...AUDIO,
          speechConfig: KORE,
          responseFormat: { audio: { mimeType: "audio/flac" } },
        },
      }),
      "invalid_enum_value",
    );
    expect(issue.path).toEqual(["generationConfig", "responseFormat", "audio", "mimeType"]);
  });

  test("S8 — bitRate on an uncompressed format is an error here too", () => {
    const issue = expectError(
      chat.safe({
        model: "gemini-2.5-flash-preview-tts",
        contents: HELLO,
        generationConfig: {
          ...AUDIO,
          speechConfig: KORE,
          responseFormat: { audio: { mimeType: "AUDIO_WAV", bitRate: 128000 } },
        },
      }),
      "unsupported_param",
    );
    expect(issue.path).toEqual(["generationConfig", "responseFormat", "audio", "bitRate"]);
  });

  test("S9/S10 — sampleRate sanity and the plausibility band", () => {
    expectError(
      chat.safe({
        model: "gemini-2.5-flash-preview-tts",
        contents: HELLO,
        generationConfig: {
          ...AUDIO,
          speechConfig: KORE,
          responseFormat: { audio: { sampleRate: -1 } },
        },
      }),
      "invalid_shape",
    );

    const banded = chat.safe({
      model: "gemini-2.5-flash-preview-tts",
      contents: HELLO,
      generationConfig: {
        ...AUDIO,
        speechConfig: KORE,
        responseFormat: { audio: { sampleRate: 96000 } },
      },
    });
    expect(banded.ok).toBe(true);
    expect(banded.warnings.some((w) => w.code === "invalid_enum_value")).toBe(true);
  });

  test("S11 — an off-table languageCode warns rather than failing", () => {
    const result = chat.safe({
      model: "gemini-2.5-flash-preview-tts",
      contents: HELLO,
      generationConfig: { ...AUDIO, speechConfig: { ...KORE, languageCode: "zz" } },
    });
    expect(result.ok).toBe(true);
    const warning = result.warnings.find((w) => w.code === "invalid_enum_value");
    expect(warning?.path).toEqual(["generationConfig", "speechConfig", "languageCode"]);
    expect(warning?.meta?.primarySubtag).toBe("zz");
  });

  test("a documented languageCode stays silent", () => {
    const result = chat.safe({
      model: "gemini-2.5-flash-preview-tts",
      contents: HELLO,
      generationConfig: { ...AUDIO, speechConfig: { ...KORE, languageCode: "pt-BR" } },
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.filter((w) => w.code === "invalid_enum_value")).toEqual([]);
  });
});
