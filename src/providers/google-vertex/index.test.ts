import { describe, expect, test } from "bun:test";
import { checkGenerateContent, createGoogleVertex, generateContentUrl } from "./index";
import { TranslationUnavailableError } from "../../core/translate/errors";
import type { ValidateResult } from "../../core/result";

const vertex = createGoogleVertex({ project: "my-project", location: "us-central1" });

function textContents(text: string) {
  return [{ role: "user" as const, parts: [{ text }] }];
}

describe("google-vertex URL construction", () => {
  test("regional endpoint interpolates location, project, and model", () => {
    const v = vertex.generateContent({ model: "gemini-2.5-flash", contents: textContents("hi") });
    expect(v.request.url).toBe(
      "https://us-central1-aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent",
    );
    expect(v.request.method).toBe("POST");
    expect(v.request.headers).toEqual({ "content-type": "application/json" });
  });

  test('location "global" uses the global aiplatform host', () => {
    const global = createGoogleVertex({ project: "p", location: "global" });
    const v = global.generateContent({ model: "gemini-2.5-flash", contents: textContents("hi") });
    expect(v.request.url).toBe(
      "https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/google/models/gemini-2.5-flash:generateContent",
    );
  });

  test("model resource paths are normalized to the bare id", () => {
    const bare = generateContentUrl("p", "us-central1", "gemini-2.5-flash");
    expect(generateContentUrl("p", "us-central1", "models/gemini-2.5-flash")).toBe(bare);
    expect(generateContentUrl("p", "us-central1", "publishers/google/models/gemini-2.5-flash")).toBe(bare);
  });

  test("prefixed model ids still resolve in the catalog (no unknown_model)", () => {
    const r = vertex.generateContent.safe({
      model: "publishers/google/models/gemini-2.5-flash",
      contents: textContents("hi"),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });
});

describe("google-vertex wire body (Gemini generateContent dialect)", () => {
  test("enumerable props are the exact body with model stripped into the URL", () => {
    const v = vertex.generateContent({
      model: "gemini-2.5-flash",
      contents: textContents("hi"),
      systemInstruction: { parts: [{ text: "be brief" }] },
      generationConfig: { temperature: 0.2, maxOutputTokens: 64 },
      labels: { team: "search" },
    });
    expect(Object.keys(v)).toEqual(["contents", "systemInstruction", "generationConfig", "labels"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual({
      contents: textContents("hi"),
      systemInstruction: { parts: [{ text: "be brief" }] },
      generationConfig: { temperature: 0.2, maxOutputTokens: 64 },
      labels: { team: "search" },
    });
  });

  test('toSdk("google-vertex") nests config for @google/genai (vertexai: true), labels included', () => {
    const v = vertex.generateContent({
      model: "gemini-2.5-flash",
      contents: textContents("hi"),
      systemInstruction: { parts: [{ text: "be brief" }] },
      generationConfig: { temperature: 0.2 },
      labels: { team: "search" },
    });
    expect(v.toSdk("google-vertex")).toEqual({
      model: "gemini-2.5-flash",
      contents: textContents("hi"),
      config: {
        temperature: 0.2,
        systemInstruction: { parts: [{ text: "be brief" }] },
        labels: { team: "search" },
      },
    });
  });

  test('toSdk("google-vertex") omits config when only model + contents are set', () => {
    const v = vertex.generateContent({ model: "gemini-2.5-flash", contents: textContents("hi") });
    expect(v.toSdk("google-vertex")).toEqual({ model: "gemini-2.5-flash", contents: textContents("hi") });
  });

  test("toSdk names the available targets when handed an unknown one", () => {
    const v = vertex.generateContent({ model: "gemini-2.5-flash", contents: textContents("hi") });
    expect(() => (v.toSdk as (t: string) => unknown)("google")).toThrow(
      /"google" is not an SDK target for this endpoint\. Available: google-vertex, ai-sdk\./,
    );
  });

  test("google-only top-level params (store) are unknown_param on Vertex", () => {
    const params = {
      model: "gemini-2.5-flash",
      contents: textContents("hi"),
      store: true,
    } as unknown as Parameters<typeof vertex.generateContent.safe>[0];
    const r = vertex.generateContent.safe(params);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
      expect(r.warnings[0]?.path).toEqual(["store"]);
      expect(r.warnings[0]?.message).toContain("google-vertex.generateContent");
    }
  });

  test("parts must set exactly one kind key", () => {
    const r = vertex.generateContent.safe({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{}] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["contents", 0, "parts", 0]);
    }
  });

  test("typo'd top-level keys are a compile error (ExactKeys)", () => {
    const r = vertex.generateContent.safe({
      model: "gemini-2.5-flash",
      contents: textContents("hi"),
      // @ts-expect-error — `generation_config` is a typo of `generationConfig`
      generation_config: {},
    });
    expect(r.ok).toBe(true);
  });
});

describe("google-vertex catalog wiring", () => {
  test("unknown models warn and name the google-vertex catalog", () => {
    const r = vertex.generateContent.safe({ model: "gemini-99-ultra", contents: textContents("hi") });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("the google-vertex catalog");
    }
  });

  test("tools on a model without tool calling is unsupported_capability", () => {
    const r = vertex.generateContent.safe({
      model: "gemini-2.5-flash-image",
      contents: textContents("hi"),
      tools: [{ functionDeclarations: [{ name: "f" }] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.path).toEqual(["tools"]);
    }
  });

  test("maxOutputTokens over the catalog output limit is over_output_limit", () => {
    const r = vertex.generateContent.safe({
      model: "gemini-2.5-flash",
      contents: textContents("hi"),
      generationConfig: { maxOutputTokens: 65537 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.errors[0]?.path).toEqual(["generationConfig", "maxOutputTokens"]);
    }
  });

  test("media kinds outside the model's input modalities error", () => {
    // gemini-2.5-flash-image accepts text + image only.
    const r = vertex.generateContent.safe({
      model: "gemini-2.5-flash-image",
      contents: [
        { role: "user", parts: [{ inlineData: { mimeType: "video/mp4", data: "AAAA" } }] },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.path).toEqual(["contents", 0, "parts", 0]);
      expect(r.errors[0]?.meta?.kind).toBe("video");
    }
  });

  test("estimate prices tokens from the google-vertex catalog", () => {
    // "hello world!" = 3 heuristic tokens + 4 per-message overhead = 7.
    const r = vertex.generateContent.safe({
      model: "gemini-2.5-flash",
      contents: textContents("hello world!"),
      generationConfig: { maxOutputTokens: 100 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.estimate.inputTokens).toBe(7);
      // gemini-2.5-flash on Vertex: $0.30/M input, $2.50/M output.
      expect(r.estimate.costUSD).toBeCloseTo((7 * 0.3 + 100 * 2.5) / 1e6, 12);
    }
  });
});

describe("google-vertex checkGenerateContent", () => {
  test("maps usage and prices with google-vertex catalog rates", () => {
    const report = checkGenerateContent({
      modelVersion: "gemini-2.5-flash",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1_000_000, candidatesTokenCount: 0, totalTokenCount: 1_000_000 },
    });
    expect(report.warnings).toEqual([]);
    expect(report.usage).toEqual({ inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 });
    expect(report.costUSD).toBeCloseTo(0.3, 10);
  });

  test("MAX_TOKENS truncation warns (delegated to the shared dialect checker)", () => {
    const report = checkGenerateContent({ candidates: [{ finishReason: "MAX_TOKENS" }] });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.meta?.kind).toBe("truncated");
    expect(report.costUSD).toBeUndefined();
  });

  test("unknown modelVersion yields no cost, never a throw", () => {
    const report = checkGenerateContent({
      modelVersion: "not-a-gemini",
      usageMetadata: { promptTokenCount: 10 },
    });
    expect(report.costUSD).toBeUndefined();
    expect(report.usage.inputTokens).toBe(10);
  });

  test("thoughts are billed at the output rate", () => {
    const report = checkGenerateContent({
      modelVersion: "gemini-2.5-flash",
      usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 100, thoughtsTokenCount: 900 },
    });
    // (100 + 900) output tokens at $2.50/M.
    expect(report.costUSD).toBeCloseTo((1000 * 2.5) / 1e6, 12);
    expect(report.usage.reasoningTokens).toBe(900);
  });
});

describe("google-vertex.generateContent toApi", () => {
  const gemini = () =>
    vertex.generateContent({
      model: "gemini-2.5-flash",
      contents: textContents("hi"),
      generationConfig: { temperature: 0.2 },
    });

  test("retargets to the Gemini API same-dialect: body copied, model back into the URL", () => {
    const routed = gemini().toApi("google");
    // The model id lives in the URL path on BOTH surfaces, so the retargeted
    // wire body still carries no `model` key.
    expect(Object.keys(routed)).toEqual(["contents", "generationConfig"]);
    expect(routed.request.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    expect(routed.request.method).toBe("POST");
    expect(routed.request.headers).toEqual({ "content-type": "application/json" });
    expect(routed.target).toBe("google");
  });

  test("an identical spelling is not audited — nothing about the model changed", () => {
    // Vertex and the Gemini API both call this model `gemini-2.5-flash`, so
    // there is no respelling to record. `warnings` is an inventory of what the
    // translation cost, so an entry saying "x is spelled x" is noise.
    const routed = gemini().toApi("google");
    expect(routed.warnings).toEqual([]);
  });

  test("toApi/toApiSafe/warnings/target are non-enumerable", () => {
    const routed = gemini().toApi("google");
    for (const key of ["toSdk", "request", "warnings", "target"]) {
      expect(Object.getOwnPropertyDescriptor(routed, key)?.enumerable).toBe(false);
    }
    expect(JSON.parse(JSON.stringify(routed))).toEqual({
      contents: textContents("hi"),
      generationConfig: { temperature: 0.2 },
    });
  });

  test("a provider that does not serve the model is an error naming the ones that do", () => {
    const validated = gemini() as unknown as { toApiSafe(target: string): ValidateResult<object> };
    const result = validated.toApiSafe("groq");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toEqual(["unsupported_capability"]);
      expect(result.errors[0]?.message).toContain('"gemini-2.5-flash" is not served by groq');
      expect(result.errors[0]?.message).toContain("google");
    }
  });

  test("a cross-dialect target throws a structural error until the gemini codec ships", () => {
    expect(() => gemini().toApi("openrouter")).toThrow(TranslationUnavailableError);
    expect(() => gemini().toApi("openrouter")).toThrow(
      /crosses wire dialects \(gemini → openai-chat\)/,
    );
  });
});
