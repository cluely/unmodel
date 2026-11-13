import { describe, expect, test } from "bun:test";
import { checkChat, createGoogleVertex, generateContentUrl, models } from "./index";
import { availability } from "../../catalog/availability/google-vertex.gen";
import { TranslationUnavailableError } from "../../core/translate/errors";
import type { ValidateResult } from "../../core/result";

const vertex = createGoogleVertex({ project: "my-project", location: "us-central1" });

function textContents(text: string) {
  return [{ role: "user" as const, parts: [{ text }] }];
}

describe("google-vertex URL construction", () => {
  test("regional endpoint interpolates location, project, and model", () => {
    const v = vertex.chat({ model: "gemini-2.5-flash", contents: textContents("hi") });
    expect(v.request.url).toBe(
      "https://us-central1-aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent",
    );
    expect(v.request.method).toBe("POST");
    expect(v.request.headers).toEqual({ "content-type": "application/json" });
  });

  test('location "global" uses the global aiplatform host', () => {
    const global = createGoogleVertex({ project: "p", location: "global" });
    const v = global.chat({ model: "gemini-2.5-flash", contents: textContents("hi") });
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
    // gemini-2.5-flash carries `status: "deprecated"` on Vertex, so a
    // zero-warning assertion uses a current row.
    const r = vertex.chat.safe({
      model: "publishers/google/models/gemini-3.5-flash-lite",
      contents: textContents("hi"),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });
});

describe("google-vertex wire body (Gemini generateContent dialect)", () => {
  test("enumerable props are the exact body with model stripped into the URL", () => {
    const v = vertex.chat({
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
    const v = vertex.chat({
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
    const v = vertex.chat({ model: "gemini-2.5-flash", contents: textContents("hi") });
    expect(v.toSdk("google-vertex")).toEqual({ model: "gemini-2.5-flash", contents: textContents("hi") });
  });

  test("toSdk names the available targets when handed an unknown one", () => {
    const v = vertex.chat({ model: "gemini-2.5-flash", contents: textContents("hi") });
    expect(() => (v.toSdk as (t: string) => unknown)("google")).toThrow(
      /"google" is not an SDK target for this endpoint\. Available: google-vertex, ai-sdk\./,
    );
  });

  test("google-only top-level params (store) are unknown_param on Vertex", () => {
    const params = {
      model: "gemini-3.5-flash-lite",
      contents: textContents("hi"),
      store: true,
    } as unknown as Parameters<typeof vertex.chat.safe>[0];
    const r = vertex.chat.safe(params);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
      expect(r.warnings[0]?.path).toEqual(["store"]);
      expect(r.warnings[0]?.message).toContain("google-vertex.chat");
    }
  });

  test("parts must set exactly one kind key", () => {
    const r = vertex.chat.safe({
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
    const r = vertex.chat.safe({
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
    const r = vertex.chat.safe({ model: "gemini-99-ultra", contents: textContents("hi") });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("the google-vertex catalog");
    }
  });

  test("tools on a model without tool calling is unsupported_capability", () => {
    const r = vertex.chat.safe({
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
    const r = vertex.chat.safe({
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
    const r = vertex.chat.safe({
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
    const r = vertex.chat.safe({
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

describe("google-vertex new Gemini rows (models.dev 2026-11-12)", () => {
  // Every rate is the generated google-vertex row: input / output per 1M.
  // argon/carbon: the promotional rate "through November 30, 2026" ("50%
  // credits back on net spend"); the page lists $4.00 / $20.00 / $0.20
  // "Starting December 1, 2026". Source:
  // https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing,
  // retrieved 2026-11-12. The first codegen:refresh after that date is
  // expected to move these two rows.
  const rows = [
    ["gemini-4-argon", 2, 10],
    ["gemini-4-carbon", 2, 10],
    ["gemini-4-hydrogen", 1.5, 7.5],
    ["gemini-nano-banana-2.1", 1.5, 30],
    ["gemini-3.1-flash-lite-image", 0.25, 30],
  ] as const;

  test.each(rows)("%s validates clean and prices from the catalog", (model, input, output) => {
    const r = vertex.chat.safe({
      model,
      contents: textContents("hello world!"),
      generationConfig: { maxOutputTokens: 100 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(r.estimate.costUSD).toBeCloseTo((7 * input + 100 * output) / 1e6, 12);
    }
  });

  test("checkChat prices a Gemini 4 response at the vertex rate", () => {
    const report = checkChat({
      modelVersion: "gemini-4-hydrogen",
      usageMetadata: { promptTokenCount: 1_000_000, candidatesTokenCount: 0 },
    });
    expect(report.costUSD).toBeCloseTo(1.5, 10);
  });
});

describe("google-vertex Gemini 4 thinking (Vertex model pages, 2026-11-12)", () => {
  test.each(["gemini-4-argon", "gemini-4-carbon", "gemini-4-hydrogen"])(
    "%s refuses any thinkingBudget, even alone",
    (model) => {
      const r = vertex.chat.safe({
        model,
        contents: textContents("hi"),
        generationConfig: { thinkingConfig: { thinkingBudget: 1024 } },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors.map((e) => e.code)).toEqual(["unsupported_param"]);
        expect(r.errors[0]?.path).toEqual(["generationConfig", "thinkingConfig", "thinkingBudget"]);
        expect(r.errors[0]?.message).toContain("set `thinkingLevel` to one of LOW, MEDIUM, HIGH");
        expect(r.errors[0]?.meta?.source).toBe(
          `https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/${model.slice("gemini-".length)}`,
        );
      }
    },
  );

  test("MINIMAL is refused and the message names the levels the model takes", () => {
    const r = vertex.chat.safe({
      model: "publishers/google/models/gemini-4-hydrogen",
      contents: textContents("hi"),
      generationConfig: { thinkingConfig: { thinkingLevel: "MINIMAL" } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["generationConfig", "thinkingConfig", "thinkingLevel"]);
      expect(r.errors[0]?.meta?.allowed).toEqual(["LOW", "MEDIUM", "HIGH", "XHIGH"]);
    }
    const argon = vertex.chat.safe({
      model: "gemini-4-argon",
      contents: textContents("hi"),
      generationConfig: { thinkingConfig: { thinkingLevel: "MINIMAL" } },
    });
    expect(argon.ok).toBe(false);
    if (!argon.ok) expect(argon.errors[0]?.meta?.allowed).toEqual(["LOW", "MEDIUM", "HIGH"]);
  });

  test("the documented levels pass, XHIGH included on hydrogen", () => {
    for (const [model, thinkingLevel] of [
      ["gemini-4-hydrogen", "XHIGH"],
      ["gemini-4-carbon", "HIGH"],
      ["gemini-4-argon", "LOW"],
    ] as const) {
      const r = vertex.chat.safe({
        model,
        contents: textContents("hi"),
        generationConfig: { thinkingConfig: { thinkingLevel, includeThoughts: true } },
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings, model).toEqual([]);
    }
  });

  test("XHIGH off hydrogen is a warning naming the page's levels, never a refusal", () => {
    for (const model of ["gemini-4-carbon", "gemini-4-argon"]) {
      const r = vertex.chat.safe({
        model,
        contents: textContents("hi"),
        generationConfig: { thinkingConfig: { thinkingLevel: "XHIGH" } },
      });
      expect(r.ok, model).toBe(true);
      if (r.ok) {
        expect(r.warnings.map((w) => w.code)).toEqual(["invalid_enum_value"]);
        expect(r.warnings[0]?.path).toEqual(["generationConfig", "thinkingConfig", "thinkingLevel"]);
        expect(r.warnings[0]?.meta?.documented).toEqual(["LOW", "MEDIUM", "HIGH"]);
      }
    }
  });

  test("older Gemini rows keep their thinkingBudget", () => {
    const r = vertex.chat.safe({
      model: "gemini-3.5-flash-lite",
      contents: textContents("hi"),
      generationConfig: { thinkingConfig: { thinkingBudget: 1024 } },
    });
    expect(r.ok).toBe(true);
  });
});

describe("google-vertex Gemini 4 sampling is ignored, not refused (Vertex model pages, 2026-11-12)", () => {
  test.each(["gemini-4-argon", "gemini-4-carbon", "gemini-4-hydrogen"])(
    "%s accepts temperature, topP and topK with one ignored-warning each",
    (model) => {
      const r = vertex.chat.safe({
        model,
        contents: textContents("hi"),
        generationConfig: { temperature: 0.2, topP: 0.5, topK: 10 },
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.warnings.map((w) => [w.code, w.path.at(-1), w.meta?.ignored])).toEqual([
          ["unsupported_param", "temperature", true],
          ["unsupported_param", "topP", true],
          ["unsupported_param", "topK", true],
        ]);
        expect(r.warnings[0]?.message).toContain("is ignored by");
      }
    },
  );

  test("a row with temperature: false and no page rule is still refused", () => {
    const r = vertex.chat.safe({
      model: "gemini-embedding-001",
      contents: textContents("hi"),
      generationConfig: { temperature: 0.2 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["generationConfig", "temperature"]);
  });
});

describe("google-vertex gemini-nano-banana-2.1 sampling (Vertex model page, 2026-11-12)", () => {
  test("seed, topK, logprobs, temperature and topP are each refused", () => {
    const r = vertex.chat.safe({
      model: "gemini-nano-banana-2.1",
      contents: textContents("a red bicycle"),
      generationConfig: { temperature: 0.5, topP: 0.9, topK: 40, seed: 7, logprobs: 2 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path.at(-1))).toEqual(["temperature", "topP", "topK", "seed", "logprobs"]);
      expect(new Set(r.errors.map((e) => e.code))).toEqual(new Set(["unsupported_param"]));
      expect(r.errors[0]?.meta?.source).toBe(
        "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/nano-banana-2-1",
      );
    }
  });

  test("an image request without sampling fields passes", () => {
    const r = vertex.chat.safe({
      model: "gemini-nano-banana-2.1",
      contents: textContents("a red bicycle"),
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], candidateCount: 1 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });
});

describe("google-vertex built-in tools on models without function calling (Vertex model pages, 2026-11-13)", () => {
  const imageModels = ["gemini-nano-banana-2.1", "gemini-3-pro-image", "gemini-3.1-flash-image"] as const;

  test("each allowlisted id is a `toolCall: false` row, so the allowlist is what opens googleSearch", () => {
    for (const model of imageModels) expect(models[model].toolCall).toBe(false);
  });

  test.each([...imageModels])("%s accepts Google Search grounding with no warnings", (model) => {
    const r = vertex.chat.safe({ model, contents: textContents("hi"), tools: [{ googleSearch: {} }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("image search rides the same googleSearch tool on gemini-nano-banana-2.1", () => {
    // "Grounding Google Search, Image search Supported"; the grounding guide
    // spells it `googleSearch.searchTypes.imageSearch`.
    const r = vertex.chat.safe({
      model: "gemini-nano-banana-2.1",
      contents: textContents("hi"),
      tools: [{ googleSearch: { searchTypes: { imageSearch: {}, webSearch: {} } } }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("functionDeclarations is still refused, at its own path, naming what the model offers", () => {
    const r = vertex.chat.safe({
      model: "gemini-nano-banana-2.1",
      contents: textContents("hi"),
      tools: [{ googleSearch: {} }, { functionDeclarations: [{ name: "f" }] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => [e.code, e.path])).toEqual([
        ["unsupported_capability", ["tools", 1, "functionDeclarations"]],
      ]);
      expect(r.errors[0]?.message).toContain("does not support function calling");
      expect(r.errors[0]?.message).toContain("supports only googleSearch");
      expect(r.errors[0]?.meta?.source).toBe(
        "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/nano-banana-2-1",
      );
    }
  });

  test("codeExecution and urlContext stay refused (\"Not supported\" on the page)", () => {
    const r = vertex.chat.safe({
      model: "gemini-nano-banana-2.1",
      contents: textContents("hi"),
      tools: [{ codeExecution: {} }, { urlContext: {} }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path)).toEqual([
        ["tools", 0, "codeExecution"],
        ["tools", 1, "urlContext"],
      ]);
    }
  });

  test("gemini-2.5-flash-image keeps refusing googleSearch (\"Grounding Not supported\")", () => {
    const r = vertex.chat.safe({
      model: "gemini-2.5-flash-image",
      contents: textContents("hi"),
      tools: [{ googleSearch: {} }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["tools"]);
  });
});

describe("google-vertex Gemini 4 long decode (Vertex guides, 2026-11-13)", () => {
  const gemini4 = ["gemini-4-argon", "gemini-4-carbon", "gemini-4-hydrogen"] as const;
  const guide = (model: string) =>
    `https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/${model}#long-decodes`;

  test.each([131072, 256000])("gemini-4-carbon accepts the guide's maxOutputTokens %d with one warning", (value) => {
    const r = vertex.chat.safe({
      model: "gemini-4-carbon",
      contents: textContents("hi"),
      generationConfig: { maxOutputTokens: value },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => [w.code, w.severity, w.path])).toEqual([
        ["over_output_limit", "warning", ["generationConfig", "maxOutputTokens"]],
      ]);
      expect(r.warnings[0]?.message).toContain("v1beta1");
      expect(r.warnings[0]?.message).toContain('.toSdk("google-vertex")');
      expect(r.warnings[0]?.meta?.source).toBe(guide("gemini-4-carbon"));
    }
  });

  test.each([...gemini4])("%s takes 1,048,576 and refuses 1,048,577", (model) => {
    const ceiling = vertex.chat.safe({
      model,
      contents: textContents("hi"),
      generationConfig: { maxOutputTokens: 1_048_576 },
    });
    expect(ceiling.ok).toBe(true);
    const over = vertex.chat.safe({
      model,
      contents: textContents("hi"),
      generationConfig: { maxOutputTokens: 1_048_577 },
    });
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.errors.map((e) => e.code)).toEqual(["over_output_limit"]);
      expect(over.errors[0]?.meta?.limit).toBe(1_048_576);
      expect(over.errors[0]?.meta?.source).toBe(guide(model));
    }
  });

  test("within one segment there is no warning", () => {
    const r = vertex.chat.safe({
      model: "gemini-4-hydrogen",
      contents: textContents("hi"),
      generationConfig: { maxOutputTokens: 65_536 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });
});

describe("google-vertex.chat non-Gemini route signpost", () => {
  test.each([
    ["xai/grok-4.7", "endpoints/openapi/chat/completions"],
    ["zai-org/glm-5.2-maas", "endpoints/openapi/chat/completions"],
    ["mistral-medium-3", "publishers/mistralai/models/{model}:rawPredict"],
    ["claude-opus-5-5@default", "publishers/anthropic/models/{model}:rawPredict"],
  ])("%s warns and names the route Vertex serves it on", (model, route) => {
    const r = vertex.chat.safe({ model, contents: textContents("hi") });
    // A WARNING, not an error: the substrate never refuses what the API might
    // fulfil, and the request is still built exactly as written.
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const signpost = r.warnings.find((w) => w.code === "unsupported_capability");
    expect(signpost?.path).toEqual(["model"]);
    expect(signpost?.meta?.route).toContain(route);
    expect(signpost?.message).toContain("unmodel has no validator for that route");
    expect(r.params.request.url).toContain(`/publishers/google/models/${model}:generateContent`);
  });

  test("a Gemini row gets no signpost", () => {
    const r = vertex.chat.safe({ model: "gemini-3.5-flash-lite", contents: textContents("hi") });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("the warned rows are exactly the non-default surfaces and the deny list the package records", async () => {
    // SURFACE_RULES (scripts/availability.ts) labels the `-maas` and `xai/`
    // rows `google-vertex.chatMaas` in the generated availability data; the
    // google-vertex deny refs (data/availability-overrides.json) cover the
    // Claude and Mistral rows. Drift in either direction is a silent hole.
    const overrides = (await Bun.file(
      new URL("../../../data/availability-overrides.json", import.meta.url).pathname,
    ).json()) as { deny: [string, string][] };
    const denied = overrides.deny
      .map(([, target]) => target)
      .filter((ref) => ref.startsWith("google-vertex:"))
      .map((ref) => {
        const body = ref
          .slice("google-vertex:".length)
          .split("*")
          .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*");
        return new RegExp(`^${body}$`);
      });
    const ids = Object.keys(models);
    const offSurface = ids.filter((id) => {
      const self = (availability as Record<string, Record<string, unknown>>)[id]?.["google-vertex"];
      return typeof self === "object" && self !== null && "endpoint" in self;
    });
    const expected = [...new Set([...offSurface, ...ids.filter((id) => denied.some((re) => re.test(id)))])].sort();
    const warned = ids
      .filter((id) => {
        const r = vertex.chat.safe({ model: id, contents: textContents("hi") });
        return r.warnings.some((w) => w.code === "unsupported_capability" && w.path[0] === "model");
      })
      .sort();
    expect(warned).toEqual(expected);
    // And the chatMaas rows are the ones pointed at the OpenAI-compatible route.
    for (const id of offSurface) {
      const r = vertex.chat.safe({ model: id, contents: textContents("hi") });
      const signpost = r.warnings.find((w) => w.code === "unsupported_capability" && w.path[0] === "model");
      expect(String(signpost?.meta?.route), id).toContain("endpoints/openapi/chat/completions");
    }
  });
});

describe("google-vertex checkChat", () => {
  test("maps usage and prices with google-vertex catalog rates", () => {
    const report = checkChat({
      modelVersion: "gemini-2.5-flash",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1_000_000, candidatesTokenCount: 0, totalTokenCount: 1_000_000 },
    });
    expect(report.warnings).toEqual([]);
    expect(report.usage).toEqual({ inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 });
    expect(report.costUSD).toBeCloseTo(0.3, 10);
  });

  test("MAX_TOKENS truncation warns (delegated to the shared dialect checker)", () => {
    const report = checkChat({ candidates: [{ finishReason: "MAX_TOKENS" }] });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.meta?.kind).toBe("truncated");
    expect(report.costUSD).toBeUndefined();
  });

  test("unknown modelVersion yields no cost, never a throw", () => {
    const report = checkChat({
      modelVersion: "not-a-gemini",
      usageMetadata: { promptTokenCount: 10 },
    });
    expect(report.costUSD).toBeUndefined();
    expect(report.usage.inputTokens).toBe(10);
  });

  test("thoughts are billed at the output rate", () => {
    const report = checkChat({
      modelVersion: "gemini-2.5-flash",
      usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 100, thoughtsTokenCount: 900 },
    });
    // (100 + 900) output tokens at $2.50/M.
    expect(report.costUSD).toBeCloseTo((1000 * 2.5) / 1e6, 12);
    expect(report.usage.reasoningTokens).toBe(900);
  });
});

describe("google-vertex.chat toApi", () => {
  const gemini = () =>
    vertex.chat({
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
